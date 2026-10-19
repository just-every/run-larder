// Outstanding delivery quantities. Shipping consumes earliest promises;
// cancellation releases the latest promises first without changing past terms.
import { open } from './availability'
import { decimal, format, min } from './decimal'
import { fail } from './problem'
import { date, type Row, type State } from './model'

export type Delivery = { quantity: string; date: string }
export function deliveryDate(value: unknown): string {
  const day = date(value, 'delivery date')
  if (new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day) fail('INPUT', 'Use a real calendar date.')
  return day
}
export function deliveries(order: Row, line: any): Delivery[] {
  return Array.isArray(line.schedules) ? structuredClone(line.schedules) : open(line) > 0n ? [{ quantity: format(open(line)), date: order.promiseDate }] : []
}
export function removeDeliveries(order: Row, line: any, quantity: bigint, latest = false): Delivery[] {
  const schedules = deliveries(order, line).sort((a, b) => a.date.localeCompare(b.date))
  const taken: Delivery[] = []
  if (latest) schedules.reverse()
  let left = quantity
  for (const schedule of schedules) {
    const q = decimal(schedule.quantity), take = min(left, q)
    if (take > 0n) taken.push({ quantity: format(take), date: schedule.date })
    schedule.quantity = format(q - take); left -= take
  }
  if (left) fail('STATE', 'Delivery quantities do not cover this action. Review the order schedule.')
  line.schedules = schedules.filter(x => decimal(x.quantity) > 0n).sort((a, b) => a.date.localeCompare(b.date))
  return taken
}
export function refreshPromise(order: Row) {
  const dates = order.lines.flatMap((line: any) => deliveries(order, line).map(schedule => schedule.date)).sort()
  if (dates.length) order.promiseDate = dates.at(-1)
}
export function firstPromise(order: Row): string {
  return order.lines?.flatMap((line: any) => deliveries(order, line).map(schedule => schedule.date)).sort()[0] ?? order.promiseDate ?? order.requiredBy ?? ''
}
export function pickedQuantity(s: State, orderId: string, lineId: string, locationId?: string): bigint {
  return s.shipments.filter(sh => sh.orderId === orderId && ['picked', 'packed'].includes(sh.status)).flatMap(sh => sh.lines)
    .filter((line: any) => line.lineId === lineId && (locationId === undefined || line.locationId === locationId))
    .reduce((total: bigint, line: any) => total + decimal(line.quantity), 0n)
}
export function commercialSnapshot(order: Row) {
  return structuredClone({ id: order.id, version: order.version, reference: order.reference, customerId: order.customerId,
    customerReference: order.customerReference, promiseDate: order.promiseDate, billingAddress: order.billingAddress ?? '', shippingAddress: order.shippingAddress ?? '',
    status: order.status, lines: order.lines.map((line: any) => ({ ...line, activeQuantity: format(decimal(line.quantity) - decimal(line.cancelled)), schedules: deliveries(order, line) })) })
}
