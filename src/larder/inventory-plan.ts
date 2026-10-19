// Read-only quantity planning. Catalog location values are read on every preview.
import { open } from './availability'
import { activeBom } from './bom'
import { resolvedComponents } from './bom-explosion'
import type { CatalogLocation } from './catalog-fields'
import { decimal, format, max, min, MAX } from './decimal'
import { addDays } from './forecast-plan'
import { get, oneOf, type Row, type State } from './model'
import { fail } from './problem'
import { deliveries, deliveryDate } from './sales-schedules'
import { availableAt, balance, reservedAt, reservedQuantity } from './stock'

export type InventoryMode = 'make-to-stock' | 'make-to-order' | 'assemble-to-order'
export type InventoryPolicy = Row & { itemId: string; locationId: string; mode: InventoryMode; batchSize: string; orderMultiple: string; orderIds?: string[] }
type Peg = { orderId: string; lineId: string; requiredBy: string; quantity: string }
type Supply = { kind: 'work' | 'purchase'; documentId: string; reference: string; lineId?: string; quantity: string; date: string; locationId: string; orderId: string | null; orderLineId: string | null; remaining: bigint }
type Allocation = { source: string; documentId?: string; locationId?: string; quantity: string; date: string; late: boolean }
export type InventoryDemand = Peg & { reference: string; rank: number | null; hardReserved: string; commonAllocated: string; existingAllocated: string; shortage: string; allocations: Allocation[] }
export type InventorySuggestion = { key: string; kind: 'work' | 'purchase'; itemId: string; locationId: string; defaultBin: string; quantity: string; netRequirement: string; surplus: string; requiredBy: string; plannedStart: string; late: boolean; orderId: string | null; lineId: string | null; pegs: Peg[]; bomId: string | null; bomRevision: number | null; components: any[]; readiness: string }

const cleanSupply = ({ remaining: _remaining, ...supply }: Supply) => supply
function multiple(quantity: bigint, batch: bigint, order: bigint) {
  let a = batch, b = order
  while (b) { const remainder = a % b; a = b; b = remainder }
  const step = batch / a * order, result = quantity ? (quantity + step - 1n) / step * step : 0n
  if (result > MAX) fail('DECIMAL', 'The rounded inventory batch exceeds the supported quantity range.')
  return result
}

function supplyAt(s: State, itemId: string, locationId: string) {
  const included: Supply[] = [], excluded: any[] = []
  function add(kind: Supply['kind'], document: Row, line: any, quantity: bigint, date: string) {
    if (!quantity) return
    const tag = line?.inventoryPolicy ?? document.inventoryPolicy
    const location = tag?.locationId ?? line?.locationId ?? document.locationId
    const entry = { kind, documentId: document.id, reference: document.reference, ...(line ? { lineId: line.id } : {}), quantity: format(quantity), date,
      locationId: location ?? '', orderId: tag?.orderId ?? null, orderLineId: tag?.lineId ?? null }
    if (location !== locationId) { excluded.push({ ...entry, reason: location ? 'Another planning location.' : 'Supply has no planning location; reconcile it before preparing overlapping supply.' }); return }
    included.push({ ...entry, remaining: quantity })
  }
  for (const w of s.workOrders.filter(w => w.itemId === itemId && ['draft', 'released'].includes(w.status)))
    add('work', w, null, max(0n, decimal(w.quantity) - decimal(w.output ?? '0') - decimal(w.scrap ?? '0')), w.expectedOn ?? w.requiredBy)
  for (const p of s.purchaseOrders.filter(p => ['draft', 'approved', 'confirmed', 'part received'].includes(p.status)))
    for (const line of p.lines.filter((l: any) => l.itemId === itemId)) add('purchase', p, line, max(0n, decimal(line.quantity) - decimal(line.received ?? '0')), p.expectedDate)
  included.sort((a, b) => a.date.localeCompare(b.date) || a.documentId.localeCompare(b.documentId) || (a.lineId ?? '').localeCompare(b.lineId ?? ''))
  return { included, excluded }
}

// orderIds is an explicit approved-demand selection supplied by the command.
export function inventoryPlan(s: State, policy: InventoryPolicy | Row, asOf: string) {
  asOf = deliveryDate(asOf)
  const item = get(s, 'items', policy.itemId, 'item'), location = get(s, 'locations', policy.locationId, 'location')
  const mode = oneOf(policy.mode, ['make-to-stock', 'make-to-order', 'assemble-to-order'] as const, 'mode')
  if (!Array.isArray(policy.orderIds)) fail('INPUT', 'Select the sales orders included in this inventory preview.', { field: 'orderIds' })
  const catalog: CatalogLocation = item.catalogLocations?.find((entry: CatalogLocation) => entry.locationId === location.id) ?? { locationId: location.id }
  const safety = decimal(catalog.safetyStock ?? '0'), minimum = decimal(catalog.minStock ?? '0'), floor = max(safety, minimum)
  const reorder = decimal(catalog.reorderPoint ?? '0'), target = max(floor, decimal(catalog.maxStock ?? '0'))
  const batch = decimal(policy.batchSize, 'batch size', { positive: true }), orderMultiple = decimal(policy.orderMultiple, 'order multiple', { positive: true })
  const leadDays = catalog.leadDays ?? 0, defaultBin = catalog.defaultBin ?? location.id, poolLocationId = defaultBin
  get(s, 'locations', poolLocationId, 'default bin')
  const physical = balance(s, item.id, poolLocationId), reserved = reservedAt(s, item.id, poolLocationId), free = max(0n, physical - reserved)
  let common = max(0n, free - floor)
  const initialCommon = common, supply = supplyAt(s, item.id, poolLocationId), demand: InventoryDemand[] = [], suggestions: InventorySuggestion[] = []
  const blockers = supply.excluded.filter(x => !x.locationId).map(x => ({ code: 'UNLOCATED_SUPPLY', documentId: x.documentId, message: x.reason }))
  const selected = [...new Set(policy.orderIds as string[])].map(id => get(s, 'salesOrders', id, 'sales order'))
  for (const o of selected) if (!['confirmed', 'part shipped'].includes(o.status)) fail('STATE', 'Select only confirmed outstanding sales orders.', { orderId: o.id })
  const explicit = (o: Row) => Number.isSafeInteger(o.rank) && o.rank > 0 && o.rank <= 1000000
  function takeSupply(entry: InventoryDemand, candidates: Supply[]) {
    let needed = decimal(entry.shortage)
    for (const source of candidates) {
      const take = min(needed, source.remaining)
      if (!take) continue
      source.remaining -= take; needed -= take
      entry.allocations.push({ source: source.kind, documentId: source.documentId, quantity: format(take), date: source.date, late: source.date > entry.requiredBy })
      entry.existingAllocated = format(decimal(entry.existingAllocated) + take)
    }
    entry.shortage = format(needed)
  }
  const scheduled = selected.flatMap(o => o.lines.filter((l: any) => l.itemId === item.id && open(l) > 0n).flatMap((line: any) => {
    const reservations = s.reservations.filter(r => r.demandKind === 'sales' && r.demandId === o.id && r.lineId === line.id && r.itemId === item.id)
      .map(r => ({ ...r, remaining: r.quantity }))
    const schedules = deliveries(o, line).sort((a, b) => a.date.localeCompare(b.date))
    if (schedules.reduce((n, d) => n + decimal(d.quantity), 0n) !== open(line)) fail('STATE', 'Delivery quantities must cover outstanding demand.', { orderId: o.id, lineId: line.id })
    return schedules.map(schedule => ({ o, line, schedule, reservations }))
  })) as { o: Row; line: any; schedule: { quantity: string; date: string }; reservations: { locationId: string; remaining: bigint }[] }[]
  scheduled.sort((a, b) => Number(!explicit(a.o)) - Number(!explicit(b.o)) || (explicit(a.o) && explicit(b.o) ? a.o.rank - b.o.rank : 0) || a.schedule.date.localeCompare(b.schedule.date) || (a.o.createdAt ?? '').localeCompare(b.o.createdAt ?? '') || a.o.id.localeCompare(b.o.id) || a.line.id.localeCompare(b.line.id))
  for (const { o, line, schedule, reservations } of scheduled) {
      const quantity = decimal(schedule.quantity)
      if (!quantity) continue
      const entry: InventoryDemand = { orderId: o.id, lineId: line.id, reference: o.reference, rank: explicit(o) ? o.rank : null, requiredBy: deliveryDate(schedule.date), quantity: format(quantity), hardReserved: '0', commonAllocated: '0', existingAllocated: '0', shortage: format(quantity), allocations: [] }
      let needed = quantity
      for (const reservation of reservations) {
        const take = min(needed, reservation.remaining)
        if (!take) continue
        reservation.remaining -= take; needed -= take
        entry.allocations.push({ source: 'hard-reservation', locationId: reservation.locationId, quantity: format(take), date: asOf, late: asOf > entry.requiredBy })
        entry.hardReserved = format(decimal(entry.hardReserved) + take)
      }
      entry.shortage = format(needed)
      // Dedicated commitments stay with their customer before common supply.
      takeSupply(entry, supply.included.filter(x => x.orderId === o.id && x.orderLineId === line.id))
      needed = decimal(entry.shortage)
      const fromCommon = min(needed, common); common -= fromCommon
      if (fromCommon) entry.allocations.push({ source: 'common-stock', locationId: poolLocationId, quantity: format(fromCommon), date: asOf, late: asOf > entry.requiredBy })
      entry.commonAllocated = format(fromCommon); entry.shortage = format(needed - fromCommon)
      takeSupply(entry, supply.included.filter(x => !x.orderId && !x.orderLineId))
      demand.push(entry)
  }
  // Existing approved draft supply already commits its recipe quantities in
  // planning, even before release creates physical hard reservations.
  const committedComponents = new Map<string, bigint>()
  for (const work of s.workOrders.filter(w => ['draft', 'released'].includes(w.status))) {
    if (work.inventoryPolicy?.locationId && work.inventoryPolicy.locationId !== poolLocationId) continue
    if (work.status === 'released') {
      for (const line of work.components) {
        const unreserved = max(0n, decimal(line.required) - decimal(line.issued) - reservedQuantity(s, work.id, line.id))
        committedComponents.set(line.itemId, (committedComponents.get(line.itemId) ?? 0n) + unreserved)
      }
    } else {
      const bom = work.inventoryBomId ? s.boms.find(b => b.id === work.inventoryBomId) : activeBom(s, work.itemId, asOf)
      if (bom) for (const line of resolvedComponents(s, bom, decimal(work.quantity), asOf).components)
        committedComponents.set(line.itemId, (committedComponents.get(line.itemId) ?? 0n) + decimal(line.quantity))
    }
  }
  const componentPools = new Map<string, bigint>(), componentFuture = new Map<string, ReturnType<typeof supplyAt>>()
  function suggest(net: bigint, pegs: Peg[], requiredBy: string, dedicated = false) {
    if (!net) return
    const quantity = multiple(net, batch, orderMultiple), plannedStart = addDays(requiredBy, -leadDays)
    const result: InventorySuggestion = { key: `${policy.id}:${suggestions.length + 1}`, kind: item.kind === 'make' ? 'work' : 'purchase', itemId: item.id, locationId: location.id, defaultBin, quantity: format(quantity), netRequirement: format(net), surplus: format(quantity - net), requiredBy, plannedStart, late: plannedStart < asOf,
      orderId: dedicated ? pegs[0].orderId : null, lineId: dedicated ? pegs[0].lineId : null, pegs, bomId: null, bomRevision: null, components: [], readiness: item.kind === 'make' ? 'No BOM' : 'Purchase required' }
    if (item.kind === 'make') {
      const bom = activeBom(s, item.id, asOf)
      if (bom) {
        result.bomId = bom.id; result.bomRevision = bom.revision
        for (const component of resolvedComponents(s, bom, quantity, asOf).components) {
          const componentCatalog: CatalogLocation | undefined = s.items.find(i => i.id === component.itemId)?.catalogLocations?.find((entry: CatalogLocation) => entry.locationId === location.id)
          const protectedFloor = max(decimal(componentCatalog?.safetyStock ?? '0'), decimal(componentCatalog?.minStock ?? '0'))
          const required = decimal(component.quantity), available = componentPools.get(component.itemId) ?? max(0n, availableAt(s, component.itemId, poolLocationId) - protectedFloor - (committedComponents.get(component.itemId) ?? 0n))
          const take = min(required, available); componentPools.set(component.itemId, available - take)
          let future = componentFuture.get(component.itemId)
          if (!future) {
            future = supplyAt(s, component.itemId, poolLocationId)
            let committed = max(0n, (committedComponents.get(component.itemId) ?? 0n) - max(0n, availableAt(s, component.itemId, poolLocationId) - protectedFloor))
            for (const source of future.included.filter(x => !x.orderId && !x.orderLineId)) {
              const take = min(committed, source.remaining); source.remaining -= take; committed -= take
            }
            componentFuture.set(component.itemId, future)
          }
          let short = required - take
          const allocations: Allocation[] = take ? [{ source: 'common-stock', locationId: poolLocationId, quantity: format(take), date: asOf, late: asOf > plannedStart }] : []
          for (const source of future.included.filter(x => !x.orderId && !x.orderLineId)) {
            const got = min(short, source.remaining)
            if (!got) continue
            short -= got; source.remaining -= got
            allocations.push({ source: source.kind, documentId: source.documentId, quantity: format(got), date: source.date, late: source.date > plannedStart })
          }
          result.components.push({ ...component, committedToExistingWork: format(committedComponents.get(component.itemId) ?? 0n), available: format(take), protectedFloor: format(protectedFloor), shortage: format(short), allocations, excludedSupply: future.excluded, ready: !short && allocations.every(x => !x.late) })
        }
        result.readiness = result.components.every(c => c.ready) ? 'Components ready by planned start' : 'Components unavailable or late for planned start'
      }
    }
    suggestions.push(result)
  }
  const shortage = demand.reduce((n, d) => n + decimal(d.shortage), 0n)
  const commonFuture = supply.included.filter(x => !x.orderId && !x.orderLineId).reduce((n, x) => n + x.remaining, 0n)
  const projected = free + commonFuture - (initialCommon - common) - shortage
  let replenishment = 0n
  if (mode === 'make-to-stock') {
    replenishment = projected <= reorder ? max(0n, target - projected) : max(0n, floor - projected)
    const pegs = demand.filter(d => decimal(d.shortage) > 0n).map(d => ({ orderId: d.orderId, lineId: d.lineId, requiredBy: d.requiredBy, quantity: d.shortage }))
    suggest(replenishment, pegs, pegs.map(p => p.requiredBy).sort()[0] ?? addDays(asOf, leadDays))
  } else for (const d of demand) suggest(decimal(d.shortage), [{ orderId: d.orderId, lineId: d.lineId, requiredBy: d.requiredBy, quantity: d.shortage }], d.requiredBy, true)
  const commonAllocations = demand.filter(d => decimal(d.commonAllocated) > 0n).map(d => ({ orderId: d.orderId, lineId: d.lineId, requiredBy: d.requiredBy, itemId: item.id, locationId: poolLocationId, quantity: d.commonAllocated }))
  return { policyId: policy.id, itemId: item.id, locationId: location.id, poolLocationId, mode, asOf, scope: 'Quantity policy preview; no finite-capacity or customer-promise approval.',
    settings: { ...catalog, locationId: location.id, reorderPoint: format(reorder), safetyStock: format(safety), minStock: format(minimum), maxStock: catalog.maxStock ?? null, defaultBin, leadDays, batchSize: format(batch), orderMultiple: format(orderMultiple) },
    onHand: format(physical), reserved: format(reserved), freeAvailable: format(free), safetyProtected: format(min(free, safety)), floorProtected: format(min(free, floor)), inventoryFloor: format(floor), commonAvailable: format(initialCommon), unusedCommon: format(common),
    projectedInventory: format(projected), existingSupply: supply.included.map(x => ({ ...cleanSupply(x), unused: format(x.remaining) })), excludedSupply: supply.excluded, blockers, demand, commonAllocations, suggestions,
    totals: { demand: format(demand.reduce((n, d) => n + decimal(d.quantity), 0n)), shortage: format(shortage), proposed: format(suggestions.reduce((n, p) => n + decimal(p.quantity), 0n)), replenishment: format(replenishment), unusedFutureCommon: format(commonFuture) } }
}
