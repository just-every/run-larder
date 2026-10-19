// ENG-002: execution refers only to the released instruction snapshot.
import { allow } from './roles'
import { fail } from './problem'
import { bump, fresh, get, text, type Context, type Row } from './model'

export function operations(c: Context, type: string, p: any): Row | undefined {
  if (!['wo.operation.acknowledge', 'wo.operation.assign', 'wo.operation.start', 'wo.operation.complete'].includes(type)) return
  allow(c, type === 'wo.operation.assign' ? ['manager'] : ['manager', 'production'])
  const w = get(c.s, 'workOrders', p.workOrderId, 'work order'); fresh(w, p.version)
  if (w.status !== 'released') fail('STATE', 'Operate only on released work.')
  const step = w.routing.find((r: any) => r.sequence === p.sequence) ?? fail('NOT_FOUND', 'Choose an operation on this released work order.')
  w.operationStates ??= []
  let task = w.operationStates.find((r: any) => r.sequence === step.sequence)
  if (!task) { task = { sequence: step.sequence, status: 'pending', acknowledgments: [] }; w.operationStates.push(task) }
  if (task.status === 'done') fail('STATE', 'This operation is complete.')
  if (type === 'wo.operation.acknowledge') {
    if (p.bomId !== w.bomId) fail('STALE', 'Acknowledge the exact pinned instruction revision.')
    if (!task.acknowledgments.some((a: any) => a.by === c.actor.id && a.bomId === w.bomId)) task.acknowledgments.push({ by: c.actor.id, at: c.now, bomId: w.bomId })
  } else if (type === 'wo.operation.assign') {
    if (task.status !== 'pending') fail('STATE', 'Assign a person before starting the operation.')
    task.assignment = { operatorId: text(p.operatorId, 'operator'), by: c.actor.id, at: c.now, skills: [...(step.requiredSkills ?? [])], bomId: w.bomId }
  } else if (type === 'wo.operation.start') {
    if (task.status !== 'pending') fail('STATE', 'This operation has already started.')
    const predecessors = step.dependsOn ?? (step.sequence > 1 ? [step.sequence - 1] : [])
    const blocked = predecessors.filter((n: number) => !w.operationStates.some((r: any) => r.sequence === n && r.status === 'done'))
    if (blocked.length) fail('DEPENDENCY', `Complete predecessor operation ${blocked.join(', ')} first.`, { predecessors: blocked })
    if ((step.instructions || step.drawings?.length) && !task.acknowledgments.some((a: any) => a.by === c.actor.id && a.bomId === w.bomId)) fail('ACKNOWLEDGMENT', 'Read and acknowledge this job’s pinned instructions and drawings before starting.')
    if (task.assignment && task.assignment.operatorId !== c.actor.id) fail('ASSIGNMENT', 'Only the assigned person can start this operation.')
    if (step.requiredSkills?.length && !task.assignment) fail('SKILLS', 'A manager must authorize a named person for these skill requirements before starting.')
    const workCentre = text(p.workCentre, 'work center', 120)
    const eligible = step.eligibleCentres ?? (step.workCentre ? [step.workCentre] : [])
    if (eligible.length && !eligible.includes(workCentre)) fail('WORK_CENTER', 'Choose an eligible work center from the pinned routing.')
    Object.assign(task, { status: 'running', startedBy: c.actor.id, startedAt: c.now, workCentre })
  } else {
    if (task.status !== 'running') fail('STATE', 'Start this operation before completing it.')
    if (task.startedBy !== c.actor.id) fail('ASSIGNMENT', 'The person who started this operation must complete it.')
    Object.assign(task, { status: 'done', completedBy: c.actor.id, completedAt: c.now })
  }
  return bump(w, {})
}
