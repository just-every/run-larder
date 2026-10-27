// Costed commercial preparation. A review never books capacity, reserves stock,
// changes issued prices, approves overtime or sends a customer document.
import { activeBom } from './bom'
import { resolvedComponents } from './bom-explosion'
import { cents, decimal, divide, format, SCALE, times } from './decimal'
import { draftWork } from './production'
import { averageCost } from './stock'
import { allow } from './roles'
import { scopeOf } from './scope'
import { fail, forbidden } from './problem'
import { bump, date, fresh, get, list, oneOf, optionalText, text, type Context, type Row } from './model'
import { instant, integer } from './scheduling/calendars'
import { recoveryProjection } from './scheduling/recovery-options'

// Round the exact quantity product directly to cents, avoiding an intermediate
// six-place rounding. Order totals sum those already rounded line extensions.
const centRatio = (numerator: bigint, denominator: bigint) => {
  const sign = numerator < 0n ? -1n : 1n, absolute = numerator < 0n ? -numerator : numerator
  return sign * ((absolute + denominator * 5000n) / (denominator * 10000n)) * 10000n
}
const extension = (q: bigint, price: bigint) => centRatio(q * price, SCALE)
const rounded = (n: bigint) => decimal(cents(n), 'rounded money', { signed: true })
function realDate(value: unknown, label: string) {
  const d = date(value, label)
  if (new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) !== d) fail('INPUT', `${label} must be a real calendar date.`)
  return d
}
function costEstimate(c: Context, order: Row, p: any) {
  const rates = ['laborCostRate', 'machineCostRate', 'overheadCostRate'].map(key => p[key] === undefined || p[key] === '' ? null : decimal(p[key], key))
  const lines = order.lines.map((line: any) => {
    const item = get(c.s, 'items', line.itemId), q = decimal(line.quantity)
    const bom = activeBom(c.s, item.id, c.now.slice(0, 10))
    let material: bigint | null = null, hours: bigint | null = null, components: any[] = []
    if (line.configuration) return { lineId: line.id, materialCost: null, laborCost: null, machineCost: null, overheadCost: null, totalCost: null, basis: 'Configured quote costing is not yet supported by this preparation door.' }
    if (item.kind === 'make' && bom) {
      components = resolvedComponents(c.s, bom, q, c.now.slice(0, 10)).components.map((part: any) => {
        const component = get(c.s, 'items', part.itemId), rate = decimal(component.standardCost ?? '0') || averageCost(c.s, component.id)
        return { itemId: part.itemId, quantity: part.quantity, unitCost: rate > 0n ? format(rate) : null, totalCost: rate > 0n ? format(times(decimal(part.quantity), rate)) : null }
      })
      if (components.every(part => part.totalCost !== null)) material = components.reduce((n, part) => n + decimal(part.totalCost), 0n)
      if (bom.routing.length) hours = divide(bom.routing.reduce((n: bigint, step: any) => n + decimal(String(step.setupMinutes ?? 0)) + times(decimal(String(step.runMinutes ?? step.minutes ?? 0)), q), 0n), decimal('60'))
    } else if (item.kind !== 'make') {
      const rate = decimal(item.standardCost ?? '0') || averageCost(c.s, item.id)
      material = rate > 0n ? times(q, rate) : null; hours = 0n
    }
    const values = rates.map(rate => hours === 0n ? 0n : hours !== null && rate !== null ? times(hours, rate) : null)
    const total = material === null || values.some(v => v === null) ? null : material + values.reduce<bigint>((n, v) => n + v!, 0n)
    return { lineId: line.id, bomId: bom?.id ?? null, bomRevision: bom?.revision ?? null, components, hours: hours === null ? null : format(hours), materialCost: material === null ? null : format(material), laborCost: values[0] === null ? null : format(values[0]!), machineCost: values[1] === null ? null : format(values[1]!), overheadCost: values[2] === null ? null : format(values[2]!), totalCost: total === null ? null : cents(total) }
  })
  return { currency: 'USD', quoteTariffs: { laborCostRate: rates[0] === null ? null : format(rates[0]), machineCostRate: rates[1] === null ? null : format(rates[1]), overheadCostRate: rates[2] === null ? null : format(rates[2]) }, lines, totalCost: lines.some((line: any) => line.totalCost === null) ? null : cents(lines.reduce((n: bigint, line: any) => n + decimal(line.totalCost), 0n)), basis: 'Current BOM quantities and setup plus run hours at explicitly entered quote tariffs; queue time excluded. Missing costs stay unknown. These tariffs are estimates, not employment wage records or actual cost postings.' }
}

function alternatives(c: Context, order: Row, p: any) {
  const asOf = instant(p.asOf ?? c.now, 'planning start'), days = integer(p.days ?? 14, 'planning days', 3, 30)
  if (Date.parse(asOf) < Date.parse(c.now)) fail('INPUT', 'Quote planning must start now or later.')
  const base = structuredClone(c.s)
  // Unaccepted quotes are preparation, not demand competing for scarce supply.
  base.salesOrders = base.salesOrders.filter(o => o.status !== 'quote')
  for (const work of base.workOrders.filter(work => work.status === 'draft' && !work.engineeringBomId)) {
    const recipe = activeBom(base, work.itemId, c.now.slice(0, 10))
    if (recipe) work.engineeringBomId = recipe.id
  }
  const unsupported = order.lines.some((line: any) => get(base, 'items', line.itemId).kind !== 'make' || line.configuration)
  if (unsupported) return { asOf, days, options: [], reason: 'Finite alternatives currently require ordinary made-item lines; bought and configured lines remain unproved.' }
  const before = recoveryProjection(base, c.people, asOf, days, false, c.now.slice(0, 10)).plan
  const options: any[] = [], rejected: any[] = []
  for (let offset = 0; offset < Math.min(days, 7) && options.length < 3; offset++) {
    const state = structuredClone(base), plannedStart = new Date(Date.parse(asOf) + offset * 86400000).toISOString().slice(0, 10)
    const requiredBy = new Date(Date.parse(asOf) + (days - 1) * 86400000).toISOString().slice(0, 10)
    const work: Row[] = order.lines.map((line: any) => draftWork({ ...c, s: state }, { itemId: line.itemId, quantity: line.quantity, requiredBy, plannedStart, reason: `Isolated quote comparison for ${order.reference}` }))
    for (const job of work) { const recipe = activeBom(state, job.itemId, c.now.slice(0, 10)); if (recipe) job.engineeringBomId = recipe.id }
    const projection = recoveryProjection(state, c.people, asOf, days, false, c.now.slice(0, 10)), plan = projection.plan
    const ids = new Set(work.map(w => w.id)), operations = plan.operations.filter(op => ids.has(op.workOrderId)), jobs = plan.jobs.filter(job => ids.has(job.workOrderId))
    const material = projection.materialEffects.filter(effect => ids.has(effect.workOrderId))
    const displacement = before.jobs.filter(old => { const next = plan.jobs.find(job => job.workOrderId === old.workOrderId); return !old.unscheduled && (next?.unscheduled || (old.endsAt && (!next?.endsAt || next.endsAt > old.endsAt))) })
    const conflicts = plan.unscheduled.filter(op => ids.has(op.workOrderId))
    // Expected output from other work is not enough: this door does not yet
    // verify the complete upstream production and quality dependency chain.
    const unprovedSupply = material.some(effect => effect.supplies.some((supply: any) => supply.kind === 'work' || (supply.kind === 'purchase' && supply.date < c.now.slice(0, 10))))
    if (jobs.length !== work.length || jobs.some(job => job.unscheduled || !job.endsAt || job.provisional) || !operations.length || conflicts.length || displacement.length || plan.protectionConflicts.length || unprovedSupply) {
      rejected.push({ plannedStart, conflicts, displacedWorkOrderIds: displacement.map(job => job.workOrderId), reason: unprovedSupply ? 'Upstream work or overdue purchase supply is unproved.' : 'Material, joint capacity, protected bookings or existing work prevents this alternative.' }); continue
    }
    const shipDate = jobs.map(job => job.endsAt!.slice(0, 10)).sort().at(-1)!
    const materialItems = new Set(projection.state.workOrders.filter(w => ids.has(w.id)).flatMap(w => { const bom = activeBom(state, w.itemId, asOf.slice(0, 10)); return bom ? resolvedComponents(state, bom, decimal(w.quantity), asOf.slice(0, 10)).components.map(part => part.itemId) : [] }))
    if (c.s.lots.some(lot => materialItems.has(lot.itemId) && ((lot.dates?.expiresOn && lot.dates.expiresOn <= shipDate) || (lot.dates?.retestOn && lot.dates.retestOn <= shipDate)))) {
      rejected.push({ plannedStart, reason: 'Dated stock needs exact lot-level review before this future promise can be offered.' }); continue
    }
    if (options.some(option => option.shipDate === shipDate)) continue
    options.push({ id: `date-${offset + 1}`, name: offset === 0 ? 'Earliest full batch' : `Later full batch ${offset}`, shipDate, plannedStart, feasible: true, operations, material, work: work.map(w => ({ itemId: w.itemId, quantity: w.quantity })), basis: 'Full-batch indicative material and finite machine and qualified-person calendars. No stock, supplier, capacity or shipment is booked. Future receipt, quality and execution remain conditions.' })
  }
  return { asOf, days, options, rejected, reason: options.length === 3 ? 'Three distinct feasible full-batch dates in the recorded calendars.' : 'Fewer than three distinct feasible full-batch dates were found; unavailable dates are never offered.' }
}

export function quoteReview(c: Context, type: string, p: any): Row | undefined {
  if (!['so.review', 'so.reviewClear'].includes(type)) return
  allow(c, ['manager', 'sales'])
  // Whole-installation planning cannot disclose records outside a member's sites.
  if (scopeOf(c.actor).locations !== null || scopeOf(c.actor).costs) forbidden('Costed quote preparation requires unrestricted commercial and location access.')
  const order = get(c.s, 'salesOrders', p.orderId); fresh(order, p.version)
  if (order.status !== 'quote') fail('STATE', 'Costed preparation is available only on an unconfirmed quote.')
  const history = [...(order.quoteReviewHistory ?? []), ...(order.quoteReview ? [order.quoteReview] : [])]
  if (type === 'so.reviewClear') {
    if (!order.quoteReview) fail('STATE', 'There is no current costed review to discard.')
    const reason = text(p.reason, 'discard reason')
    const disposition = { actorId: c.actor.id, at: c.now, reason, orderVersion: order.version, reviewInputVersion: order.quoteReview.inputVersion }
    return bump(order, { quoteReview: null, quoteReviewHistory: [...(order.quoteReviewHistory ?? []), { ...order.quoteReview, disposition }], reviewClearedBy: c.actor.id, reviewClearedAt: c.now, reviewClearReason: reason })
  }
  const currency = oneOf(p.currency ?? 'USD', ['USD', 'CAD'] as const, 'quote currency')
  const rate = currency === 'USD' ? SCALE : decimal(p.usdRate, 'USD per customer currency unit', { positive: true })
  const rateDate = currency === 'USD' ? c.now.slice(0, 10) : realDate(p.rateDate, 'rate date')
  if (rateDate > c.now.slice(0, 10)) fail('INPUT', 'A recorded exchange rate cannot be future dated.')
  const rateReference = currency === 'USD' ? 'USD functional currency' : text(p.rateReference, 'rate reference', 200)
  const validUntil = realDate(p.validUntil, 'quote validity')
  if (validUntil < c.now.slice(0, 10)) fail('INPUT', 'Quote validity has expired.')
  const discount = decimal(p.discountPercent ?? '0', 'discount percent')
  if (discount > decimal('100')) fail('INPUT', 'Discount cannot exceed 100 percent.')
  const offered = list<any>(p.lines, 'customer price lines', 100)
  if (offered.length !== order.lines.length || new Set(offered.map(line => line.lineId)).size !== offered.length || offered.some(line => !order.lines.some((saved: any) => saved.id === line.lineId))) fail('INPUT', 'Review every quote line exactly once.')
  const lines = order.lines.map((line: any) => {
    const offer = offered.find(candidate => candidate.lineId === line.id), quantity = decimal(line.quantity)
    const breaks = (offer.breaks === undefined || offer.breaks.length === 0 ? [] : list<any>(offer.breaks, 'quantity breaks', 20)).map(price => ({ minimum: format(decimal(price.minimum, 'break minimum', { positive: true })), unitPrice: format(decimal(price.unitPrice, 'break price')) }))
    if (new Set(breaks.map(price => price.minimum)).size !== breaks.length) fail('INPUT', 'Quantity break minimums must be unique.')
    const eligible = breaks.filter(price => decimal(price.minimum) <= quantity).sort((a, b) => decimal(a.minimum) < decimal(b.minimum) ? 1 : -1)[0]
    const unitPrice = eligible?.unitPrice ?? format(decimal(offer.unitPrice, 'customer unit price'))
    const gross = extension(quantity, decimal(unitPrice)), discountAmount = centRatio(gross * discount, decimal('100')), net = gross - discountAmount
    return { lineId: line.id, itemId: line.itemId, quantity: line.quantity, unitPrice, breaks, appliedMinimum: eligible?.minimum ?? null, grossAmount: cents(gross), discountAmount: cents(discountAmount), amount: cents(net), usdAmount: cents(extension(net, rate)) }
  })
  const freight = rounded(decimal(p.freight ?? '0', 'freight')), amount = lines.reduce((n: bigint, line: any) => n + decimal(line.amount), freight)
  const usdAmount = lines.reduce((n: bigint, line: any) => n + decimal(line.usdAmount), extension(freight, rate))
  const estimate = costEstimate(c, order, p), cost = estimate.totalCost === null ? null : decimal(estimate.totalCost)
  const marginAmount = cost === null ? null : usdAmount - cost
  const dates = alternatives(c, order, p)
  return bump(order, { quoteReviewHistory: history, quoteReview: { preparedBy: c.actor.id, preparedAt: c.now, inputVersion: c.s.version + 1, status: 'preparation', currency, usdRate: format(rate), rateDate, rateReference, validUntil, paymentTerms: text(p.paymentTerms, 'payment terms', 1000), note: optionalText(p.note, 'quote assumptions', 1000), discountPercent: format(discount), freightAmount: cents(freight), freightUsdAmount: cents(extension(freight, rate)), lines, totalAmount: cents(amount), totalUsdAmount: cents(usdAmount), estimate, marginUsdAmount: marginAmount === null ? null : cents(marginAmount), marginAmount: marginAmount === null ? null : cents(centRatio(marginAmount * SCALE, rate)), marginPercent: marginAmount === null || usdAmount === 0n ? null : format(divide(times(marginAmount, decimal('100')), usdAmount)), ...dates, rounding: 'Exact six-place quantity times price rounded directly half away from zero to a cent per line; discount rounded per line; converted net lines and freight rounded separately; totals sum those cents. USD per one customer currency unit. No tax is estimated.', semantics: 'Preparation only; confirmation is refused while this review exists. No acceptance, booking, overtime authorization, invoice or outbound action. Discarding a review restores the ordinary USD quote, without applying these reviewed terms.' } })
}
