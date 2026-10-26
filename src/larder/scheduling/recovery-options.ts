// Deterministic recovery comparisons. Only recorded inputs enter the projection;
// options carry no authority until a human adopts their exact retained intervals.
import { activeBom } from '../bom'
import { decimal, format } from '../decimal'
import { orderStatuses } from '../order-status'
import { canonicalJson } from '../../modules/import-kit/src/d1/index'
import { type Context, type State } from '../model'
import { finitePlan } from './finite'

type Plan = ReturnType<typeof finitePlan>
// Compare the durable input representation, including removals and reservation
// changes from any public command. Draft commercial documents are not supply.
export function recoveryInputsChanged(before: State, after: State) {
  const inputs = (s: State) => JSON.stringify({
    work: s.workOrders.filter(w => ['draft', 'released'].includes(w.status)),
    demand: s.salesOrders.filter(o => o.status !== 'quote'),
    supply: s.purchaseOrders.filter(o => o.status !== 'draft'),
    boms: s.boms, machines: s.machineCalendars, labor: s.laborCalendars,
    maintenance: s.maintenance, lots: s.lots,
    movements: s.movements.map(m => ({ ...m, quantity: String(m.quantity), unitCost: String(m.unitCost) })),
    reservations: s.reservations.map(r => ({ ...r, quantity: String(r.quantity) })),
  })
  return inputs(before) !== inputs(after)
}
export function recoveryProjection(s: State, people: Context['people'], asOf: string, days: number, releaseBookings = true) {
  const state = structuredClone(s), statuses = orderStatuses(state).work, materialEffects: any[] = []
  for (const w of state.workOrders.filter(w => ['draft', 'released'].includes(w.status))) {
    delete w.planningMaterialBlock; delete w.planningMaterialReadyAt
    const status = statuses.find(o => o.id === w.id)
    const missing = status?.lines.filter(l => decimal(l.missing) > 0n || l.ingredientStatus === 'Not available' || l.ingredientStatus === 'No BOM') ?? []
    const supplies = status?.lines.flatMap(l => l.supplies) ?? []
    const notBefore = supplies.map(p => p.date).filter(Boolean).sort().at(-1)
    if (missing.length || !status || status.ingredientStatus === 'No BOM') w.planningMaterialBlock = 'Current shared material allocation has uncovered or unproved inputs; review the dated material sources.'
    if (notBefore) w.planningMaterialReadyAt = notBefore + 'T00:00:00.000Z'
    materialEffects.push({ workOrderId: w.id, reference: w.reference, notBefore: notBefore ?? null, missing: missing.map(l => ({ itemId: l.itemId, quantity: l.missing })), supplies, basis: 'Shared indicative physical, reserved and approved purchase allocations; future work remains subject to its own dependency and execution gates.' })
  }
  return { state, plan: finitePlan(state, people ?? [], asOf, days, { releaseBookings }), materialEffects }
}

export const recoveryEffects = (before: Plan, after: Plan) => after.jobs.map(j => {
  const old = before.jobs.find(o => o.workOrderId === j.workOrderId)
  return { workOrderId: j.workOrderId, reference: j.reference, before: old?.endsAt ?? null, after: j.endsAt, lateBefore: old?.late ?? false, lateAfter: j.late, unscheduled: j.unscheduled }
}).filter(j => j.before !== j.after || j.unscheduled || j.lateBefore !== j.lateAfter)

export function protectedConflicts(s: State, after: Plan) {
  return (s.schedulePolicies[0]?.protectedOperations ?? []).filter((old: any) => {
    const next = after.operations.find(o => o.key === old.key)
    return !next || canonicalJson(next.intervals) !== canonicalJson(old.intervals) || next.machineId !== old.machineId || next.operatorId !== old.operatorId
  }).map((o: any) => o.key)
}

export function recoveryOptions(c: Context, before: Plan, projection: ReturnType<typeof recoveryProjection>, event: any, asOf: string, days: number) {
  const s = projection.state, poId = ['po.revise', 'po.confirm'].includes(event.type) ? event.payload.poId : undefined
  const maintenance = event.type.startsWith('maintenance.') ? s.maintenance.find(m => m.id === event.payload.maintenanceId) ?? s.maintenance.find(m => m.commandId === c.commandId) : undefined
  const centre = maintenance?.workCentre ?? event.payload.workCentre
  const affected = s.workOrders.filter(w => ['draft', 'released'].includes(w.status) && (
    poId ? projection.materialEffects.some(m => m.workOrderId === w.id && m.supplies.some((p: any) => p.documentId === poId)) :
    centre ? (w.routing ?? activeBom(s, w.itemId)?.routing ?? []).some((r: any) => r.workCentre === centre || w.scheduleChoices?.[r.sequence] === centre) : event.payload.workOrderId ? w.id === event.payload.workOrderId : true
  ))
  const protectedKeys = new Set((s.schedulePolicies[0]?.protectedOperations ?? []).map((o: any) => o.key))
  const decisions = affected.flatMap(w => {
    if (w.operationStates?.some((t: any) => ['running', 'paused'].includes(t.status))) return []
    const routing = w.status === 'released' ? w.routing ?? [] : activeBom(s, w.itemId)?.routing ?? []
    return routing.flatMap((step: any) => {
      if (protectedKeys.has(`${w.id}:${step.sequence}`) || w.operationStates?.some((t: any) => t.sequence === step.sequence && t.status === 'done')) return []
      const current = w.scheduleChoices?.[step.sequence] ?? before.operations.find(o => o.key === `${w.id}:${step.sequence}`)?.machine ?? step.workCentre
      const alternatives = [...new Set<string>(step.eligibleCentres ?? [step.workCentre])].filter(name => name !== current && s.machineCalendars.some(m => m.name === name)).sort()
      return alternatives.length ? [{ workOrderId: w.id, sequence: step.sequence, current, alternatives }] : []
    })
  })
  const sources = {
    demandIds: [...new Set(affected.flatMap(w => (w.demandSources ?? []).map((d: any) => d.documentId)))],
    workOrderIds: affected.map(w => w.id), purchaseOrderIds: [...new Set(projection.materialEffects.filter(m => affected.some(w => w.id === m.workOrderId)).flatMap(m => m.supplies.filter((p: any) => p.kind === 'purchase').map((p: any) => p.documentId)))],
    reservationIds: s.reservations.filter(r => affected.some(w => w.id === r.demandId)).map(r => r.id),
    reservationCount: s.reservations.filter(r => affected.some(w => w.id === r.demandId)).length,
    maintenanceIds: s.maintenance.filter(m => m.status !== 'released').map(m => m.id),
    machineCalendarIds: s.machineCalendars.map(m => m.id), laborCalendarIds: s.laborCalendars.map(l => l.id),
    operationProgressKeys: affected.flatMap(w => (w.operationStates ?? []).filter((t: any) => t.startedAt || t.reports?.length).map((t: any) => `${w.id}:${t.sequence}`)),
    operationProgressCount: affected.reduce((n, w) => n + (w.operationStates ?? []).filter((t: any) => t.startedAt || t.reports?.length).length, 0),
  }
  const options: any[] = [], rejected: any[] = []
  let evaluated = 0, truncated = false
  // Bound the explicit combinatorial comparison; disclose its extent rather
  // than treating a limited search as proof that no recovery exists.
  function search(index: number, choices: Map<string, Record<string, string>>) {
    if (options.length >= 2 || evaluated >= 64) { truncated = true; return }
    if (index < decisions.length) {
      const d = decisions[index]!
      for (const name of d.alternatives) {
        const next = new Map(choices); next.set(d.workOrderId, { ...(choices.get(d.workOrderId) ?? {}), [d.sequence]: name })
        search(index + 1, next)
        if (options.length >= 2 || evaluated >= 64) break
      }
      return
    }
    if (!choices.size) return
    evaluated++
    const clone = structuredClone(s)
    const changes = [...choices].map(([workOrderId, selection]) => {
      const w = clone.workOrders.find(w => w.id === workOrderId)!
      const change = { workOrderId, scheduleChoices: { ...(w.scheduleChoices ?? {}), ...selection }, priority: w.priority ?? 0, plannedStart: w.plannedStart ?? asOf.slice(0, 10) }
      Object.assign(w, change); return change
    })
    const after = finitePlan(clone, c.people ?? [], asOf, days, { releaseBookings: true })
    const conflicts = protectedConflicts(s, after)
    const promises = after.promises.filter(p => p.workOrderIds.some((id: string) => affected.some(w => w.id === id))).map(p => ({ ...p, beforeDate: p.promiseDate, afterDate: p.promiseDate,
      feasible: p.workOrderIds.length > 0 && p.workOrderIds.every((id: string) => { const j = after.jobs.find(j => j.workOrderId === id); return j && !j.unscheduled && !!j.endsAt && j.endsAt <= p.promiseDate + 'T23:59:59.999Z' }),
    }))
    const failed = after.unscheduled.filter(u => affected.some(w => w.id === u.workOrderId) || !before.unscheduled.some(old => old.workOrderId === u.workOrderId && old.sequence === u.sequence && old.reason === u.reason))
    const newLate = after.jobs.filter(j => j.late && !before.jobs.find(old => old.workOrderId === j.workOrderId)?.late)
    if (conflicts.length || after.protectionConflicts.length || failed.length || newLate.length || promises.some(p => !p.feasible)) {
      rejected.push({ changes, protectedKeys: conflicts, unscheduled: failed, lateWorkOrderIds: newLate.map(j => j.workOrderId), latePromiseIds: promises.filter(p => !p.feasible).map(p => p.orderId) }); return
    }
    const moved = after.operations.filter(o => changes.some(ch => ch.workOrderId === o.workOrderId) && decisions.some(d => d.workOrderId === o.workOrderId && d.sequence === o.sequence && d.current !== o.machine))
    if (!moved.length) return
    const costKnown = after.operations.every(o => o.planningCost !== null)
    options.push({ id: `option-${options.length + 1}`, name: `Alternate recovery ${options.length + 1}`, feasible: true, changes, after, effects: recoveryEffects(before, after), protectionConflicts: conflicts,
      changedPromiseCount: 0, promiseEffects: promises, movedOperations: moved, sequence: [...after.operations].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.key.localeCompare(b.key)).map((o, index) => ({ position: index + 1, ...o })),
      planningCostUsd: costKnown ? format(after.operations.reduce((total, o) => total + decimal(o.planningCost!), 0n)) : null,
      cashExposureUsd: '0', requiredRoles: ['planner'], sources, uncertainty: 'Finite production and current material allocation only; future receipt, quality, execution and shipping gates still apply. Unknown tariffs stay unknown. No new purchase or customer-date change.',
    })
  }
  search(0, new Map())
  return { options, search: { evaluated, truncated, rejected, sources, reason: options.length >= 2 ? 'Two distinct feasible alternate-machine plans retained for human selection.' : decisions.length ? 'Fewer than two feasible alternate-machine plans found in the recorded capacity; inspect rejected comparisons and blockers.' : 'No movable operation with a configured eligible alternate; started and protected work stays fixed.' } }
}
