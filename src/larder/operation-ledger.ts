// FLOOR-003: the per-operation quantity and cost ledger, derived only from
// recorded facts (reports, holds, backorders, CAP-003 handoffs). Client-safe.
// Quantities are finished-item base units at six decimals; an operation's units
// are exactly one of: upstream (not yet received), waiting, running,
// backordered, completed (available), moved on, held or scrapped.
import { decimal, format, max, sum } from './decimal'
import { predecessors, receivedQuantity, transferredTo } from './operation-dependencies'
import type { Row } from './model'

const open = (rows: any[] | undefined) => (rows ?? []).filter(r => r.status === 'open')

export function ledgerFacts(w: Row, step: any) {
  const task = w.operationStates?.find((t: any) => t.sequence === step.sequence)
  const received = receivedQuantity(w, step)
  const reports: any[] = task?.reports ?? [], holds: any[] = task?.holds ?? []
  const reportScrap = sum(reports.map(r => decimal(r.scrap))), reportedGood = sum(reports.map(r => decimal(r.good)))
  const holdScrap = sum(holds.filter(h => h.disposition === 'scrap').map(h => decimal(h.quantity)))
  const held = sum(open(holds).map(h => decimal(h.quantity))), backordered = sum(open(task?.backorders).map(b => decimal(b.quantity)))
  const movedOn = w.routing.filter((r: any) => predecessors(r).includes(step.sequence)).reduce((n: bigint, r: any) => max(n, transferredTo(w, step.sequence, r.sequence)), 0n)
  const done = task?.status === 'done'
  // Completed units are the furthest of reported good units and handed-off
  // units; completing the operation completes every unit still in process.
  const completed = done ? max(0n, received - reportScrap) : max(reportedGood, movedOn)
  const inProcess = done ? 0n : max(0n, received - completed - reportScrap - backordered)
  const transferable = max(0n, completed - holdScrap - held)
  return { task, received, completed, inProcess, held, backordered, movedOn, scrapped: reportScrap + holdScrap, transferable, available: max(0n, transferable - movedOn), status: task?.status ?? 'pending', ledgerManaged: reports.length > 0 || holds.length > 0 }
}

export const downstream = (w: Row, sequence: number): number[] => {
  const seen = new Set<number>([sequence])
  for (let grew = true; grew;) { grew = false; for (const r of w.routing) if (!seen.has(r.sequence) && predecessors(r).some(p => seen.has(p))) { seen.add(r.sequence); grew = true } }
  return [...seen].sort((a, b) => a - b)
}

// reservedFor(lineId) is the live reservation, so the view shows commitments kept.
export function operationLedger(w: Row, materials: bigint, reservedFor: (lineId: string) => bigint) {
  const quantity = decimal(w.quantity), share = (n: bigint) => quantity > 0n ? n * materials / quantity : 0n
  const steps = w.routing.map((step: any) => {
    const f = ledgerFacts(w, step), upstream = max(0n, quantity - f.received)
    const waiting = f.status === 'pending' ? f.inProcess : 0n, running = f.status === 'pending' ? 0n : f.inProcess
    const buckets = { upstream, waiting, running, backordered: f.backordered, completed: f.available, movedOn: f.movedOn, held: f.held, scrapped: f.scrapped }
    return {
      sequence: step.sequence, name: step.name, workCentre: step.workCentre, status: f.status, received: format(f.received),
      quantities: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, format(v)])),
      costs: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, format(share(v))])),
      transferable: format(f.transferable), holds: (f.task?.holds ?? []), reports: f.task?.reports ?? [],
    }
  })
  const backorders = w.routing.flatMap((step: any) => (w.operationStates?.find((t: any) => t.sequence === step.sequence)?.backorders ?? []).map((b: any) => {
    const q = decimal(b.quantity)
    return {
      ...b, sequence: step.sequence, workOrderId: w.id, reference: w.reference, requiredBy: w.requiredBy, late: b.dueOn > w.requiredBy,
      cost: format(share(q)),
      materials: w.components.map((l: any) => ({ itemId: l.itemId, needed: format(quantity > 0n ? decimal(l.required) * q / quantity : 0n), reserved: format(reservedFor(l.id)), issued: l.issued })),
      capacity: downstream(w, step.sequence).map(n => w.routing.find((r: any) => r.sequence === n)).map((r: any) => ({ sequence: r.sequence, workCentre: r.workCentre, minutes: Math.round(((r.setupMinutes ?? 0) + (r.runMinutes ?? r.minutes ?? 0) * Number(format(q)) + (r.queueMinutes ?? 0)) * 1e6) / 1e6 })),
    }
  }))
  return { workOrderId: w.id, reference: w.reference, quantity: w.quantity, materialsCost: format(materials), costBasis: 'Actual issued material cost spread evenly over the job quantity (rounded down to six places); labor and overhead are not recorded.', steps, backorders }
}
