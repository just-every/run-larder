// Weekly commercial demand and MPS quantities; this is not a capacity promise.
import { decimal, format, max, min, times } from './decimal'
import { deliveries, deliveryDate } from './sales-schedules'
import { reservedQuantity, usableOnHand } from './stock'
import { type Row, type State } from './model'

export const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
export function weekOf(value: unknown) {
  const day = deliveryDate(value), dow = new Date(day + 'T00:00:00Z').getUTCDay()
  return addDays(day, -((dow + 6) % 7))
}
export const adjustedForecast = (f: Row) => f.overrideQuantity !== null ? decimal(f.overrideQuantity) : times(decimal(f.quantity), decimal(f.seasonality))

type Orders = { actual: bigint; outstanding: bigint; reserved: bigint; sources: any[] }
// Consume forecast with both outstanding schedules and already fulfilled dated
// deliveries. A shipment cannot cause its demand to reappear as forecast.
export function weeklyOrders(s: State) {
  const buckets = new Map<string, Orders>()
  function add(itemId: string, date: string, quantity: bigint, outstanding: bigint, reserved: bigint, source: any) {
    const key = `${itemId}|${weekOf(date)}`, b = buckets.get(key) ?? { actual: 0n, outstanding: 0n, reserved: 0n, sources: [] }
    b.actual += quantity; b.outstanding += outstanding; b.reserved += reserved
    b.sources.push({ ...source, date, quantity: format(quantity), outstanding: format(outstanding), reserved: format(reserved) }); buckets.set(key, b)
  }
  for (const o of s.salesOrders.filter(o => ['confirmed', 'part shipped', 'shipped'].includes(o.status))) for (const line of o.lines) {
    let reserved = reservedQuantity(s, o.id, line.id)
    for (const d of deliveries(o, line)) {
      const q = decimal(d.quantity), take = min(reserved, q); reserved -= take
      add(line.itemId, d.date, q, q, take, { orderId: o.id, lineId: line.id, reference: o.reference })
    }
    for (const sh of s.shipments.filter(sh => sh.orderId === o.id && sh.status === 'shipped')) for (const l of sh.lines.filter((l: any) => l.lineId === line.id)) {
      const dated = l.deliveries?.length ? l.deliveries : sh.commercialTerms?.promiseDate ? [{ date: sh.commercialTerms.promiseDate, quantity: l.quantity }] : []
      if (!dated.length) {
        const key = `${line.itemId}|undated`, unknown = buckets.get(key) ?? { actual: 0n, outstanding: 0n, reserved: 0n, sources: [] }
        unknown.actual += decimal(l.quantity); unknown.sources.push({ orderId: o.id, reference: o.reference, shipmentId: sh.id, shipmentReference: sh.reference, quantity: l.quantity }); buckets.set(key, unknown)
      }
      for (const d of dated) add(line.itemId, d.date, decimal(d.quantity), 0n, 0n, { orderId: o.id, lineId: line.id, reference: o.reference, shipmentId: sh.id, shipmentReference: sh.reference })
    }
  }
  return buckets
}

export function forecastDemand(s: State) {
  const orders = weeklyOrders(s)
  return s.forecasts.map(f => ({ forecastId: f.id, itemId: f.itemId, week: f.week,
    quantity: format(max(0n, adjustedForecast(f) - (orders.get(`${f.itemId}|${f.week}`)?.actual ?? 0n))) }))
}

export function masterSchedule(s: State) {
  const orders = weeklyOrders(s), residual = forecastDemand(s), keys = new Set(s.forecasts.map(f => `${f.itemId}|${f.week}`))
  const horizonEnd = s.forecasts.map(f => f.week).sort().at(-1)
  const itemIds = new Set(s.forecasts.map(f => f.itemId))
  for (const key of orders.keys()) { const [itemId, week] = key.split('|'); if (itemIds.has(itemId) && horizonEnd && week <= horizonEnd) keys.add(key) }
  const balances = new Map<string, bigint>(), used = new Set<string>()
  return [...keys].sort((a, b) => a.split('|')[1].localeCompare(b.split('|')[1]) || a.localeCompare(b)).map(key => {
    const [itemId, week] = key.split('|'), f = s.forecasts.find(f => f.itemId === itemId && f.week === week), o = orders.get(key)
    let balance = balances.get(itemId) ?? max(0n, usableOnHand(s, itemId) - s.reservations.filter(r => r.itemId === itemId).reduce((n, r) => n + r.quantity, 0n))
    const supply: any[] = []
    for (const w of s.workOrders.filter(w => w.itemId === itemId && ['draft', 'released'].includes(w.status) && (w.expectedOn ?? w.requiredBy) <= addDays(week, 6))) {
      const id = 'wo:' + w.id
      if (used.has(id)) continue
      const quantity = max(0n, decimal(w.quantity) - decimal(w.output) - decimal(w.scrap)); balance += quantity; used.add(id)
      supply.push({ documentId: w.id, reference: w.reference, quantity: format(quantity), date: w.expectedOn ?? w.requiredBy })
    }
    for (const po of s.purchaseOrders.filter(po => ['draft', 'approved', 'confirmed', 'part received'].includes(po.status) && po.expectedDate <= addDays(week, 6))) for (const l of po.lines.filter((l: any) => l.itemId === itemId)) {
      const id = 'po:' + po.id + ':' + l.id
      if (used.has(id)) continue
      const quantity = max(0n, decimal(l.quantity) - decimal(l.received)); balance += quantity; used.add(id)
      supply.push({ documentId: po.id, reference: po.reference, quantity: format(quantity), date: po.expectedDate })
    }
    const forecast = f ? adjustedForecast(f) : 0n, actual = o?.actual ?? 0n, extra = decimal(residual.find(r => r.forecastId === f?.id)?.quantity ?? '0')
    const demand = (o?.outstanding ?? 0n) - (o?.reserved ?? 0n) + extra, proposed = max(0n, demand - balance)
    const closing = max(0n, balance - demand); balances.set(itemId, closing)
    return { forecastId: f?.id ?? null, itemId, week, baseline: f?.quantity ?? '0', seasonality: f?.seasonality ?? '1', overrideQuantity: f?.overrideQuantity ?? null,
      forecast: format(forecast), actual: format(actual), outstanding: format(o?.outstanding ?? 0n), reserved: format(o?.reserved ?? 0n), consumedForecast: format(min(forecast, actual)),
      residualForecast: format(extra), netDemand: format(demand), error: format(actual - forecast), available: format(balance), proposed: format(proposed), closing: format(closing),
      sources: o?.sources ?? [], supply, undatedShipped: format(orders.get(`${itemId}|undated`)?.actual ?? 0n), undatedSources: orders.get(`${itemId}|undated`)?.sources ?? [] }
  })
}
