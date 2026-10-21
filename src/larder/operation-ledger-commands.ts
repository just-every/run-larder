// FLOOR-003: partial completion, scrap, scoped operation holds and dated
// manufacturing backorders. Reports are actual quantities (unlike FLOOR-007
// progress estimates) and never post stock or finished output.
import { decimal, format } from './decimal'
import { ledgerFacts } from './operation-ledger'
import { assertEquipmentAvailable } from './maintenance-availability'
import { allow, approver } from './roles'
import { fail, forbidden } from './problem'
import { bump, date, fresh, get, newId, oneOf, today, text, type Context, type Row } from './model'

const commands = ['wo.operation.report', 'wo.operation.hold', 'wo.operation.holdRelease', 'wo.operation.backorder', 'wo.operation.backorderResume']
const supervisor = (c: Context) => ['owner', 'manager'].includes(c.actor.role)

export function operationLedgerCommands(c: Context, type: string, p: any): Row | undefined {
  if (!commands.includes(type)) return
  allow(c, ['manager', 'production', 'operator'])
  const w = get(c.s, 'workOrders', p.workOrderId, 'work order'); fresh(w, p.version)
  if (w.status !== 'released') fail('STATE', 'Record the operation ledger only on released work.')
  const step = w.routing.find((r: any) => r.sequence === p.sequence) ?? fail('NOT_FOUND', 'Choose an operation on this released work order.')
  const task = w.operationStates?.find((t: any) => t.sequence === step.sequence) ?? fail('STATE', 'This operation has no recorded state yet.')
  const f = ledgerFacts(w, step), reason = text(p.reason, 'reason')
  // The assigned starter records their own operation; owner/manager record any with a reason.
  const own = () => {
    if (supervisor(c)) return
    if (task.startedBy !== c.actor.id || task.assignment?.operatorId !== c.actor.id) forbidden('Only the assigned person who started this operation records its quantities.')
  }
  if (type === 'wo.operation.report') {
    own()
    if (task.status !== 'running') fail('STATE', 'Report quantities only while the operation is running.')
    assertEquipmentAvailable(c.s, task.workCentre, c.now)
    const good = decimal(p.good ?? '0', 'good quantity'), scrap = decimal(p.scrap ?? '0', 'scrap quantity')
    if (good === 0n && scrap === 0n) fail('INPUT', 'Record a good or scrap quantity.')
    if (good + scrap > f.inProcess) fail('QUANTITY', `Only ${format(f.inProcess)} units are in process at this operation.`)
    task.reports = [...(task.reports ?? []), { id: newId(), good: format(good), scrap: format(scrap), scrapReason: scrap > 0n ? text(p.scrapReason, 'scrap reason', 400) : '', by: c.actor.id, at: c.now, reason }]
  } else if (type === 'wo.operation.hold') {
    own()
    if (!['running', 'done'].includes(task.status)) fail('STATE', 'Hold completed units only from a running or completed operation.')
    const quantity = decimal(p.quantity, 'held quantity', { positive: true })
    if (quantity > f.available) fail('QUANTITY', `Only ${format(f.available)} completed units here are neither held nor handed on.`)
    task.holds = [...(task.holds ?? []), { id: newId(), quantity: format(quantity), status: 'open', reason, by: c.actor.id, at: c.now }]
  } else if (type === 'wo.operation.holdRelease') {
    approver(c, ['manager'])
    const hold = (task.holds ?? []).find((h: any) => h.id === p.holdId) ?? fail('NOT_FOUND', 'Choose the operation hold to release.')
    if (hold.status !== 'open') fail('STATE', 'This hold is already released.')
    if (hold.by === c.actor.id && c.actor.role !== 'owner') forbidden('A different owner or manager releases a hold you placed.')
    Object.assign(hold, { status: 'released', disposition: oneOf(p.disposition, ['continue', 'scrap'] as const, 'disposition'), releasedBy: c.actor.id, releasedAt: c.now, releaseReason: reason })
  } else if (type === 'wo.operation.backorder') {
    approver(c, ['manager'])
    if (task.status === 'done') fail('STATE', 'A completed operation has no units left to backorder.')
    const quantity = decimal(p.quantity, 'backorder quantity', { positive: true }), dueOn = date(p.dueOn, 'backorder date')
    if (dueOn < today(c)) fail('INPUT', 'A backorder date cannot be in the past.', { field: 'dueOn' })
    if (quantity > f.inProcess) fail('QUANTITY', `Only ${format(f.inProcess)} units are still uncompleted at this operation.`)
    task.backorders = [...(task.backorders ?? []), { id: newId(), quantity: format(quantity), status: 'open', dueOn, reason, by: c.actor.id, at: c.now }]
  } else {
    approver(c, ['manager'])
    const backorder = (task.backorders ?? []).find((b: any) => b.id === p.backorderId) ?? fail('NOT_FOUND', 'Choose the backorder to resume.')
    if (backorder.status !== 'open') fail('STATE', 'This backorder is already resumed.')
    Object.assign(backorder, { status: 'resumed', resumedBy: c.actor.id, resumedAt: c.now, resumeReason: reason })
  }
  return bump(w, {})
}
