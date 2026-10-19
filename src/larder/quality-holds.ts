// TRACE-004 hold and plan reads shared by the command door and the client's
// dispatch readiness; free of server-only imports so the browser bundle can use it.
import type { Row, State } from './model'

// The approved, current plans that apply to a work order (in-process, final) or a received lot.
export function plansFor(s: Pick<State, 'inspectionPlans'>, stage: string, itemId: string, revision: number | null) {
  return s.inspectionPlans.filter(p => p.status === 'approved' && p.stage === stage && p.itemId === itemId && (p.revision === null || p.revision === revision))
}

export const openHolds = (s: Pick<State, 'qualityHolds'>, subjectId: string) => s.qualityHolds.filter(h => h.status === 'open' && h.subjectId === subjectId)
export const holdReason = (h: Row) => `Quality hold: ${h.planName} failed on ${h.failedAt.slice(0, 10)} (${h.failures.join('; ')}); an owner or manager releases it after a passing retest.`
