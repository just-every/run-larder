// Available-to-promise: physical, reserved and expected stock kept apart.
import { decimal, format, max } from './decimal'
import { onHand, reservedQuantity } from './stock'
import { blockedQuantity, utcToday } from './lot-dates'
import type { State } from './model'

export const open = (line: any) => decimal(line.quantity) - decimal(line.shipped ?? '0') - decimal(line.cancelled ?? '0')

export function expectedPurchase(s: State, itemId: string) {
  let n = 0n
  for (const po of s.purchaseOrders) if (['approved', 'confirmed', 'part received'].includes(po.status))
    for (const l of po.lines) if (l.itemId === itemId) n += max(0n, decimal(l.quantity) - decimal(l.received))
  return n
}

export function expectedProduction(s: State, itemId: string) {
  let n = 0n
  for (const w of s.workOrders) if (w.status === 'released' && w.itemId === itemId) n += max(0n, decimal(w.quantity) - decimal(w.output) - decimal(w.scrap))
  return n
}

// Demand not yet covered by a reservation: confirmed order lines and released
// work-order components.
export function unreservedDemand(s: State, itemId: string) {
  let n = 0n
  for (const o of s.salesOrders) if (['confirmed', 'part shipped'].includes(o.status))
    for (const l of o.lines) if (l.itemId === itemId) n += max(0n, open(l) - reservedQuantity(s, o.id, l.id))
  for (const w of s.workOrders) if (w.status === 'released')
    for (const l of w.components) if (l.itemId === itemId) n += max(0n, decimal(l.required) - decimal(l.issued) - reservedQuantity(s, w.id, l.id))
  return n
}

export function availability(s: State, itemId: string, today = utcToday()) {
  const physical = onHand(s, itemId), quarantine = onHand(s, itemId, 'quarantine'), expired = blockedQuantity(s, itemId, today)
  const reserved = s.reservations.filter(r => r.itemId === itemId).reduce((n, r) => n + r.quantity, 0n)
  const purchase = expectedPurchase(s, itemId), production = expectedProduction(s, itemId), demand = unreservedDemand(s, itemId)
  return {
    itemId, onHand: format(physical), quarantine: format(quarantine), reserved: format(reserved), expired: format(expired), available: format(physical - expired - reserved),
    expectedPurchase: format(purchase), expectedProduction: format(production), unreservedDemand: format(demand),
    availableToPromise: format(physical - expired - reserved + purchase + production - demand),
  }
}
