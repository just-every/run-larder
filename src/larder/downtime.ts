// FLOOR-007: reported progress estimates effort; only explicit completion ends a task.
import { timestamp } from './timestamp'
import { assertEquipmentAvailable } from './maintenance-availability'
import { decimal, format } from './decimal'
import { bump, fresh, get, newId, oneOf, text, type Context, type Row, type State } from './model'
import { fail, forbidden } from './problem'
import { allow, approver } from './roles'

const commands = ['wo.operation.pause', 'wo.operation.resume', 'wo.operation.progress', 'wo.operation.escalationAck']
const reasons = ['breakdown', 'waiting-material', 'changeover', 'quality', 'other'] as const


export function downtime(c: Context, type: string, p: any): Row | undefined {
  if (!commands.includes(type)) return
  allow(c, ['manager', 'production'])
  const w = get(c.s, 'workOrders', p.workOrderId, 'work order'); fresh(w, p.version)
  const step = w.routing.find((r: any) => r.sequence === p.sequence) ?? fail('NOT_FOUND', 'Choose an operation on this released work order.')
  const task = w.operationStates?.find((r: any) => r.sequence === step.sequence)
  if (!task?.startedBy || !task.startedAt) fail('STATE', 'Start this operation before reporting downtime or progress.')
  if (type === 'wo.operation.escalationAck') {
    approver(c, ['manager'])
    const interval = task.downtime?.find((d: any) => d.id === p.downtimeId) ?? fail('NOT_FOUND', 'Choose the downtime notice to acknowledge.')
    if (c.actor.role !== 'owner' && interval.escalationOwnerId !== c.actor.id) forbidden('Only the assigned supervisor or owner can acknowledge this notice.')
    if (interval.acknowledgedAt) fail('STATE', 'This downtime notice is already acknowledged.')
    const note = text(p.note, 'acknowledgment note')
    Object.assign(interval, { acknowledgedBy: c.actor.id, acknowledgedAt: c.now, acknowledgedNote: note })
    return bump(w, {})
  }
  if (w.status !== 'released') fail('STATE', 'Report downtime and progress only on released work.')
  if (!['running', 'paused'].includes(task.status)) fail('STATE', 'Report only on a running or paused operation.')
  let reportingReason = ''
  if (c.actor.role === 'production') {
    if (task.startedBy !== c.actor.id) forbidden('Only the person running this operation can report its downtime or progress.')
  } else {
    approver(c, ['manager'])
    reportingReason = text(type === 'wo.operation.pause' ? p.note : p.reason, 'supervisor reason')
  }
  const intervals = task.downtime ?? []
  const open = intervals.filter((d: any) => !d.stoppedAt)
  if (type === 'wo.operation.pause') {
    if (task.status !== 'running' || open.length) fail('STATE', 'This operation is already paused; resume it before recording another pause.')
    const reason = oneOf(p.reason, reasons, 'downtime reason'), note = text(p.note, 'downtime note')
    // The command API verifies this person is an active owner/manager before commit.
    const escalationOwnerId = text(p.escalationOwnerId, 'escalation owner')
    const anticipatedResumeAt = timestamp(p.anticipatedResumeAt, 'anticipated resume time')
    if (Date.parse(anticipatedResumeAt) < Date.parse(c.now)) fail('INPUT', 'Anticipated resume time cannot be before now.')
    const last = intervals.at(-1)
    if (last && Date.parse(last.stoppedAt) > Date.parse(c.now)) fail('STATE', 'A new pause cannot overlap an earlier downtime interval.')
    task.downtime = [...intervals, { id: newId(), commandId: c.commandId, reason, note, startedAt: c.now, startedBy: c.actor.id, escalationOwnerId, anticipatedResumeAt, notification: 'recorded in app' }]
    task.status = 'paused'
  } else if (type === 'wo.operation.resume') {
    assertEquipmentAvailable(c.s, task.workCentre, c.now)
    const interval = intervals.at(-1)
    if (task.status !== 'paused' || open.length !== 1 || interval !== open[0]) fail('STATE', 'Resume only a paused operation with one open downtime interval.')
    if (Date.parse(c.now) < Date.parse(interval.startedAt)) fail('STATE', 'Resume time cannot precede the recorded pause.')
    const reason = text(p.reason, 'resume reason')
    Object.assign(interval, { stoppedAt: c.now, stoppedBy: c.actor.id, resumeReason: reason })
    task.events = [...(task.events ?? []), { type: 'resumed', downtimeId: interval.id, reason, by: c.actor.id, at: c.now }]
    task.status = 'running'
  } else {
    const completed = decimal(p.completedQuantity, 'completed quantity')
    if (completed > decimal(w.quantity)) fail('QUANTITY', 'Reported completed quantity cannot exceed the work order quantity.')
    if (task.progress && completed < decimal(task.progress.completedQuantity)) fail('QUANTITY', 'Reported completed quantity cannot go backwards.')
    if (typeof p.remainingMinutes !== 'number' || !Number.isFinite(p.remainingMinutes) || p.remainingMinutes < 0 || p.remainingMinutes > 1000000)
      fail('INPUT', 'Remaining effort must be a number from 0 to 1000000 job minutes.')
    const report = { completedQuantity: format(completed), remainingMinutes: p.remainingMinutes, by: c.actor.id, at: c.now, note: text(p.note, 'progress note'), ...(reportingReason ? { reason: reportingReason } : {}) }
    task.progressReports = [...(task.progressReports ?? []), report]
    // Zero remaining minutes is an estimate, never output, stock or completion.
    task.progress = report
  }
  return bump(w, {})
}

export function lostTimeReport(s: State, asOf = new Date().toISOString()): Row[] {
  asOf = timestamp(asOf, 'report as-of time')
  return s.workOrders.flatMap(w => (w.operationStates ?? []).flatMap((task: any) => (task.downtime ?? []).map((interval: any) => {
    const step = w.routing.find((r: any) => r.sequence === task.sequence) ?? fail('STATE', 'Recorded downtime has no pinned operation.')
    const startedAt = timestamp(interval.startedAt, 'recorded downtime start')
    const stoppedAt = interval.stoppedAt ? timestamp(interval.stoppedAt, 'recorded downtime stop') : null
    const elapsedMs = Math.max(0, Date.parse(stoppedAt ?? asOf) - Date.parse(startedAt))
    // Integer milliseconds -> six-decimal minutes, rounded half up without float drift.
    const elapsedMinutes = format((BigInt(elapsedMs) * 1000000n + 30000n) / 60000n)
    return { ...interval, id: interval.id, version: w.version, workOrderId: w.id, workOrderReference: w.reference,
      itemId: w.itemId, sequence: task.sequence, operationName: step.name, workCentre: task.workCentre,
      operatorId: task.startedBy, operationStatus: task.status, status: stoppedAt ? 'closed' : 'open',
      startedAt, stoppedAt, elapsedMinutes, asOf }
  })))
}
