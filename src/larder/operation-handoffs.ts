// Keep actual operation handoffs with fungible WIP during FLOOR-005 splits/merges.
// Original operator evidence stays in the source's history; allocations are explicit.
import { decimal, format, max } from './decimal'
import { transferredTo } from './operation-dependencies'
import type { Row } from './model'

export function allocateHandoffs(source: Row, destination: Row, quantity: bigint, open: bigint, record: Row) {
  for (const step of source.routing) for (const next of source.routing) {
    const held = max(0n, transferredTo(source, step.sequence, next.sequence) - decimal(source.output) - decimal(source.scrap))
    if (held === 0n) continue
    const take = quantity === open ? held : held * quantity / open
    if (take === 0n) continue
    const allocation = { sourceId: source.id, destinationId: destination.id, fromSequence: step.sequence, toSequence: next.sequence, quantity: format(take), transferId: record.id }
    source.handoffAllocations ??= []
    source.handoffAllocations.push({ ...allocation, direction: 'out' })
    destination.handoffAllocations ??= []
    destination.handoffAllocations.push({ ...allocation, direction: 'in' })
    record.handoffs ??= []; record.handoffs.push(allocation)
  }
}
