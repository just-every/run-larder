// DEMAND-004 policies use base quantities; ENG-007 location settings stay authoritative.
import { activeBom } from './bom'
import { decimal, format } from './decimal'
import { fail } from './problem'
import { date, get, oneOf, text, type State } from './model'

export function inventoryPolicyFields(s: State, p: any) {
  const item = get(s, 'items', p.itemId, 'item'), location = get(s, 'locations', p.locationId, 'location')
  if (item.archived || location.archived) fail('ARCHIVED', 'Choose an active item and location.')
  const mode = oneOf(p.mode, ['make-to-stock', 'make-to-order', 'assemble-to-order'] as const, 'policy')
  if (mode !== 'make-to-stock' && item.kind !== 'make') fail('INPUT', 'Order and assembly policies require a made item.')
  if (mode === 'assemble-to-order' && !activeBom(s, item.id)) fail('NO_BOM', 'Assembly needs an effective bill of materials.')
  const effectiveOn = date(p.effectiveOn, 'effective date')
  if (new Date(effectiveOn + 'T00:00:00Z').toISOString().slice(0, 10) !== effectiveOn) fail('INPUT', 'Use a real effective date.')
  return { itemId: item.id, locationId: location.id, mode, effectiveOn,
    batchSize: format(decimal(p.batchSize, 'batch size', { positive: true })),
    orderMultiple: format(decimal(p.orderMultiple, 'order multiple', { positive: true })),
    reason: text(p.reason, 'policy reason', 400) }
}
