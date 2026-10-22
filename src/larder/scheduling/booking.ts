import { bump, row, type Context, type Row } from '../model'
import { planningDigest } from './fingerprint'

export function adoptionProblem(c: Context, plan: Row): { code: string; message: string } | null {
  if (plan.inputDigest !== planningDigest(c.s, c.people) || plan.day !== c.now.slice(0, 10) || Date.parse(plan.after.startsAt) < Date.parse(c.now)) return { code: 'STALE', message: 'Planning inputs, live people or planning window changed. Prepare a fresh scenario.' }
  if (plan.after.unscheduled.some((u: any) => !plan.before.unscheduled.some((b: any) => b.workOrderId === u.workOrderId && b.sequence === u.sequence && b.reason === u.reason) || plan.changes.some((ch: any) => ch.workOrderId === u.workOrderId)) || plan.after.protectionConflicts?.length || plan.protectionConflicts.length) return { code: 'CAPACITY', message: 'An infeasible or protected operation prevents adoption; nothing was booked.' }
  if (plan.inventoryUnavailable?.length || plan.alternateSuppliers?.length) return { code: 'POLICY', message: 'Speculative inventory and supplier assumptions cannot authorize stock or spending. Realize them through their existing approved doors, then compare again.' }
  return null
}

// Shared by manual and delegated adoption; grant paths never apply scenario
// changes, overtime, work drafts, stock or any other business mutation.
export function bookIntervals(c: Context, plan: Row, reason: string, approvedBy: string, automatic?: { grantId: string; grantVersion: number }) {
  for (const old of c.s.scheduleBookings.filter(b => b.status === 'active')) bump(old, { status: 'superseded', supersededBy: plan.id })
  const booking = row(c, 'scheduleBookings', { status: 'active', planId: plan.id, asOf: plan.asOf, days: plan.days, operations: plan.after.operations, approvedBy, approvedAt: c.now, reason, ...(automatic ? { automatic: true, ...automatic, commandId: c.commandId } : {}) })
  return bump(plan, { status: 'adopted', bookingId: booking.id, decidedBy: approvedBy, decidedAt: c.now, note: reason,
    ...(automatic ? { autoApplication: { ...automatic, approverId: approvedBy, commandId: c.commandId, at: c.now, before: plan.before.operations, after: plan.after.operations, displacement: plan.effects } } : {}) })
}
