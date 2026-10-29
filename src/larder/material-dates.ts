import { quotePurchaseShares } from './quote-supply'
import { purchaseDate } from './supplier-terms'
// MRP-001's dated physical/purchase projection. Read-only: reservations stay
// bin-level commitments, and the suggested lots are never a physical pick.
import { addDays, forecastDemand } from './forecast-plan'
import { decimal, format, max, min } from './decimal'
import { lotBlock, shipBlock } from './lot-dates'
import { positions } from './stock'
import { deliveries } from './sales-schedules'
import type { Row, State } from './model'
import type { CatalogLocation } from './catalog-fields'
import { activeBom } from './bom'
import { buySuggestion } from './material-supplier'
import { impossibleTiming, materialReleaseOn, materialTiming } from './material-lead'
import { componentQuantity } from './bom-explosion'
import { datedRequirementKey, openDatedSupply, demandOrder, materialMode, materialOrder, type MaterialDemand as Demand } from './material-demand'

// Outstanding work whose every pinned input is covered by usable stock or dated supply nets demand on its
// completion day like a purchase. Covering one work order's inputs can free another's, so the projection is
// recomputed with each newly proven output until the set stops growing; adding supply never removes cover.
export function materialDates(s: State) {
  let proven = new Set<string>(), plan = project(s, proven)
  for (let pass = 0; pass <= s.workOrders.length; pass++) {
    const next = plan.workFeasibility.filter(w => w.feasible).map(w => w.workOrderId)
    if (next.every(id => proven.has(id))) break
    proven = new Set(next); plan = project(s, proven)
  }
  return plan
}

const remainingOutput = (w: Row) => max(0n, decimal(w.quantity) - decimal(w.output) - decimal(w.scrap))

function project(s: State, proven: Set<string>) {
  const today = new Date().toISOString().slice(0, 10)
  const demands: Demand[] = []
  const add = (d: Omit<Demand, 'sources' | 'left'>) => { if (d.quantity > 0n) demands.push({ ...d, sources: [], left: d.quantity }) }
  for (const o of s.salesOrders) if (['confirmed', 'part shipped'].includes(o.status)) for (const l of o.lines)
    for (const d of deliveries(o, l)) add({ kind: 'sales', documentId: o.id, lineId: l.id, reference: o.reference, itemId: l.itemId, date: d.date, quantity: decimal(d.quantity), customerId: o.customerId, rank: o.rank ?? Infinity, supply: materialMode(s, l), path: [] })
  for (const w of s.workOrders) if (w.status === 'released') for (const l of w.components) {
    // Pinned mixed make/buy requirements allocate actual issues buy first,
    // consistently with the aggregate ENG-001 planner. Never read a new BOM.
    const workTiming = materialTiming({ ...w, id: w.bomId }, decimal(w.quantity), w.expectedOn ?? w.requiredBy, today)
    let issued = decimal(l.issued)
    const requirements = Array.isArray(l.supplyRequirements) && l.supplyRequirements.length
      ? [...l.supplyRequirements].sort((a, b) => a.supply.localeCompare(b.supply))
      : [{ supply: materialMode(s, l), quantity: l.required }]
    for (const requirement of requirements) {
      const quantity = decimal(requirement.quantity), used = min(issued, quantity); issued -= used
      add({ kind: 'work', documentId: w.id, lineId: l.id, reference: w.reference, itemId: l.itemId, date: workTiming.releaseOn ?? workTiming.receiptOn, workTiming,
        quantity: quantity - used, rank: w.rank ?? Infinity, supply: requirement.supply,
        path: [{ itemId: w.itemId, bomId: w.bomId, revision: w.bomRevision }] })
    }
  }
  for (const f of forecastDemand(s)) add({ kind: 'forecast', documentId: f.forecastId, lineId: f.forecastId, reference: `Forecast ${f.week}`, itemId: f.itemId, date: addDays(f.week, 6), quantity: decimal(f.quantity), rank: Infinity, supply: materialMode(s, f), path: [] })
  demands.sort(demandOrder)

  const physical = positions(s)
  const stock = physical.filter(p => p.status === 'available').map(p => ({ ...p, left: decimal(p.quantity) }))
    .filter(p => p.left > 0n).sort((a, b) => {
      const expiry = (id: string) => id ? s.lots.find(l => l.id === id)?.dates?.expiresOn || '9999-12-31' : ''
      return expiry(a.lotId).localeCompare(expiry(b.lotId)) || a.locationId.localeCompare(b.locationId) || a.lotId.localeCompare(b.lotId)
    })
  const reservations = s.reservations.map(r => ({ ...r, left: r.quantity }))
  const usable = (d: Demand, lotId: string) => {
    if (d.workTiming && impossibleTiming(d.workTiming)) return false
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

  const purchases = [
    ...s.purchaseOrders.filter(p => ['approved', 'confirmed', 'part received'].includes(p.status)).flatMap(po => po.lines.map((l: any) => ({
      kind: 'purchase' as const, itemId: l.itemId as string, documentId: po.id, lineId: l.id as string, reference: po.reference as string, date: purchaseDate(po, l) as string, left: max(0n, decimal(l.quantity) - decimal(l.received)),
    }))),
    // The completion day is a declared expectation, exactly like a PO's; quality and receipt still gate use.
    ...s.workOrders.filter(w => proven.has(w.id)).map(w => ({ kind: 'work' as const, itemId: w.itemId as string, documentId: w.id, lineId: 'output', reference: w.reference as string, date: (w.expectedOn ?? w.requiredBy) as string, left: remainingOutput(w) })),
  ].filter(p => p.left > 0n).sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference) || a.lineId.localeCompare(b.lineId))
  // Remove every committed purchase share before assigning free supply. A
  // delayed share remains held, with a shortage on its owner, not resold.
  for (const share of quotePurchaseShares(s)) {
    let held = share.left
    const owned = demands.filter(d => d.documentId === share.workOrderId && d.lineId === share.lineId && d.itemId === share.itemId)
    for (const purchase of purchases) if (purchase.kind === 'purchase' && purchase.documentId === share.documentId && purchase.itemId === share.itemId && purchase.lineId === share.purchaseLineId) {
      const take = min(held, purchase.left); held -= take; purchase.left -= take
      let remaining = take
      for (const demand of owned) {
        if (purchase.date < today || purchase.date > demand.date) continue
        const allocated = min(demand.left, remaining); demand.left -= allocated; remaining -= allocated
        if (allocated > 0n) demand.sources.push({ kind: 'purchase', documentId: purchase.documentId, lineId: purchase.lineId, reference: purchase.reference, date: purchase.date, quantity: format(allocated), reserved: true })
      }
    }
  }
  const latePurchases = (d: Demand) => purchases.filter(p => p.itemId === d.itemId && p.left > 0n && (p.date > d.date || p.date < today)).map(p => ({ kind: p.kind, documentId: p.documentId, lineId: p.lineId, reference: p.reference, date: p.date, quantity: format(p.left), reason: p.date < today ? 'overdue; receipt not recorded' : 'after required date' }))
  const unavailablePurchases = new Map<Demand, ReturnType<typeof latePurchases>>()
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
      quantity, left: quantity, sources: [], rank: Infinity, supply: materialMode(s, { itemId: item.id }), path: [] })
  }
  const floorDemands = [...floors.values()].sort((a, b) => a.itemId.localeCompare(b.itemId) || a.locationId!.localeCompare(b.locationId!))
  for (const d of floorDemands) d.catalogLocationIds!.sort()
  // Current floors always protect physical stock before free demand, even
  // when their item follows another item in the BOM graph.
  for (const d of floorDemands) { takeStock(d, d.locationId, d.left, false); unavailablePurchases.set(d, latePurchases(d)) }
  const allocated = [...floorDemands]
  const blockedExplosions: { itemId: string; documentId: string; lineId: string; requiredBy: string; quantity: string; workOrderIds: string[]; reason: string }[] = []
  for (const itemId of materialOrder(s, [...floorDemands, ...demands], today)) {
    const rows = demands.filter(d => d.itemId === itemId).sort(demandOrder)
    for (const d of rows) {
      if (d.supply !== 'phantom') takeStock(d, undefined, d.left, false)
      for (const p of purchases) if (!(d.workTiming && impossibleTiming(d.workTiming)) && d.supply !== 'phantom' && p.itemId === d.itemId && p.date >= today && p.date <= d.date) {
        const take = min(d.left, p.left)
        if (take <= 0n) continue
        d.left -= take; p.left -= take
        d.sources.push({ kind: p.kind, documentId: p.documentId, lineId: p.lineId, reference: p.reference, date: p.date, quantity: format(take), reserved: false })
      }
      unavailablePurchases.set(d, latePurchases(d))
      allocated.push(d)
    }
    // Follow ENG-001's active-today revision and aggregate upward rounding.
    // Cumulative pegs sum to the rounded recipe total, including tiny roots.
    for (const d of rows) if (d.workTiming && impossibleTiming(d.workTiming)) blockedExplosions.push({ itemId, documentId: d.documentId, lineId: d.lineId, requiredBy: d.date, quantity: format(d.left), workOrderIds: [d.documentId], reason: d.workTiming.basis })
    const branches = [...floorDemands.filter(d => d.itemId === itemId), ...rows]
      .filter(d => d.left > 0n && d.supply !== 'buy' && !(d.workTiming && impossibleTiming(d.workTiming))).sort(demandOrder)
    // Existing work has independent pinned inputs. Until its material
    // feasibility can be proved, do not explode the same output's sales again
    // or silently call that output usable supply. Keep the shortage explicit.
    const workOrderIds = s.workOrders.filter(w => w.itemId === itemId && ['draft', 'released'].includes(w.status)
      && decimal(w.quantity) > decimal(w.output) + decimal(w.scrap)).map(w => w.id).sort()
    // Once every outstanding job for the item has proven inputs, its output is already netted above and only
    // the uncovered remainder explodes; any unproven job keeps the whole remainder blocked.
    const unproven = workOrderIds.filter(id => !proven.has(id))
    if (unproven.length) {
      for (const d of branches) if (d.supply === 'make') blockedExplosions.push({ itemId, documentId: d.documentId,
        lineId: d.lineId, requiredBy: d.date, quantity: format(d.left), workOrderIds: unproven,
        reason: 'outstanding work inputs and output feasibility must be reconciled before further make explosion' })
    }
    const expandable = branches.filter(d => d.supply === 'phantom' || !unproven.length)
    const bom = activeBom(s, itemId, today)
    if (!bom) continue
    const timed = expandable.map(d => ({ d, timing: materialTiming(bom, d.left, d.date, today, d.supply === 'phantom') }))
    for (const { d, timing } of timed) if (impossibleTiming(timing)) blockedExplosions.push({ itemId, documentId: d.documentId, lineId: d.lineId, requiredBy: d.date, quantity: format(d.left), workOrderIds: [], reason: timing.basis })
    for (const line of bom.components) {
      let cumulative = 0n, apportioned = 0n
      for (const { d, timing } of timed) {
        if (impossibleTiming(timing)) continue
        cumulative += d.left
        const total = componentQuantity(line.quantity, cumulative, bom.yield ?? '1')
        add({ kind: 'dependent', documentId: d.documentId, lineId: d.lineId, reference: d.reference,
          itemId: line.itemId, date: timing.releaseOn ?? d.date, quantity: total - apportioned, rank: d.rank,
          supply: materialMode(s, line), path: [...d.path, { itemId, bomId: bom.id, revision: bom.revision, timing }] })
        apportioned = total
      }
    }
  }
  // Future dated floor replenishment. A floor stays a current physical protection, but once every dated demand
  // has taken its supply, what remains of open purchases and proven work output restores an uncovered floor in
  // date order. That supply never counts as physical cover; it only schedules the restoration and keeps the
  // buy suggestion to the part nothing has scheduled.
  const replenishment = new Map<Demand, { kind: 'purchase' | 'work'; documentId: string; lineId: string; reference: string; date: string; quantity: string }[]>()
  for (const d of floorDemands) {
    const scheduled: { kind: 'purchase' | 'work'; documentId: string; lineId: string; reference: string; date: string; quantity: string }[] = []
    let need = d.left
    for (const p of purchases) {
      if (need <= 0n) break
      if (p.itemId !== d.itemId || p.left <= 0n || p.date < today) continue
      const take = min(need, p.left)
      p.left -= take; need -= take
      scheduled.push({ kind: p.kind, documentId: p.documentId, lineId: p.lineId, reference: p.reference, date: p.date, quantity: format(take) })
    }
    replenishment.set(d, scheduled)
  }
  // Material feasibility of outstanding work: every pinned input still to be issued is covered, after the
  // shared allocation, by usable stock or dated supply. Draft work pins no inputs, so it is never proven.
  const workFeasibility = s.workOrders.filter(w => ['draft', 'released'].includes(w.status) && remainingOutput(w) > 0n).map(w => {
    const inputs = allocated.filter(d => d.kind === 'work' && d.documentId === w.id), completionOn = (w.expectedOn ?? w.requiredBy) as string
    const shortages = inputs.filter(d => d.left > 0n).map(d => ({ itemId: d.itemId, quantity: format(d.left) }))
    const blocker = w.status !== 'released' ? 'draft work has no pinned inputs to prove'
      : inputs.some(d => d.workTiming && impossibleTiming(d.workTiming)) ? 'the pinned routing leaves the four-digit calendar'
      : completionOn < today ? 'the completion day has passed and no output is recorded'
      : shortages.length ? 'pinned inputs are not all covered' : null
    return { workOrderId: w.id, reference: w.reference as string, itemId: w.itemId as string, status: w.status as string, remainingOutput: format(remainingOutput(w)), completionOn,
      feasible: blocker === null, reason: blocker ?? 'every pinned input is covered by usable stock or dated supply', shortages }
  })
  const requirements = allocated.map(d => {
    const item = s.items.find(i => i.id === d.itemId)!
    const manufacturing = d.left > 0n && d.supply !== 'buy' ? materialTiming(activeBom(s, d.itemId, today), d.left, d.date, today, d.supply === 'phantom') : null
    const terms = s.partyItems.filter(t => t.itemId === item.id && s.parties.some(p => p.id === t.partyId && p.kind !== 'customer'))
      .sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.id.localeCompare(b.id))[0]

    const timingBlocked = d.workTiming && impossibleTiming(d.workTiming)
    const scheduled = replenishment.get(d) ?? [], unscheduled = d.left - scheduled.reduce((n, r) => n + decimal(r.quantity), 0n)
    const key = datedRequirementKey(d)
    return { key, linkedSupply: openDatedSupply(s, d), kind: d.kind, supply: d.supply, path: d.path, ...(d.kind === 'safety' ? { locationId: d.locationId, catalogLocationIds: d.catalogLocationIds, replenishment: scheduled, restoredOn: d.left > 0n && unscheduled === 0n ? scheduled.at(-1)!.date : null } : {}), documentId: d.documentId, lineId: d.lineId, reference: d.reference, itemId: d.itemId, requiredBy: d.date, overdue: d.date < today,
      manufacturing, ...(d.workTiming ? { workTiming: d.workTiming } : {}),
      quantity: format(d.quantity), covered: format(d.quantity - d.left), shortage: format(d.left), sources: d.sources, unavailablePurchases: unavailablePurchases.get(d)!,
      unavailableStock: physical.filter(p => p.itemId === d.itemId && (p.status !== 'available' || !usable(d, p.lotId))).map(p => ({ ...p, reason: p.status !== 'available' ? p.status : timingBlocked ? d.workTiming!.basis : d.kind === 'sales' ? shipBlock(s, p.lotId, d.date > today ? d.date : today, d.customerId!) : lotBlock(s.lots.find(l => l.id === p.lotId), d.date > today ? d.date : today) })),
      suggestion: timingBlocked ? null : d.left > 0n && d.supply === 'buy' ? (unscheduled > 0n ? buySuggestion(terms, unscheduled, d.date, today) : null) : d.left > 0n && d.supply === 'make' && manufacturing?.releaseOn ? { kind: 'make' as const, quantity: format(d.left), ...manufacturing } : null }
  })
  return { version: s.version, asOf: today, scope: 'current physical safety floors, dated multilevel sales/forecast demand and pinned released-work inputs; physical stock and dated purchases',
    limitations: ['Purchase dates are declared expectations; receipt and quality still gate use.', 'Manufacturing offsets use recorded full-batch routing critical paths in UTC calendar days; missing routing remains unknown, and capacity and transfer overlap are not applied.', 'Draft work output is provisional; released work output nets demand on its completion day only when every pinned input is covered.', 'Safety floors protect current physical stock only; automatic adoption is not applied; open supply restores an uncovered floor on its dated receipt without being physical cover; exact dated suggestions can be prepared as drafts after current-input review.'],
    requirements, blockedExplosions, unverifiedReservations: unverified, workFeasibility,
    provisionalSupply: [
      ...s.purchaseOrders.filter(p => p.status === 'draft').flatMap(po => po.lines.map((l: any) => ({ kind: 'purchase', documentId: po.id, reference: po.reference, itemId: l.itemId, date: purchaseDate(po, l), quantity: l.quantity, reason: 'purchase not approved' }))),
      ...s.workOrders.filter(w => ['draft', 'released'].includes(w.status) && !proven.has(w.id)).map(w => ({ kind: 'work', documentId: w.id, reference: w.reference, itemId: w.itemId, date: w.expectedOn ?? w.requiredBy, quantity: format(max(0n, decimal(w.quantity) - decimal(w.output) - decimal(w.scrap))), reason: 'work material feasibility not proven' })),
    ],
    excludedStock: physical.filter(p => p.status !== 'available' || lotBlock(s.lots.find(l => l.id === p.lotId), today)).map(p => ({ ...p, reason: p.status !== 'available' ? p.status : lotBlock(s.lots.find(l => l.id === p.lotId), today) })),
  }
}
