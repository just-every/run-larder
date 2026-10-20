// TRACE-003 lot dates, customer shelf-life rules, FEFO eligibility and the
// documented expiry disposition. Dates are UTC calendar days; an expiry or
// retest date is usable through that day and blocked from the next.
import { attach } from './attachments'
import { decimal, format } from './decimal'
import { fail, forbidden } from './problem'
import { allow } from './roles'
import { balance, move } from './stock'
import { bump, date, fresh, get, list, oneOf, optionalText, text, type Context, type Row, type State } from './model'

export const utcToday = () => new Date().toISOString().slice(0, 10)
export const expiryAlertDays = 30
const dayMs = 86400000
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs)
const addDays = (on: string, n: number) => new Date(Date.parse(`${on}T00:00:00Z`) + n * dayMs).toISOString().slice(0, 10)
const later = (a: string, b: string) => (a > b ? a : b)

function wholeDays(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (!Number.isSafeInteger(n) || (n as number) < 0 || (n as number) > 3650) fail('INPUT', `${field} must be a whole number of days from 0 to 3650.`, { field })
  return n as number
}
const optionalDate = (value: unknown, field: string) => {
  if (value === undefined || value === null || value === '') return ''
  const on = date(value, field)
  if (new Date(`${on}T00:00:00Z`).toISOString().slice(0, 10) !== on) fail('INPUT', `${field} must be a real UTC calendar date.`, { field })
  return on
}

// Validated dates for a new lot. A supplier shelf life without an explicit
// expiry sets expiry = manufacture date + shelf-life days.
export function lotDates(input: any, lotCode: string, today: string, manufacturedOn = ''): Record<string, unknown> {
  const x = input && typeof input === 'object' ? input : {}
  const out = {
    manufacturedOn: optionalDate(x.manufacturedOn, 'manufacture date') || manufacturedOn,
    expiresOn: optionalDate(x.expiresOn, 'expiry date'), retestOn: optionalDate(x.retestOn, 'retest date'),
    supplierShelfLifeDays: wholeDays(x.supplierShelfLifeDays, 'supplier shelf life'), storage: optionalText(x.storage, 'storage conditions', 200),
  }
  const recorded = Object.values(out).some(v => v !== '' && v !== undefined)
  if (!recorded) return {}
  if (!lotCode) fail('INPUT', 'Record lot dates against a named lot.', { field: 'lot' })
  if (out.manufacturedOn && out.manufacturedOn > today) fail('INPUT', 'The manufacture date cannot be in the future.', { field: 'manufacturedOn' })
  if (!out.expiresOn && out.supplierShelfLifeDays !== undefined) {
    if (!out.manufacturedOn) fail('INPUT', 'A supplier shelf life needs the manufacture date to set the expiry.', { field: 'manufacturedOn' })
    out.expiresOn = addDays(out.manufacturedOn, out.supplierShelfLifeDays)
  }
  if (out.manufacturedOn && out.expiresOn && out.expiresOn < out.manufacturedOn) fail('INPUT', 'The expiry date cannot be before the manufacture date.', { field: 'expiresOn' })
  if (out.retestOn && out.expiresOn && out.retestOn > out.expiresOn) fail('INPUT', 'The retest date cannot be after the expiry date.', { field: 'retestOn' })
  return { dates: out }
}

// Why a lot cannot be used on a day: past its expiry or retest date.
export function lotBlock(lot: Row | undefined, on: string): string {
  const d = lot?.dates
  if (!d) return ''
  if (d.expiresOn && d.expiresOn < on) return `expired on ${d.expiresOn}`
  if (d.retestOn && d.retestOn < on) return `retest was due on ${d.retestOn}`
  return ''
}

// Available-status quantity in lots blocked on a day, optionally at one location.
export function blockedQuantity(s: State, itemId: string, on: string, locationId?: string): bigint {
  let n = 0n
  for (const m of s.movements) if (m.itemId === itemId && m.status === 'available' && m.lotId && (locationId === undefined || m.locationId === locationId) && lotBlock(s.lots.find(l => l.id === m.lotId), on)) n += m.quantity
  return n > 0n ? n : 0n
}

const customerMinimum = (s: State, customerId: string) => s.parties.find(p => p.id === customerId)?.minShelfLifeDays as number | undefined

// One lot's eligibility for a customer shipping on a day. A customer minimum
// needs a recorded expiry: undated stock cannot prove remaining shelf life.
export function shipBlock(s: State, lotId: string, on: string, customerId: string): string {
  const lot = lotId ? s.lots.find(l => l.id === lotId) : undefined, blocked = lotBlock(lot, on)
  if (blocked) return blocked
  const minimum = customerMinimum(s, customerId)
  if (minimum === undefined) return ''
  const expiresOn = lot?.dates?.expiresOn
  if (!expiresOn) return `no expiry recorded; the customer needs ${minimum} days of shelf life`
  const remaining = daysBetween(on, expiresOn)
  return remaining < minimum ? `${remaining} days of shelf life left on ${on}; the customer needs ${minimum}` : ''
}

// Lots in first-expiry-first-out order: unlotted stock first, then dated
// lots by expiry, then undated lots in receipt order.
export function fefoOrder(s: State, lotIds: string[]): string[] {
  const at = (id: string) => (id ? s.lots.find(l => l.id === id)?.dates?.expiresOn || '9999-12-31' : '')
  return [...lotIds].sort((a, b) => (at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : 0))
}

// The FEFO proposal for an item at a location for a customer shipping on a day.
export function fefo(s: State, itemId: string, locationId: string, on: string, customerId: string) {
  const lots = [...new Set(s.movements.filter(m => m.itemId === itemId && m.locationId === locationId && m.status === 'available').map(m => m.lotId))]
  return fefoOrder(s, lots).map(lotId => {
    const lot = s.lots.find(l => l.id === lotId), quantity = balance(s, itemId, locationId, 'available', lotId), reason = shipBlock(s, lotId, on, customerId)
    return { lotId, code: lot?.code ?? '', quantity, expiresOn: lot?.dates?.expiresOn ?? '', retestOn: lot?.dates?.retestOn ?? '', remainingDays: lot?.dates?.expiresOn ? daysBetween(on, lot.dates.expiresOn) : null, eligible: !reason, reason }
  }).filter(x => x.quantity > 0n)
}

// The planned ship day: the order's promise date, or today when that has passed.
export const shipDay = (order: Row, today: string) => later(order.promiseDate ?? today, today)

// Whether FEFO governs an item: any of its lots carry dates, or the customer has a minimum.
export const dated = (s: State, itemId: string, customerId: string) => customerMinimum(s, customerId) !== undefined || s.lots.some(l => l.itemId === itemId && l.dates)

// Read model: every open sales line's FEFO proposal by reserved location.
export function fefoPlans(s: State, today: string) {
  return s.salesOrders.filter(o => ['confirmed', 'part shipped'].includes(o.status)).flatMap(o => {
    const on = shipDay(o, today)
    return o.lines.filter((l: any) => dated(s, l.itemId, o.customerId)).flatMap((l: any) => s.reservations.filter(r => r.demandId === o.id && r.lineId === l.id).map(r => ({
      orderId: o.id, lineId: l.id, itemId: l.itemId, locationId: r.locationId, on, minShelfLifeDays: customerMinimum(s, o.customerId) ?? null,
      lots: fefo(s, l.itemId, r.locationId, on, o.customerId).map(x => ({ ...x, quantity: format(x.quantity) })),
    })))
  })
}

// The lots a pick takes for a FEFO-governed line: the named lot if eligible on
// the planned ship day, otherwise eligible lots in FEFO order, net of quantities
// already picked into unshipped shipments.
export function pickLots(c: Context, order: Row, itemId: string, locationId: string, quantity: bigint, lotId: string): { lotId: string; quantity: bigint }[] {
  if (!dated(c.s, itemId, order.customerId)) return [{ lotId, quantity }]
  const on = shipDay(order, c.now.slice(0, 10)), proposal = fefo(c.s, itemId, locationId, on, order.customerId)
  const picked = (lot: string) => c.s.shipments.filter(x => ['picked', 'packed'].includes(x.status)).flatMap(x => x.lines).filter((l: any) => l.itemId === itemId && l.locationId === locationId && l.lotId === lot).reduce((n: bigint, l: any) => n + decimal(l.quantity), 0n)
  const free = (x: { lotId: string; quantity: bigint }) => x.quantity - picked(x.lotId)
  if (lotId) {
    const named = proposal.find(x => x.lotId === lotId), reason = named ? named.reason : shipBlock(c.s, lotId, on, order.customerId) || 'no available stock in that lot here'
    if (!named || !named.eligible) fail('FEFO_INELIGIBLE', `Lot ${c.s.lots.find(l => l.id === lotId)?.code ?? ''} cannot be picked for ${order.reference}: ${reason}.`, { lotId, on })
    if (free(named!) < quantity) fail('INSUFFICIENT_STOCK', `Only ${format(free(named!))} is unpicked in lot ${named!.code}.`, { lotId })
    return [{ lotId, quantity }]
  }
  const out: { lotId: string; quantity: bigint }[] = []
  let left = quantity
  for (const x of proposal.filter(x => x.eligible)) {
    if (left === 0n) break
    const take = free(x) < left ? free(x) : left
    if (take > 0n) { out.push({ lotId: x.lotId, quantity: take }); left -= take }
  }
  if (left > 0n) fail('FEFO_INELIGIBLE', `Only ${format(quantity - left)} is in lots eligible to ship on ${on} for ${order.reference}: ${proposal.filter(x => !x.eligible).map(x => `${x.code || 'unlotted'} ${x.reason}`).join('; ') || 'no other stock here'}.`, { on, needed: format(quantity) })
  return out
}

// Lot expiry state for the stock view and Today alerts.
export function lotStatuses(s: State, today: string) {
  return s.lots.filter(l => l.dates).map(l => {
    const held = s.movements.filter(m => m.lotId === l.id).reduce((n, m) => n + m.quantity, 0n)
    const blocked = lotBlock(l, today), remainingDays = l.dates.expiresOn ? daysBetween(today, l.dates.expiresOn) : null
    const state = blocked ? (blocked.startsWith('expired') ? 'expired' : 'retest due') : remainingDays !== null && remainingDays <= expiryAlertDays ? 'expiring' : 'current'
    return { lotId: l.id, itemId: l.itemId, code: l.code, ...l.dates, remainingDays, state, reason: blocked, onHand: format(held) }
  })
}

// Owner/manager/quality documented disposition of an expired or retest-due lot.
export function expiry(c: Context, type: string, p: any): Row | undefined {
  if (type !== 'lot.dispose') return
  allow(c, ['manager', 'quality'])
  if (c.actor.role === 'agent') forbidden('Agents cannot decide a lot disposition.')
  const lot = get(c.s, 'lots', p.lotId, 'lot'); fresh(lot, p.version)
  const today = c.now.slice(0, 10), was = lotBlock(lot, today)
  if (!was) fail('STATE', `Lot ${lot.code} is not expired or due for retest.`)
  const decision = oneOf(p.decision, ['extend', 'scrap'] as const, 'decision'), reason = text(p.reason, 'reason', 400)
  if (!Array.isArray(p.evidence) || !p.evidence.length) fail('EVIDENCE', 'Attach the retest or disposal record.')
  const evidence = list(p.evidence, 'evidence', 5).map(file => attach(c, file))
  const entry: Record<string, unknown> = { decision, reason, evidence, at: c.now, by: c.actor.id, before: lot.dates, blocked: was }
  if (decision === 'extend') {
    const expiresOn = optionalDate(p.expiresOn, 'new expiry date'), retestOn = optionalDate(p.retestOn, 'new retest date')
    if (!expiresOn && !retestOn) fail('INPUT', 'Give the new expiry or retest date the retest supports.')
    for (const [value, field] of [[expiresOn, 'expiresOn'], [retestOn, 'retestOn']] as const) if (value && value <= today) fail('INPUT', 'A new date must be after today.', { field })
    const dates = { ...lot.dates, expiresOn: expiresOn || lot.dates.expiresOn, retestOn: retestOn || lot.dates.retestOn }
    if (dates.retestOn && dates.expiresOn && dates.retestOn > dates.expiresOn) fail('INPUT', 'The retest date cannot be after the expiry date.', { field: 'retestOn' })
    if (lotBlock({ ...lot, dates }, today)) fail('INPUT', `Lot ${lot.code} would still be blocked: ${lotBlock({ ...lot, dates }, today)}.`)
    return bump(lot, { dates, dispositions: [...(lot.dispositions ?? []), { ...entry, after: dates }] })
  }
  const location = get(c.s, 'locations', p.locationId, 'location'), on = balance(c.s, lot.itemId, location.id, 'available', lot.id)
  if (on <= 0n) fail('INSUFFICIENT_STOCK', `Lot ${lot.code} has no available stock at ${location.name}.`)
  move(c, { itemId: lot.itemId, locationId: location.id, status: 'available', lotId: lot.id, quantity: -on, kind: 'scrap', documentKind: 'lots', documentId: lot.id, reason: `Expiry disposition: ${reason}` })
  return bump(lot, { dispositions: [...(lot.dispositions ?? []), { ...entry, locationId: location.id, quantity: format(on) }] })
}
