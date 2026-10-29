// TRACE-004 hold and plan reads shared by the command door and the client's
// dispatch readiness; free of server-only imports so the browser bundle can use it.
import type { Row, State } from './model'
import { fail } from './problem'

// The approved, current plans that apply to a work order (in-process, final) or a received lot.
export function plansFor(s: Pick<State, 'inspectionPlans'>, stage: string, itemId: string, revision: number | null) {
  return s.inspectionPlans.filter(p => p.status === 'approved' && p.stage === stage && p.itemId === itemId && (p.revision === null || p.revision === revision))
}

// Recovery is a new physical lot. Only results on that exact lot under the
// current applicable receipt plans establish its condition.
export function receiptInspections(s: Pick<State, 'inspectionPlans' | 'inspections'>, lot: Row) {
  return plansFor(s, 'receipt', lot.itemId, null).filter(p => p.required).map(plan => {
    const latest = s.inspections.filter(i => i.planId === plan.id && i.subjectKind === 'lots' && i.subjectId === lot.id).at(-1)
    if (!latest || !latest.passed || latest.planVersion !== plan.version) return fail('RETEST', `Record a passing ${plan.name} inspection on lot ${lot.code} under the current approved plan.`)
    return { id: latest.id, planId: plan.id, planVersion: plan.version, inspectedBy: latest.inspectedBy, inspectedAt: latest.inspectedAt }
  })
}

export const openHolds = (s: Pick<State, 'qualityHolds'>, subjectId: string) => s.qualityHolds.filter(h => h.status === 'open' && h.subjectId === subjectId)
export const holdReason = (h: Row) => `Quality hold: ${h.planName} failed on ${h.failedAt.slice(0, 10)} (${h.failures.join('; ')}); an owner or manager releases it after a passing retest.`

// Split/merge successors inherit holds raised later on any original job.
export const workHolds = (s: Pick<State, 'qualityHolds'>, w: Row) => s.qualityHolds.filter(h => h.status === 'open' && [w.id, ...(w.lineageSourceIds ?? [])].includes(h.subjectId))
