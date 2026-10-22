import { rateReaders } from './scheduling/calendars'
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
import { signatureStatus } from './approval-policy'
import { collections, type Actor, type State } from './model'
import { isScoped, scopeOf } from './scope'
import { redactCosts } from './scope-cost'
import { reconcile, visibleState } from './scope-view'

export const movementView = (m: State['movements'][number]) => ({ ...m, quantity: format(m.quantity), unitCost: format(m.unitCost) })

// A scoped member reads only what their scope covers (GOV-001): see scope-view.ts.
export function stateView(s: State, actor: Actor, extra: Record<string, unknown>) {
  const scope = scopeOf(actor)
  if (!isScoped(actor)) return fullView(s, actor, extra)
  let out: Record<string, any>
  if (scope.locations === null) out = fullView(s, actor, extra) as Record<string, any>
  else {
    const full = fullView(s, actor, extra) as Record<string, any>, seen = fullView(visibleState(s, scope).state, actor, extra) as Record<string, any>
    const records = new Set<string>([...collections, 'actor', 'version', 'movements', 'reservations'])
    out = Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, records.has(k) || k in extra ? v : reconcile(full[k], v)]))
  }
  if (scope.costs) { const { actor: me, version, ...rest } = out; out = { version, actor: me, ...redactCosts(rest) } }
  return out
}

function fullView(s: State, actor: Actor, extra: Record<string, unknown>) {
  const blind = blindView(s, actor, extra)
  if (blind) return blind
  const today = new Date().toISOString().slice(0, 10), followUpCases = followUpView(s, today)
  const records = Object.fromEntries(collections.map(k => [k, (k === 'laborRates' && !rateReaders.includes(actor.role)) || (k === 'auditErasures' && actor.role !== 'owner') ? [] : s[k]]))
  // Scopes and custom roles are the owner's to read; everyone else sees only who holds which role.
  if (actor.role !== 'owner') { records.roles = s.roles.map(({ id, version, role }) => ({ id, version, role })); records.customRoles = [] }
  records.approvalSignatures = s.approvalSignatures.map(x => ({ ...x, status: signatureStatus(s, x, new Date().toISOString(), extra.people as { id: string; role: string }[] | undefined) }))
  // GOV-001: a rework wage rate is read by the owner, managers and accounts, and by the production person who entered it.
  records.reworkOrders = s.reworkOrders.map(r => rateReaders.includes(actor.role) || (actor.role === 'production' && r.preparedBy === actor.id) ? r : { ...r, labor: (r.labor ?? []).map(({ rate, ...line }: any) => line) })
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
