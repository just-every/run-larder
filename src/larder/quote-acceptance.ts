// Exact native owner decisions. Commercial acceptance never claims a supplier
// receipt, physical execution, provider confirmation or statutory tax posting.
import { canonicalJson, sha256 } from '../modules/import-kit/src/d1/index'
import { decimal, divide, format, min } from './decimal'
import { fail, forbidden } from './problem'
import { bump, fresh, get, nextReference, row, text, type Context, type Row } from './model'
import { gate } from './approval-policy'
import { production } from './production'
import { customerAttestation } from './order-changes'
import { recoveryProjection } from './scheduling/recovery-options'
import { release, reserve } from './stock'

export function quoteAcceptance(c: Context, type: string, p: any): Row | undefined {
  if (!['so.reviewAccept', 'so.invoice'].includes(type)) return
  if (c.actor.role !== 'owner') forbidden('Only the owner accepts costed commitments or issues their invoices.')
  const order = get(c.s, 'salesOrders', p.orderId); fresh(order, p.version)
  if (type === 'so.invoice') {
    if (!order.quoteAcceptance || !['confirmed', 'part shipped', 'shipped'].includes(order.status)) fail('STATE', 'Accept the exact costed quote before issuing its invoice.')
    if (order.invoices?.length) fail('STATE', 'This accepted commitment already has its invoice. An identical command retry recovers it.')
    const reason = text(p.reason, 'invoice reason')
    const invoice = { id: crypto.randomUUID(), reference: nextReference(c.s.salesOrders.flatMap(o => o.invoices ?? []), 'INV'), orderId: order.id, issuedBy: c.actor.id, issuedAt: c.now, reason,
      ...structuredClone(order.customerTerms), optionId: order.quoteAcceptance.optionId, optionDigest: order.quoteAcceptance.optionDigest,
      basis: 'Native customer invoice; no tax calculation, outside delivery or external ledger posting.' }
    return bump(order, { invoices: [invoice] })
  }
  const review = order.quoteReview
  if (order.status !== 'quote' || !review || review.status !== 'preparation') fail('STATE', 'Choose an unconfirmed quote with a current preparation.')
  const option = review.options.find((o: any) => o.id === p.optionId)
  if (!option || !option.digest || option.digest !== p.optionDigest) fail('QUOTE_OPTION', 'Choose the exact saved feasible option and its digest.')
  const { digest, ...content } = option
  if (sha256(canonicalJson(content)) !== digest) fail('QUOTE_OPTION', 'The option is not an intact current preparation. Prepare again.')
  if (review.inputVersion !== c.s.version || review.preparedAt.slice(0, 10) !== c.now.slice(0, 10) || review.validUntil < c.now.slice(0, 10) || option.operations.some((operation: any) => operation.intervals.some((span: any) => Date.parse(span.startsAt) < Date.parse(c.now)))) fail('STALE', 'Business inputs, validity or planning time changed. Prepare fresh options before acceptance.')
  const reason = text(p.reason, 'acceptance reason')
  const customerApproval = customerAttestation(c, p.customerApproval)
  if (option.kind === 'overtime' && p.authorizeOvertime !== true) fail('OVERTIME_AUTHORITY', 'Explicitly authorize the exact retained overtime windows separately from the customer commitment.')
  if (option.estimate.totalCost === null) fail('QUOTE_COST', 'Complete the declared tariffs and material costs before accepting an estimated margin.')
  const projected = structuredClone(c.s)
  projected.salesOrders = projected.salesOrders.filter(o => o.status !== 'quote')
  for (const window of option.overtime) {
    const calendar = get(projected, window.kind === 'machine' ? 'machineCalendars' : 'laborCalendars', window.id)
    calendar.overtimeWindows = [...(calendar.overtimeWindows ?? []), window]
  }
  for (const work of option.work) projected.workOrders.push(structuredClone(work))
  const freshPlan = recoveryProjection(projected, c.people, review.asOf, review.days, false, c.now.slice(0, 10))
  const ids = new Set<string>(option.work.map((w: Row) => w.id))
  const operations = freshPlan.plan.operations.filter(o => ids.has(o.workOrderId))
  // Recompute with today's actual active people as well as the guarded state
  // version. The commit batch also rechecks every booked person's live role.
  if (freshPlan.plan.protectionConflicts.length || freshPlan.plan.unscheduled.some(o => ids.has(o.workOrderId)) || canonicalJson(operations) !== canonicalJson(option.operations)) fail('STALE', 'Current material, machine or qualified-person inputs no longer prove these exact intervals.')
  const currentMaterial = freshPlan.materialEffects.filter(e => ids.has(e.workOrderId)).map(e => ({ workOrderId: e.workOrderId, supplies: e.supplies, missing: e.missing, notBefore: e.notBefore }))
  const savedMaterial = option.material.map((e: any) => ({ workOrderId: e.workOrderId, supplies: e.supplies, missing: e.missing, notBefore: e.notBefore }))
  if (canonicalJson(currentMaterial) !== canonicalJson(savedMaterial)) fail('STALE', 'The reviewed supply allocation changed. Prepare again.')
  const signed = gate(c, { category: 'margin', subjectKind: 'salesOrders', subject: order, measure: () => option.marginPercent === null ? null : decimal(option.marginPercent, 'option margin', { signed: true }), permitted: ['manager'], preparedBy: order.preparedBy, terms: { optionDigest: digest, customerApproval }, p })
  if (signed && 'pending' in signed) return fail('APPROVAL_REQUIRED', 'This exact preparation cannot wait for another signature. Use the existing explicit owner override with its accountable person, or prepare a qualifying margin.')
  signed?.consume(order.id)
  for (const window of option.overtime) {
    const calendar = get(c.s, window.kind === 'machine' ? 'machineCalendars' : 'laborCalendars', window.id)
    const approved = { ...window, by: c.actor.id, at: c.now, orderId: order.id, commandId: c.commandId, reason }
    bump(calendar, { overtimeWindows: [...(calendar.overtimeWindows ?? []), approved], overtimeHistory: [...(calendar.overtimeHistory ?? []), approved] })
  }
  const workOrderIds: string[] = []
  for (const saved of option.work) {
    const work = row(c, 'workOrders', { ...structuredClone(saved), quoteOrderId: order.id, requiredBy: option.deliveries.find((d: any) => d.workOrderId === saved.id).shipDate })
    work.createdAt = saved.createdAt
    // Use the normal release door to pin engineering and costing. Physical
    // reservations are then limited to this exact option's reviewed stock share.
    production(c, 'wo.release', { workOrderId: work.id, version: work.version })
    release(c, work.id)
    const material = option.material.find((m: any) => m.workOrderId === work.id)
    work.quoteSupply = []
    for (const component of work.components) {
      const part = material.items.find((i: any) => i.itemId === component.itemId)
      const physical = part.supplies.filter((s: any) => s.kind === 'stock').reduce((n: bigint, s: any) => n + decimal(s.quantity), 0n)
      if (reserve(c, { demandKind: 'work', demandId: work.id, lineId: component.id, itemId: component.itemId }, physical) !== physical) fail('STALE', 'The exact physical supply share is no longer available.')
      for (const supply of part.supplies.filter((s: any) => s.kind === 'purchase')) work.quoteSupply.push({ ...supply, itemId: component.itemId, lineId: component.id, received: '0' })
    }
    work.shortages = work.components.map((part: any) => ({ itemId: part.itemId, short: format(decimal(part.required) - c.s.reservations.filter(r => r.demandId === work.id && r.lineId === part.id).reduce((n, r) => n + r.quantity, 0n)) })).filter((p: any) => p.short !== '0')
    work.expectedOn = work.requiredBy
    workOrderIds.push(work.id)
  }
  const booking = row(c, 'scheduleBookings', { status: 'active', orderId: order.id, planId: order.id, asOf: review.asOf, days: review.days, operations, approvedBy: c.actor.id, approvedAt: c.now, commandId: c.commandId, reason })
  const customerTerms = { currency: review.currency, usdRate: review.usdRate, rateDate: review.rateDate, rateReference: review.rateReference, validUntil: review.validUntil, paymentTerms: review.paymentTerms,
    discountPercent: review.discountPercent, freightAmount: review.freightAmount, freightUsdAmount: review.freightUsdAmount, lines: structuredClone(review.lines), totalAmount: review.totalAmount, totalUsdAmount: review.totalUsdAmount,
    estimate: structuredClone(option.estimate), marginAmount: option.marginAmount, marginUsdAmount: option.marginUsdAmount, marginPercent: option.marginPercent, rounding: review.rounding }
  for (const line of order.lines) {
    const price = review.lines.find((l: any) => l.lineId === line.id)
    // Existing operational money reports stay in USD. Original customer terms
    // and reconciled cent extensions are retained independently and displayed.
    line.unitPrice = format(divide(decimal(price.usdAmount), decimal(price.quantity)))
    line.acceptedUsdAmount = price.usdAmount
    line.schedules = option.deliveries.filter((d: any) => d.lineId === line.id).map((d: any) => ({ quantity: d.quantity, date: d.shipDate }))
  }
  return bump(order, { status: 'confirmed', currency: 'USD', customerCurrency: review.currency, customerTerms, promiseDate: option.shipDate, confirmedBy: c.actor.id, confirmedAt: c.now,
    quoteAcceptance: { optionId: option.id, optionDigest: digest, signatureIds: signed?.signatureIds ?? [], override: signed?.override ?? null, option: structuredClone(option), bookingId: booking.id, workOrderIds, customerApproval, reason, by: c.actor.id, at: c.now, commandId: c.commandId },
    quoteReview: { ...review, status: 'accepted' } })
}

// Purchase commitments become ordinary hard reservations only on actual usable
// receipt. A receipt retry is handled by command replay before reaching here.
export function receiveQuoteSupply(c: Context, receipt: Row) {
  for (const line of receipt.lines) {
    if (line.inspection !== 'accept' || line.damageReason) continue
    let left = decimal(line.quantity)
    for (const work of c.s.workOrders.filter(w => w.status === 'released' && w.quoteSupply?.length)) {
      let changed = false
      for (const supply of work.quoteSupply) if (supply.documentId === receipt.poId && supply.itemId === line.itemId && supply.purchaseLineId === line.lineId) {
        const take = min(left, decimal(supply.quantity) - decimal(supply.received))
        if (take <= 0n) continue
        const got = reserve(c, { demandKind: 'work', demandId: work.id, lineId: supply.lineId, itemId: line.itemId }, take, line.locationId)
        supply.received = format(decimal(supply.received) + got); left -= got; changed ||= got > 0n
      }
      if (changed) bump(work, {})
    }
  }
}
