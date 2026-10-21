// CAP-003: pinned dependencies and actual handoffs, shared by dispatch and commands.
// Progress reports are estimates and are never used as transfer evidence.
import { decimal, format, min } from './decimal'
import { plansFor } from './quality-holds'
import type { Row, State } from './model'

export type DependencyState = Pick<State, 'inspectionPlans' | 'inspections' | 'items'>
export type OperationGate = { code: string; message: string; ownerId?: string }
export const predecessors = (step: any): number[] => step.dependsOn ?? (step.sequence > 1 ? [step.sequence - 1] : [])
export const transferredTo = (w: Row, from: number, to: number): bigint => {
  const actual = (w.operationStates?.find((t: any) => t.sequence === from)?.transfers ?? []).filter((t: any) => t.toSequence === to).reduce((n: bigint, t: any) => n + decimal(t.quantity), 0n)
  return (w.handoffAllocations ?? []).filter((a: any) => a.fromSequence === from && a.toSequence === to).reduce((n: bigint, a: any) => n + (a.direction === 'in' ? 1n : -1n) * decimal(a.quantity), actual)
}

export function predecessorQualityGates(s: DependencyState, w: Row, sequences: number[]): OperationGate[] {
  return plansFor(s, 'in-process', w.itemId, w.bomRevision).filter(p => p.required && sequences.includes(p.operationSequence)).flatMap(p => {
    const latest = s.inspections.filter(i => i.subjectKind === 'workOrders' && i.subjectId === w.id && i.planId === p.id && i.planVersion === p.version).at(-1)
    return latest?.passed ? [] : [{ code: 'QUALITY_CHECK', message: `Record a passing ${p.name} inspection after operation ${p.operationSequence}.`, ownerId: p.approval?.by ?? w.releasedBy }]
  })
}

export function dependencyGates(s: DependencyState, w: Row, step: any): OperationGate[] {
  const previous = predecessors(step), gates: OperationGate[] = []
  for (const sequence of previous) {
    const task = w.operationStates?.find((t: any) => t.sequence === sequence), ownerId = task?.assignment?.operatorId ?? w.releasedBy
    if (!step.allowOverlap && task?.status !== 'done') gates.push({ code: 'DEPENDENCY', message: `Complete predecessor operation ${sequence} first.`, ownerId })
    const batch = decimal(step.transferBatch ?? '0')
    if (batch > 0n) {
      const required = min(batch, decimal(w.quantity)), received = transferredTo(w, sequence, step.sequence)
      if (received < required) gates.push({ code: 'TRANSFER_BATCH', message: `Operation ${sequence} must hand off ${format(required)} base units to operation ${step.sequence}; ${format(received)} recorded.`, ownerId })
    }
  }
  gates.push(...predecessorQualityGates(s, w, previous))
  if (step.requireMaterials) for (const line of w.components) {
    const missing = decimal(line.required) - decimal(line.issued)
    const item = s.items.find(i => i.id === line.itemId)
    if (missing > 0n) gates.push({ code: 'MATERIAL', message: `Issue ${format(missing)} more ${item?.baseUnit ?? 'base units'} of ${item?.name ?? line.itemId} before operation ${step.sequence}.`, ownerId: w.releasedBy })
  }
  return gates
}

// An overlap operation can hand off or complete only units already handed to it.
export function receivedQuantity(w: Row, step: any): bigint {
  if (decimal(step.transferBatch ?? '0') === 0n || !predecessors(step).length) return decimal(w.quantity)
  return predecessors(step).reduce((n, sequence) => min(n, transferredTo(w, sequence, step.sequence)), decimal(w.quantity))
}
