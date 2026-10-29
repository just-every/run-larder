import { purchaseDate } from './supplier-terms'
import { decimal, format, max, min } from './decimal'
import { usableOnHand } from './stock'
import type { State } from './model'

export type IngredientStatus = 'In stock' | 'Expected' | 'Not available' | 'No BOM'
export type ProductionStatus = 'not started' | 'blocked' | 'in progress' | 'done' | 'ready to ship'
export type Supply = { kind: 'stock' | 'reservation' | 'purchase' | 'work'; documentId: string; reference: string; date: string; quantity: string }
export type StatusLine = { id: string; itemId: string; ingredientStatus: IngredientStatus; productionStatus: ProductionStatus; required: string; available: string; missing: string; supplies: Supply[]; ingredients?: StatusLine[]; supplyingWork?: { documentId: string; quantity: string; lines: StatusLine[] }[] }
type Pool = Omit<Supply, 'quantity'> & { itemId: string; left: bigint; demandId?: string }

// Local pools exist for this read only. All hard reservations are removed from
// free stock before any ranked demand is considered, including another order's.
export function supplyAllocator(s: State, on = new Date().toISOString().slice(0, 10)) {
  const pools: Pool[] = s.items.map(i => ({ itemId: i.id, kind: 'stock', documentId: '', reference: i.sku, date: '',
    left: max(0n, usableOnHand(s, i.id, on) - s.reservations.filter(r => r.itemId === i.id).reduce((n, r) => n + r.quantity, 0n)) }))
  for (const p of s.purchaseOrders) if (['approved', 'confirmed', 'part received'].includes(p.status))
    for (const l of p.lines) pools.push({ itemId: l.itemId, kind: 'purchase', documentId: p.id, reference: p.reference, date: purchaseDate(p, l),
      left: max(0n, decimal(l.quantity) - decimal(l.received)) })
  for (const w of s.workOrders) if (w.status === 'released') pools.push({ itemId: w.itemId, kind: 'work', documentId: w.id, reference: w.reference,
    demandId: w.quoteOrderId, date: w.expectedOn ?? w.requiredBy, left: max(0n, decimal(w.quantity) - decimal(w.output) - decimal(w.scrap)) })
  // An accepted quote owns its identified future supply once. As receipts
  // replace the purchase balance, reserve its planning share of free physical
  // stock until the existing manual receipt-allocation door is used.
  for (const w of s.workOrders.filter(w => w.status === 'released' && w.quoteSupplies)) {
    for (const part of w.quoteSupplies) {
      const component = w.components.find((l: any) => l.itemId === part.itemId)
      if (!component) continue
      const reserved = s.reservations.filter(r => r.demandId === w.id && r.itemId === part.itemId).reduce((n, r) => n + r.quantity, 0n)
      let outstanding = max(0n, decimal(component.required) - decimal(component.issued) - reserved)
      for (const source of part.supplies.filter((p: Supply) => p.kind === 'purchase')) {
        let claim = min(outstanding, decimal(source.quantity))
        for (const pool of [...pools.filter(p => p.kind === 'purchase' && p.documentId === source.documentId), ...pools.filter(p => p.kind === 'stock')]) {
          if (!claim) break
          if (pool.itemId !== part.itemId || pool.demandId) continue
          const quantity = min(claim, pool.left)
          if (quantity > 0n) { pool.left -= quantity; claim -= quantity; outstanding -= quantity; pools.push({ ...pool, left: quantity, demandId: w.id }) }
        }
      }
    }
  }
  pools.sort((a, b) => Number(a.kind !== 'stock') - Number(b.kind !== 'stock') || a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference) || a.documentId.localeCompare(b.documentId))
  const reservations = s.reservations.map(r => ({ ...r, left: r.quantity }))
  return (itemId: string, required: bigint, demandId: string, lineId: string, reference: string): StatusLine => {
    let left = max(0n, required), physical = 0n
    const supplies: Supply[] = []
    for (const r of reservations) if (r.demandId === demandId && r.lineId === lineId && r.itemId === itemId && left > 0n) {
      const q = min(left, r.left); r.left -= q; left -= q; physical += q
      if (q > 0n) supplies.push({ kind: 'reservation', documentId: demandId, reference, date: '', quantity: format(q) })
    }
    for (const pool of pools) if (pool.itemId === itemId && pool.documentId !== demandId && (!pool.demandId || pool.demandId === demandId) && left > 0n) {
      const q = min(left, pool.left); pool.left -= q; left -= q
      if (pool.kind === 'stock') physical += q
      if (q > 0n) supplies.push({ kind: pool.kind, documentId: pool.documentId, reference: pool.reference, date: pool.date, quantity: format(q) })
    }
    return { id: lineId, itemId, required: format(required), available: format(physical), missing: format(left), supplies,
      ingredientStatus: left > 0n ? 'Not available' : physical < required ? 'Expected' : 'In stock', productionStatus: 'not started' }
  }
}

export function combined(lines: readonly Pick<StatusLine, 'ingredientStatus'>[]): IngredientStatus {
  if (lines.some(l => l.ingredientStatus === 'No BOM')) return 'No BOM'
  if (lines.some(l => l.ingredientStatus === 'Not available')) return 'Not available'
  return lines.some(l => l.ingredientStatus === 'Expected') ? 'Expected' : 'In stock'
}
