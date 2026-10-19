// What a released job's missing materials wait on: each item's open supply (purchase orders not yet received, and
// released work making it), earliest first, as far as it covers what the job is short; and, against the schedule,
// whether it arrives before or after the job's first step starts. The Shortages page, Today, the Schedule and the
// work order all tell this one story from the same records.
import { itemName, rows, type LarderState, type Rec } from './api'
import { dayName, qty } from './format'
import { fromDate, startOfDay, type Plan } from './schedule/plan'

export type Supply = { id: string; reference: string; kind: 'po' | 'wo'; date: Date; quantity: number }
export type Cover = { itemId: string; short: string; by: Supply[]; uncovered: number; arrives?: Date }

const num = (v: unknown) => Number(String(v ?? '0')) || 0

function supplyOf(s: LarderState, itemId: string, plan?: Plan): Supply[] {
  const bought = rows(s, 'purchaseOrders').filter(p => ['approved', 'confirmed', 'part received'].includes(p.status)).flatMap(p => p.lines
    .filter((l: any) => l.itemId === itemId).map((l: any) => ({ id: p.id, reference: p.reference, kind: 'po' as const, date: fromDate(p.expectedDate), quantity: num(l.quantity) - num(l.received) })))
  const made = rows(s, 'workOrders').filter(w => w.status === 'released' && w.itemId === itemId && !plan?.ops.some(o => o.workOrder.id === w.id && o.provisional))
    .map(w => ({ id: w.id, reference: w.reference, kind: 'wo' as const, date: plan?.finish.get(w.id) ?? fromDate(w.requiredBy), quantity: num(w.quantity) - num(w.output) - num(w.scrap) }))
  return [...bought, ...made].filter(x => x.quantity > 0).sort((a, b) => a.date.getTime() - b.date.getTime())
}

// Each material the job is short of, and the supply that covers it.
export function covers(s: LarderState, w: Rec, plan?: Plan): Cover[] {
  return (w.shortages ?? []).map((x: any) => {
    const by: Supply[] = []
    let left = num(x.short)
    for (const supply of supplyOf(s, x.itemId, plan)) { if (left <= 0) break; by.push(supply); left -= supply.quantity }
    return { itemId: x.itemId, short: x.short, by, uncovered: Math.max(0, left), arrives: left <= 0 ? by[by.length - 1]?.date : undefined }
  })
}

// When all of a job's missing materials are due, if open supply covers them.
export function coveredBy(s: LarderState, w: Rec, plan?: Plan) {
  const list = covers(s, w, plan)
  return list.length && list.every(c => c.arrives) ? new Date(Math.max(...list.map(c => c.arrives!.getTime()))) : undefined
}

export const firstStart = (plan: Plan, id: string) => plan.ops.filter(o => o.workOrder.id === id).map(o => o.start).sort((a, b) => a.getTime() - b.getTime())[0]

// "44 Hard maple 8/4 lumber, covered by PO-0002, arriving Tue Oct 20, after the job starts Mon Oct 19"
export function timing(c: Cover, start?: Date) {
  if (!c.arrives) return c.by.length ? `${qty(String(c.uncovered))} not covered by open supply (${c.by.map(b => b.reference).join(' and ')} covers the rest)` : 'not covered by open supply'
  const when = !start ? '' : startOfDay(c.arrives) > startOfDay(start) ? `, after the job starts ${dayName(start)}` : startOfDay(c.arrives) < startOfDay(start) ? `, before the job starts ${dayName(start)}` : `, the day the job starts`
  return `covered by ${c.by.map(b => b.reference).join(' and ')}, arriving ${dayName(c.arrives)}${when}`
}

export function stories(s: LarderState, w: Rec, plan: Plan) {
  const start = firstStart(plan, w.id)
  return covers(s, w, plan).map(c => `${qty(c.short)} ${itemName(s, c.itemId)}, ${timing(c, start)}`)
}
