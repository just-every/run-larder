// Opening stock, transfers, counts with approved adjustments, and customer returns.
import { attach } from './attachments'
import { toBase } from './catalogue'
import { decimal, format } from './decimal'
import { fail } from './problem'
import { allow, approver } from './roles'
import { availableAt, balance, move, withdraw } from './stock'
import { bump, date, fresh, get, list, nextReference, oneOf, optionalText, row, text, type Context, type Row } from './model'

export const valuationBases = ['supplier-invoice', 'last-purchase', 'standard-cost', 'owner-estimate'] as const

export function warehouse(c: Context, type: string, p: any): Row | undefined {
  switch (type) {
    case 'opening.record': {
      allow(c, ['manager', 'warehouse'])
      const location = get(c.s, 'locations', p.locationId, 'location')
      const countedOn = date(p.countedOn, 'count date'), basis = oneOf(p.valuationBasis, valuationBases, 'valuation basis')
      const evidence = attach(c, p.evidence)
      const opening = row(c, 'openings', { reference: nextReference(c.s.openings, 'OS'), locationId: location.id, countedOn, valuationBasis: basis, countedBy: text(p.countedBy, 'counted by', 120), evidence, lines: [] })
      for (const line of list(p.lines)) {
        const item = get(c.s, 'items', line.itemId, 'item')
        if (c.s.movements.some(m => m.itemId === item.id && m.locationId === location.id)) fail('OPENING_EXISTS', `${item.name} already has stock history at ${location.name}. Use a count to correct it.`, { itemId: item.id })
        if (opening.lines.some((l: any) => l.itemId === item.id && (l.lot ?? '') === (line.lot ?? ''))) fail('INPUT', `${item.name} appears twice on this opening count.`)
        const quantity = toBase(item, line.quantity, line.unit), unitCost = decimal(line.unitCost, 'unit cost')
        const lot = optionalText(line.lot, 'lot', 80)
        const lotRow = lot ? row(c, 'lots', { itemId: item.id, code: lot, supplierId: null, source: 'opening', documentId: opening.id, status: 'released' }) : null
        move(c, { itemId: item.id, locationId: location.id, status: 'available', lotId: lotRow?.id, quantity, unitCost, kind: 'opening', documentKind: 'openings', documentId: opening.id, reason: `Opening count ${countedOn} (${basis})` })
        opening.lines.push({ itemId: item.id, quantity: format(quantity), unitCost: format(unitCost), lotId: lotRow?.id ?? '' })
      }
      return opening
    }
    case 'transfer.create': {
      allow(c, ['manager', 'warehouse'])
      const item = get(c.s, 'items', p.itemId, 'item'), from = get(c.s, 'locations', p.fromLocationId, 'location'), to = get(c.s, 'locations', p.toLocationId, 'location')
      if (from.id === to.id) fail('INPUT', 'Choose two different locations.')
      const quantity = toBase(item, p.quantity, p.unit), lotId = p.lotId ? get(c.s, 'lots', p.lotId, 'lot').id : ''
      if (availableAt(c.s, item.id, from.id) < quantity) fail('INSUFFICIENT_STOCK', `Only ${format(availableAt(c.s, item.id, from.id))} ${item.baseUnit} of ${item.name} is free to move from ${from.name}.`)
      const t = row(c, 'transfers', { reference: nextReference(c.s.transfers, 'TR'), itemId: item.id, fromLocationId: from.id, toLocationId: to.id, quantity: format(quantity), lotId, reason: text(p.reason, 'reason', 400), status: 'done' })
      for (const out of withdraw(c, { itemId: item.id, locationId: from.id, status: 'available', lotId: lotId || undefined, quantity: -quantity, kind: 'transfer', documentKind: 'transfers', documentId: t.id, reason: t.reason }))
        move(c, { itemId: item.id, locationId: to.id, status: 'available', lotId: out.lotId, quantity: -out.quantity, unitCost: out.unitCost, kind: 'transfer', documentKind: 'transfers', documentId: t.id, reason: t.reason })
      return t
    }
    case 'count.record': {
      allow(c, ['manager', 'warehouse'])
      const item = get(c.s, 'items', p.itemId, 'item'), location = get(c.s, 'locations', p.locationId, 'location')
      const counted = decimal(p.counted, 'counted quantity'), lotId = p.lotId ? get(c.s, 'lots', p.lotId, 'lot').id : ''
      // Without a lot, the count covers everything available at the location.
      const system = balance(c.s, item.id, location.id, 'available', lotId || undefined)
      return row(c, 'counts', { reference: nextReference(c.s.counts, 'CT'), itemId: item.id, locationId: location.id, lotId, counted: format(counted), system: format(system), variance: format(counted - system), frontier: c.s.movements.at(-1)?.sequence ?? 0, note: optionalText(p.note, 'note', 400), status: counted === system ? 'matched' : 'awaiting approval' })
    }
    case 'count.approve':
    case 'count.reject': {
      approver(c, ['manager'])
      const count = get(c.s, 'counts', p.countId, 'count'); fresh(count, p.version)
      approver(c, ['manager'], count.createdBy)
      if (count.status !== 'awaiting approval') fail('STATE', 'Only a count awaiting approval can be decided.')
      const later = c.s.movements.some(m => m.sequence > count.frontier && m.itemId === count.itemId && m.locationId === count.locationId)
      if (type === 'count.approve' && later) fail('STALE_COUNT', 'Stock moved at this location after the count. Count again before adjusting.', { countId: count.id })
      const approval = row(c, 'approvals', { subjectKind: 'counts', subjectId: count.id, subjectVersion: count.version, decision: type === 'count.approve' ? 'approved' : 'rejected', role: c.actor.role, note: optionalText(p.note, 'note', 400) })
      if (type === 'count.reject') return bump(count, { status: 'rejected', approvalId: approval.id })
      const variance = decimal(count.variance, 'variance', { signed: true })
      withdraw(c, { itemId: count.itemId, locationId: count.locationId, status: 'available', lotId: count.lotId || undefined, quantity: variance, kind: 'adjustment', documentKind: 'counts', documentId: count.id, reason: `Approved count ${count.reference}` })
      return bump(count, { status: 'adjusted', approvalId: approval.id })
    }
    case 'return.receive': {
      allow(c, ['manager', 'warehouse'])
      const order = get(c.s, 'salesOrders', p.orderId, 'order'), line = order.lines.find((l: any) => l.id === p.lineId) ?? fail('NOT_FOUND', 'That order line was not found.')
      const item = get(c.s, 'items', line.itemId, 'item'), quantity = toBase(item, p.quantity, p.unit)
      if (decimal(line.shipped) - decimal(line.returned) < quantity) fail('RETURN_EXCEEDS', `Only ${format(decimal(line.shipped) - decimal(line.returned))} ${item.baseUnit} shipped on this line can come back.`)
      const location = get(c.s, 'locations', p.locationId, 'location'), disposition = oneOf(p.disposition, ['restock', 'quarantine'] as const, 'disposition')
      const shipped = c.s.movements.filter(m => m.documentKind === 'shipments' && m.itemId === item.id && c.s.shipments.some(s => s.id === m.documentId && s.orderId === order.id))
      const unitCost = shipped.at(-1)?.unitCost ?? 0n
      const r = row(c, 'returns', { reference: nextReference(c.s.returns, 'RT'), orderId: order.id, lineId: line.id, itemId: item.id, quantity: format(quantity), locationId: location.id, disposition, reason: text(p.reason, 'reason', 400) })
      move(c, { itemId: item.id, locationId: location.id, status: disposition === 'restock' ? 'available' : 'quarantine', quantity, unitCost, kind: 'return', documentKind: 'returns', documentId: r.id, reason: r.reason })
      line.returned = format(decimal(line.returned) + quantity)
      bump(order, {})
      return r
    }
  }
}
