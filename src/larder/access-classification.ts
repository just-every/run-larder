// Classify the owner's existing scope edit by effective authority, including
// custom restrictions and the current site membership of every location.
import { effectiveScope } from './scope'
import { row, type Context, type Row, type State } from './model'

function authority(s: State, operatorId: string) {
  const member = s.roles.find(r => r.id === operatorId)
  const custom = s.customRoles.find(r => r.id === member?.customRoleId)
  const scope = effectiveScope(member, custom, s.locations)
  return {
    memberVersion: member?.version ?? 0, role: member?.role ?? 'viewer',
    customRoleId: custom?.id ?? null, customRoleVersion: custom?.version ?? 0,
    restrictions: { locations: member?.locations ?? null, sites: member?.sites ?? null, costsRestricted: member?.costsRestricted === true },
    unrestrictedLocations: scope.locations === null,
    effectiveLocationIds: (scope.locations ?? s.locations.map(l => l.id)).slice().sort(),
    costsRestricted: scope.costs, removedDoors: scope.removed.slice().sort(),
  }
}

export function recordAccessClassification(c: Context, before: State, type: string, result: Row) {
  if (type !== 'member.scope') return
  const was = authority(before, result.id), next = authority(c.s, result.id)
  const added = next.effectiveLocationIds.filter(id => !was.effectiveLocationIds.includes(id))
  const removed = was.effectiveLocationIds.filter(id => !next.effectiveLocationIds.includes(id))
  const widening = added.length > 0 || (!was.unrestrictedLocations && next.unrestrictedLocations) || (was.costsRestricted && !next.costsRestricted)
  const narrowing = removed.length > 0 || (was.unrestrictedLocations && !next.unrestrictedLocations) || (!was.costsRestricted && next.costsRestricted)
  c.actionClassification = row(c, 'accessActions', {
    commandId: c.commandId, commandType: type, inputVersion: before.version, recordedVersion: before.version + 1,
    actorId: c.actor.id, actorRole: c.actor.role, source: 'person', targetId: result.id,
    classes: ['access'], affectedPersonCount: widening || narrowing ? 1 : 0,
    directions: [...(widening ? ['widening'] : []), ...(narrowing ? ['narrowing'] : [])],
    effect: 'applied', before: was, after: next,
    locationChanges: { added, removed },
  })
}
