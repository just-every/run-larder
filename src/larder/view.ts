import { supplierPerformance } from './supplier-terms'
// What a signed-in person or agent reads: records, formatted ledger, positions,
// availability, shortages and the exception queue.
import { materialPoolView } from './production-trace'
import { materialCost } from './production-cost'
import { operationLedger } from './operation-ledger'
import { reservedQuantity } from './stock'
import { dispatchTasks } from './operations'
import { lostTimeReport } from './downtime'
import { engineeringAffectedWork } from './engineering'
import { masterSchedule } from './forecast-plan'
import { orderStatuses } from './order-status'
import { blindView } from './count-visibility'
import { availability } from './availability'
import { format } from './decimal'
import { exceptionRows } from './exceptions'
import { followUpView } from './follow-up-state'
import { shortages } from './planning'
import { positions } from './stock'
import { fefoPlans, lotStatuses } from './lot-dates'
import { pendingHandoffCount } from './handoff'
import { collections, type Actor, type State } from './model'

export const movementView = (m: State['movements'][number]) => ({ ...m, quantity: format(m.quantity), unitCost: format(m.unitCost) })

export function stateView(s: State, actor: Actor, extra: Record<string, unknown>) {
  const blind = blindView(s, actor, extra)
  if (blind) return blind
  const today = new Date().toISOString().slice(0, 10), followUpCases = followUpView(s, today)
  const records = Object.fromEntries(collections.map(k => [k, s[k]]))
  return {
    version: s.version, actor, ...records, supplierPerformance: supplierPerformance(s),
    workMaterialPools: Object.fromEntries(s.workOrders.filter(w => w.status === 'released' || (w.outputs ?? []).some((b: any) => !b.allocations)).map(w => [w.id, materialPoolView(s, w)])),
    workTransferCosts: Object.fromEntries(s.workOrders.map(w => [w.id, format(materialCost(s, w))])),
    operationLedgers: Object.fromEntries(s.workOrders.filter(w => w.status === 'released' && w.routing?.length).map(w => [w.id, operationLedger(w, materialCost(s, w), lineId => reservedQuantity(s, w.id, lineId))])),
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
    exceptions: exceptionRows(followUpCases),
    followUpCases,
    lotStatuses: lotStatuses(s, new Date().toISOString().slice(0, 10)),
    fefoPlans: fefoPlans(s, new Date().toISOString().slice(0, 10)),
    pendingHandoff: pendingHandoffCount(s),
    ...extra,
  }
}
