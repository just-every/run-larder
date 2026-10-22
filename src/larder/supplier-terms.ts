// Native supplier quotations. Quantities and prices are per item base unit;
// currency conversion is an attributed buyer record, never a provider claim.
import { decimal, format, max, times } from './decimal'
import { date, fresh, get, list, optionalText, text, type Context, type Row, type State } from './model'
import { savePartyItem } from './catalogue'
import { allow } from './roles'
import { fail } from './problem'

const integer = (v: unknown, name: string, upper: number) => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= upper ? Number(v) : fail('INPUT', `${name} must be a whole number from 0 to ${upper}.`)
const day = (v: unknown) => { const d = date(v); if (new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) !== d) fail('INPUT', 'Use a real calendar date.'); return d }
const positive = (v: unknown, name: string) => format(decimal(v, name, { positive: true }))
const array = (v: unknown, name: string, cap: number): any[] => Array.isArray(v) && v.length <= cap ? v : fail('INPUT', `${name} must be an array of at most ${cap} entries.`)
export const openDay = (t: any, on: string) => t.weekdays.includes(new Date(on + 'T00:00:00Z').getUTCDay()) && !t.closedDates.includes(on)
const nextDay = (on: string) => new Date(Date.parse(on + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)

export function supplierTerms(c: Context, p: any): Row {
  allow(c, ['manager', 'buyer'])
  const supplier = get(c.s, 'parties', p.partyId, 'supplier')
  if (supplier.kind === 'customer') fail('INPUT', 'Choose a supplier.')
  const existing = p.id ? get(c.s, 'partyItems', p.id, 'supplier terms') : undefined
  if (existing && (existing.partyId !== p.partyId || existing.itemId !== p.itemId)) fail('INPUT', 'A terms revision keeps its supplier and item.')
  if (existing) fresh(existing, p.version)
  const weekdays = list<number>(p.weekdays, 'working weekdays', 7).map(v => integer(v, 'weekday', 6))
  if (new Set(weekdays).size !== weekdays.length) fail('INPUT', 'Working weekdays must be distinct.')
  const closedDates = array(p.closedDates ?? [], 'closed dates', 366).map(day)
  if (new Set(closedDates).size !== closedDates.length) fail('INPUT', 'Closed dates must be distinct.')
  const currency = text(p.currency, 'currency', 3)
  if (!(Intl.supportedValuesOf('currency') as string[]).includes(currency)) fail('INPUT', 'Choose an ISO 4217 currency.')
  const usdRate = currency === 'USD' ? '1' : positive(p.usdRate, 'USD per currency unit')
  if (currency === 'USD' && p.usdRate !== undefined && p.usdRate !== '1') fail('INPUT', 'USD uses a rate of one.')
  const rateOn = day(p.rateOn), rateSource = text(p.rateSource, 'rate source', 200)
  if (rateOn > c.now.slice(0, 10)) fail('INPUT', 'A recorded rate cannot be in the future.')
  const breaks = array(p.breaks ?? [], 'price breaks', 30).map(b => ({ quantity: positive(b.quantity, 'break quantity'), price: format(decimal(b.price, 'break price')) })).sort((a, b) => decimal(a.quantity) < decimal(b.quantity) ? -1 : 1)
  if (new Set(breaks.map(b => b.quantity)).size !== breaks.length) fail('INPUT', 'Price break quantities must be distinct.')
  const terms = { packQuantity: positive(p.packQuantity, 'pack quantity'), moq: positive(p.moq, 'minimum order quantity'), leadDays: integer(p.leadDays, 'lead days', 365), weekdays, closedDates,
    currency, usdRate, rateOn, rateSource, price: format(decimal(p.price, 'price')), breaks, paymentTerms: text(p.paymentTerms, 'payment terms', 200), freightTerms: text(p.freightTerms, 'freight terms', 200), note: optionalText(p.note, 'note', 400) }
  const leadDaysMax = integer(p.leadDaysMax ?? terms.leadDays, 'maximum uncertain lead days', 365)
  if (leadDaysMax < terms.leadDays) fail('INPUT', 'Maximum lead time cannot be shorter than normal lead time.')
  Object.assign(terms, { leadDaysMax })
  // Supplier/item pairs are unambiguous; alternatives are separate suppliers.
  if (c.s.partyItems.some(r => r.id !== existing?.id && r.partyId === p.partyId && r.itemId === p.itemId && r.supplierTerms)) fail('INPUT', 'Revise the existing supplier/item terms.')
  const history = structuredClone(existing?.termHistory ?? [])
  const item = get(c.s, 'items', p.itemId, 'item')
  const result = savePartyItem(c, { ...p, unit: item.baseUnit, price: format(times(decimal(terms.price), decimal(usdRate))) })
  result.supplierTerms = terms
  result.termHistory = [...history, { version: result.version, at: c.now, by: c.actor.id, partyCode: result.partyCode, preferred: result.preferred, ...structuredClone(terms) }]
  return result
}

export function supplierQuote(ref: Row, wanted: string, requiredBy: string, on: string) {
  const t = ref.supplierTerms, requested = decimal(wanted, 'quantity', { positive: true }), pack = decimal(t.packQuantity)
  const minimum = max(requested, decimal(t.moq)), quantity = ((minimum + pack - 1n) / pack) * pack
  let arrival = on, left = t.leadDays
  // Lead days count working days after order day; zero lead rolls to the next
  // open day. At least one weekday and bounded closures make this finite.
  while (left > 0 || !openDay(t, arrival)) { arrival = nextDay(arrival); if (openDay(t, arrival) && left > 0) left-- }
  const price = [...t.breaks].reverse().find(b => decimal(b.quantity) <= quantity)?.price ?? t.price
  const sourceExposure = times(quantity, decimal(price)), usdUnitPrice = times(decimal(price), decimal(t.usdRate))
  return { partyItemId: ref.id, version: ref.version, supplierId: ref.partyId, itemId: ref.itemId, partyCode: ref.partyCode, preferred: ref.preferred,
    requested: format(requested), quantity: format(quantity), earliestDate: arrival, requiredBy, feasible: arrival <= requiredBy, price, currency: t.currency,
    sourceExposure: format(sourceExposure), unitPrice: format(usdUnitPrice), exposure: format(times(quantity, usdUnitPrice)), terms: structuredClone(t) }
}

export function supplierQuotes(s: State, itemId: string, quantity: string, requiredBy: string, on: string) {
  const item = get(s, 'items', itemId, 'item'); if (item.archived) fail('ARCHIVED', 'Choose an active item.')
  day(requiredBy); decimal(quantity, 'quantity', { positive: true })
  return { version: s.version, asOf: on, quotes: s.partyItems.filter(r => r.itemId === itemId && r.supplierTerms && s.parties.some(p => p.id === r.partyId && p.kind !== 'customer'))
    .map(r => supplierQuote(r, quantity, requiredBy, on)).sort((a, b) => Number(b.feasible) - Number(a.feasible) || (decimal(a.exposure) < decimal(b.exposure) ? -1 : decimal(a.exposure) > decimal(b.exposure) ? 1 : a.supplierId.localeCompare(b.supplierId))) }
}

export function quotedLines(c: Context, p: any) {
  const ref = get(c.s, 'partyItems', p.partyItemId, 'supplier terms'); fresh(ref, p.version)
  if (!ref.supplierTerms) fail('INPUT', 'This supplier has no structured terms.')
  const requiredBy = day(p.requiredBy), quote = supplierQuote(ref, p.quantity, requiredBy, c.now.slice(0, 10))
  if (!quote.feasible) fail('INFEASIBLE_QUOTE', 'This supplier cannot deliver by the required date.')
  const schedule = p.deliveries ? list(p.deliveries, 'deliveries', 100) : [{ quantity: quote.quantity, expectedDate: quote.earliestDate }]
  if (schedule.reduce((n, l: any) => n + decimal(l.quantity, 'delivery quantity', { positive: true }), 0n) !== decimal(quote.quantity)) fail('SCHEDULE', 'Scheduled quantities must equal the pack-rounded quote quantity.')
  const lines = schedule.map((l: any) => {
    const expectedDate = day(l.expectedDate)
    if (expectedDate < quote.earliestDate || expectedDate > requiredBy || !openDay(ref.supplierTerms, expectedDate)) fail('SCHEDULE', 'Each delivery must fall on an open supplier day between earliest delivery and required date.')
    return { itemId: ref.itemId, quantity: l.quantity, unitPrice: quote.unitPrice, expectedDate, supplierQuote: quote }
  })
  return { supplierId: ref.partyId, requiredBy, reason: p.reason, expectedDate: lines.map(l => l.expectedDate).sort()[0], lines }
}

export function validateQuoteLines(c: Context, supplierId: string, lines: any[], requiredBy?: string) {
  for (const ref of c.s.partyItems.filter(r => r.partyId === supplierId && r.supplierTerms)) {
    const matching = lines.filter(l => l.itemId === ref.itemId)
    if (!matching.length) continue
    const total = matching.reduce((n, l) => n + decimal(l.quantity), 0n), t = ref.supplierTerms
    if (total < decimal(t.moq) || total % decimal(t.packQuantity)) fail('SUPPLIER_CONSTRAINT', 'The total item quantity must meet supplier MOQ and pack multiples.')
    const q = supplierQuote(ref, format(total), '9999-12-31', c.now.slice(0, 10))
    for (const l of matching) {
      if (l.expectedDate < q.earliestDate || !openDay(t, l.expectedDate)) fail('SUPPLIER_CONSTRAINT', 'The delivery does not meet supplier lead time/calendar.')
      if (l.unitPrice !== q.unitPrice) fail('SUPPLIER_CONSTRAINT', 'Use the supplier price break and recorded USD rate.')
      l.supplierQuote = { ...q, requiredBy: requiredBy ?? '', requested: format(total) }
    }
  }
}

export const purchaseDate = (po: Row, line: any) => line.expectedDate ?? po.expectedDate
export function purchaseNextDate(po: Row) {
  return po.lines.filter((l: any) => decimal(l.received) < decimal(l.quantity)).map((l: any) => purchaseDate(po, l)).sort()[0] ?? po.expectedDate
}

export function supplierPerformance(s: State) {
  return s.parties.filter(p => p.kind !== 'customer').map(p => {
    const receipts = s.receipts.filter(r => s.purchaseOrders.some(po => po.id === r.poId && po.supplierId === p.id)).flatMap(r => r.lines.filter((l: any) => l.movementId).map((l: any) => {
      const movement = s.movements.find(m => m.id === l.movementId), reversed = s.movements.filter(m => m.reversesId === l.movementId).reduce((n, m) => n + m.quantity, 0n)
      return { receiptId: r.id, reference: r.reference, poId: r.poId, lineId: l.lineId, arrivedOn: r.createdAt.slice(0, 10), expectedDate: l.expectedDate, approvedDate: l.approvedDate,
        quantity: format(max(0n, (movement?.quantity ?? 0n) + reversed)), inspection: l.inspection, late: r.createdAt.slice(0, 10) > l.expectedDate }
    }))
    return { supplierId: p.id, receipts, measuredDeliveries: receipts.filter((r: any) => decimal(r.quantity) > 0n).length, lateDeliveries: receipts.filter((r: any) => decimal(r.quantity) > 0n && r.late).length }
  })
}
