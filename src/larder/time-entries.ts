// FLOOR-002: actual labor and operation time. A person clocks setup, run and cleanup against an operation of released
// work, pauses for a reason and stops; crews may attend one operation in parallel, but one person is on one thing at a
// time, so a duplicate tap or an overlapping shift can never count labor twice. A missed or wrong stop is corrected by
// a request a supervisor approves with a reason (never the person who asked, the owner excepted); impossible and
// overlapping times are refused; a locked period changes only after accounts reopen it. Costing uses the retained
// rate in force when the entry started (see timeCosts).
import { decimal, format, SCALE } from './decimal'
import { fail } from './problem'
import { allow, approver } from './roles'
import { timestamp } from './timestamp'
import { bump, fresh, get, newId, oneOf, text, row, type Context, type Row, type State } from './model'

export const phases = ['setup', 'run', 'cleanup'] as const
const pauseReasons = ['breakdown', 'waiting-material', 'changeover', 'quality', 'break', 'other'] as const
const longest = 16 * 3600000

const ms = (v: string) => Date.parse(v)
// The intervals an entry actually worked: its span minus pauses.
const worked = (e: Row, stop = e.stoppedAt) => Math.max(0, ms(stop) - ms(e.startedAt) - (e.pauses ?? []).reduce((n: number, p: any) => n + Math.max(0, Math.min(ms(p.stoppedAt ?? stop), ms(stop)) - Math.max(ms(p.startedAt), ms(e.startedAt))), 0))
const live = (e: Row) => e.status === 'open' || e.status === 'paused'

// Is this instant inside a locked period?
export const locked = (s: State, at: string) => s.timeLocks.find(l => l.status === 'locked' && at.slice(0, 10) <= l.through)

// The person already on something else during [from, to) (an open entry runs to now).
function overlapping(s: State, operatorId: string, from: string, to: string | null, now: string, except?: string) {
  return s.timeEntries.find(e => e.operatorId === operatorId && e.id !== except && e.status !== 'withdrawn' && ms(e.startedAt) < ms(to ?? now) && ms(e.stoppedAt ?? now) > ms(from))
}

export function timeEntries(c: Context, type: string, p: any): Row | undefined {
  if (type === 'time.lock' || type === 'time.reopen') {
    allow(c, ['accounts'])
    if (type === 'time.lock') {
      const through = text(p.through, 'lock through date', 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(through) || through >= c.now.slice(0, 10)) fail('INPUT', 'Lock a period that has ended: choose a date before today.', { field: 'through' })
      if (c.s.timeEntries.some(e => live(e) && e.startedAt.slice(0, 10) <= through)) fail('STATE', 'Stop or correct every open clock entry in the period before locking it.')
      return row(c, 'timeLocks', { through, status: 'locked', reason: text(p.reason, 'lock reason', 400), lockedBy: c.actor.id, lockedAt: c.now })
    }
    const lock = get(c.s, 'timeLocks', p.lockId, 'locked period'); fresh(lock, p.version)
    if (lock.status !== 'locked') fail('STATE', 'This period is already open.')
    return bump(lock, { status: 'reopened', reopenedBy: c.actor.id, reopenedAt: c.now, reopenReason: text(p.reason, 'reopen reason', 400) })
  }
  if (!['time.start', 'time.pause', 'time.resume', 'time.stop', 'time.correct', 'time.decide'].includes(type)) return
  if (type === 'time.decide') {
    // A supervisor decides a correction with a reason; the person who asked never decides their own.
    const entry = get(c.s, 'timeEntries', p.entryId, 'time entry'), request = entry.corrections?.find((x: any) => x.id === p.correctionId) ?? fail('NOT_FOUND', 'Choose the correction to decide.')
    approver(c, ['manager'], request.requestedBy)
    if (entry.operatorId === c.actor.id && c.actor.role !== 'owner') fail('FORBIDDEN', 'A person never approves a correction to their own time.')
    if (request.status !== 'pending') fail('STATE', 'This correction was already decided.')
    const decision = oneOf(p.decision, ['approve', 'decline'] as const, 'decision'), reason = text(p.reason, 'decision reason', 400)
    if (decision === 'approve') {
      const l = locked(c.s, request.startedAt) ?? locked(c.s, entry.startedAt)
      if (l) fail('PERIOD_LOCKED', `The period through ${l.through} is locked; accounts must reopen it first.`, { lockId: l.id })
      if (overlapping(c.s, entry.operatorId, request.startedAt, request.stoppedAt, c.now, entry.id)) fail('OVERLAP', 'This person has other recorded time in that span; one person cannot work two things at once.')
      Object.assign(entry, { startedAt: request.startedAt, stoppedAt: request.stoppedAt, status: 'closed', corrected: true })
    }
    Object.assign(request, { status: decision === 'approve' ? 'approved' : 'declined', decidedBy: c.actor.id, decidedAt: c.now, decisionReason: reason })
    return bump(entry, {})
  }
  allow(c, ['manager', 'production', 'operator'])
  if (type === 'time.start') {
    const w = get(c.s, 'workOrders', p.workOrderId, 'work order')
    if (w.status !== 'released') fail('STATE', 'Clock time only against released work.')
    const step = w.routing.find((r: any) => r.sequence === p.sequence) ?? fail('NOT_FOUND', 'Choose an operation on this released work order.')
    const task = w.operationStates?.find((t: any) => t.sequence === step.sequence)
    if (task?.status === 'done') fail('STATE', 'This operation is complete.')
    // An operator clocks only operations assigned to them, like every other operator door.
    if (c.actor.role === 'operator' && task?.assignment?.operatorId !== c.actor.id) fail('ASSIGNMENT', 'Operators clock only operations assigned to them.')
    const phase = oneOf(p.phase, phases, 'phase')
    const mine = c.s.timeEntries.find(e => e.operatorId === c.actor.id && live(e))
    if (mine) fail(mine.workOrderId === w.id && mine.sequence === step.sequence && mine.phase === phase ? 'DUPLICATE' : 'OVERLAP', mine.workOrderId === w.id && mine.sequence === step.sequence && mine.phase === phase ? 'You are already clocked on this phase; a second tap adds nothing.' : 'Stop your current clock entry before starting another; one person works one thing at a time.', { entryId: mine.id })
    const l = locked(c.s, c.now)
    if (l) fail('PERIOD_LOCKED', `The period through ${l.through} is locked.`)
    return row(c, 'timeEntries', { workOrderId: w.id, reference: w.reference, sequence: step.sequence, operatorId: c.actor.id, phase, startedAt: c.now, stoppedAt: null, status: 'open', pauses: [], corrections: [], station: typeof p.station === 'string' ? p.station.slice(0, 120) : '' })
  }
  const entry = get(c.s, 'timeEntries', p.entryId, 'time entry')
  if (type !== 'time.correct' && entry.operatorId !== c.actor.id) fail('ASSIGNMENT', 'Only the person clocked on can pause, resume or stop their time; ask a supervisor for a correction.')
  if (type === 'time.pause') {
    if (entry.status !== 'open') fail('DUPLICATE', 'This entry is not running; it is already paused or stopped.')
    return bump(entry, { status: 'paused', pauses: [...entry.pauses, { id: newId(), reason: oneOf(p.reason, pauseReasons, 'pause reason'), note: typeof p.note === 'string' ? p.note.slice(0, 400) : '', startedAt: c.now, stoppedAt: null }] })
  }
  if (type === 'time.resume') {
    if (entry.status !== 'paused') fail('DUPLICATE', 'This entry is not paused.')
    return bump(entry, { status: 'open', pauses: entry.pauses.map((x: any) => x.stoppedAt ? x : { ...x, stoppedAt: c.now }) })
  }
  if (type === 'time.stop') {
    if (!live(entry)) fail('DUPLICATE', 'This entry is already stopped.')
    if (ms(c.now) - ms(entry.startedAt) > longest) fail('IMPOSSIBLE', 'This entry has run longer than sixteen hours; ask a supervisor to correct it.')
    return bump(entry, { status: 'closed', stoppedAt: c.now, pauses: entry.pauses.map((x: any) => x.stoppedAt ? x : { ...x, stoppedAt: c.now }) })
  }
  // time.correct: a missed or wrong stop (or start) is asked for with a reason and decided by a supervisor.
  if (entry.operatorId !== c.actor.id && !['owner', 'manager'].includes(c.actor.role)) fail('FORBIDDEN', 'Ask for corrections only to your own time; a supervisor may correct anyone\'s.')
  const startedAt = p.startedAt === undefined ? entry.startedAt : timestamp(p.startedAt, 'start time'), stoppedAt = timestamp(p.stoppedAt, 'stop time')
  if (ms(stoppedAt) <= ms(startedAt)) fail('IMPOSSIBLE', 'The stop must be after the start.')
  if (ms(stoppedAt) > ms(c.now)) fail('IMPOSSIBLE', 'A stop cannot be in the future.')
  if (ms(stoppedAt) - ms(startedAt) > longest) fail('IMPOSSIBLE', 'One entry cannot span more than sixteen hours.')
  if (overlapping(c.s, entry.operatorId, startedAt, stoppedAt, c.now, entry.id)) fail('OVERLAP', 'This person has other recorded time in that span; one person cannot work two things at once.')
  const l = locked(c.s, startedAt) ?? locked(c.s, entry.startedAt)
  if (l) fail('PERIOD_LOCKED', `The period through ${l.through} is locked; accounts must reopen it first.`, { lockId: l.id })
  if (entry.corrections.some((x: any) => x.status === 'pending')) fail('STATE', 'Decide the pending correction first.')
  return bump(entry, { corrections: [...entry.corrections, { id: newId(), startedAt, stoppedAt, reason: text(p.reason, 'correction reason', 400), requestedBy: c.actor.id, requestedAt: c.now, status: 'pending' }] })
}

// Closed entries priced at the rate in force when each began; an unknown rate stays unknown.
export function timeCosts(s: State) {
  return s.timeEntries.filter(e => e.status === 'closed').map(e => {
    const milliseconds = worked(e)
    // The rate in force when the work began; a corrected start earlier than any retained rate uses the rate in force when the time was first clocked.
    const priced = (at: string) => {
      const calendar = s.laborCalendars.find(l => [...(l.history ?? []), l].filter((v: any) => (v.updatedAt ?? v.createdAt) <= at).sort((a: any, b: any) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt) || b.version - a.version)[0]?.operatorIds.includes(e.operatorId))
      return s.laborRates.filter(r => r.laborId === calendar?.id).flatMap(r => [...(r.history ?? []), r]).filter(r => (r.updatedAt ?? r.createdAt) <= at).sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt) || b.version - a.version)[0]
    }
    const rate = priced(e.startedAt) ?? priced(e.createdAt)
    const cost = (r: string) => format((BigInt(milliseconds) * decimal(r) + 1800000n) / 3600000n)
    return { entryId: e.id, workOrderId: e.workOrderId, reference: e.reference, sequence: e.sequence, phase: e.phase, operatorId: e.operatorId, startedAt: e.startedAt, stoppedAt: e.stoppedAt, corrected: Boolean(e.corrected), activeMilliseconds: milliseconds, hours: format((BigInt(milliseconds) * SCALE + 1800000n) / 3600000n), hourlyRate: rate?.hourlyRate ?? null, burdenRate: rate?.burdenRate ?? null, laborCost: rate ? cost(rate.hourlyRate) : null, burdenCost: rate ? cost(rate.burdenRate) : null, currency: 'USD', basis: rate ? 'Clocked time minus recorded pauses at the retained rate in force at the entry start; costing evidence only, never payroll.' : 'No retained rate in force when the entry started; cost unknown.' }
  })
}
