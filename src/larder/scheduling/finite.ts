// Read-only finite projection. Every occupied minute belongs to one named
// machine slot and one named live person; unconfigured work is never fabricated.
import { type Row, type State } from '../model'
import { activeBom } from '../bom'
import { deliveries } from '../sales-schedules'
import { operationEffort, operationReady } from '../operation-effort'
import { predecessors } from '../operation-dependencies'
import { calendarMask, instant, integer, localGrid } from './calendars'

type Person = { id: string; name: string; role: string }
type Resource = { id: string; name: string; calendar: Row; available: Uint8Array; used: Uint8Array; capacity: number }
type Segment = { startsAt: string; endsAt: string }
export type ScheduledOperation = { key: string; workOrderId: string; reference: string; sequence: number; name: string; machineId: string; machine: string; machineSlot: number; operatorId: string; person: string; laborId: string; setupMinutes: number; runMinutes: number; queueMinutes: number; occupiedMinutes: number; startsAt: string; endsAt: string; intervals: Segment[]; predecessors: number[]; slackMinutes: number; critical: boolean; maintenanceIds: string[]; provisional: boolean }
const iso = (n: number) => new Date(n).toISOString()
const activeRoles = ['owner', 'manager', 'production', 'operator']
export function finitePlan(s: State, people: Person[], at = new Date().toISOString(), days = 14) {
  const asOf = instant(at, 'plan start'), horizonDays = integer(days, 'plan horizon days', 1, 60)
  const from = Math.ceil(Date.parse(asOf) / 60000) * 60000, length = horizonDays * 1440, until = from + length * 60000
  const grids = new Map<string, ReturnType<typeof localGrid>>()
  const mask = (r: Row) => { if (!grids.has(r.timeZone)) grids.set(r.timeZone, localGrid(r.timeZone, from, length)); return calendarMask(r, grids.get(r.timeZone)!, from) }
  const machines: Resource[] = s.machineCalendars.flatMap(r => {
    const available = mask(r)
    // Open equipment holds remain a release gate after ETA. Any recovery beyond
    // that ETA is explicitly provisional, matching CAP-009's existing contract.
    for (const m of s.maintenance.filter(m => m.workCentre === r.name)) {
      const end = Date.parse(m.status === 'released' ? m.releasedAt : iso(until))
      for (let i = Math.max(0, Math.floor((Date.parse(m.startsAt) - from) / 60000)); i < length && from + i * 60000 < end; i++) available[i] = 0
    }
    return Array.from({ length: r.capacity }, (_, slot) => ({ id: `${r.id}:${slot + 1}`, name: r.name, calendar: r, available, used: new Uint8Array(length), capacity: 1 }))
  })
  const labor: Resource[] = s.laborCalendars.flatMap(r => {
    const available = mask(r)
    return r.operatorIds.flatMap((id: string) => {
      const person = people.find(p => p.id === id && activeRoles.includes(p.role))
      return person ? [{ id, name: person.name, calendar: r, available, used: new Uint8Array(length), capacity: r.capacity }] : []
    })
  })
  const operations: ScheduledOperation[] = [], unscheduled: any[] = [], jobs: any[] = []
  const work = s.workOrders.filter(w => ['draft', 'released'].includes(w.status)).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.requiredBy.localeCompare(b.requiredBy) || a.reference.localeCompare(b.reference))
  for (const w of work) {
    const routing: any[] = w.status === 'released' ? w.routing ?? [] : (w.engineeringBomId ? s.boms.find(b => b.id === w.engineeringBomId) : activeBom(s, w.itemId))?.routing ?? []
    const placed = new Map<number, ScheduledOperation>(), blocked = new Set<number>(), complete = new Set<number>((w.operationStates ?? []).filter((t: any) => t.status === 'done').map((t: any) => t.sequence))
    const readyDate = Math.max(from, Date.parse((w.plannedStart || asOf.slice(0, 10)) + 'T00:00Z'), ...s.boms.filter(b => Object.values(w.engineeringBomIds ?? {}).includes(b.id)).map(b => Date.parse((b.effectiveOn ?? asOf.slice(0, 10)) + 'T00:00Z')))
    if (!routing.length) unscheduled.push({ workOrderId: w.id, reference: w.reference, sequence: null, reason: 'No routing on this job.' })
    for (const step of [...routing].sort((a, b) => a.sequence - b.sequence)) {
      if (complete.has(step.sequence)) continue
      const key = `${w.id}:${step.sequence}`, previous = predecessors(step), task = w.operationStates?.find((t: any) => t.sequence === step.sequence)
      const eligible = step.eligibleCentres?.length ? step.eligibleCentres : [step.workCentre]
      const centers = machines.filter(m => eligible.includes(m.name) && (!task?.workCentre || task.workCentre === m.name))
      const peopleFor = labor.filter(l => (step.requiredSkills ?? []).every((skill: string) => l.calendar.skills.includes(skill)) && (!task?.assignment || task.assignment.operatorId === l.id))
      let reason = previous.some(n => blocked.has(n)) ? 'Predecessor is unscheduled.' : !centers.length ? 'No configured eligible machine.' : !peopleFor.length ? 'No live qualified person with a calendar.' : ''
      const ready = Math.max(readyDate, operationReady(w, step, new Date(asOf))?.getTime() ?? from, ...previous.map(n => Date.parse(placed.get(n)?.endsAt ?? asOf))) + (step.queueMinutes ?? 0) * 60000
      let best: { m: Resource; l: Resource; slots: number[]; duration: number } | undefined
      if (!reason) for (const m of centers) for (const l of peopleFor) {
        // Queue time is elapsed waiting before resource occupation; efficiency
        // scales remaining setup/run effort, conservatively rounded to minutes.
        const effort = Math.max(0, operationEffort(w, step) - (task?.progress ? 0 : (step.queueMinutes ?? 0)))
        const duration = Math.max(1, Math.ceil(effort * 100 / m.calendar.efficiency)), slots: number[] = []
        for (let i = Math.max(0, Math.ceil((ready - from) / 60000)); i < length; i++) {
          if (best && i > best.slots[best.slots.length - 1]!) break
          if (m.available[i] && !m.used[i] && l.available[i] && l.used[i]! < l.capacity) slots.push(i)
          if (slots.length === duration) break
        }
        if (slots.length === duration && (!best || slots[slots.length - 1]! < best.slots[best.slots.length - 1]!)) best = { m, l, slots, duration }
      }
      if (!best) { reason ||= 'No joint machine/person capacity within the planning horizon.'; blocked.add(step.sequence); unscheduled.push({ key, workOrderId: w.id, reference: w.reference, sequence: step.sequence, name: step.name, reason }); continue }
      const { m, l, slots, duration } = best, intervals: Segment[] = []
      for (const i of slots) {
        m.used[i] = 1; l.used[i] = l.used[i]! + 1
        const startsAt = iso(from + i * 60000), endsAt = iso(from + (i + 1) * 60000), last = intervals[intervals.length - 1]
        if (last?.endsAt === startsAt) last.endsAt = endsAt; else intervals.push({ startsAt, endsAt })
      }
      const startsAt = intervals[0]!.startsAt, endsAt = intervals[intervals.length - 1]!.endsAt
      const maintenanceIds = [...new Set([...previous.flatMap(n => placed.get(n)?.maintenanceIds ?? []), ...s.maintenance.filter(x => x.status === 'unreleased' && x.workCentre === m.name && x.startsAt < endsAt).map(x => x.id)])]
      const op: ScheduledOperation = { key, workOrderId: w.id, reference: w.reference, sequence: step.sequence, name: step.name, machineId: m.calendar.id, machine: m.name, machineSlot: Number(m.id.split(':').at(-1)), operatorId: l.id, person: l.name, laborId: l.calendar.id, setupMinutes: step.setupMinutes ?? 0, runMinutes: step.runMinutes ?? step.minutes ?? 0, queueMinutes: step.queueMinutes ?? 0, occupiedMinutes: duration, startsAt, endsAt, intervals, predecessors: previous, slackMinutes: 0, critical: false, maintenanceIds, provisional: maintenanceIds.length > 0 }
      placed.set(step.sequence, op); operations.push(op)
    }
    const jobOps = [...placed.values()], incomplete = unscheduled.some(u => u.workOrderId === w.id)
    const endsAt = jobOps.length ? jobOps.map(o => o.endsAt).sort().at(-1)! : null
    // CPM over this job's dependency graph uses occupied effort. Contention,
    // calendars and waiting are shown separately by the actual projected dates.
    const earliest = new Map<number, number>(), latest = new Map<number, number>()
    for (const o of jobOps) earliest.set(o.sequence, Math.max(0, ...o.predecessors.map(n => earliest.get(n) ?? 0)) + o.queueMinutes + o.occupiedMinutes)
    const pathMinutes = Math.max(0, ...earliest.values())
    for (const o of [...jobOps].reverse()) {
      const next = jobOps.filter(n => n.predecessors.includes(o.sequence))
      const end = Math.min(pathMinutes, ...next.map(n => latest.get(n.sequence)! - n.occupiedMinutes - n.queueMinutes))
      latest.set(o.sequence, end); o.slackMinutes = Math.max(0, end - earliest.get(o.sequence)!); o.critical = o.slackMinutes === 0
    }
    const dueAt = w.requiredBy + 'T23:59:59.999Z'
    jobs.push({ workOrderId: w.id, reference: w.reference, dueAt, endsAt: incomplete ? null : endsAt, projectedLastAt: endsAt, late: !incomplete && endsAt !== null && endsAt > dueAt, unscheduled: incomplete, provisional: jobOps.some(o => o.provisional), criticalPath: jobOps.filter(o => o.critical).map(o => o.key), pathMinutes, dueSlackMinutes: !incomplete && endsAt ? Math.floor((Date.parse(dueAt) - Date.parse(endsAt)) / 60000) : null })
  }
  const promises = s.salesOrders.filter(o => ['confirmed', 'part shipped'].includes(o.status)).flatMap(order => order.lines.flatMap((line: any) => deliveries(order, line).map(delivery => {
    const linked = work.filter(w => (w.datedPlan?.requirement.documentId === order.id && w.datedPlan?.requirement.lineId === line.id) || (w.itemId === line.itemId && (w.demandSources ?? []).some((source: any) => source.documentId === order.id)))
    return { orderId: order.id, reference: order.reference, lineId: line.id, itemId: line.itemId, promiseDate: delivery.date, quantity: delivery.quantity, workOrderIds: linked.map(w => w.id), operationKeys: operations.filter(o => linked.some(w => w.id === o.workOrderId)).map(o => o.key), basis: linked.length ? 'Recorded MRP demand links; inspect every linked operation and blockers. Capacity projection alone does not prove material, shipping or quantity coverage.' : 'No recorded open work link; this promise has no finite production proof.' }
  })))
  const loads = [...machines, ...labor].map(r => ({ kind: machines.includes(r) ? 'machine' : 'labor', id: r.id, calendarId: r.calendar.id, name: r.name, capacityMinutes: r.available.reduce((n, v) => n + v * r.capacity, 0), bookedMinutes: r.used.reduce((n, v) => n + v, 0) })).map(r => ({ ...r, percent: r.capacityMinutes ? Math.round(r.bookedMinutes / r.capacityMinutes * 1000) / 10 : 0 }))
  const bottleneck = loads.filter(l => l.bookedMinutes > 0).sort((a, b) => b.percent - a.percent || b.bookedMinutes - a.bookedMinutes || a.id.localeCompare(b.id))[0] ?? null
  return { version: s.version, asOf, startsAt: iso(from), endsAt: iso(until), horizonDays, today: asOf.slice(0, 10), promises, operations, jobs, unscheduled, lateJobs: jobs.filter(j => j.late).map(j => j.workOrderId), unscheduledJobs: jobs.filter(j => j.unscheduled).map(j => j.workOrderId), loads, bottleneck, counts: { late: jobs.filter(j => j.late).length, unscheduled: jobs.filter(j => j.unscheduled).length }, semantics: 'Read-only finite projection; intervals are occupied minutes, queue is elapsed before occupation; CPM slack uses dependency effort and due slack uses projected finish. Drafts do not book or approve execution. Unreleased maintenance recovery is provisional.' }
}
