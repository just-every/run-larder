// A comparison only. Imported setup observations never authorize live bookings.
import { canonicalJson, sha256 } from '../../modules/import-kit/src/d1/index'
import { decimal } from '../decimal'
import { get, type Context, type Row } from '../model'
import { fail, forbidden } from '../problem'
import { scopeOf } from '../scope'
import { instant, integer } from './calendars'
import { finitePlan } from './finite'

export function nestingCapacity(c: Context, group: Row, members: any[], sharedSetup: string, input: any) {
  if (input === undefined) return undefined
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INPUT', 'Supply a nesting comparison object with a start and horizon.')
  // This comparison includes displaced work and resource identities. A scoped
  // member cannot use it to learn work outside their current location scope.
  if (scopeOf(c.actor).locations !== null) forbidden('A whole-shop nesting comparison needs unrestricted location scope.')
  const asOf = instant(input.asOf, 'nesting comparison start'), days = integer(input.days, 'nesting comparison days', 1, 60)
  if (Date.parse(asOf) < Date.parse(c.now)) fail('INPUT', 'Choose a future comparison window.')
  const ids = new Set(members.map(m => m.workOrderId)), keys = new Set(members.map(m => `${m.workOrderId}:${m.sequence}`))
  const jobs = members.map(m => get(c.s, 'workOrders', m.workOrderId))
  if (jobs.some(w => w.routing.length !== 1)) fail('STATE', 'Combined setup comparison currently requires single-operation jobs; downstream batch stages need a separate review.')
  const protectedOperations = c.s.schedulePolicies[0]?.protectedOperations ?? []
  if ([...protectedOperations, ...c.s.scheduleBookings.filter(b => b.status === 'active').flatMap(b => b.operations)].some((o: any) => keys.has(o.key))) fail('PROTECTED', 'Grouped work has an existing booking or protection; this comparison cannot release it.')
  if (jobs.some(w => w.planningMaterialBlock)) fail('CAPACITY', 'Resolve every grouped job material blocker before comparing combined setup.')
  const setup = Number(decimal(sharedSetup)) / 1e6
  if (!Number.isSafeInteger(setup)) fail('INPUT', 'Combined setup comparison requires whole setup minutes.')
  const before = finitePlan(c.s, c.people ?? [], asOf, days), clone = structuredClone(c.s)
  const first = jobs[0]!, operation = members[0]!.operation
  // One virtual operation owns the shared setup exactly once, plus every
  // original job's pinned run effort. It exists only in this isolated clone.
  const virtualId = `nest-comparison-${group.id}`
  const runMinutes = members.reduce((n, m) => n + Number(get(c.s, 'workOrders', m.workOrderId).quantity) * Number(m.operation.runMinutes ?? m.operation.minutes), 0)
  if (!Number.isFinite(runMinutes) || runMinutes < 0) fail('CAPACITY', 'Every grouped job needs a finite pinned run estimate.')
  const latest = (values: string[]) => values.filter(Boolean).sort().at(-1)
  const combined = { ...structuredClone(first), id: virtualId, reference: group.reference, quantity: '1', output: '0', scrap: '0',
    rank: Math.max(...jobs.map(w => w.rank ?? 1000001)), priority: Math.min(...jobs.map(w => w.priority ?? 0)),
    plannedStart: latest(jobs.map(w => w.plannedStart)), planningMaterialReadyAt: latest(jobs.map(w => w.planningMaterialReadyAt)),
    requiredBy: jobs.map(w => w.requiredBy).sort()[0], demandSources: [],
    routing: [{ ...operation, sequence: 1, dependsOn: [], setupMinutes: setup, runMinutes, minutes: runMinutes, queueMinutes: Math.max(...members.map(m => m.operation.queueMinutes ?? 0)) }],
    operationStates: [{ sequence: 1, status: 'pending' }], scheduleChoices: { 1: first.scheduleChoices?.[members[0].sequence] } }
  clone.workOrders = [...clone.workOrders.filter(w => !ids.has(w.id)), combined]
  const after = finitePlan(clone, c.people ?? [], asOf, days)
  const occupied = after.operations.find(o => o.workOrderId === virtualId)
  const comparisonJobs = after.jobs.find(j => j.workOrderId === virtualId)
  const conflicts = after.unscheduled.filter(u => u.workOrderId === virtualId || !before.unscheduled.some(b => b.workOrderId === u.workOrderId && b.sequence === u.sequence && b.reason === u.reason))
  const allocations = members.map(m => ({ workOrderId: m.workOrderId, sequence: m.sequence, reference: m.reference, requiredBy: m.requiredBy,
    bomId: m.bomId, bomRevision: m.bomRevision, demandSources: m.demandSources,
    before: before.jobs.find(j => j.workOrderId === m.workOrderId)?.endsAt ?? null,
    after: comparisonJobs?.endsAt ?? null, late: !comparisonJobs?.endsAt ? null : comparisonJobs.endsAt > m.requiredBy + 'T23:59:59.999Z' }))
  const displacement = after.jobs.filter(j => j.workOrderId !== virtualId).flatMap(j => {
    const old = before.jobs.find(b => b.workOrderId === j.workOrderId)
    return old?.endsAt === j.endsAt && old?.unscheduled === j.unscheduled ? [] : [{ workOrderId: j.workOrderId, reference: j.reference, before: old?.endsAt ?? null, after: j.endsAt, late: j.late, unscheduled: j.unscheduled }]
  })
  return { asOf, days, inputDigest: sha256(canonicalJson({ version: c.s.version, people: c.people, members, sharedSetup, asOf, days })),
    semantics: 'Comparison only: one shared setup and all pinned run effort on one named machine slot and qualified person. No booking, assignment, stock or customer promise changes.',
    changedPromiseCount: 0, bookingEnabled: false, before, after, combinedOperation: occupied ?? null, allocations, displacement,
    conflicts, protectionConflicts: after.protectionConflicts, feasible: Boolean(occupied) && conflicts.length === 0 && after.protectionConflicts.length === 0 }
}
