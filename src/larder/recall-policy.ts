// TRACE-006: client-safe containment gates shared by dispatch and commands.
import type { Row, State } from './model'
export const lotRecalls = (s: Pick<State, 'recalls'>, lotId: string) => s.recalls.filter(r => r.status === 'open' && r.lotIds.includes(lotId))
export const workRecalls = (s: Pick<State, 'recalls'>, w: Row) => s.recalls.filter(r => r.status === 'open' && [w.id, ...(w.lineageSourceIds ?? [])].some(id => r.workOrderIds.includes(id)))
export const recallReason = (r: Row) => `Recall hold ${r.reference}: ${r.reason}; owner ${r.ownerId}. Recall disposition is not yet available.`
