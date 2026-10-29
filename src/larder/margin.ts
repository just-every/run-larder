// GOV-002 margin: (revenue − standard cost) ÷ revenue over an order's non-cancelled
// lines, in percent at six places. Null when a line's item has no standard cost or
// the order has no revenue, so an unknown margin never passes a margin floor.
import { saleExtension } from './sales-money'
import { decimal, divide, times } from './decimal'
import type { State } from './model'

export function orderMargin(s: State, lines: any[], usdRate = '1'): bigint | null {
  let revenue = 0n, cost = 0n
  for (const l of lines) {
    const quantity = decimal(l.quantity) - decimal(l.cancelled ?? '0')
    if (quantity <= 0n) continue
    const standard = decimal(s.items.find(i => i.id === l.itemId)?.standardCost ?? '0')
    if (standard <= 0n) return null
    revenue += saleExtension(quantity, l.unitPrice, usdRate); cost += times(quantity, standard)
  }
  return revenue > 0n ? divide(times(revenue - cost, decimal('100')), revenue) : null
}
