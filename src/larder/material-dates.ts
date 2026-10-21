// MRP-001's dated physical/purchase projection. Read-only: reservations stay
// bin-level commitments, and the suggested lots are never a physical pick.
import { addDays, forecastDemand } from './forecast-plan'
import { decimal, format, max, min } from './decimal'
import { lotBlock, shipBlock } from './lot-dates'
import { positions } from './stock'
import { deliveries } from './sales-schedules'
import type { State } from './model'
import type { CatalogLocation } from './catalog-fields'

type Source = { kind: 'stock' | 'purchase'; documentId: string; lineId?: string; reference: string; locationId?: string; lotId?: string; date: string; quantity: string; reserved: boolean }
type Demand = { kind: 'sales' | 'work' | 'forecast' | 'safety'; documentId: string; lineId: string; reference: string; itemId: string; date: string; quantity: bigint; customerId?: string; locationId?: string; catalogLocationIds?: string[]; rank: number; sources: Source[]; left: bigint }

export function materialDates(s: State) {
  const today = new Date().toISOString().slice(0, 10)
  const demands: Demand[] = []
  const add = (d: Omit<Demand, 'sources' | 'left'>) => { if (d.quantity > 0n) demands.push({ ...d, sources: [], left: d.quantity }) }
  for (const o of s.salesOrders) if (['confirmed', 'part shipped'].includes(o.status)) for (const l of o.lines)
    for (const d of deliveries(o, l)) add({ kind: 'sales', documentId: o.id, lineId: l.id, reference: o.reference, itemId: l.itemId, date: d.date, quantity: decimal(d.quantity), customerId: o.customerId, rank: o.rank ?? Infinity })
  for (const w of s.workOrders) if (w.status === 'released') for (const l of w.components)
    add({ kind: 'work', documentId: w.id, lineId: l.id, reference: w.reference, itemId: l.itemId, date: w.requiredBy, quantity: max(0n, decimal(l.required) - decimal(l.issued)), rank: w.rank ?? Infinity })
  for (const f of forecastDemand(s)) add({ kind: 'forecast', documentId: f.forecastId, lineId: f.forecastId, reference: `Forecast ${f.week}`, itemId: f.itemId, date: addDays(f.week, 6), quantity: decimal(f.quantity), rank: Infinity })
  demands.sort((a, b) => a.date.localeCompare(b.date) || a.rank - b.rank || a.reference.localeCompare(b.reference) || a.documentId.localeCompare(b.documentId) || a.lineId.localeCompare(b.lineId))

  const physical = positions(s)
  const stock = physical.filter(p => p.status === 'available').map(p => ({ ...p, left: decimal(p.quantity) }))
    .filter(p => p.left > 0n).sort((a, b) => {
      const expiry = (id: string) => id ? s.lots.find(l => l.id === id)?.dates?.expiresOn || '9999-12-31' : ''
      return expiry(a.lotId).localeCompare(expiry(b.lotId)) || a.locationId.localeCompare(b.locationId) || a.lotId.localeCompare(b.lotId)
    })
  const reservations = s.reservations.map(r => ({ ...r, left: r.quantity }))
  const usable = (d: Demand, lotId: string) => {
    const on = d.date > today ? d.date : today
    return !(d.kind === 'sales' ? shipBlock(s, lotId, on, d.customerId!) : lotBlock(s.lots.find(l => l.id === lotId), on))
  }
  function takeStock(d: Demand, locationId: string | undefined, wanted: bigint, reserved: boolean) {
    let left = wanted
    for (const p of stock) {
      if (p.itemId !== d.itemId || (locationId !== undefined && p.locationId !== locationId) || !usable(d, p.lotId)) continue
      const take = min(left, p.left)
      if (take <= 0n) continue
      p.left -= take; left -= take; d.left -= take
      d.sources.push({ kind: 'stock', documentId: p.lotId, reference: s.lots.find(l => l.id === p.lotId)?.code ?? 'Unlotted stock', locationId: p.locationId, lotId: p.lotId, date: today, quantity: format(take), reserved })
    }
    return wanted - left
  }
  // Protect all existing bin commitments before assigning any free stock,
  // even when their demand is later than a competing unreserved order.
  const unverified: { reservationId: string; documentId: string; itemId: string; locationId: string; date: string | null; quantity: string }[] = []
  for (const d of demands) for (const r of reservations) {
    if (r.demandId !== d.documentId || r.lineId !== d.lineId || r.itemId !== d.itemId) continue
    const intended = min(d.left, r.left)
    if (intended <= 0n) continue
    const covered = takeStock(d, r.locationId, intended, true)
    r.left -= intended
    if (covered < intended) unverified.push({ reservationId: r.id, documentId: r.demandId, itemId: r.itemId, locationId: r.locationId, date: d.date, quantity: format(intended - covered) })
  }
  // A commitment that cannot be proven usable on its date remains protected;
  // it never turns into free stock for another demand or another bin.
  for (const r of reservations) if (r.left > 0n) unverified.push({ reservationId: r.id, documentId: r.demandId, itemId: r.itemId, locationId: r.locationId, date: null, quantity: format(r.left) })
  for (const r of unverified) {
    let left = decimal(r.quantity)
    for (const p of stock) if (p.itemId === r.itemId && p.locationId === r.locationId) { const take = min(left, p.left); p.left -= take; left -= take }
  }

  const purchases = s.purchaseOrders.filter(p => ['approved', 'confirmed', 'part received'].includes(p.status)).flatMap(po => po.lines.map((l: any) => ({
    itemId: l.itemId as string, documentId: po.id, lineId: l.id as string, reference: po.reference as string, date: po.expectedDate as string, left: max(0n, decimal(l.quantity) - decimal(l.received)),
  }))).filter(p => p.left > 0n).sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference) || a.lineId.localeCompare(b.lineId))
  // DEMAND-004 already protects max(safetyStock, minStock) at the default
  // bin. Apply that same current physical floor once, after hard commitments.
  // Several catalog locations can name one bin: take their maximum, not sum.
  const floors = new Map<string, Demand>()
  for (const item of s.items) if (!item.archived) for (const settings of (item.catalogLocations ?? []) as CatalogLocation[]) {
    const quantity = max(decimal(settings.safetyStock ?? '0'), decimal(settings.minStock ?? '0'))
    if (quantity <= 0n) continue
    const locationId = settings.defaultBin ?? settings.locationId, key = JSON.stringify([item.id, locationId])
    const previous = floors.get(key)
    if (previous) {
      previous.quantity = max(previous.quantity, quantity); previous.left = previous.quantity
      previous.catalogLocationIds!.push(settings.locationId)
    } else floors.set(key, { kind: 'safety', documentId: item.id, lineId: locationId, itemId: item.id, locationId,
      catalogLocationIds: [settings.locationId], reference: `Safety floor ${item.sku}`, date: today,
      quantity, left: quantity, sources: [], rank: Infinity })
  }
  const floorDemands = [...floors.values()].sort((a, b) => a.itemId.localeCompare(b.itemId) || a.locationId!.localeCompare(b.locationId!))
  for (const d of floorDemands) d.catalogLocationIds!.sort()
  const requirements = [...floorDemands, ...demands].map(d => {
    takeStock(d, d.locationId, d.left, false)
    // A current physical floor cannot be filled by an unreceived PO, even
    // one due today: no receipt or destination has yet been proven.
    for (const p of purchases) if (d.kind !== 'safety' && p.itemId === d.itemId && p.date >= today && p.date <= d.date) {
      const take = min(d.left, p.left)
      if (take <= 0n) continue
      d.left -= take; p.left -= take
      d.sources.push({ kind: 'purchase', documentId: p.documentId, lineId: p.lineId, reference: p.reference, date: p.date, quantity: format(take), reserved: false })
    }
    const item = s.items.find(i => i.id === d.itemId)!
    const terms = s.partyItems.filter(t => t.itemId === item.id && s.parties.some(p => p.id === t.partyId && p.kind !== 'customer'))
      .sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.id.localeCompare(b.id))[0]
    const late = purchases.filter(p => p.itemId === d.itemId && p.left > 0n && (p.date > d.date || p.date < today)).map(p => ({ documentId: p.documentId, lineId: p.lineId, reference: p.reference, date: p.date, quantity: format(p.left), reason: p.date < today ? 'overdue; receipt not recorded' : 'after required date' }))
    return { kind: d.kind, ...(d.kind === 'safety' ? { locationId: d.locationId, catalogLocationIds: d.catalogLocationIds } : {}), documentId: d.documentId, lineId: d.lineId, reference: d.reference, itemId: d.itemId, requiredBy: d.date, overdue: d.date < today,
      quantity: format(d.quantity), covered: format(d.quantity - d.left), shortage: format(d.left), sources: d.sources, unavailablePurchases: late,
      unavailableStock: physical.filter(p => p.itemId === d.itemId && (p.status !== 'available' || !usable(d, p.lotId))).map(p => ({ ...p, reason: p.status !== 'available' ? p.status : d.kind === 'sales' ? shipBlock(s, p.lotId, d.date > today ? d.date : today, d.customerId!) : lotBlock(s.lots.find(l => l.id === p.lotId), d.date > today ? d.date : today) })),
      suggestion: d.left > 0n && item.kind === 'buy' ? { kind: 'buy', quantity: format(d.left), supplierId: terms?.partyId ?? null, receiptOn: d.date,
        releaseOn: terms ? addDays(d.date, -terms.leadDays) : null, leadDays: terms?.leadDays ?? null, requiresPastRelease: terms ? addDays(d.date, -terms.leadDays) < today : null } : null }
  })
  return { version: s.version, asOf: today, scope: 'current physical safety floors, direct sales, residual forecast and pinned released-work inputs; physical stock and dated purchases',
    limitations: ['Purchase dates are declared expectations; receipt and quality still gate use.', 'Unmade BOM demand is not exploded.', 'Draft and released work output is provisional; multilevel material feasibility is not proven.', 'Safety floors protect current physical stock only; future floor replenishment, supplier calendars and automatic draft adoption are not applied.'],
    requirements, unverifiedReservations: unverified,
    provisionalSupply: [
      ...s.purchaseOrders.filter(p => p.status === 'draft').flatMap(po => po.lines.map((l: any) => ({ kind: 'purchase', documentId: po.id, reference: po.reference, itemId: l.itemId, date: po.expectedDate, quantity: l.quantity, reason: 'purchase not approved' }))),
      ...s.workOrders.filter(w => ['draft', 'released'].includes(w.status)).map(w => ({ kind: 'work', documentId: w.id, reference: w.reference, itemId: w.itemId, date: w.expectedOn ?? w.requiredBy, quantity: format(max(0n, decimal(w.quantity) - decimal(w.output) - decimal(w.scrap))), reason: 'work material feasibility not proven' })),
    ],
    excludedStock: physical.filter(p => p.status !== 'available' || lotBlock(s.lots.find(l => l.id === p.lotId), today)).map(p => ({ ...p, reason: p.status !== 'available' ? p.status : lotBlock(s.lots.find(l => l.id === p.lotId), today) })),
  }
}
