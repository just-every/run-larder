// Durable purchase shares belong to released quote work, never to a prediction.
import { decimal, max } from './decimal'
import type { State } from './model'

export function quotePurchaseShares(s: State) {
  return s.workOrders.filter(w => w.status === 'released').flatMap(work => (work.quoteSupply ?? []).map((supply: any) => ({
    ...supply, workOrderId: work.id, left: max(0n, decimal(supply.quantity) - decimal(supply.received)),
  }))).filter((supply: any) => supply.left > 0n)
}
