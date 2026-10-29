// GOV-014 reads for a scoped member. The member's state holds only records whose every named location is in scope.
// A derived figure (availability, shortages, costs, schedules, packs) is computed twice, over everything and over the
// visible records; it shows only if the two agree, so no partial total ever appears under a plain label. Anything
// else reads "restricted (includes other locations)". Out-of-scope records are never counted or named.
import { forbidden } from './problem'
import { collections, type State } from './model'
import { hiddenLocations, names, type Scope } from './scope'
import { redactCosts } from './scope-cost'

export const restrictedFigure = 'restricted (includes other locations)'
export const restrictedRecord = 'restricted record'
// Base records follow the role alone (rule 3); their per-location entries are scrubbed instead of hiding the record.
// A lot is judged by its stock: it stays while any of its movements is visible, minus references to hidden records.
const base = new Set(['items', 'parties', 'partyItems', 'boms', 'roles', 'customRoles', 'lots'])
const idKeys = ['id', 'itemId', 'workOrderId', 'orderId', 'lotId', 'key', 'poId', 'customerId', 'supplierId', 'partyId']

function scrub(value: any, hidden: Set<string>): any {
  if (Array.isArray(value)) return value.filter(v => !names(v, hidden)).map(v => scrub(v, hidden))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([k, v]) => !hidden.has(k) && !(typeof v === 'string' && hidden.has(v))).map(([k, v]) => [k, scrub(v, hidden)]))
}

export type Visible = { state: State; hidden: Set<string> }

export function visibleState(s: State, scope: Scope): Visible {
  if (scope.locations === null) return { state: s, hidden: new Set() }
  const places = hiddenLocations(s, scope), hidden = new Set(places)
  for (const site of s.sites) { const bins = s.locations.filter(l => l.siteId === site.id); if (!bins.length || bins.some(l => !scope.locations!.includes(l.id))) hidden.add(site.id) }
  const keep = (r: unknown) => !names(r, hidden)
  for (const m of s.movements) if (names(m, places)) { hidden.add(m.id) }
  for (const r of s.reservations) if (names(r, places)) hidden.add(r.id)
  // A lot whose every movement is out of scope is itself out of scope.
  for (const m of s.custodyLedger) if (names(m, places)) hidden.add(m.id)
  for (const l of s.lots) { const moved = [...s.movements, ...s.custodyLedger].filter(m => m.lotId === l.id); if (moved.length && moved.every(m => hidden.has(m.id))) hidden.add(l.id) }
  for (const k of collections) if (!base.has(k)) for (const r of s[k]) if (names(r, places)) hidden.add(r.id)
  // Anything that names a hidden record is hidden too, so no identifier of one survives.
  for (let pass = 0; pass < 6; pass++) {
    let grew = false
    for (const k of collections) if (!base.has(k)) for (const r of s[k]) if (!hidden.has(r.id) && names(r, hidden)) { hidden.add(r.id); grew = true }
    for (const m of s.movements) if (!hidden.has(m.id) && names(m, hidden)) { hidden.add(m.id); grew = true }
    for (const r of s.reservations) if (!hidden.has(r.id) && names(r, hidden)) { hidden.add(r.id); grew = true }
    if (!grew) break
  }
  const out = { ...s } as State
  for (const k of collections) (out as any)[k] = base.has(k) ? s[k].filter(r => !hidden.has(r.id)).map(r => scrub(r, hidden)) : s[k].filter(r => !hidden.has(r.id))
  out.locations = s.locations.filter(l => scope.locations!.includes(l.id))
  out.movements = s.movements.filter(m => !hidden.has(m.id) && keep(m))
  out.reservations = s.reservations.filter(r => !hidden.has(r.id) && keep(r))
  return { state: out, hidden }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const identity = (e: any) => idKeys.find(k => typeof e?.[k] === 'string')
const stub = (e: any) => { const k = identity(e); return { ...(k ? { [k]: e[k] } : {}), restricted: restrictedFigure } }

// Keep what the visible records alone determine; mark the rest restricted.
export function reconcile(full: any, visible: any): any {
  if (same(full, visible)) return visible
  if (Array.isArray(visible)) {
    const whole = (Array.isArray(full) ? full : []).map(f => JSON.stringify(f))
    return visible.map(e => whole.includes(JSON.stringify(e)) ? e : stub(e))
  }
  // An object of derived entries keyed by record id, or a report with named sections: decide each entry alone.
  if (visible && typeof visible === 'object' && full && typeof full === 'object' && !Array.isArray(full)) return Object.fromEntries(Object.entries(visible).map(([k, v]) => [k, reconcile((full as any)[k], v)]))
  return restrictedFigure
}

// Trace, recall and certificate packs: out-of-scope rows and nodes read only as a restricted record.
export function stubHidden(value: any, hidden: Set<string>): any {
  if (Array.isArray(value)) return value.map(v => (v && typeof v === 'object' && names(v, hidden)) || (typeof v === 'string' && hidden.has(v)) ? { restricted: restrictedRecord } : stubHidden(v, hidden))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, typeof v === 'string' && hidden.has(v) ? restrictedRecord : stubHidden(v, hidden)]))
  return value
}

export const refuseHidden = (value: unknown, hidden: Set<string>) => { if (names(value, hidden)) forbidden('This involves records outside your location scope.') }

// Run a read over the real state for an unscoped member, or reconcile it for a scoped one.
export async function scopedRead<T>(s: State, scope: Scope | undefined, compute: (s: State) => T | Promise<T>): Promise<T> {
  if (!scope || (scope.locations === null && !scope.costs)) return compute(s)
  let out: any = scope.locations === null ? await compute(s) : reconcile(await compute(s), await compute(visibleState(s, scope).state))
  if (scope.costs) out = redactCosts(out)
  return out
}

// The state an export is built from for a scoped member: visible records only, cost fields restricted.
export function scopedState(s: State, scope: Scope): State {
  const seen = scope.locations === null ? s : visibleState(s, scope).state
  return scope.costs ? redactCosts(seen) : seen
}
