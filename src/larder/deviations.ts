// TRACE-008 executed deviations, shared by trace rows and frozen shipment packs.
import type { Movement, Row, State } from './model'
export const deviationLabel = 'released under deviation; failed results retained, not passed'
export const lotDeviations = (s: Pick<State, 'nonconformances'>, lotId: string) => s.nonconformances.flatMap(n => n.lotId !== lotId ? [] : (n.deviationProposals ?? []).filter((d: Row) => d.executedAt).map((d: Row) => ({
  reference: d.reference, caseReference: n.reference, locationId: n.locationId, quantity: d.quantity, proposedBy: d.proposedBy, approvedBy: d.approvedBy, executedBy: d.executedBy, executedAt: d.executedAt, inspectionIds: d.inspectionIds, label: deviationLabel,
})))
export const movementDeviation = (s: Pick<State, 'nonconformances'>, m: Movement) => m.kind !== 'nonconformance-deviation' ? undefined
  : s.nonconformances.find(n => n.id === m.documentId)?.deviationProposals?.find((d: Row) => d.movementIds?.includes(m.id))?.reference as string | undefined
