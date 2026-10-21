// ENG-002: execution refers only to the released instruction snapshot.
import { decimal, format } from './decimal'
import { dependencyGates, predecessorQualityGates, receivedQuantity, transferredTo, predecessors, type OperationGate } from './operation-dependencies'
import { workRecalls, recallReason } from './recall-policy'
import { activeMaintenance, assertEquipmentAvailable } from './maintenance-availability'
import { holdReason, workHolds } from './quality-holds'
import { allow } from './roles'
import { fail } from './problem'
import { bump, fresh, get, text, type Actor, type Context, type Row, type State } from './model'

type Gate = OperationGate

// The read projection and the command share actual start gates. Form inputs
// (station, chosen center and reason) are validated only when submitted.
export function operationStartGates(s: Pick<State, 'maintenance' | 'qualityHolds' | 'recalls' | 'inspectionPlans' | 'inspections' | 'items'>, actor: Pick<Actor, 'id' | 'role'>, w: Row, step: any, now: string, workCentre?: string): Gate[] {
  const states: any[] = w.operationStates ?? []
  const task = states.find(t => t.sequence === step.sequence)
  const centres: string[] = step.eligibleCentres?.length ? step.eligibleCentres : step.workCentre ? [step.workCentre] : []
  const gates: Gate[] = [
    ...(!['owner', 'manager', 'production', 'operator'].includes(actor.role) ? [{ code: 'FORBIDDEN', message: 'Your current role cannot execute operations.' }] : []),
    ...(w.status !== 'released' ? [{ code: 'STATE', message: 'Operate only on released work.' }] : []),
    ...(task && task.status !== 'pending' ? [{ code: 'STATE', message: task.status === 'done' ? 'This operation is complete.' : 'This operation has already started.' }] : []),
    ...workRecalls(s, w).map(r => ({ code: 'RECALL_HOLD', message: recallReason(r), ownerId: r.ownerId })),
    ...workHolds(s, w).map(h => ({ code: 'QUALITY_HOLD', message: holdReason(h), ownerId: h.createdBy })),
    ...dependencyGates(s, w, step),
    ...((step.instructions || step.drawings?.length) && !task?.acknowledgments?.some((a: any) => a.by === actor.id && a.bomId === w.bomId) ? [{ code: 'ACKNOWLEDGMENT', message: 'Read and acknowledge this job’s pinned instructions and drawings before starting.' }] : []),
    ...(task?.assignment && task.assignment.operatorId !== actor.id ? [{ code: 'ASSIGNMENT', message: 'Only the assigned person can start this operation.' }] : []),
    ...(step.requiredSkills?.length && !task?.assignment ? [{ code: 'SKILLS', message: 'A manager must authorize a named person for these skill requirements before starting.' }] : []),
    ...(!step.requiredSkills?.length && !task?.assignment ? [{ code: 'ASSIGNMENT', message: 'A manager must assign a named operator before starting.' }] : []),
    ...(workCentre && centres.length && !centres.includes(workCentre) ? [{ code: 'WORK_CENTER', message: 'Choose an eligible work center from the pinned routing.' }] : []),
    ...((workCentre ? activeMaintenance(s, workCentre, now).length > 0 : centres.length > 0 && centres.every(center => activeMaintenance(s, center, now).length > 0)) ? [{ code: 'MAINTENANCE', message: 'Eligible equipment is unavailable until maintenance release.' }] : []),
  ]
  return gates.map(g => ({ ...g, ownerId: g.ownerId ?? (['ACKNOWLEDGMENT', 'STATE'].includes(g.code) ? actor.id : task?.assignment?.operatorId ?? w.releasedBy) }))
}

export function dispatchTasks(s: State, actor: Actor, now = new Date().toISOString()) {
  return s.workOrders.filter(w => w.status === 'released').flatMap(w => w.routing.map((step: any) => {
    const task = w.operationStates?.find((t: any) => t.sequence === step.sequence)
    const gates = operationStartGates(s, actor, w, step, now)
    return { workOrderId: w.id, version: w.version, sequence: step.sequence, operatorId: task?.assignment?.operatorId ?? null, status: task?.status ?? 'pending', ready: (!task || task.status === 'pending') && gates.length === 0, gates, asOf: now }
  }))
}

export function operations(c: Context, type: string, p: any): Row | undefined {
  if (!['wo.operation.acknowledge', 'wo.operation.assign', 'wo.operation.start', 'wo.operation.complete', 'wo.operation.transfer'].includes(type)) return
  allow(c, type === 'wo.operation.assign' ? ['manager'] : ['manager', 'production', 'operator'])
  const w = get(c.s, 'workOrders', p.workOrderId, 'work order'); fresh(w, p.version)
  if (w.status !== 'released') fail('STATE', 'Operate only on released work.')
  const step = w.routing.find((r: any) => r.sequence === p.sequence) ?? fail('NOT_FOUND', 'Choose an operation on this released work order.')
  w.operationStates ??= []
  let task = w.operationStates.find((r: any) => r.sequence === step.sequence)
  if (!task) { task = { sequence: step.sequence, status: 'pending', acknowledgments: [] }; w.operationStates.push(task) }
  const inherited = task.status === 'done' && task.inheritedFrom?.length > 0
  if (task.status === 'done' && type !== 'wo.operation.transfer' && !(inherited && type === 'wo.operation.assign')) fail('STATE', 'This operation is complete.')
  // An operator acts only on an operation assigned to them.
  if (c.actor.role === 'operator' && task.assignment?.operatorId !== c.actor.id) fail('ASSIGNMENT', 'Operators act only on operations assigned to them.')
  if (type === 'wo.operation.transfer') {
    if (!['running', 'done'].includes(task.status)) fail('STATE', 'Hand off completed units only from a running or completed operation.')
    if ((!inherited && task.startedBy !== c.actor.id) || task.assignment?.operatorId !== c.actor.id) fail('ASSIGNMENT', 'Only the assigned starter or assigned inheritor of a completed operation can record its handoff.')
    const destination = w.routing.find((r: any) => r.sequence === p.toSequence)
    if (!destination || !predecessors(destination).includes(step.sequence) || decimal(destination.transferBatch ?? '0') === 0n) fail('DEPENDENCY', 'Choose a direct successor with a configured transfer batch.')
    const gate = [...workRecalls(c.s, w).map(r => ({ code: 'RECALL_HOLD', message: recallReason(r) })), ...workHolds(c.s, w).map(h => ({ code: 'QUALITY_HOLD', message: holdReason(h) })), ...predecessorQualityGates(c.s, w, [step.sequence])][0]
    if (gate) fail(gate.code, gate.message)
    if (task.workCentre) assertEquipmentAvailable(c.s, task.workCentre, c.now)
    const quantity = decimal(p.quantity, 'handoff quantity', { positive: true })
    if (transferredTo(w, step.sequence, destination.sequence) + quantity > receivedQuantity(w, step)) fail('QUANTITY', 'Hand off no more than the work quantity or the actual quantity received from every predecessor.')
    task.transfers = [...(task.transfers ?? []), { toSequence: destination.sequence, quantity: format(quantity), by: c.actor.id, at: c.now, reason: text(p.reason, 'handoff reason') }]
  } else if (type === 'wo.operation.acknowledge') {
    if (p.bomId !== w.bomId) fail('STALE', 'Acknowledge the exact pinned instruction revision.')
    if (!task.acknowledgments.some((a: any) => a.by === c.actor.id && a.bomId === w.bomId)) task.acknowledgments.push({ by: c.actor.id, at: c.now, bomId: w.bomId })
  } else if (type === 'wo.operation.assign') {
    const operatorId = text(p.operatorId, 'operator')
    const legacy = ['running', 'paused'].includes(task.status) && !task.assignment && Boolean(task.startedBy)
    if (task.status !== 'pending' && !legacy && !inherited) fail('STATE', 'Assign a person before starting the operation.')
    if (legacy && operatorId !== task.startedBy) fail('ASSIGNMENT', 'Record the existing starter as the operator of this legacy active task.')
    const reason = legacy ? text(p.reason, 'legacy assignment reason') : ''
    task.assignment = { operatorId, by: c.actor.id, at: c.now, skills: [...(step.requiredSkills ?? [])], bomId: w.bomId, ...(legacy ? { legacy: true, reason } : {}) }
    task.assignmentHistory = [...(task.assignmentHistory ?? []), structuredClone(task.assignment)]
  } else if (type === 'wo.operation.start') {
    const gate = operationStartGates(c.s, c.actor, w, step, c.now, typeof p.workCentre === 'string' ? p.workCentre.trim() : undefined)[0]
    if (gate) fail(gate.code, gate.message)
    const workCentre = text(p.workCentre, 'work center', 120)
    const station = text(p.station, 'station', 120), reason = text(p.reason, 'start reason')
    Object.assign(task, { status: 'running', startedBy: c.actor.id, startedAt: c.now, workCentre, station, startReason: reason })
    task.events = [...(task.events ?? []), { type: 'started', by: c.actor.id, operatorId: c.actor.id, at: c.now, workCentre, station, reason }]
  } else {
    assertEquipmentAvailable(c.s, task.workCentre, c.now)
    if (task.status !== 'running') fail('STATE', 'Start this operation before completing it.')
    if (task.startedBy !== c.actor.id) fail('ASSIGNMENT', 'The person who started this operation must complete it.')
    if (task.assignment?.operatorId !== c.actor.id) fail('ASSIGNMENT', 'Only the assigned person can complete this operation. A manager must record the existing starter for a legacy active task.')
    if (receivedQuantity(w, step) < decimal(w.quantity)) fail('TRANSFER_BATCH', 'Receive the full work quantity from every predecessor before completing this operation.')
    const reason = text(p.reason, 'completion reason')
    Object.assign(task, { status: 'done', completedBy: c.actor.id, completedAt: c.now, completionReason: reason })
    task.events = [...(task.events ?? []), { type: 'completed', by: c.actor.id, operatorId: c.actor.id, at: c.now, workCentre: task.workCentre, station: task.station ?? null, reason }]
  }
  return bump(w, {})
}
