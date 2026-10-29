// Human-reviewed amendments preserve issued documents and production spend.
import { attach } from './attachments'
import { open } from './availability'
import { decimal, format, max, min } from './decimal'
import { changeImpact } from './order-change-impact'
import { fail } from './problem'
import { allow, approver } from './roles'
import { gate, policyFor } from './approval-policy'
import { orderMargin } from './margin'
import { commercialSnapshot, deliveryDate, pickedQuantity, refreshPromise } from './sales-schedules'
import { bump, fresh, get, list, newId, optionalText, row, text, type Context, type Row } from './model'

export function trimOrderReservations(c: Context, order: Row) {
  for (const line of order.lines) {
    const reservations = c.s.reservations.filter(reservation => reservation.demandId === order.id && reservation.lineId === line.id)
    let excess = max(0n, reservations.reduce((total, reservation) => total + reservation.quantity, 0n) - open(line))
    for (const reservation of [...reservations].reverse()) {
      const unpicked = max(0n, reservation.quantity - pickedQuantity(c.s, order.id, line.id, reservation.locationId))
      const take = min(excess, unpicked)
      reservation.quantity -= take; excess -= take
    }
    if (excess) fail('PICKED_COMMITMENT', 'Undo the picked or packed shipment before reducing its reserved quantity.')
  }
  c.s.reservations = c.s.reservations.filter(reservation => reservation.quantity > 0n)
}

function changedOrder(c: Context, order: Row, p: any): Row {
  const lines = list(p.lines).map((input: any) => {
    const old = input.lineId ? order.lines.find((line: any) => line.id === input.lineId) ?? fail('NOT_FOUND', 'That order line was not found.') : null
    const item = get(c.s, 'items', input.itemId, 'item')
    if (old && old.itemId !== item.id) fail('INPUT', 'Keep the item on an existing line; add a new line for another item.')
    if (!old && item.archived) fail('ARCHIVED', 'An archived item cannot be added to an order.')
    const unitPrice = format(decimal(input.unitPrice, 'unit price'))
    if (old && decimal(unitPrice) !== decimal(old.unitPrice)) {
      const legacy = c.s.shipments.filter(shipment => shipment.orderId === order.id && ['picked', 'packed', 'shipped'].includes(shipment.status)
        && shipment.lines.some((issued: any) => issued.lineId === old.id && issued.unitPrice === undefined))
      if (legacy.length) fail('HISTORICAL_TERMS', 'An issued shipment has no recorded original price. Undo and re-pick unshipped parcels at their authorized terms; reconcile shipped parcels against historical source-document evidence before repricing this line.', { shipments: legacy.map(shipment => ({ id: shipment.id, reference: shipment.reference, status: shipment.status, action: shipment.status === 'shipped' ? 'reconcile original issued price from historical source-document evidence' : 'unpick and re-pick before repricing' })) })
    }
    const active = decimal(input.quantity, 'non-cancelled quantity'), shipped = decimal(old?.shipped ?? '0')
    if (!old && !active) fail('INPUT', 'A new order line needs a positive quantity.')
    if (active < shipped) fail('SHIPPED_COMMITMENT', 'The requested quantity cannot be less than the quantity already shipped.')
    const wanted = active - shipped
    if (old && wanted < pickedQuantity(c.s, order.id, old.id)) fail('PICKED_COMMITMENT', 'Undo the picked or packed shipment before cancelling its quantity.')
    const previousActive = old ? decimal(old.quantity) - decimal(old.cancelled) : 0n
    const gross = old ? decimal(old.quantity) + max(0n, active - previousActive) : active
    decimal(format(gross), 'cumulative ordered quantity')
    const cancelled = old ? decimal(old.cancelled) + max(0n, previousActive - active) : 0n
    if (!Array.isArray(input.schedules) || input.schedules.length > 100) fail('INPUT', 'Supply at most 100 outstanding delivery schedules per line.')
    const schedules = input.schedules.map((schedule: any) => ({ quantity: format(decimal(schedule.quantity, 'delivery quantity', { positive: true })), date: deliveryDate(schedule.date) }))
      .sort((a: any, b: any) => a.date.localeCompare(b.date))
    if (schedules.reduce((total: bigint, schedule: any) => total + decimal(schedule.quantity), 0n) !== wanted) fail('SCHEDULE_QUANTITY', 'Delivery schedules must total the still-open quantity, excluding shipped and cancelled quantities.')
    return { ...(old ?? {}), id: old?.id ?? newId(), itemId: item.id, quantity: format(gross), cancelled: format(cancelled),
      shipped: old?.shipped ?? '0', returned: old?.returned ?? '0', unitPrice, schedules }
  })
  if (new Set(lines.map(line => line.id)).size !== lines.length) fail('INPUT', 'List each order line once.')
  if (order.lines.some((line: any) => !lines.some(next => next.id === line.id))) fail('INPUT', 'Include every existing line; set its non-cancelled quantity to its shipped quantity to cancel the remainder.')
  const after = structuredClone(order)
  Object.assign(after, { lines, billingAddress: p.billingAddress === undefined ? order.billingAddress ?? '' : optionalText(p.billingAddress, 'billing address', 2000),
    shippingAddress: p.shippingAddress === undefined ? order.shippingAddress ?? '' : optionalText(p.shippingAddress, 'shipping address', 2000) })
  refreshPromise(after)
  after.status = lines.every(line => open(line) === 0n) ? lines.some(line => decimal(line.shipped) > 0n) ? 'shipped' : 'cancelled' : lines.some(line => decimal(line.shipped) > 0n) ? 'part shipped' : 'confirmed'
  return after
}

export function customerAttestation(c: Context, input: any) {
  const approval = input ?? {}, approvedOn = deliveryDate(approval.approvedOn)
  if (approvedOn > c.now.slice(0, 10)) fail('INPUT', 'Record a customer approval already received, not a future approval.')
  return { name: text(approval.name, 'customer approver', 200), reference: text(approval.reference, 'customer approval reference', 400), approvedOn,
    evidence: approval.evidence ? attach(c, approval.evidence) : null, recordedBy: c.actor.id, recordedAt: c.now, basis: 'locally recorded customer attestation' }
}

export function orderChanges(c: Context, type: string, p: any): Row | undefined {
  if (type === 'so.changePreview') {
    allow(c, ['manager', 'sales'])
    const order = get(c.s, 'salesOrders', p.orderId, 'order'); fresh(order, p.version)
    if (order.quoteAcceptance) fail('COSTED_TERMS', 'Accepted costed terms are immutable at this door; customer-currency amendments require a separate exact review.')
    if (!['confirmed', 'part shipped', 'shipped', 'cancelled'].includes(order.status)) fail('STATE', 'Confirm the order before preparing an amendment.')
    const after = changedOrder(c, order, p), customerApproval = customerAttestation(c, p.customerApproval)
    for (const previous of c.s.orderChanges.filter(change => change.orderId === order.id && change.status === 'preview')) bump(previous, { status: 'superseded', supersededAt: c.now, supersededBy: c.actor.id })
    return row(c, 'orderChanges', { orderId: order.id, reason: text(p.reason, 'change reason', 1000), customerApproval,
      before: commercialSnapshot(order), after: commercialSnapshot(after), impact: changeImpact(c.s, order, after), status: 'preview', stateVersion: c.s.version + 1 })
  }
  if (type !== 'so.changeApprove') return
  const preview = get(c.s, 'orderChanges', p.previewId, 'order change preview')
  approver(c, ['manager', 'sales']); fresh(preview, p.version)
  if (preview.status !== 'preview') fail('STATE', 'This amendment has already been decided.')
  if (preview.stateVersion !== c.s.version) fail('STALE', 'Business records changed after this preview. Prepare and review the amendment again.')
  const order = get(c.s, 'salesOrders', preview.orderId, 'order'); fresh(order, preview.before.version)
  const before = commercialSnapshot(order)
  const lines = preview.after.lines.map(({ activeQuantity, ...line }: any) => line)
  // GOV-002 margin floor. A preview binds the exact records, so it cannot wait for a second
  // signature: below the floor it needs a one-signature policy or the owner's override.
  const below = policyFor(c, 'margin', () => orderMargin(c.s, lines))
  if (below && below.policy.signatures > 1 && p.override === undefined) fail('APPROVAL_REQUIRED', 'This amendment leaves the order below the owner\'s margin floor, which needs two signatures. An amendment preview binds the exact records, so only the owner can approve it, with an override naming the accountable person.', { marginPercent: below.value === null ? null : format(below.value) })
  const signed = below ? gate(c, { category: 'margin', subjectKind: 'orderChanges', subject: preview, measure: () => orderMargin(c.s, lines), permitted: ['manager'], preparedBy: preview.createdBy, p }) : null
  if (signed && 'pending' in signed) fail('APPROVAL_REQUIRED', 'This amendment needs the owner\'s override naming the accountable person.')
  bump(order, { lines: structuredClone(lines), billingAddress: preview.after.billingAddress, shippingAddress: preview.after.shippingAddress,
    promiseDate: preview.after.promiseDate, status: preview.after.status, commercialRevision: (order.commercialRevision ?? 1) + 1 })
  trimOrderReservations(c, order)
  const history = { changeId: preview.id, kind: 'approved amendment', reason: preview.reason, customerApproval: preview.customerApproval,
    before, after: commercialSnapshot(order), approvedBy: c.actor.id, approvedAt: c.now }
  order.changeHistory = [...(order.changeHistory ?? []), history]
  if (signed && !('pending' in signed)) { Object.assign(history, { marginSignatureIds: signed.signatureIds, override: signed.override }); signed.consume(preview.id) }
  bump(preview, { status: 'approved', approvedBy: c.actor.id, approvedAt: c.now, appliedOrderVersion: order.version })
  return order
}
