import { allocateHandoffs } from './operation-handoffs'
import { decimal, format, max, min } from './decimal'
import { fail } from './problem'
import { allow } from './roles'
import { transferDemand } from './work-demand'
import { workMaterialPool } from './production-trace'
import { materialCost } from './production-cost'
import { allocations, lineageIds, partition, uniqueOrigins, type Allocation } from './work-lineage'
import { bump, fresh, get, list, newId, nextReference, row, text, type Context, type Row } from './model'

const completed = (w: Row) => decimal(w.output) + decimal(w.scrap)
const remaining = (w: Row) => decimal(w.quantity) - completed(w)
const fraction = (n: bigint, part: bigint, whole: bigint) => whole > 0n ? n * part / whole : 0n
function eligible(c: Context, w: Row, merge = false) {
  if (!['draft', 'released'].includes(w.status) || remaining(w) <= 0n) fail('STATE', 'Choose draft or released work with an untransferred remaining quantity.')
  if (w.operationStates?.some((t: any) => ['running', 'paused'].includes(t.status))) fail('ACTIVE_CLOCK', 'Complete active operations before transferring remaining work; their clocks stay on the original job.')
  if (c.s.qualityHolds.some(h => h.status === 'open' && lineageIds(w).includes(h.subjectId))) fail('QUALITY_HOLD', 'Release the original quality hold before transferring this work.')
  w.demandSources ??= [{ workOrderId: w.id, reason: w.reason, inventoryPolicy: structuredClone(w.inventoryPolicy ?? null), masterSchedule: structuredClone(w.masterSchedule ?? null) }]
  if (merge) {
    const lots = c.s.lots.filter(l => l.source === 'production' && l.documentId === w.id).map(l => l.id)
    if (c.s.movements.some(m => m.kind === 'shipment' && lots.includes(m.lotId))) fail('SHIPPED_OUTPUT', 'A job with shipped output cannot participate in a merge.')
  }
}
function snapshot(w: Row) {
  return JSON.stringify({ itemId: w.itemId, traceAllocationVersion: w.traceAllocationVersion, status: w.status, bomId: w.bomId, bomRevision: w.bomRevision, bomRevisions: w.bomRevisions ?? [], engineeringBomId: w.engineeringBomId, engineeringBomIds: w.engineeringBomIds, completedSteps: (w.operationStates ?? []).filter((t: any) => t.status === 'done').map((t: any) => t.sequence), routing: w.transferRouting ?? w.routing, standardUnitCost: w.standardUnitCost, planningLocation: w.inventoryPolicy?.locationId, inventoryBomId: w.inventoryBomId, componentBasis: w.components.map((x: any) => [x.itemId, x.perUnit]) })
}
function successor(c: Context, source: Row, quantity: bigint, origins: Allocation[], centres: any, reason: string) {
  const routing = structuredClone(source.transferRouting ?? source.routing)
  for (const step of routing) if (centres?.[step.sequence]) {
    const center = text(centres[step.sequence], 'work center', 120), eligible = step.eligibleCentres?.length ? step.eligibleCentres : [step.workCentre]
    if (!eligible.includes(center)) fail('WORK_CENTER', 'Choose a center eligible under the pinned routing.')
    step.workCentre = center
  }
  return row(c, 'workOrders', { reference: nextReference(c.s.workOrders, 'WO'), itemId: source.itemId, quantity: format(quantity), requiredBy: source.requiredBy, expectedOn: source.expectedOn, masterSchedule: source.masterSchedule ? structuredClone(source.masterSchedule) : undefined, plannedCentres: centres ?? source.plannedCentres ?? {}, engineeringBomId: source.engineeringBomId, inventoryBomId: source.inventoryBomId, reason, priority: source.priority, plannedStart: source.plannedStart, status: source.status, traceAllocationVersion: source.traceAllocationVersion, preparedBy: c.actor.id, bomId: source.bomId, bomRevision: source.bomRevision, bomRevisions: structuredClone(source.bomRevisions ?? []), engineeringBomIds: source.engineeringBomIds ? structuredClone(source.engineeringBomIds) : undefined, components: [], routing, transferRouting: structuredClone(source.transferRouting ?? source.routing), operationStates: routing.map((step: any) => ({ sequence: step.sequence, status: 'pending', acknowledgments: [] })), output: '0', scrap: '0', standardUnitCost: source.standardUnitCost, quantityAllocations: origins, lineageSourceIds: lineageIds(source), demandSources: structuredClone(source.demandSources ?? [{ workOrderId: source.id, reason: source.reason, inventoryPolicy: source.inventoryPolicy ?? null, masterSchedule: source.masterSchedule ?? null }]) })
}
function transfer(c: Context, source: Row, dest: Row, quantity: bigint, record: Row) {
  const originalQuantity = decimal(source.quantity), open = remaining(source), components = []
  for (const l of source.components) {
    const required = fraction(decimal(l.required), quantity, originalQuantity), doneRequirement = fraction(decimal(l.required), completed(source), originalQuantity)
    const available = source.traceAllocationVersion ? max(0n, workMaterialPool(c.s, source).remaining.get(l.itemId) ?? 0n) : max(0n, decimal(l.issued) - doneRequirement)
    const issued = quantity === open ? available : fraction(available, quantity, open)
    const cost = decimal(l.issued) > 0n ? fraction(materialCost(c.s, source, l.itemId), issued, decimal(l.issued)) : 0n
    let target = dest.components.find((x: any) => x.itemId === l.itemId)
    if (!target) { target = { id: newId(), itemId: l.itemId, perUnit: l.perUnit, required: '0', issued: '0', supplyRequirements: [] }; dest.components.push(target) }
    target.required = format(decimal(target.required) + required); target.issued = format(decimal(target.issued) + issued)
    for (const x of l.supplyRequirements ?? []) {
      const take = fraction(decimal(x.quantity), quantity, originalQuantity)
      let targetSupply = target.supplyRequirements.find((a: any) => a.supply === x.supply)
      if (!targetSupply) { targetSupply = { supply: x.supply, quantity: '0' }; target.supplyRequirements.push(targetSupply) }
      targetSupply.quantity = format(decimal(targetSupply.quantity) + take); x.quantity = format(decimal(x.quantity) - take)
    }
    let reserveNeeded = max(0n, required - issued)
    for (const r of [...c.s.reservations]) if (r.demandId === source.id && r.lineId === l.id && reserveNeeded > 0n) {
      const take = min(reserveNeeded, r.quantity); r.quantity -= take; reserveNeeded -= take
      if (r.quantity === 0n) c.s.reservations.splice(c.s.reservations.indexOf(r), 1)
      const existing = c.s.reservations.find(x => x.demandId === dest.id && x.lineId === target.id && x.locationId === r.locationId)
      if (existing) existing.quantity += take
      else c.s.reservations.push({ ...r, id: newId(), demandId: dest.id, lineId: target.id, quantity: take })
    }
    l.required = format(decimal(l.required) - required); l.issued = format(decimal(l.issued) - issued)
    components.push({ itemId: l.itemId, quantity: format(issued), cost: format(cost) })
  }
  allocateHandoffs(source, dest, quantity, open, record)
  transferDemand(source, dest, quantity)
  record.transfers.push({ sourceId: source.id, destinationId: dest.id, quantity: format(quantity), components })
  bump(source, { quantity: format(originalQuantity - quantity), ...(originalQuantity === quantity ? { status: 'transferred' } : {}) })
}
function finish(c: Context, dest: Row, sources: Row[]) {
  dest.lineageSourceIds = [...new Set(sources.flatMap(lineageIds))]
  dest.demandSources = sources.flatMap(s => s.demandSources ?? [{ workOrderId: s.id, reason: s.reason, inventoryPolicy: s.inventoryPolicy ?? null, masterSchedule: s.masterSchedule ?? null }]).filter((x, i, all) => all.findIndex(y => JSON.stringify(y) === JSON.stringify(x)) === i)
  // A predecessor is inherited only if every merged input completed it.
  dest.operationStates = dest.routing.map((step: any) => ({ sequence: step.sequence, status: sources.every(s => s.operationStates?.some((t: any) => t.sequence === step.sequence && t.status === 'done')) ? 'done' : 'pending', acknowledgments: [], inheritedFrom: sources.filter(s => s.operationStates?.some((t: any) => t.sequence === step.sequence && t.status === 'done')).map(s => ({ workOrderId: s.id, sequence: step.sequence })) }))
  dest.shortages = dest.components.map((l: any) => ({ itemId: l.itemId, short: format(max(0n, decimal(l.required) - decimal(l.issued) - c.s.reservations.filter(r => r.demandId === dest.id && r.lineId === l.id).reduce((n, r) => n + r.quantity, 0n))) })).filter((x: any) => x.short !== '0')
  return dest
}
export function workTransfers(c: Context, type: string, p: any): Row | undefined {
  if (!['wo.split', 'wo.merge'].includes(type)) return
  allow(c, ['manager', 'production', 'planner'])
  const reason = text(p.reason, 'transfer reason', 1000)
  if (type === 'wo.split') {
    const source = get(c.s, 'workOrders', p.workOrderId); fresh(source, p.version); eligible(c, source)
    const parts = list(p.parts, 'split parts', 20).map((x: any) => ({ ...x, q: decimal(x.quantity, 'split quantity', { positive: true }) }))
    if (parts.reduce((n, x) => n + x.q, 0n) > remaining(source)) fail('QUANTITY', 'Split only the untransferred remaining quantity.')
    const [done, open] = partition(allocations(source), completed(source)); let left = open
    const record = row(c, 'workTransfers', { kind: 'split', reason, sourceVersions: [{ id: source.id, version: source.version }], transfers: [], destinations: [] })
    for (const part of parts) {
      const [origins, rest] = partition(left, part.q); left = rest
      const dest = successor(c, source, part.q, origins, part.centres, reason)
      transfer(c, source, dest, part.q, record); finish(c, dest, [source]); record.destinations.push(dest.id)
    }
    source.quantityAllocations = [...done, ...left]
    return record
  }
  const entries = list(p.sources, 'merge sources', 20)
  if (entries.length < 2 || new Set(entries.map((x: any) => x.workOrderId)).size !== entries.length) fail('DUPLICATE_WORK', 'Merge at least two distinct jobs, each listed once.')
  const sources = entries.map((x: any) => { const w = get(c.s, 'workOrders', x.workOrderId); fresh(w, x.version); eligible(c, w, true); return w })
  if (sources.some(w => snapshot(w) !== snapshot(sources[0]))) fail('INCOMPATIBLE', 'Merge only the same item, state, pinned revision tree, recipe and routing.')
  const origins = sources.flatMap(w => partition(allocations(w), completed(w))[1]); uniqueOrigins(origins)
  const quantity = sources.reduce((n, w) => n + remaining(w), 0n), dest = successor(c, sources[0], quantity, origins, p.centres, reason)
  dest.requiredBy = sources.map(w => w.requiredBy).sort()[0]
  const record = row(c, 'workTransfers', { kind: 'merge', reason, sourceVersions: sources.map(w => ({ id: w.id, version: w.version })), transfers: [], destinations: [dest.id] })
  for (const source of sources) {
    const [done] = partition(allocations(source), completed(source)), quantity = remaining(source)
    transfer(c, source, dest, quantity, record); source.quantityAllocations = done
  }
  finish(c, dest, sources)
  return record
}
