import { sha256, canonicalJson } from '../../modules/import-kit/src/d1/index'
import { date, get, list, text, type Context } from '../model'
import { fail } from '../problem'
import { finitePlan } from './finite'
import { instant, integer } from './calendars'

const fingerprint = (plan: ReturnType<typeof finitePlan>) => sha256(canonicalJson({ ...plan, version: 0 }))
export function capacityPreview(c: Context, plan: any) {
  const changes = list<any>(plan.changes, 'reschedule changes', 100).map(ch => {
    const w = get(c.s, 'workOrders', ch.workOrderId)
    if (!['draft', 'released'].includes(w.status)) fail('STATE', 'Move only open work.')
    if (w.operationStates?.some((t: any) => ['running', 'paused'].includes(t.status))) fail('STATE', 'A running or paused job keeps its active work; choose a pending job.')
    const plannedStart = date(ch.plannedStart, 'planned start')
    if (new Date(plannedStart + 'T00:00Z').toISOString().slice(0, 10) !== plannedStart) fail('INPUT', 'Use a real planned-start date.')
    const scheduleChoices = ch.scheduleChoices === undefined ? undefined : structuredClone(w.scheduleChoices ?? {})
    if (scheduleChoices) for (const [seq, center] of Object.entries(ch.scheduleChoices)) {
      const routing = w.status === 'released' ? w.routing : c.s.boms.filter(b => b.itemId === w.itemId && b.status === 'active').sort((a,b) => b.revision-a.revision)[0]?.routing
      const step = routing?.find((r: any) => String(r.sequence) === seq)
      if (!step || !(step.eligibleCentres?.length ? step.eligibleCentres : [step.workCentre]).includes(center)) fail('WORK_CENTER', 'Choose an alternate qualified by the pinned routing.')
      scheduleChoices[seq] = center
    }
    return { workOrderId: w.id, ...(scheduleChoices ? { scheduleChoices } : {}), plannedStart, priority: integer(ch.priority ?? w.priority ?? 0, 'priority', -1000000, 1000000) }
  })
  if (new Set(changes.map(ch => ch.workOrderId)).size !== changes.length) fail('INPUT', 'Move each job only once.')
  const asOf = instant(plan.capacity?.asOf ?? c.now, 'preview start'), days = integer(plan.capacity?.days ?? 14, 'preview horizon', 1, 60)
  if (Date.parse(asOf) < Math.floor(Date.parse(c.now) / 60000) * 60000) fail('INPUT', 'Preview a current or future planning window.')
  const people = c.people ?? []
  const before = finitePlan(c.s, people, asOf, days), clone = structuredClone(c.s)
  for (const ch of changes) Object.assign(get(clone, 'workOrders', ch.workOrderId), ch)
  const after = finitePlan(clone, people, asOf, days)
  const effects = after.jobs.map(j => {
    const old = before.jobs.find(b => b.workOrderId === j.workOrderId)
    return { workOrderId: j.workOrderId, reference: j.reference, before: old?.endsAt ?? null, after: j.endsAt, dueAt: j.dueAt, lateBefore: old?.late ?? false, lateAfter: j.late, unscheduledBefore: old?.unscheduled ?? false, unscheduledAfter: j.unscheduled }
  }).filter(j => changes.some(ch => ch.workOrderId === j.workOrderId) || j.before !== j.after || j.unscheduledBefore !== j.unscheduledAfter)
  const newUnscheduled = after.unscheduledJobs.filter(id => !before.unscheduledJobs.includes(id))
  const conflicts = after.unscheduled.filter(u => changes.some(ch => ch.workOrderId === u.workOrderId) || newUnscheduled.includes(u.workOrderId))
  return { changes, asOf, days, before, after, effects, conflicts, newUnscheduled, changedPromiseCount: 0, promiseEffects: after.promises.map(p => ({ ...p, before: before.jobs.filter(j => p.workOrderIds.includes(j.workOrderId)).map(j => ({ reference: j.reference, endsAt: j.endsAt, late: j.late })), after: after.jobs.filter(j => p.workOrderIds.includes(j.workOrderId)).map(j => ({ reference: j.reference, endsAt: j.endsAt, late: j.late })) })), fingerprint: fingerprint(after), reason: text(plan.capacity?.reason ?? 'Reviewed finite reschedule', 'schedule reason') }
}

export function approveCapacity(c: Context, proposal: any) {
  const preview = proposal.context.capacity
  if (c.s.version !== proposal.snapshotVersion + 1) fail('STALE', 'Shop-floor, calendars or other records changed after preview. Prepare a new finite schedule.')
  if (preview.conflicts.length || preview.newUnscheduled.length) fail('CAPACITY', 'The reviewed move leaves work without finite capacity. Resolve its explicit conflicts before approval.', preview.conflicts)
  if (Date.parse(preview.after.startsAt) < Date.parse(c.now)) fail('STALE', 'This planning window has already started. Preview again with a current or future window.')
  const clone = structuredClone(c.s)
  for (const change of preview.changes) Object.assign(get(clone, 'workOrders', change.workOrderId), change)
  const live = finitePlan(clone, c.people ?? [], preview.asOf, preview.days)
  if (fingerprint(live) !== preview.fingerprint) fail('STALE', 'Live people or finite capacity changed after preview. Review again.')
  // Existing reschedule approval applies the exact changes, in the same atomic
  // write as its decision. The reviewed intervals stay in the proposal audit.
}
