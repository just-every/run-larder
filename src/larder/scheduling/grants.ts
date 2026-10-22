// A grant delegates only bounded internal interval bookings, never business
// authority. Every revision suspends the previous approval immediately.
import { bump, fresh, get, list, row, text, type Context, type Row } from '../model'
import { allow, approver } from '../roles'
import { fail, forbidden } from '../problem'
import { instant, integer } from './calendars'

export const grantEvents = ['progress', 'ETA', 'breakdown', 'priority']
export const recoveryEvent = (type: string) => type.startsWith('maintenance.') || type === 'wo.operation.pause' ? 'breakdown' : type.startsWith('po.') ? 'ETA' : type === 'order.rank' ? 'priority' : 'progress'
const protectionVersion = (c: Context) => c.s.schedulePolicies[0]?.version
const snapshot = (g: Row) => { const { history, ...data } = g; return data }
const revise = (g: Row, data: Record<string, any>) => bump(g, { ...data, history: [...(g.history ?? []), snapshot(g)] })

export function suspendGrant(c: Context, grant: Row, reason: string) {
  return revise(grant, { status: 'suspended', suspendedAt: c.now, suspensionReason: reason })
}

export function scheduleGrant(c: Context, type: string, p: any): Row | undefined {
  if (!type.startsWith('schedule.grant.')) return
  if (type === 'schedule.grant.prepare') {
    allow(c, ['manager', 'planner', 'agent'])
    if (!protectionVersion(c)) fail('POLICY', 'Record the planning window and protections before preparing a grant.')
    const eventTypes = [...new Set(list<string>(p.eventTypes, 'event types', 4))]
    if (eventTypes.some(e => !grantEvents.includes(e))) fail('INPUT', 'Choose progress, ETA, breakdown or priority events.')
    const scope = (value: unknown, kind: 'machineCalendars' | 'workOrders') => {
      if (!Array.isArray(value) || value.length > 100) fail('INPUT', 'Explicitly list the grant scope, at most 100 records.')
      return [...new Set((value as unknown[]).map(id => get(c.s, kind, id).id))]
    }
    const machineIds = scope(p.machineIds, 'machineCalendars'), workOrderIds = scope(p.workOrderIds, 'workOrders')
    if (!machineIds.length && !workOrderIds.length) fail('INPUT', 'Choose at least one work center or job; there is no installation-wide default.')
    const expiresAt = instant(p.expiresAt, 'grant expiry')
    if (expiresAt <= c.now) fail('INPUT', 'The grant expiry must be in the future.')
    const data = { status: 'draft', preparedBy: c.actor.id, preparedAt: c.now, eventTypes, machineIds, workOrderIds,
      maxDelayMinutes: integer(p.maxDelayMinutes, 'per-job delay limit', 0, 86400),
      maxDisplacementMinutes: integer(p.maxDisplacementMinutes, 'per-job displacement limit', 0, 86400),
      expiresAt, protectionVersion: protectionVersion(c), reason: text(p.reason, 'grant reason'), approvedBy: null, approvedAt: null, revokedBy: null, revokedAt: null, revokeReason: null, suspendedAt: null, suspensionReason: null }
    if (!p.id) return row(c, 'scheduleGrants', { ...data, history: [] })
    const grant = get(c.s, 'scheduleGrants', p.id); fresh(grant, p.version)
    return revise(grant, data)
  }
  const grant = get(c.s, 'scheduleGrants', p.grantId); fresh(grant, p.version)
  const reason = text(p.reason, 'grant decision reason')
  if (type === 'schedule.grant.approve') {
    approver(c, ['manager', 'planner'], grant.preparedBy)
    if (grant.status !== 'draft') fail('STATE', 'Prepare a new grant version before approval.')
    if (grant.protectionVersion !== protectionVersion(c) || grant.expiresAt <= c.now) fail('STALE', 'The protection version or expiry changed; prepare a fresh grant.')
    return revise(grant, { status: 'active', approvedBy: c.actor.id, approvedAt: c.now, approvalReason: reason })
  }
  if (type === 'schedule.grant.revoke') {
    if (!(['owner', 'manager'].includes(c.actor.role) || [grant.preparedBy, grant.approvedBy].includes(c.actor.id))) forbidden('Only the owner, a manager, the preparer or approver can revoke a grant.')
    if (grant.status === 'revoked') fail('STATE', 'This grant is already revoked.')
    return revise(grant, { status: 'revoked', revokedBy: c.actor.id, revokedAt: c.now, revokeReason: reason })
  }
  fail('COMMAND', 'Unknown schedule grant command.')
}

// Return an explanation rather than throwing: the recorded event still lands,
// with its proposal left for human review and no partial booking.
export function grantRefusal(c: Context, grant: Row, plan: Row): string | null {
  if (grant.status !== 'active') return 'Grant is not active.'
  if (grant.expiresAt <= c.now) return 'Grant expired.'
  if (grant.protectionVersion !== protectionVersion(c)) return 'Protection version changed.'
  if (!c.people?.some(p => p.id === grant.approvedBy && ['owner', 'manager', 'planner'].includes(p.role))) return 'Grant approver lost active membership or authority.'
  if (c.actor.role === 'agent' || plan.kind !== 'reflow') return 'Only recorded human events qualify.'
  if (!grant.eventTypes.includes(recoveryEvent(plan.event.type))) return 'Event type is outside the grant.'
  if (plan.after.protectionConflicts?.length || plan.protectionConflicts.length) return 'Protected intervals conflict.'
  if (plan.after.jobs.some((j: any) => (j.late && !plan.before.jobs.find((b: any) => b.workOrderId === j.workOrderId)?.late) || (j.unscheduled && !plan.before.jobs.find((b: any) => b.workOrderId === j.workOrderId)?.unscheduled))) return 'A job became newly late or unscheduled.'
  if (plan.after.unscheduled.some((u: any) => !plan.before.unscheduled.some((b: any) => b.workOrderId === u.workOrderId && b.sequence === u.sequence && b.reason === u.reason))) return 'A new unscheduled operation or conflict needs review.'
  const pins = c.s.schedulePolicies[0]?.protectedOperations ?? []
  for (const op of plan.after.operations) {
    const old = plan.before.operations.find((o: any) => o.key === op.key)
    if (!old) return 'An operation has no prior interval to rebook.'
    // No routing, machine choice, assignment or tool change is delegated.
    if (['machineId', 'machineSlot', 'operatorId', 'laborId'].some(k => old[k] !== op[k])) return 'Resource choice or assignment changed.'
    const displaced = JSON.stringify(old.intervals) !== JSON.stringify(op.intervals)
    if (!displaced) continue
    if (pins.some((p: any) => p.key === op.key)) return 'Frozen or manually locked work cannot move.'
    if (!grant.machineIds.includes(op.machineId) && !grant.workOrderIds.includes(op.workOrderId)) return 'Displaced work is outside the grant scope.'
    const displacement = Math.max(Math.abs(Date.parse(op.startsAt) - Date.parse(old.startsAt)), Math.abs(Date.parse(op.endsAt) - Date.parse(old.endsAt))) / 60000
    if (displacement > grant.maxDisplacementMinutes) return 'Per-job displacement limit exceeded.'
  }
  for (const job of plan.after.jobs) {
    const old = plan.before.jobs.find((j: any) => j.workOrderId === job.workOrderId)
    if (old?.endsAt && job.endsAt && (Date.parse(job.endsAt) - Date.parse(old.endsAt)) / 60000 > grant.maxDelayMinutes) return 'Per-job delay limit exceeded.'
  }
  return null
}
