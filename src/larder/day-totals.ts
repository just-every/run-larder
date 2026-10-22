// MOVE-007: the totals a parallel run compares each day, computed from Larder's
// own records. Stock is dated (movements up to and including the day); the rest
// are Larder's totals as they stand when the comparison is made.
import { decimal, format, times } from './decimal'
import { materialCost } from './production-cost'
import type { State } from './model'

export const stockMetrics = ['stockUnits', 'stockValueUsd'] as const
export const currentMetrics = ['reservedUnits', 'activeBoms', 'openWorkOrders', 'wipValueUsd', 'capacityMinutes', 'openSalesOrders', 'openSalesValueUsd', 'openPurchaseOrders', 'openPurchaseValueUsd'] as const
export const metrics = [...stockMetrics, ...currentMetrics] as const
export type Metric = (typeof metrics)[number]

const sum = (values: bigint[]) => values.reduce((n, v) => n + v, 0n)
const remaining = (l: any, taken: string[]) => sum(taken.map(k => decimal(l[k] ?? '0'))) > decimal(l.quantity) ? 0n : decimal(l.quantity) - sum(taken.map(k => decimal(l[k] ?? '0')))

export function dayTotals(s: State, day: string): Record<Metric, string> {
  const dated = s.movements.filter(m => m.createdAt.slice(0, 10) <= day)
  const openWork = s.workOrders.filter(w => ['draft', 'released'].includes(w.status))
  const openSales = s.salesOrders.filter(o => !['quote', 'shipped', 'cancelled', 'closed'].includes(o.status) && o.lines.some((l: any) => remaining(l, ['shipped', 'cancelled']) > 0n))
  const openPurchases = s.purchaseOrders.filter(o => ['approved', 'confirmed', 'part received'].includes(o.status) && o.lines.some((l: any) => remaining(l, ['received', 'rejected']) > 0n))
  const value = (orders: any[], taken: string[]) => sum(orders.flatMap(o => o.lines.map((l: any) => times(remaining(l, taken), decimal(l.unitPrice)))))
  return {
    stockUnits: format(sum(dated.map(m => m.quantity))),
    stockValueUsd: format(sum(dated.map(m => times(m.quantity, m.unitCost)))),
    reservedUnits: format(sum(s.reservations.map(r => r.quantity))),
    activeBoms: String(s.boms.filter(b => b.status === 'active').length),
    openWorkOrders: String(openWork.length),
    wipValueUsd: format(sum(s.workOrders.filter(w => w.status === 'released').map(w => materialCost(s, w)))),
    capacityMinutes: String(openWork.reduce((n, w) => n + (w.routing ?? []).reduce((m: number, r: any) => m + (Number(r.setupMinutes) || 0) + (Number(r.minutes) || 0) * Number(w.quantity), 0), 0)),
    openSalesOrders: String(openSales.length), openSalesValueUsd: format(value(openSales, ['shipped', 'cancelled'])),
    openPurchaseOrders: String(openPurchases.length), openPurchaseValueUsd: format(value(openPurchases, ['received', 'rejected'])),
  }
}
