// Keep customer/location pegs partitioned with the physical work quantity.
import { decimal, format, min } from './decimal'
import type { Row } from './model'
function take(input: any[], quantity: bigint): [any[], any[]] {
  const moved: any[] = [], left: any[] = []
  for (const p of input) {
    const q = decimal(p.quantity), part = min(q, quantity)
    if (part) moved.push({ ...p, quantity: format(part) })
    if (q > part) left.push({ ...p, quantity: format(q - part) })
    quantity -= part
  }
  return [moved, left]
}
export function transferDemand(source: Row, dest: Row, quantity: bigint) {
  if (!source.inventoryPolicy) return
  const tag = source.inventoryPolicy, pegs = structuredClone(tag.pegs ?? [])
  const total = pegs.reduce((n: bigint, p: any) => n + decimal(p.quantity), 0n), jobQuantity = decimal(source.quantity)
  if (total < jobQuantity) pegs.push({ orderId: null, lineId: null, quantity: format(jobQuantity - total) })
  const [done, open] = take(pegs, decimal(source.output) + decimal(source.scrap)), [moved, left] = take(open, quantity)
  source.inventoryPolicy = { ...tag, transferredPegs: true, quantity: format(jobQuantity - quantity), pegs: [...done, ...left] }
  if (!dest.inventoryPolicy) dest.inventoryPolicy = { ...structuredClone(tag), transferredPegs: true, orderId: null, lineId: null, quantity: '0', pegs: [] }
  dest.inventoryPolicy.pegs.push(...moved)
  dest.inventoryPolicy.quantity = format(decimal(dest.inventoryPolicy.quantity) + quantity)
}
export function remainingPegs(tag: any, completed: bigint) { return take(tag.pegs, completed)[1] }
