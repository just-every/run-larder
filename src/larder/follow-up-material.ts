// Actual material requirements and source-aware receipt acceptance.
import { activeBom } from './bom'
import { resolvedComponents } from './bom-explosion'
import { decimal, format, max, min } from './decimal'
import { addDays, forecastDemand } from './forecast-plan'
import { lotBlock } from './lot-dates'
import { fail } from './problem'
import { deliveries } from './sales-schedules'
import { reservedQuantity, usableOnHand } from './stock'
import type { Movement, State } from './model'

type Demand = { itemId: string; quantity: bigint; document: string; documentId: string; reference: string; date: string; supply: string }
export function physicalShortages(s: State, today: string) {
  const demands = new Map<string, Demand[]>(), edges = new Map<string, Set<string>>(), discovered = new Set<string>()
  const pendingWork = new Map<string, bigint>()
  const mode = (l: any) => l.supply ?? s.items.find(i => i.id === l.itemId)?.kind ?? 'buy'
  function discover(itemId: string, supply: string) {
    if (!edges.has(itemId)) edges.set(itemId, new Set())
    if (supply === 'buy' || discovered.has(itemId)) return
    discovered.add(itemId)
    const bom = activeBom(s, itemId, today)
    if (bom) for (const l of resolvedComponents(s, bom, decimal('1'), today).components) {
      edges.get(itemId)!.add(l.itemId); discover(l.itemId, l.supply)
    }
  }
  function add(d: Demand) {
    if (d.quantity <= 0n) return
    demands.set(d.itemId, [...(demands.get(d.itemId) ?? []), d]); discover(d.itemId, d.supply)
  }
  for (const o of s.salesOrders) if (['confirmed', 'part shipped'].includes(o.status)) for (const l of o.lines) {
    let reserved = reservedQuantity(s, o.id, l.id)
    for (const delivery of deliveries(o, l)) {
      const quantity = decimal(delivery.quantity), take = min(reserved, quantity); reserved -= take
      add({ itemId: l.itemId, quantity: quantity - take, document: 'salesOrders', documentId: o.id, reference: o.reference, date: delivery.date, supply: mode(l) })
    }
  }
  for (const f of forecastDemand(s)) add({ itemId: f.itemId, quantity: decimal(f.quantity), document: 'forecasts', documentId: f.forecastId, reference: `Forecast ${f.week}`, date: addDays(f.week, 6), supply: mode(f) })
  for (const w of s.workOrders) if (['draft', 'released'].includes(w.status)) {
    pendingWork.set(w.itemId, (pendingWork.get(w.itemId) ?? 0n) + max(0n, decimal(w.quantity) - decimal(w.output) - decimal(w.scrap)))
    const bom = w.status === 'draft' ? (w.engineeringBomId ? s.boms.find(b => b.id === w.engineeringBomId) : activeBom(s, w.itemId, today)) : undefined
    const inputs = w.status === 'released' ? w.components : bom ? resolvedComponents(s, bom, decimal(w.quantity), today, w.engineeringBomIds).components : []
    for (const l of inputs) {
      let covered = w.status === 'released' ? decimal(l.issued) + reservedQuantity(s, w.id, l.id) : 0n
      const requirements = l.supplyRequirements?.length ? [...l.supplyRequirements].sort((a: any, b: any) => a.supply.localeCompare(b.supply)) : [{ supply: mode(l), quantity: w.status === 'released' ? l.required : l.quantity }]
      for (const r of requirements) {
        const quantity = decimal(r.quantity), take = min(covered, quantity); covered -= take
        add({ itemId: l.itemId, quantity: quantity - take, document: 'workOrders', documentId: w.id, reference: w.reference, date: w.requiredBy, supply: r.supply })
      }
    }
  }
  const indegree = new Map([...edges.keys()].map(id => [id, 0]))
  for (const children of edges.values()) for (const id of children) indegree.set(id, (indegree.get(id) ?? 0) + 1)
  const ready = [...indegree].filter(([, n]) => !n).map(([id]) => id).sort(), ordered: string[] = []
  while (ready.length) {
    const id = ready.shift()!; ordered.push(id)
    for (const child of edges.get(id) ?? []) { const n = indegree.get(child)! - 1; indegree.set(child, n); if (!n) { ready.push(child); ready.sort() } }
  }
  if (ordered.length !== indegree.size) fail('BOM_CYCLE', 'The effective manufacturing recipes contain a cycle. Correct the BOM before following up shortages.')
  const shortages: { itemId: string; missing: bigint; pegs: { document: string; documentId: string; reference: string; quantity: string; date: string }[] }[] = []
  for (const itemId of ordered) {
    const rows = (demands.get(itemId) ?? []).sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference) || a.documentId.localeCompare(b.documentId))
    let physical = max(0n, usableOnHand(s, itemId, today) - s.reservations.filter(r => r.itemId === itemId).reduce((n, r) => n + r.quantity, 0n)), missing = 0n, cumulative = 0n
    const bom = activeBom(s, itemId, today), expanded = new Map<string, bigint>()
    for (const d of rows) {
      const take = min(physical, d.quantity); physical -= take
      let uncovered = d.quantity - take; missing += uncovered
      if (d.supply === 'buy' || !bom) continue
      // Existing work's inputs were seeded above. Its expected output prevents
      // duplicate recipe demand, but never covers the physical shortage itself.
      const pending = pendingWork.get(itemId) ?? 0n, fromWork = min(pending, uncovered)
      pendingWork.set(itemId, pending - fromWork); uncovered -= fromWork
      if (!uncovered) continue
      cumulative += uncovered
      for (const l of resolvedComponents(s, bom, cumulative, today).components) {
        const key = `${l.itemId}:${l.supply}`, total = decimal(l.quantity), previous = expanded.get(key) ?? 0n
        add({ ...d, itemId: l.itemId, supply: l.supply, quantity: total - previous }); expanded.set(key, total)
      }
    }
    if (missing) shortages.push({ itemId, missing, pegs: rows.map(d => ({ ...d, quantity: format(d.quantity) })) })
  }
  return shortages
}

// Receipt lines and their movements are posted together in the same order.
// A held receipt earns acceptance only when its own FIFO chunk is released.
// Other held stock (returns, openings, output, etc.) must occupy that FIFO too.
export function acceptedPurchases(s: State): Map<string, bigint> {
  const ordered = [...s.movements].sort((a, b) => a.sequence - b.sequence)
  const reversed = new Set(ordered.filter(m => m.reversesId).map(m => m.reversesId))
  const sources = new Map<string, string>()
  for (const r of s.receipts) {
    const movements = ordered.filter(m => m.documentKind === 'receipts' && m.documentId === r.id && m.kind === 'receipt' && m.quantity > 0n)
    movements.forEach((m, index) => {
      const line = r.lines[index]
      if (line) sources.set(m.id, `${r.poId}:${line.lineId}`)
    })
  }
  const accepted = new Map<string, bigint>()
  const credit = (m: Movement, quantity: bigint, acceptedAt: string) => {
    const key = sources.get(m.id)
    // Usability belongs to acceptance time; natural expiry after acceptance
    // must not reopen a supplier obligation already fulfilled with usable stock.
    const blocked = lotBlock(s.lots.find(l => l.id === m.lotId), acceptedAt.slice(0, 10))
    if (key && !reversed.has(m.id) && !blocked) accepted.set(key, (accepted.get(key) ?? 0n) + quantity)
  }
  type Chunk = { movement: Movement; left: bigint }
  const pools = new Map<string, Chunk[]>()
  for (const m of ordered) {
    if (m.status === 'available') {
      if (m.kind === 'receipt' && m.quantity > 0n) credit(m, m.quantity, m.createdAt)
      continue
    }
    const key = JSON.stringify([m.itemId, m.locationId, m.lotId])
    const chunks = pools.get(key) ?? []
    pools.set(key, chunks)
    if (m.quantity > 0n) { chunks.push({ movement: m, left: m.quantity }); continue }
    let left = -m.quantity
    // Compensation removes the reversed inbound's remaining chunk first;
    // any excess still consumes the real pool rather than inventing stock.
    const consume = m.reversesId ? [...chunks.filter(c => c.movement.id === m.reversesId), ...chunks.filter(c => c.movement.id !== m.reversesId)] : chunks
    for (const chunk of consume) {
      const take = min(left, chunk.left)
      chunk.left -= take; left -= take
      if (m.kind === 'release' && m.documentKind === 'approvals' && s.approvals.some(a => a.id === m.documentId && a.decision === 'released')) credit(chunk.movement, take, m.createdAt)
      if (!left) break
    }
  }
  return accepted
}

