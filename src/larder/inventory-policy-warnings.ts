// MPS review evidence: effective policies with current ENG-007 configuration.
import type { CatalogLocation } from './catalog-fields'
import { decimal, format } from './decimal'
import { get, type Row, type State } from './model'

export type MpsPolicyWarning = {
  policyId: string
  itemId: string
  locationId: string
  revision: number
  mode: 'make-to-stock' | 'make-to-order' | 'assemble-to-order'
  effectiveOn: string
  batchSize: string
  orderMultiple: string
  reorderPoint: string
  safetyStock: string
  minStock: string
  maxStock: string | null
  defaultBin: string
  leadDays: number
}

export function mpsPolicyWarnings(s: State, itemIds: string[], on: string): MpsPolicyWarning[] {
  const selected = new Set(itemIds), effective = new Map<string, Row>()
  for (const policy of s.inventoryPolicies) {
    if (!selected.has(policy.itemId) || policy.effectiveOn > on) continue
    const key = JSON.stringify([policy.itemId, policy.locationId]), previous = effective.get(key)
    if (!previous || policy.effectiveOn > previous.effectiveOn ||
      (policy.effectiveOn === previous.effectiveOn && (policy.revision > previous.revision ||
        (policy.revision === previous.revision && policy.id < previous.id)))) effective.set(key, policy)
  }
  return [...effective.values()]
    .sort((a, b) => a.itemId.localeCompare(b.itemId) || a.locationId.localeCompare(b.locationId))
    .map(policy => {
      const item = get(s, 'items', policy.itemId, 'item')
      const settings: CatalogLocation | undefined = item.catalogLocations?.find((entry: CatalogLocation) => entry.locationId === policy.locationId)
      return {
        policyId: policy.id,
        itemId: policy.itemId,
        locationId: policy.locationId,
        revision: policy.revision,
        mode: policy.mode,
        effectiveOn: policy.effectiveOn,
        batchSize: format(decimal(policy.batchSize)),
        orderMultiple: format(decimal(policy.orderMultiple)),
        reorderPoint: format(decimal(settings?.reorderPoint ?? '0')),
        safetyStock: format(decimal(settings?.safetyStock ?? '0')),
        minStock: format(decimal(settings?.minStock ?? '0')),
        maxStock: settings?.maxStock === undefined ? null : format(decimal(settings.maxStock)),
        defaultBin: settings?.defaultBin ?? policy.locationId,
        leadDays: settings?.leadDays ?? 0,
      }
    })
}
