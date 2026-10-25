// GOV-001: refuse, before any handler runs, a door a member's custom role removed or one that needs a restricted
// cost or wage field. Nothing about a restricted value is echoed back.
import { forbidden } from './problem'
import type { Actor } from './model'
import { scopeOf } from './scope'
import { costDoors, offersCost } from './scope-cost'

export function gateCommand(actor: Actor, type: string, payload: unknown) {
  if (type.startsWith('so.allocation') && actor.role !== 'owner') forbidden('Only the owner reviews and approves sales reservation splits pending policy approval.')
  if (type.startsWith('batch.') && !((['batch.plan', 'batch.review', 'batch.void'].includes(type) ? ['owner', 'manager', 'accounts', 'planner'] : ['owner']).includes(actor.role))) forbidden('Only the owner approves and posts batch allocations or releases output.')
  const scope = scopeOf(actor)
  if (scope.removed.includes(type)) forbidden('Your custom role does not include this approval.')
  if (scope.costs && (costDoors.test(type) || offersCost(payload))) forbidden('This door needs cost or wage fields your account is restricted from.')
}
