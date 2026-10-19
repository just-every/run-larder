// Aggregate every parent before netting a shared component. Physical and open
// supply are pools, while pegging retains the demand that caused each branch.
import { activeBom } from './bom'
import { componentQuantity } from './bom-explosion'
import { expectedProduction, expectedPurchase, open } from './availability'
import { decimal, format, max, min } from './decimal'
import { fail } from './problem'
import { onHand, reservedQuantity } from './stock'
import type { Row, State } from './model'

type Mode = 'make' | 'buy' | 'phantom'
export type Peg = { document: string; documentId: string; reference: string; quantity: string; date: string; path: { itemId: string; bomId: string; revision: number }[]; supply: Mode }
type Demand = Omit<Peg, 'quantity'> & { quantity: bigint }
export type NettedItem = { itemId: string; demand: bigint; available: bigint; expected: bigint; shortage: bigint; pegs: Peg[]; makeShortage: bigint; buyShortage: bigint }
const mode = (s: State, component: any): Mode => component.supply ?? (s.items.find(i => i.id === component.itemId)?.kind === 'make' ? 'make' : 'buy')
const peg = (d: Demand): Peg => ({ ...d, quantity: format(d.quantity) })

export function netRequirements(s: State): NettedItem[] {
  const on = new Date().toISOString().slice(0, 10)
  const demands = new Map<string, Demand[]>(), edges = new Map<string, Set<string>>()
  const contexts = new Set<string>()
  const add = (id: string, d: Demand) => { if (d.quantity > 0n) demands.set(id, [...(demands.get(id) ?? []), d]) }
  // Discover graph edges independently of quantities: a stocked branch still
  // has to precede components demanded through another, uncovered branch.
  function discover(id: string, supply: Mode, date: string) {
    if (!edges.has(id)) edges.set(id, new Set())
    const key = JSON.stringify([id, supply, date])
    if (contexts.has(key)) return
    contexts.add(key)
    if (supply === 'buy') return
    const b = activeBom(s, id, on)
    if (!b) return
    for (const c of b.components) {
      edges.get(id)!.add(c.itemId)
      discover(c.itemId, mode(s, c), date)
    }
  }
  const seed = (id: string, d: Demand) => { add(id, d); discover(id, d.supply, d.date) }
  for (const o of s.salesOrders) if (['confirmed', 'part shipped'].includes(o.status))
    for (const l of o.lines) seed(l.itemId, { document: 'salesOrders', documentId: o.id, reference: o.reference, date: o.promiseDate, path: [], supply: mode(s, l), quantity: max(0n, open(l) - reservedQuantity(s, o.id, l.id)) })
  for (const w of s.workOrders) if (w.status === 'released')
    for (const l of w.components) {
      // Released physical requirements may combine distinct make/buy paths.
      // Existing issue/reservation covers buy first, then make, consistently
      // across every read; the remaining demand retains each original mode.
      let covered = decimal(l.issued) + reservedQuantity(s, w.id, l.id)
      const requirements = Array.isArray(l.supplyRequirements) && l.supplyRequirements.length
        ? [...l.supplyRequirements].sort((a, b) => a.supply.localeCompare(b.supply))
        : [{ supply: l.supply ?? mode(s, l), quantity: l.required }]
      for (const requirement of requirements) {
        const quantity = decimal(requirement.quantity), take = min(covered, quantity)
        covered -= take
        seed(l.itemId, { document: 'workOrders', documentId: w.id, reference: w.reference, date: w.requiredBy,
          path: [{ itemId: w.itemId, bomId: w.bomId, revision: w.bomRevision }], supply: requirement.supply, quantity: quantity - take })
      }
    }
  // Draft output is already supply. Its inputs are separate demand exactly
  // once; consuming that output must never explode the same recipe again.
  for (const w of s.workOrders) if (w.status === 'draft') {
    const b = activeBom(s, w.itemId, on)
    if (!b) continue
    for (const l of b.components) seed(l.itemId, { document: 'workOrders', documentId: w.id, reference: w.reference, date: w.requiredBy, path: [{ itemId: w.itemId, bomId: b.id, revision: b.revision }], supply: mode(s, l), quantity: componentQuantity(l.quantity, decimal(w.quantity), b.yield ?? '1') })
  }
  const indegree = new Map([...edges.keys()].map(id => [id, 0]))
  for (const children of edges.values()) for (const id of children) indegree.set(id, (indegree.get(id) ?? 0) + 1)
  const ready = [...indegree].filter(([, n]) => n === 0).map(([id]) => id).sort(), ordered: string[] = []
  while (ready.length) {
    const id = ready.shift()!; ordered.push(id)
    for (const child of edges.get(id) ?? []) {
      const n = indegree.get(child)! - 1; indegree.set(child, n)
      if (!n) { ready.push(child); ready.sort() }
    }
  }
  if (ordered.length !== indegree.size) fail('BOM_CYCLE', 'The effective manufacturing recipes contain a cycle. Correct the BOM before planning.')
  const result: NettedItem[] = []
  for (const id of ordered) {
    const rows = (demands.get(id) ?? []).sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference) || a.documentId.localeCompare(b.documentId) || JSON.stringify(a.path).localeCompare(JSON.stringify(b.path)) || a.supply.localeCompare(b.supply))
    if (!rows.length) continue
    const available = max(0n, onHand(s, id) - s.reservations.filter(r => r.itemId === id).reduce((n, r) => n + r.quantity, 0n))
    const drafted = s.purchaseOrders.filter(p => p.status === 'draft').flatMap(p => p.lines).filter((l: any) => l.itemId === id).reduce((n: bigint, l: any) => n + decimal(l.quantity), 0n)
      + s.workOrders.filter(w => w.status === 'draft' && w.itemId === id).reduce((n, w) => n + decimal(w.quantity), 0n)
    const expected = expectedPurchase(s, id) + expectedProduction(s, id) + drafted
    let pool = available + expected, shortage = 0n, makeShortage = 0n, buyShortage = 0n
    const real = rows.filter(d => d.supply !== 'phantom')
    const expansions = new Map<string, { bom: Row; demands: Demand[] }>()
    for (const d of rows) {
      let uncovered = d.quantity
      if (d.supply !== 'phantom') {
        const covered = min(pool, uncovered); pool -= covered; uncovered -= covered; shortage += uncovered
        if (d.supply === 'make') makeShortage += uncovered
        else buyShortage += uncovered
      }
      if (!uncovered || d.supply === 'buy') continue
      const b = activeBom(s, id, on)
      if (!b) {
        if (d.supply === 'phantom') fail('NO_BOM', 'A phantom subassembly needs an effective bill of materials.', { itemId: id, date: d.date })
        continue
      }
      const group = expansions.get(b.id) ?? { bom: b, demands: [] }
      group.demands.push({ ...d, quantity: uncovered }); expansions.set(b.id, group)
    }
    // Round once for the complete recipe demand. Cumulative allocation gives
    // each root a peg while their sum stays exactly equal to the exploded total.
    for (const { bom: b, demands: branches } of expansions.values()) for (const l of b.components) {
      let cumulative = 0n, allocated = 0n
      for (const d of branches) {
        cumulative += d.quantity
        const total = componentQuantity(l.quantity, cumulative, b.yield ?? '1')
        add(l.itemId, { ...d, quantity: total - allocated, supply: mode(s, l), path: [...d.path, { itemId: id, bomId: b.id, revision: b.revision }] })
        allocated = total
      }
    }
    if (real.length) result.push({ itemId: id, demand: real.reduce((n, d) => n + d.quantity, 0n), available, expected, shortage, pegs: real.map(peg), makeShortage, buyShortage })
  }
  return result
}
