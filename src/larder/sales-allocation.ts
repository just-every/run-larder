// Reviewed sales reservation splits. Physical movements and commercial terms
// stay with their existing doors; approval never implies a customer date change.
import { open } from './availability'
import { decimal, format, max, min, times } from './decimal'
import { bump, fresh, get, list, row, text, type Context, type Row } from './model'
import { fail, forbidden } from './problem'
import { pickedQuantity, deliveries } from './sales-schedules'
import { availableAt, balance, reservedQuantity, reserve } from './stock'
import { assertLotNotHeld } from './quality'
import { lotBlock } from './lot-dates'

export function salesAllocation(c: Context, type: string, p: any): Row | undefined {
  if (!['so.allocationPreview', 'so.allocationApprove'].includes(type)) return
  if (c.actor.role !== 'owner') forbidden('Only the owner reviews and approves sales reservation splits pending policy approval.')
  if (type === 'so.allocationPreview') {
    const receipt = get(c.s, 'receipts', p.receiptId, 'receipt')
    const item = get(c.s, 'items', p.itemId, 'item'), location = get(c.s, 'locations', p.locationId, 'location')
    if (location.archived) fail('ARCHIVED', 'Choose an active location.')
    const day = c.now.slice(0, 10)
    const sourceLines = receipt.lines.filter((l: any) => l.itemId === item.id && l.locationId === location.id && l.inspection === 'accept')
    if (!sourceLines.length) fail('INPUT', 'Choose accepted receipt stock at this location.')
    const lots = [...new Set<string>(sourceLines.map((l: any) => l.lotId ?? ''))]
    const accepted = lots.reduce((total, lotId) => {
      const lot = c.s.lots.find(l => l.id === lotId)
      if (lot?.ownerId || (lot && lotBlock(lot, day))) return total
      assertLotNotHeld(c.s, lotId, 'allocated from this receipt')
      const received = sourceLines.filter((l: any) => (l.lotId ?? '') === lotId).reduce((n: bigint, l: any) => n + decimal(l.quantity), 0n)
      return total + max(0n, min(received, balance(c.s, item.id, location.id, 'available', lotId)))
    }, 0n)
    const seen = new Set<string>()
    const effects = list(p.allocations, 'sales allocation lines', 20).map((input: any) => {
      const order = get(c.s, 'salesOrders', input.orderId, 'sales order')
      if (!['confirmed', 'part shipped'].includes(order.status)) fail('STATE', 'Allocate only to open confirmed orders.')
      const line = order.lines.find((l: any) => l.id === input.lineId && l.itemId === item.id) ?? fail('INPUT', 'Choose a line for the receipt item.')
      const key = `${order.id}:${line.id}`
      if (seen.has(key)) fail('INPUT', 'List each sales line once.')
      seen.add(key)
      const after = decimal(input.quantity, 'target reserved quantity')
      const before = c.s.reservations.find(r => r.demandKind === 'sales' && r.demandId === order.id && r.lineId === line.id && r.locationId === location.id)?.quantity ?? 0n
      const elsewhere = reservedQuantity(c.s, order.id, line.id) - before
      if (after + elsewhere > open(line)) fail('INPUT', 'Target reservations exceed the still-open line quantity.')
      if (after < pickedQuantity(c.s, order.id, line.id, location.id)) fail('PICKED_COMMITMENT', 'Undo the picked or packed shipment before displacing its reservation.')
      const cost = line.quotedUnitCost === null || line.quotedUnitCost === undefined ? null : decimal(line.quotedUnitCost)
      const unitMargin = cost === null ? null : decimal(line.unitPrice) - cost
      return { orderId: order.id, lineId: line.id, reference: order.reference, customerId: order.customerId, itemId: item.id, locationId: location.id,
        before: format(before), after: format(after), displaced: format(max(0n, before - after)), rank: order.rank ?? null,
        promiseDate: order.promiseDate, deliveries: deliveries(order, line), openQuantity: format(open(line)),
        reservedValueBefore: format(times(before, decimal(line.unitPrice))), reservedValueAfter: format(times(after, decimal(line.unitPrice))),
        estimatedMarginBefore: unitMargin === null ? null : format(times(before, unitMargin)), estimatedMarginAfter: unitMargin === null ? null : format(times(after, unitMargin)) }
    })
    const before = effects.reduce((n, e) => n + decimal(e.before), 0n), after = effects.reduce((n, e) => n + decimal(e.after), 0n)
    if (after > accepted || after > availableAt(c.s, item.id, location.id, day) + before) fail('INSUFFICIENT_STOCK', 'The split exceeds accepted usable receipt stock or takes an unnamed hard reservation.')
    return row(c, 'approvals', { category: 'sales-allocation', status: 'preview', receiptId: receipt.id, itemId: item.id, locationId: location.id,
      reason: text(p.reason, 'allocation reason', 400), effects, totalBefore: format(before), totalAfter: format(after), acceptedQuantity: format(accepted),
      changedPromiseCount: 0, stateVersion: c.s.version + 1, day,
      semantics: 'Target reservations at this location only. Other reservations, picked quantities, physical stock and customer promises remain protected. Margin uses the retained quoted unit cost, when recorded; it is an estimate, not realized profit.' })
  }
  const preview = get(c.s, 'approvals', p.previewId, 'allocation preview'); fresh(preview, p.version)
  if (preview.category !== 'sales-allocation' || preview.status !== 'preview') fail('STATE', 'Choose an undecided sales allocation preview.')
  if (preview.stateVersion !== c.s.version || preview.day !== c.now.slice(0, 10)) fail('STALE', 'Business records or the UTC day changed. Prepare and review the split again.')
  const reason = text(p.reason, 'approval reason', 400)
  // Remove only the explicitly reviewed reservations, then reserve the exact
  // targets on the command's private state. Any failure discards every change.
  c.s.reservations = c.s.reservations.filter(r => !preview.effects.some((e: any) => r.demandKind === 'sales' && r.demandId === e.orderId && r.lineId === e.lineId && r.itemId === e.itemId && r.locationId === e.locationId))
  for (const e of preview.effects) {
    const quantity = decimal(e.after)
    const got = reserve(c, { demandKind: 'sales', demandId: e.orderId, lineId: e.lineId, itemId: e.itemId }, quantity, e.locationId)
    if (got !== quantity) fail('INSUFFICIENT_STOCK', 'The exact reviewed split cannot be reserved. Nothing was changed.')
  }
  for (const id of new Set<string>(preview.effects.map((e: any) => e.orderId))) {
    const order = get(c.s, 'salesOrders', id)
    bump(order, { allocationApprovalIds: [...(order.allocationApprovalIds ?? []), preview.id], reservation: order.lines.map((l: any) => ({ lineId: l.id, reserved: format(reservedQuantity(c.s, order.id, l.id)), short: format(max(0n, open(l) - reservedQuantity(c.s, order.id, l.id))) })) })
  }
  return bump(preview, { status: 'approved', approvedBy: c.actor.id, approvedAt: c.now, approvalReason: reason })
}
