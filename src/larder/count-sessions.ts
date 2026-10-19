// Scheduled blind counts use reconcile mode: movement frontiers invalidate
// observations instead of blocking the warehouse's receipts and production.
import { decimal, format, times } from './decimal'
import { fail, forbidden } from './problem'
import { allow } from './roles'
import { averageCost, balance, positions } from './stock'
import { bump, date, fresh, get, list, newId, nextReference, oneOf, optionalText, row, text, today, type Context, type Row } from './model'

const pending = (s: Row) => s.status !== 'complete'
const abs = (n: bigint) => n < 0n ? -n : n
function snapshot(c: Context, line: any, locationId: string) {
  const system = balance(c.s, line.itemId, locationId, 'available', line.lotId)
  const unitCost = averageCost(c.s, line.itemId)
  return { system: format(system), unitCost: format(unitCost), value: format(times(system, unitCost)), frontier: c.s.movements.at(-1)?.sequence ?? 0 }
}

export function countSessions(c: Context, type: string, p: any): Row | undefined {
  if (type === 'count.schedule') {
    allow(c, ['manager'])
    const location = get(c.s, 'locations', p.locationId, 'location')
    if (location.archived) fail('INPUT', 'Choose an active bin or location.')
    const counter = get(c.s, 'roles', p.counterId, 'warehouse counter')
    if (counter.role !== 'warehouse') fail('INPUT', 'Assign an invited warehouse person to keep the count blind.')
    const basis = oneOf(p.basis, ['value', 'risk', 'bin'] as const, 'count selection basis')
    const risk = oneOf(p.risk ?? 'high', ['high', 'medium', 'low'] as const, 'risk')
    const scheduledOn = date(p.scheduledOn, 'scheduled date')
    if (scheduledOn < today(c)) fail('INPUT', 'Schedule a count for today or a future date.')
    const recountTolerance = format(decimal(p.recountTolerance ?? '0', 'recount tolerance'))
    const minimumValue = decimal(p.minimumValue ?? '0', 'minimum inventory value')
    if (p.itemId) get(c.s, 'items', p.itemId, 'item')
    let targets = positions(c.s).filter(x => x.locationId === location.id && x.status === 'available' && (!p.itemId || p.itemId === x.itemId))
    if (p.itemId && !targets.length) targets = [{ itemId: p.itemId, locationId: location.id, status: 'available', lotId: '', quantity: '0' }]
    const lines = targets.map(x => ({ id: newId(), itemId: x.itemId, lotId: x.lotId, risk, status: 'pending', attempts: [], ...snapshot(c, x, location.id) }))
      .filter(x => basis !== 'value' || decimal(x.value) >= minimumValue)
      .sort((a, b) => basis === 'value' ? (decimal(a.value) > decimal(b.value) ? -1 : 1) : a.itemId.localeCompare(b.itemId))
    list(lines, 'count targets')
    if (c.s.countSessions.some(s => pending(s) && s.counterId === counter.id)) fail('STATE', 'This person already has an unfinished blind count.')
    return row(c, 'countSessions', { reference: nextReference(c.s.countSessions, 'CC'), locationId: location.id, scheduledOn, counterId: counter.id, basis, risk, minimumValue: format(minimumValue), recountTolerance, mode: 'reconcile', lines, status: 'scheduled' })
  }
  if (type !== 'count.submit' && type !== 'count.recount') return
  allow(c, type === 'count.submit' ? ['warehouse'] : ['manager'])
  const session = get(c.s, 'countSessions', p.sessionId, 'count session'); fresh(session, p.version)
  const line = session.lines.find((l: any) => l.id === p.lineId) ?? fail('NOT_FOUND', 'That count line was not found.')
  if (!pending(session) || line.status === 'approved') fail('STATE', 'This count line is complete.')
  if (type === 'count.recount') {
    if (!line.attempts.length) fail('STATE', 'Record the first count before requesting a recount.')
    const previous = get(c.s, 'counts', line.countId)
    if (previous.status === 'awaiting approval') bump(previous, { status: 'superseded' })
    Object.assign(line, snapshot(c, line, session.locationId), { status: 'recount required', recountReason: text(p.note, 'recount reason', 400), requestedBy: c.actor.id, requestedAt: c.now })
    return bump(session, { status: 'counting' })
  }
  if (session.counterId !== c.actor.id) forbidden('Only the assigned warehouse person can submit this blind count.')
  if (session.scheduledOn > today(c)) fail('STATE', 'This count is not due yet.')
  if (!['pending', 'recount required'].includes(line.status)) fail('STATE', 'Request a recount before submitting another observation.')
  // A mandatory variance recount gets a new frontier even without a separate
  // manager request; the first observation remains in counts and attempts.
  if (line.status === 'recount required' && !line.requestedAt) Object.assign(line, snapshot(c, line, session.locationId))
  const counted = decimal(p.counted, 'counted quantity')
  const serials: string[] = p.serials === undefined ? [] : (Array.isArray(p.serials) && p.serials.length <= 500 ? p.serials.map((v: unknown) => text(v, 'observed serial', 120)) : fail('INPUT', 'List at most 500 observed serials.'))
  if (serials.length && (new Set(serials).size !== serials.length || counted !== decimal(String(serials.length)))) fail('INPUT', 'Observed serials must be unique and match the counted quantity.')
  if (serials.some(id => session.lines.some((other: any) => other.id !== line.id && other.countId && c.s.counts.find(x => x.id === other.countId)?.serials?.includes(id)))) fail('INPUT', 'A serial was already observed on another line of this count.')
  const system = decimal(line.system), variance = counted - system
  const count = row(c, 'counts', { reference: nextReference(c.s.counts, 'CT'), sessionId: session.id, sessionLineId: line.id, itemId: line.itemId, locationId: session.locationId, lotId: line.lotId, serials, counted: format(counted), system: line.system, variance: format(variance), unitCost: line.unitCost, valueVariance: format(times(variance, decimal(line.unitCost))), frontier: line.frontier, countingBasis: 'physical blind count in base unit', countedAt: c.now, note: optionalText(p.note, 'count note', 400), status: 'awaiting approval' })
  if (line.countId) { const old = get(c.s, 'counts', line.countId); if (old.status === 'awaiting approval') bump(old, { status: 'superseded' }) }
  line.attempts.push(count.id)
  Object.assign(line, { countId: count.id, status: abs(variance) > decimal(session.recountTolerance) && line.attempts.length < 2 ? 'recount required' : 'awaiting approval', requestedAt: null })
  bump(session, { status: 'counting' })
  // Persist a blind-safe result too: replay cannot reveal the hidden basis.
  return { id: count.id, version: count.version, reference: count.reference, sessionId: session.id, lineId: line.id, status: line.status }
}

export function decideSessionCount(c: Context, count: Row, type: string) {
  if (!count.sessionId) return
  const session = get(c.s, 'countSessions', count.sessionId), line = session.lines.find((l: any) => l.id === count.sessionLineId)
  if (count.createdBy === c.actor.id) forbidden('A different person must approve a blind count, including in an owner-run workshop.')
  if (line.countId !== count.id) fail('STATE', 'Decide the latest recount observation.')
  if (type === 'count.approve' && line.status !== 'awaiting approval') fail('RECOUNT_REQUIRED', 'The variance exceeds tolerance. Recount before approval.')
  line.status = type === 'count.approve' ? 'approved' : 'recount required'
  if (type === 'count.reject') { Object.assign(line, snapshot(c, line, session.locationId), { requestedAt: c.now, requestedBy: c.actor.id, recountReason: 'Count rejected; recount required' }) }
  bump(session, { status: session.lines.every((l: any) => l.status === 'approved') ? 'complete' : 'counting' })
}
