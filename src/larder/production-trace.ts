import { decimal, format } from './decimal'
import { fail } from './problem'
import { list, type Row, type State } from './model'

// Split/merge transfers item-level WIP. Lot identity remains in one shared
// issue pool until the operator records exact consumption by output batch.
export function workMaterialPool(s: State, w: Row) {
  const group = new Set([w.id])
  let changed = true
  while (changed) { changed = false; for (const t of s.workTransfers) for (const a of t.transfers) if (group.has(a.sourceId) || group.has(a.destinationId)) for (const id of [a.sourceId, a.destinationId]) if (!group.has(id)) { group.add(id); changed = true } }
  const used = new Map<string, bigint>()
  for (const job of s.workOrders.filter(j => group.has(j.id))) for (const b of job.outputs ?? []) for (const a of b.allocations ?? []) used.set(a.movementId, (used.get(a.movementId) ?? 0n) + decimal(a.quantity))
  const own = new Map<string, bigint>(w.components.map((l: any) => [l.itemId, decimal(l.issued)]))
  for (const b of w.outputs ?? []) for (const a of b.allocations ?? []) own.set(a.itemId, (own.get(a.itemId) ?? 0n) - decimal(a.quantity))
  const sources = s.movements.filter(m => m.kind === 'issue' && m.documentKind === 'workOrders' && group.has(m.documentId)).map(m => {
    const reversed = s.movements.filter(r => r.reversesId === m.id).reduce((n, r) => n + r.quantity, 0n)
    return { movementId: m.id, lotId: m.lotId, itemId: m.itemId, workOrderId: m.documentId, quantity: -m.quantity - reversed - (used.get(m.id) ?? 0n) }
  }).filter(a => a.quantity > 0n && (own.get(a.itemId) ?? 0n) > 0n)
  return { sources, remaining: own, unrecorded: s.workOrders.filter(j => group.has(j.id)).flatMap(j => (j.outputs ?? []).filter((b: any) => !b.allocations).map((b: any) => ({ workOrderId: j.id, reference: j.reference, at: b.at }))) }
}
export function batchAllocation(s: State, w: Row, p: any, completed: boolean) {
  const pool = workMaterialPool(s, w)
  for (const [itemId, q] of pool.remaining) if (q > pool.sources.filter(a => a.itemId === itemId).reduce((n, a) => n + a.quantity, 0n)) fail('TRACE_ALLOCATION', 'Original issue movements do not cover the remaining WIP; reconcile its missing source history first.')
  let inputs: any[]
  if (p.allocations !== undefined) inputs = Array.isArray(p.allocations) && !p.allocations.length ? [] : list(p.allocations, 'component-lot allocation')
  else {
    // No choice only when this is the sole completed batch and all remaining
    // issued material for every relevant item belongs to this job.
    const unambiguous = completed && !w.outputs?.length && [...pool.remaining].every(([itemId, q]) => q === pool.sources.filter(a => a.itemId === itemId).reduce((n, a) => n + a.quantity, 0n))
    if (!unambiguous && pool.sources.length) fail('TRACE_ALLOCATION', 'Record actual component-lot quantities for this output batch. Final allocations must reconcile to all issued material.')
    inputs = pool.sources.map(a => ({ movementId: a.movementId, quantity: format(a.quantity) }))
  }
  const allocated = new Map<string, bigint>(), seen = new Set<string>()
  const result = inputs.map(a => {
    if (seen.has(a.movementId)) fail('TRACE_ALLOCATION', 'List each source issue once.')
    seen.add(a.movementId)
    const source = pool.sources.find(m => m.movementId === a.movementId) ?? fail('TRACE_ALLOCATION', 'Choose an unallocated issued material source for this job or its split/merge lineage.')
    const quantity = decimal(a.quantity, 'allocated quantity', { positive: true })
    if (quantity > source.quantity) fail('TRACE_ALLOCATION', 'That source quantity is already allocated or reversed.')
    allocated.set(source.itemId, (allocated.get(source.itemId) ?? 0n) + quantity)
    return { movementId: source.movementId, lotId: source.lotId, itemId: source.itemId, quantity: format(quantity) }
  })
  for (const [itemId, remaining] of pool.remaining) {
    const q = allocated.get(itemId) ?? 0n
    if (q > remaining || (completed && q !== remaining)) fail('TRACE_ALLOCATION', 'Batch allocations must stay within this job’s issued WIP and the final batch must reconcile it exactly.')
  }
  if (pool.sources.length && !result.length) fail('TRACE_ALLOCATION', 'Record the component lots actually used for this output batch.')
  return result
}
export function materialPoolView(s: State, w: Row) {
  const pool = workMaterialPool(s, w)
  return pool.sources.map(a => ({ ...a, quantity: format(a.quantity), jobRemaining: format(pool.remaining.get(a.itemId) ?? 0n) }))
}
