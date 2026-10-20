// Quantity lineage is independent of stock: ranges of original job quantities
// partition work without copying original movements or execution clocks.
import { decimal, format, min } from './decimal'
import { fail } from './problem'
import type { Row } from './model'
export type Allocation = { originId: string; start: string; quantity: string }
export const allocations = (w: Row): Allocation[] => w.quantityAllocations ?? [{ originId: w.id, start: '0', quantity: w.quantity }]
export function partition(input: Allocation[], quantity: bigint): [Allocation[], Allocation[]] {
  const taken: Allocation[] = [], left: Allocation[] = []
  for (const a of input) {
    const q = decimal(a.quantity), take = min(quantity, q)
    if (take > 0n) taken.push({ ...a, quantity: format(take) })
    if (q > take) left.push({ ...a, start: format(decimal(a.start) + take), quantity: format(q - take) })
    quantity -= take
  }
  if (quantity !== 0n) fail('QUANTITY', 'Origin quantities do not cover this transfer.')
  return [taken, left]
}
export function uniqueOrigins(input: Allocation[]) {
  const byOrigin = new Map<string, Allocation[]>()
  for (const a of input) byOrigin.set(a.originId, [...(byOrigin.get(a.originId) ?? []), a])
  for (const entries of byOrigin.values()) {
    entries.sort((a, b) => decimal(a.start) < decimal(b.start) ? -1 : 1)
    for (let i = 1; i < entries.length; i++) if (decimal(entries[i - 1].start) + decimal(entries[i - 1].quantity) > decimal(entries[i].start)) fail('DUPLICATE_WORK', 'These jobs include overlapping original quantities.')
  }
}
export const lineageIds = (w: Row): string[] => [w.id, ...(w.lineageSourceIds ?? [])]
