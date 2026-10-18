// The production schedule, computed from the records: each open work order's routing steps laid end to end
// on their work centers in priority order, one job at a time per center (finite capacity). Larder's work-center
// calendar is one weekday shift (SHIFT) for every center; nothing here is saved.
import { byId, itemName, rows, type LarderState, type Rec } from '../api'

export const SHIFT = { start: 7, end: 15 }
const shiftMinutes = (SHIFT.end - SHIFT.start) * 60
const DAY = 86400000

export type Op = {
  key: string; workOrder: Rec; reference: string; item: string; sku: string; quantity: number; step: string; sequence: number; workCenter: string
  minutes: number; start: Date; end: Date; late: boolean; short: boolean
}
export type Plan = { ops: Op[]; centers: string[]; finish: Map<string, Date> }

export const weekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes())
const at = (d: Date, hour: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour)
export const fromDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d) }
const quantityOf = (v: unknown) => Number(String(v ?? '0')) || 0

// The first working minute at or after t.
function working(t: Date) {
  let d = t
  for (;;) {
    if (weekend(d)) { d = at(addDays(d, 1), SHIFT.start); continue }
    if (d < at(d, SHIFT.start)) return at(d, SHIFT.start)
    if (d >= at(d, SHIFT.end)) { d = at(addDays(d, 1), SHIFT.start); continue }
    return d
  }
}
function addWorking(t: Date, minutes: number) {
  let d = working(t), left = minutes
  for (;;) {
    const room = (at(d, SHIFT.end).getTime() - d.getTime()) / 60000
    if (left <= room) return new Date(d.getTime() + left * 60000)
    left -= room; d = working(at(addDays(d, 1), SHIFT.start))
  }
}

// The earliest gap on a center, at or after ready, that holds the step whole.
type Span = { begin: Date; end: Date }
function slot(spans: Span[], ready: Date, minutes: number): Span {
  let begin = working(ready)
  for (const b of spans) {
    if (b.end <= begin) continue
    if (addWorking(begin, minutes) <= b.begin) break
    begin = working(b.end)
  }
  return { begin, end: addWorking(begin, minutes) }
}

// Released work keeps the routing it was released with; a draft follows its item's active BOM.
const routingOf = (s: LarderState, w: Rec): any[] => w.status === 'released' ? w.routing ?? [] : rows(s, 'boms').find(b => b.itemId === w.itemId && b.status === 'active')?.routing ?? []
const remaining = (w: Rec) => Math.max(0, quantityOf(w.quantity) - quantityOf(w.output) - quantityOf(w.scrap))
export const openWork = (s: LarderState) => rows(s, 'workOrders').filter(w => ['draft', 'released'].includes(w.status))
// Every routing step the shop can run: open work's routings and each item's active BOM.
const routed = (s: LarderState) => [...openWork(s).flatMap(w => routingOf(s, w)), ...rows(s, 'boms').filter(b => b.status === 'active').flatMap(b => b.routing ?? [])].filter(r => r.minutes > 0)

// changes: the planner's proposed start and priority per work order, applied before laying out.
export function schedule(s: LarderState, now: Date, changes: Record<string, { plannedStart?: string; priority?: number }> = {}): Plan {
  const work: Rec[] = openWork(s).map(w => ({ ...w, ...changes[w.id] }))
  work.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.plannedStart || '').localeCompare(b.plannedStart || '') || a.requiredBy.localeCompare(b.requiredBy) || a.reference.localeCompare(b.reference))
  const booked = new Map<string, Span[]>(), ops: Op[] = [], finish = new Map<string, Date>(), today = at(now, SHIFT.start)
  for (const w of work) {
    const planned = w.plannedStart ? at(fromDate(w.plannedStart), SHIFT.start) : today
    let ready = planned > today ? planned : today
    const steps = routingOf(s, w).filter(r => r.minutes > 0)
    const placed: Op[] = []
    for (const r of steps) {
      const center = r.workCentre || 'Unassigned', minutes = r.minutes * remaining(w)
      if (!minutes) continue
      const { begin, end } = slot(booked.get(center) ?? [], ready, minutes)
      booked.set(center, [...(booked.get(center) ?? []), { begin, end }].sort((a, b) => a.begin.getTime() - b.begin.getTime())); ready = end
      placed.push({ key: `${w.id}:${r.sequence}`, workOrder: w, reference: w.reference, item: itemName(s, w.itemId), sku: byId(s, 'items', w.itemId)?.sku ?? '', quantity: remaining(w), step: r.name, sequence: r.sequence, workCenter: center, minutes, start: begin, end, late: false, short: (w.shortages ?? []).length > 0 })
    }
    if (!placed.length) continue
    const due = at(fromDate(w.requiredBy), SHIFT.end), late = ready > due
    for (const op of placed) op.late = late
    finish.set(w.id, ready); ops.push(...placed)
  }
  // Every center a routing uses gets a row, idle ones at 0%, in routing order: the earliest step that uses each comes
  // first, and centers with nothing booked follow by their routing step.
  const steps = routed(s), centers = [...new Set(steps.map(r => r.workCentre || 'Unassigned'))]
  const order = (c: string) => Math.min(...ops.filter(o => o.workCenter === c).map(o => o.sequence * 1e13 + o.start.getTime()), ...steps.filter(r => (r.workCentre || 'Unassigned') === c).map(r => r.sequence * 1e13 + 9e12))
  centers.sort((a, b) => order(a) - order(b))
  return { ops, centers, finish }
}

// Booked shift hours on a center inside [from, to), against one shift per weekday.
export function load(plan: Plan, center: string, from: Date, to: Date) {
  let booked = 0, capacity = 0
  for (let d = startOfDay(from); d < to; d = addDays(d, 1)) if (!weekend(d)) capacity += shiftMinutes
  for (const o of plan.ops.filter(o => o.workCenter === center)) {
    for (let d = startOfDay(o.start); d <= o.end; d = addDays(d, 1)) {
      if (d < startOfDay(from) || d >= to || weekend(d)) continue
      const a = Math.max(o.start.getTime(), at(d, SHIFT.start).getTime()), b = Math.min(o.end.getTime(), at(d, SHIFT.end).getTime())
      if (b > a) booked += (b - a) / 60000
    }
  }
  // Hours read whole from ten up (one decimal below), and the per cent follows the hours shown.
  const hours = booked >= 600 ? Math.round(booked / 60) : Math.round(booked / 6) / 10, hoursCapacity = capacity / 60
  return { hours, capacity: hoursCapacity, percent: hoursCapacity ? Math.round((hours / hoursCapacity) * 100) : 0 }
}

export const daysBetween = (a: Date, b: Date) => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY)
