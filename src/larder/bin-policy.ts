import { decimal } from './decimal'
import { fail } from './problem'
import { enforcePayload } from './scope'
import type { Context } from './model'

// Capacity is per item in base units, including custody and quarantined stock.
export function binRoom(c: Context, itemId: string, locationId: string, lotId: string, quantity: bigint) {
  const s = c.s
  const rule = s.binRules.find(r => r.itemId === itemId && r.locationId === locationId)
  if (!rule) return
  enforcePayload(c, rule)
  if (rule.lotId && rule.lotId !== lotId) fail('BIN_LOT', 'This bin rule accepts a different lot.')
  const held = s.movements.filter(m => m.itemId === itemId && m.locationId === locationId).reduce((n, m) => n + m.quantity, 0n)
    + s.custodyLedger.filter(m => m.itemId === itemId && m.locationId === locationId).reduce((n, m) => n + decimal(m.quantity, 'custody quantity', { signed: true }), 0n)
  if (held + quantity > decimal(rule.capacity)) fail('BIN_CAPACITY', 'This receipt would exceed the item capacity of the bin.')
}
