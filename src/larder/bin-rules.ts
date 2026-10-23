// Physical bin rules apply at the shared movement door, including putaway and replenishment.
import { decimal, format } from './decimal'
import { bump, fresh, get, text, type Context, type Row, type State } from './model'
import { fail } from './problem'
import { allow } from './roles'

export function checkBin(s: State, location: Row, itemId: string, lotId: string, incoming: bigint) {
  const rule = location.binRule
  if (!rule) return
  if (rule.itemId !== itemId) fail('BIN_ITEM', 'This bin is assigned to a different item.')
  const positions = new Map<string, bigint>()
  for (const m of s.movements) if (m.locationId === location.id && m.status !== 'transit') {
    const key = `${m.itemId}:${m.lotId}`
    positions.set(key, (positions.get(key) ?? 0n) + m.quantity)
  }
  if ([...positions].some(([key, n]) => n > 0n && !key.startsWith(itemId + ':'))) fail('BIN_ITEM', 'Remove the other item before applying this bin rule.')
  if (rule.singleLot && [...positions].some(([key, n]) => n > 0n && key !== `${itemId}:${lotId}`)) fail('BIN_LOT', 'This bin permits one lot at a time.')
  const present = [...positions.values()].reduce((a, b) => a + b, 0n)
  if (present + incoming > decimal(rule.capacity)) fail('BIN_CAPACITY', `The bin capacity is ${rule.capacity} in the assigned item's base unit.`)
}

export function binRules(c: Context, type: string, p: any): Row | undefined {
  if (type !== 'bin.rule') return
  allow(c, [])
  const location = get(c.s, 'locations', p.locationId, 'bin'); fresh(location, p.version)
  const reason = text(p.reason, 'rule reason', 400)
  if (p.clear === true) return bump(location, { binRule: null, binRuleHistory: [...(location.binRuleHistory ?? []), { rule: location.binRule ?? null, reason, by: c.actor.id, at: c.now }] })
  const item = get(c.s, 'items', p.itemId, 'item')
  const capacity = format(decimal(p.capacity, 'bin capacity', { positive: true }))
  if (typeof p.singleLot !== 'boolean') fail('INPUT', 'Choose whether this bin permits only one lot.')
  const binRule = { itemId: item.id, capacity, singleLot: p.singleLot, reason, by: c.actor.id, at: c.now }
  const lots = [...new Set(c.s.movements.filter(m => m.locationId === location.id && m.status !== 'transit').map(m => m.lotId))]
  if (!lots.length) checkBin(c.s, { ...location, binRule }, item.id, '', 0n)
  for (const lotId of lots) {
    if (c.s.movements.filter(m => m.locationId === location.id && m.lotId === lotId && m.status !== 'transit').reduce((n, m) => n + m.quantity, 0n) > 0n) checkBin(c.s, { ...location, binRule }, item.id, lotId, 0n)
  }
  return bump(location, { binRule, binRuleHistory: [...(location.binRuleHistory ?? []), { rule: location.binRule ?? null, reason, by: c.actor.id, at: c.now }] })
}
