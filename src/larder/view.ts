// What a signed-in person or agent reads: records, formatted ledger, positions,
// availability, shortages and the exception queue.
import { dispatchTasks } from './operations'
import { lostTimeReport } from './downtime'
import { engineeringAffectedWork } from './engineering'
import { masterSchedule } from './forecast-plan'
import { orderStatuses } from './order-status'
import { blindView } from './count-visibility'
import { availability } from './availability'
import { format } from './decimal'
import { exceptions } from './exceptions'
import { shortages } from './planning'
import { positions } from './stock'
import { pendingHandoffCount } from './handoff'
import { collections, type Actor, type State } from './model'

export const movementView = (m: State['movements'][number]) => ({ ...m, quantity: format(m.quantity), unitCost: format(m.unitCost) })

export function stateView(s: State, actor: Actor, extra: Record<string, unknown>) {
  const blind = blindView(s, actor, extra)
  if (blind) return blind
  const records = Object.fromEntries(collections.map(k => [k, s[k]]))
  return {
    version: s.version, actor, ...records,
    orderStatuses: orderStatuses(s),
    masterSchedule: masterSchedule(s),
    lostTimeReport: lostTimeReport(s),
    dispatch: dispatchTasks(s, actor),
    engineeringImpacts: Object.fromEntries(s.items.filter(i => i.kind === 'make').map(i => [i.id, engineeringAffectedWork(s, i.id)])),
    movements: s.movements.map(movementView),
    reservations: s.reservations.map(r => ({ ...r, quantity: format(r.quantity) })),
    positions: positions(s),
    availability: s.items.map(i => availability(s, i.id)),
    shortages: shortages(s),
    exceptions: exceptions(s, new Date().toISOString().slice(0, 10)),
    pendingHandoff: pendingHandoffCount(s),
    ...extra,
  }
}
