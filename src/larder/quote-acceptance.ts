// Explicit commercial commitment, separate from inert quote preparation.
import { canonicalJson, sha256 } from '../modules/import-kit/src/d1/index'
import { cents, decimal, divide, format } from './decimal'
import { customerAttestation } from './order-changes'
import { quotePlanningState } from './quote-review'
import { production } from './production'
import { recoveryProjection } from './scheduling/recovery-options'
import { fail, forbidden } from './problem'
import { gate } from './approval-policy'
import { bump, fresh, get, nextReference, row, text, type Context, type Row } from './model'

export function quoteAcceptance(c: Context, type: string, p: any): Row | undefined {
  if (!['so.acceptOption', 'so.invoice'].includes(type)) return
  if (c.actor.role !== 'owner') forbidden('Only the owner accepts exact costed terms or issues their local invoice.')
  const order = get(c.s, 'salesOrders', p.orderId); fresh(order, p.version)
  const reason = text(p.reason, 'decision reason')
  if (type === 'so.invoice') {
    if (!order.quoteAcceptance || !['confirmed', 'part shipped', 'shipped'].includes(order.status)) fail('STATE', 'An accepted costed order is required.')
    if (order.invoice) fail('STATE', 'This exact order already has its local invoice.')
    return bump(order, { invoice: { id: crypto.randomUUID(), reference: nextReference(c.s.salesOrders.filter(o => o.invoice).map(o => o.invoice), 'INV'),
      issuedAt: c.now, issuedBy: c.actor.id, reason, orderId: order.id, acceptanceDigest: order.quoteAcceptance.optionDigest,
      terms: structuredClone(order.customerTerms), status: 'issued locally', semantics: 'Local customer invoice; no tax determination, outbound send, payment or external ledger posting.' } })
  }
  const review = order.quoteReview
  if (order.status !== 'quote' || !review) fail('STATE', 'Prepare a current quote before accepting an option.')
  if (p.reviewVersion !== review.inputVersion || review.inputVersion !== c.s.version || review.peopleDigest !== sha256(canonicalJson(c.people)) || review.validUntil < c.now.slice(0, 10) || review.asOf < c.now)
    fail('STALE', 'Quote inputs, live people, validity or planning time changed. Prepare fresh options.')
  const option = review.options.find((o: any) => o.id === p.optionId)
  if (!option || !option.feasible || !option.workDrafts?.length) fail('QUOTE_OPTION', 'Choose a feasible saved option; unavailable comparisons cannot be accepted.')
  const { digest, ...bound } = option
  if (p.optionDigest !== digest || digest !== sha256(canonicalJson(bound))) fail('QUOTE_OPTION', 'The exact saved option digest is required.')
  if (option.estimate.totalCost === null || option.marginPercent === null) fail('QUOTE_COST', 'Resolve unknown costs before a customer commitment.')
  if (option.overtime.length && p.authorizeOvertime !== true) fail('OVERTIME_AUTHORITY', 'The owner must explicitly authorize these exact machine and person overtime windows.')
  const customerApproval = customerAttestation(c, p.customerApproval)
  const state = quotePlanningState(c)
  for (const change of option.overtime) {
    const calendar = get(state, change.kind === 'machine' ? 'machineCalendars' : 'laborCalendars', change.id)
    calendar.overtimeWindows = [...(calendar.overtimeWindows ?? []), change]
  }
  for (const work of option.workDrafts) {
    if (state.workOrders.some(w => w.id === work.id)) fail('QUOTE_OPTION', 'This work identity was already used.')
    state.workOrders.push(structuredClone(work))
  }
  const projection = recoveryProjection(state, c.people, review.asOf, review.days, false, c.now.slice(0, 10))
  const ids = new Set<string>(option.workDrafts.map((w: Row) => w.id))
  const operations = projection.plan.operations.filter(op => ids.has(op.workOrderId))
  const material = projection.materialEffects.filter(effect => ids.has(effect.workOrderId))
  if (projection.plan.protectionConflicts.length || projection.plan.unscheduled.some(op => ids.has(op.workOrderId)) || canonicalJson(operations) !== canonicalJson(option.operations) ||
      material.some(effect => effect.missing.length) || material.some(effect => canonicalJson(effect.supplies) !== canonicalJson(option.material.find((m: any) => m.workOrderId === effect.workOrderId)?.supplies)))
    fail('STALE', 'Current material and joint calendars no longer prove the saved option. Nothing was booked.')
  // Reuse the existing margin approval policy; owner authority does not waive it.
  const signed = gate(c, { category: 'margin', subjectKind: 'salesOrders', subject: order, terms: { optionId: option.id, optionDigest: digest }, measure: () => decimal(option.marginPercent, 'margin', { signed: true }), permitted: ['manager'], preparedBy: order.preparedBy, p })
  if (signed && 'pending' in signed) fail('MARGIN_POLICY', 'The margin policy requires its explicit owner override before this exact commitment.')
  if (signed && !('pending' in signed)) signed.consume(row(c, 'approvals', { subjectKind: 'salesOrders', subjectId: order.id, subjectVersion: order.version, decision: 'approved', role: c.actor.role, category: 'margin', signatureIds: signed.signatureIds, override: signed.override }).id)
  for (const change of option.overtime) {
    const calendar = get(c.s, change.kind === 'machine' ? 'machineCalendars' : 'laborCalendars', change.id)
    bump(calendar, { overtimeWindows: [...(calendar.overtimeWindows ?? []), { ...change, approvedBy: c.actor.id, approvedAt: c.now, reason, orderId: order.id, optionDigest: digest }] })
  }
  for (const draft of option.workDrafts) {
    const work = structuredClone(draft), delivery = option.deliveries.find((d: any) => d.workOrderId === work.id)
    Object.assign(work, { quoteOrderId: order.id, quoteLineId: delivery.lineId, expectedOn: delivery.shipDate,
      quoteSupplies: structuredClone(option.material.find((m: any) => m.workOrderId === work.id)?.items ?? []),
      demandSources: [{ kind: 'sales', documentId: order.id, lineId: delivery.lineId, quantity: work.quantity }], acceptedBy: c.actor.id, acceptedAt: c.now })
    c.s.workOrders.push(work)
    production(c, 'wo.release', { workOrderId: work.id, version: work.version })
  }
  const booking = row(c, 'scheduleBookings', { status: 'active', orderId: order.id, optionDigest: digest, asOf: review.asOf, days: review.days,
    operations: structuredClone(option.operations), approvedBy: c.actor.id, approvedAt: c.now, reason })
  const terms = { currency: review.currency, usdRate: review.usdRate, rateDate: review.rateDate, rateReference: review.rateReference,
    validUntil: review.validUntil, paymentTerms: review.paymentTerms, discountPercent: review.discountPercent,
    freightAmount: review.freightAmount, freightUsdAmount: review.freightUsdAmount, lines: structuredClone(review.lines), totalAmount: review.totalAmount, totalUsdAmount: review.totalUsdAmount,
    estimatedCostUsd: option.estimate.totalCost, marginAmount: option.marginAmount, marginUsdAmount: option.marginUsdAmount, marginPercent: option.marginPercent, rounding: review.rounding }
  for (const line of order.lines) {
    const quoted = review.lines.find((l: any) => l.lineId === line.id)
    line.unitPrice = format(divide(decimal(quoted.usdAmount), decimal(line.quantity)))
    line.schedules = option.deliveries.filter((d: any) => d.lineId === line.id).map((d: any) => ({ id: crypto.randomUUID(), quantity: d.quantity, date: d.shipDate }))
  }
  return bump(order, { status: 'confirmed', promiseDate: option.shipDate, confirmedBy: c.actor.id, confirmedAt: c.now,
    customerTerms: terms, quoteReview: null, quoteReviewHistory: [...(order.quoteReviewHistory ?? []), { ...review, disposition: { actorId: c.actor.id, at: c.now, reason, optionId: option.id, optionDigest: digest } }],
    quoteAcceptance: { optionId: option.id, optionDigest: digest, option: structuredClone(option), bookingId: booking.id,
      workOrderIds: [...ids], by: c.actor.id, at: c.now, reason, customerApproval, overtimeAuthorized: !!option.overtime.length,
      semantics: 'Exact owner-authorized local commitment and booked intervals. Physical receipt, qualified execution and quality release remain separate doors; no provider, payment or payroll authority.' } })
}
