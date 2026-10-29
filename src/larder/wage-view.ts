// GOV-015 wage default: a rework hourly rate is read by the owner, managers and accounts, and by the production
// person who entered it on their own order. Anyone else reads no figure the rate follows from: once an order records
// labor, its labor cost, total and output values, the unit costs of the stock it produced wherever that stock moves,
// the handoffs that carry those movements and the jobs that issue that stock (and what they make) read restricted.
import { rateReaders } from './scheduling/calendars'
import { restricted } from './scope-cost'
import type { Actor, Row, State } from './model'

export const readsWages = (actor: Actor, order: Row) => rateReaders.includes(actor.role) || (actor.role === 'production' && order.preparedBy === actor.id)

// A rework order as someone without wage authority reads it.
export function withoutWages(order: Row): Row {
  const out: Row = { ...order, labor: (order.labor ?? []).map(({ rate, ...line }: any) => line) }
  if (!out.labor.length) return out
  if (order.outputs) out.outputs = order.outputs.map((x: any) => ({ ...x, value: restricted }))
  if (order.outputLots) out.outputLots = order.outputLots.map((x: any) => ({ ...x, value: restricted }))
  if (order.cost) out.cost = { ...order.cost, labor: restricted, total: restricted, outputs: restricted }
  return out
}

// The lots, jobs and movements whose values carry labor this actor may not read.
export function wageCarriers(s: State, actor: Actor) {
  const lots = new Set<string>(s.reworkOrders.filter(w => w.labor?.length && !readsWages(actor, w)).flatMap(w => (w.outputLots ?? []).map((x: any) => x.lotId))), jobs = new Set<string>()
  for (let grew = lots.size > 0; grew;) {
    grew = false
    for (const m of s.movements) if (lots.has(m.lotId) && m.documentKind === 'workOrders' && !jobs.has(m.documentId)) { jobs.add(m.documentId); grew = true }
    for (const l of s.lots) if (l.source === 'production' && jobs.has(l.documentId) && !lots.has(l.id)) { lots.add(l.id); grew = true }
  }
  return { lots, jobs, movements: new Set(s.movements.filter(m => lots.has(m.lotId)).map(m => m.id)) }
}
