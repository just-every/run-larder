// Facts for the existing native owner decision, never an agent permission.
import type { Context, Row } from './model'
import { effectiveScope } from './scope'

export type ScopeTarget = { id: string; version: number; role: string; status: string }
const sorted = (ids: string[] | null | undefined) => ids == null ? null : [...ids].sort()

export function scopeClassification(c: Context, member: Row | undefined, next: Row, target: ScopeTarget) {
  const custom = c.s.customRoles.find(r => r.id === member?.customRoleId)
  const before = effectiveScope(member, custom, c.s.locations), after = effectiveScope(next, custom, c.s.locations)
  const all = c.s.locations.map(l => l.id)
  const was = before.locations ?? all, now = after.locations ?? all
  const added = now.filter(id => !was.includes(id)).sort(), removed = was.filter(id => !now.includes(id)).sort()
  // Null is unrestricted, including future locations. A custom role may make
  // a raw restriction change leave effective authority entirely unchanged.
  const futureSites = (r: Row | undefined) => Array.isArray(r?.locations) || Array.isArray(custom?.locations) ? [] : sorted(r?.sites)
  const wasFuture = futureSites(member), nowFuture = futureSites(next)
  const expands = (a: string[] | null, b: string[] | null) => a !== null && (b === null || b.some(id => !a.includes(id)))
  const active = target.status === 'active'
  const widening = active && (added.length > 0 || expands(wasFuture, nowFuture) || (before.costs && !after.costs))
  const narrowing = active && (removed.length > 0 || expands(nowFuture, wasFuture) || (!before.costs && after.costs))
  const restrictions = (r: Row | undefined, scope: typeof before) => ({
    role: r?.role ?? 'viewer', active,
    member: { sites: sorted(r?.sites), locations: sorted(r?.locations), costsRestricted: Boolean(r?.costsRestricted) },
    effective: { locations: sorted(scope.locations), futureSites: futureSites(r), costsRestricted: scope.costs, removedDoors: [...scope.removed].sort() },
  })
  return {
    version: 1, classes: ['access'], effect: 'applied', commandId: c.commandId, at: c.now,
    actor: { id: c.actor.id, role: c.actor.role, operatorVersion: c.actor.operatorVersion },
    target: { operatorId: target.id, operatorVersion: target.version, status: target.status, nativeRole: target.role },
    basis: { stateVersion: c.s.version, memberVersion: member?.version ?? 0, customRoleId: custom?.id ?? '', customRoleVersion: custom?.version ?? 0 },
    memberVersion: next.version,
    access: { people: widening || narrowing ? 1 : 0, direction: widening && narrowing ? 'mixed' : widening ? 'widening' : narrowing ? 'narrowing' : 'unchanged', widening, narrowing, addedLocations: active ? added : [], removedLocations: active ? removed : [] },
    before: restrictions(member, before), after: restrictions(next, after),
  }
}
