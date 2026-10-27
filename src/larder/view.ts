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
import { kitAvailability } from './kits'
import { format } from './decimal'
import { exceptionRows } from './exceptions'
import { followUpView } from './follow-up-state'
import { shortages } from './planning'
import { positions } from './stock'
import { fefoPlans, lotStatuses } from './lot-dates'
import { pendingHandoffCount } from './handoff'
import { signatureStatus } from './approval-policy'
import { collections, type Actor, type Row, type State } from './model'
import { isScoped, names, scopeOf } from './scope'
import { redactCosts, restricted } from './scope-cost'
import { readsWages, wageCarriers, withoutWages } from './wage-view'
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
  const records = Object.fromEntries(collections.map(k => [k, ((k === 'laborRates' || ['costPolicies','jobCharges','costLinks','marginCharges','costValuations','reportSchedules'].includes(k)) && !rateReaders.includes(actor.role)) || (['integrationGrants', 'auditErasures', 'retentionHolds', 'contactErasures'].includes(k) && actor.role !== 'owner') ? [] : s[k]]))
  // Scopes and custom roles are the owner's to read; everyone else sees only who holds which role.
  if (actor.role !== 'owner') { records.varianceAnalyses = []; records.roles = s.roles.map(({ id, version, role }) => ({ id, version, role })); records.customRoles = [] }
  records.approvalSignatures = s.approvalSignatures.map(x => ({ ...x, status: signatureStatus(s, x, new Date().toISOString(), extra.people as { id: string; role: string }[] | undefined) }))
  if (scopeOf(actor).locations !== null) records.salesOrders = s.salesOrders.map(({ quoteReview, quoteReviewHistory, ...order }) => order)
  // GOV-001: a rework wage rate, and every figure it follows from, is read only with wage authority (see wage-view.ts).
  records.reworkOrders = s.reworkOrders.map(r => readsWages(actor, r) ? r : withoutWages(r))
  const wages = wageCarriers(s, actor), job = <T>(w: Row, value: T) => wages.jobs.has(w.id) ? redactCosts(value) : value
  records.workOrders = records.workOrders.map(w => job(w, w))
  records.handoffs = records.handoffs.map(h => names(h, wages.movements) ? redactCosts(h) : h)
  return {
    version: s.version, actor, ...records, supplierPerformance: supplierPerformance(s),
    workMaterialPools: Object.fromEntries(s.workOrders.filter(w => w.status === 'released' || (w.outputs ?? []).some((b: any) => !b.allocations)).map(w => [w.id, job(w, materialPoolView(s, w))])),
    workTransferCosts: Object.fromEntries(s.workOrders.map(w => [w.id, wages.jobs.has(w.id) ? restricted : format(materialCost(s, w))])),
    operationLedgers: Object.fromEntries(s.workOrders.filter(w => w.status === 'released' && w.routing?.length).map(w => [w.id, job(w, operationLedger(w, materialCost(s, w), lineId => reservedQuantity(s, w.id, lineId)))])),
    orderStatuses: orderStatuses(s),
    masterSchedule: masterSchedule(s),
    lostTimeReport: lostTimeReport(s),
    dispatch: dispatchTasks(s, actor),
    engineeringImpacts: Object.fromEntries(s.items.filter(i => i.kind === 'make').map(i => [i.id, engineeringAffectedWork(s, i.id).map(w => job(w, w))])),
    movements: s.movements.map(m => wages.movements.has(m.id) ? { ...movementView(m), unitCost: restricted } : movementView(m)),
    reservations: s.reservations.map(r => ({ ...r, quantity: format(r.quantity) })),
    positions: positions(s),
    availability: s.items.map(i => availability(s, i.id)),
    kitAvailability: kitAvailability(s),
    shortages: shortages(s),
    exceptions: exceptionRows(followUpCases),
    followUpCases,
    lotStatuses: lotStatuses(s, new Date().toISOString().slice(0, 10)),
    fefoPlans: fefoPlans(s, new Date().toISOString().slice(0, 10)),
    pendingHandoff: pendingHandoffCount(s),
    ...extra,
  }
}
