// GOV-001 location scope (ct scope-review-50 a) and the member's effective authority. Until STOCK-001 ships a site
// record, a "site" is an explicit list of existing locations the owner sets for a member. The owner is never scoped.
// A record is in scope only if every location it names is in scope; a command naming any other location is refused
// inside the atomic write; an independent approval needs the preparer and the approver both to cover the record.
import { forbidden } from './problem'
import type { Actor, Collection, Context, Row, State } from './model'
import { collections } from './model'

export type Scope = { locations: string[] | null; costs: boolean; removed: string[]; version: number; customId: string; customVersion: number }
export const unscoped: Scope = { locations: null, costs: false, removed: [], version: 0, customId: '', customVersion: 0 }
export const scopeOf = (a: Pick<Actor, 'scope'>): Scope => a.scope ?? unscoped
export const isScoped = (a: Pick<Actor, 'scope'>) => scopeOf(a).locations !== null || scopeOf(a).costs

// What a member holds: the role row, narrowed by an owner-named custom role. Narrowing only: lists intersect, a
// restriction on either side applies, and removed doors are a deny list so they stay removed when the base role changes.
export function effectiveScope(member: Row | undefined, custom: Row | undefined): Scope {
  const lists = [member?.locations, custom?.locations].filter(Array.isArray) as string[][]
  const locations = lists.length ? lists.reduce((a, b) => a.filter(id => b.includes(id))) : null
  return { locations, costs: Boolean(member?.costsRestricted || custom?.costsRestricted), removed: [...(custom?.removedDoors ?? [])], version: member?.version ?? 0, customId: custom?.id ?? '', customVersion: custom?.version ?? 0 }
}

// Approval doors an owner may remove from a custom role.
export const approvalDoor = /(^|\.)(approve|changeApprove|confirm|release|decide|reject|dispose|execute|revoke|tolerance|deviation\.approve|deputize)$/

function leaves(value: unknown, visit: (s: string) => void) {
  if (typeof value === 'string') visit(value)
  else if (Array.isArray(value)) for (const v of value) leaves(v, visit)
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { visit(k); leaves(v, visit) }
}
export const names = (value: unknown, ids: Set<string>) => { let hit = false; leaves(value, x => { if (ids.has(x)) hit = true }); return hit }

// Out-of-scope locations by id and by name, so neither reaches a scoped member.
export const hiddenLocations = (s: State, scope: Scope) => new Set(scope.locations === null ? [] : s.locations.filter(l => !scope.locations!.includes(l.id)).flatMap(l => [l.id, l.name]))

const deny = () => forbidden('This touches a location outside your location scope.')

// Before the handler runs, so no error text can describe an out-of-scope record: the payload names none.
export function enforcePayload(c: Context, payload: unknown) {
  const scope = scopeOf(c.actor)
  if (scope.locations !== null && names(payload, hiddenLocations(c.s, scope))) deny()
}

// After the handler ran on a copy: refuse any change naming a location outside the actor's scope.
export function enforceScope(c: Context, before: State) {
  const scope = scopeOf(c.actor)
  if (scope.locations === null) return
  const hidden = hiddenLocations(c.s, scope), known = new Set(c.s.locations.map(l => l.id))
  const touched: unknown[] = []
  for (const k of collections as readonly Collection[]) {
    const old = new Map(before[k].map(r => [r.id, JSON.stringify(r)])), now = new Set(c.s[k].map(r => r.id))
    for (const r of c.s[k]) if (old.get(r.id) !== JSON.stringify(r)) touched.push(r)
    for (const r of before[k]) if (!now.has(r.id)) touched.push(r)
  }
  touched.push(...c.s.movements.slice(before.movements.length), ...c.s.reservations.filter(r => !before.reservations.some(o => o.id === r.id && o.quantity === r.quantity)))
  // A new location is outside every explicit list.
  if (c.s.locations.some(l => !before.locations.some(o => o.id === l.id))) deny()
  const unknownPlace = (r: any) => typeof r?.locationId === 'string' && !known.has(r.locationId)
  if (touched.some(r => names(r, hidden) || unknownPlace(r))) deny()
  // Independent approval: the preparer must cover the exact record too, judged live.
  if (c.preparedBy && c.preparedBy !== c.actor.id) {
    const prepared = c.s.roles.find(r => r.id === c.preparedBy)
    if (prepared) {
      const theirs = effectiveScope(prepared, c.s.customRoles.find(r => r.id === prepared.customRoleId))
      if (theirs.locations !== null) {
        const theirHidden = hiddenLocations(c.s, theirs)
        if (touched.some(r => names(r, theirHidden))) forbidden('The person who prepared this is outside the location scope it needs.')
      }
    }
  }
}
