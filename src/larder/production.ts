// Work orders: draft, release (pins the BOM revision and reserves components),
// material issue, output with scrap, and close with cost variance.
import { materialCost } from './production-cost'
import { requiredTypes } from './certificate-policy'
import { engineeringReleaseBom } from './engineering-policy'
import { requireCatalogLot } from './catalog-fields'
import { activeBom } from './bom'
import { resolvedComponents } from './bom-explosion'
import { toBase } from './catalogue'
import { decimal, divide, format, max, min, times } from './decimal'
import { fail } from './problem'
import { allow, approver } from './roles'
import { averageCost, consume, move, release, reserve, reservedQuantity, withdraw } from './stock'
import { lotDates } from './lot-dates'
import { holdReason, workHolds, plansFor } from './quality-holds'
import { bump, date, fresh, get, list, newId, nextReference, optionalText, row, text, type Context, type Row } from './model'

export function draftWork(c: Context, p: any, preparedBy?: string): Row {
  const item = get(c.s, 'items', p.itemId, 'item')
  if (item.kind !== 'make') fail('NOT_MADE', `${item.name} is bought, not made.`)
  return row(c, 'workOrders', {
    reference: nextReference(c.s.workOrders, 'WO'), itemId: item.id, quantity: format(toBase(item, p.quantity, p.unit)), requiredBy: date(p.requiredBy, 'required-by date'),
    reason: text(p.reason, 'reason', 1000), priority: Number.isSafeInteger(p.priority) ? p.priority : 0, plannedStart: p.plannedStart ? date(p.plannedStart, 'planned start') : '',
    status: 'draft', bomId: null, bomRevision: null, components: [], routing: [], output: '0', scrap: '0', standardUnitCost: '0', preparedBy: preparedBy ?? c.actor.id,
  })
}

const component = (w: Row, itemId: unknown) => w.components.find((l: any) => l.itemId === itemId) ?? fail('NOT_IN_BOM', `That item is not a component of ${w.reference}'s pinned revision ${w.bomRevision}.`)

export function production(c: Context, type: string, p: any): Row | undefined {
  switch (type) {
    case 'wo.draft':
      allow(c, ['manager', 'production', 'agent'])
      return draftWork(c, p)
    case 'wo.release': {
      approver(c, ['manager', 'production'])
      const w = get(c.s, 'workOrders', p.workOrderId, 'work order'); fresh(w, p.version)
      approver(c, ['manager', 'production'])
      if (w.status !== 'draft') fail('STATE', 'Only a draft work order can be released.')
      const bom = engineeringReleaseBom(c, w) ?? activeBom(c.s, w.itemId, c.now.slice(0, 10)) ?? fail('NO_BOM', 'Give this item a bill of materials before releasing work.')
      const quantity = decimal(w.quantity)
      const resolved = resolvedComponents(c.s, bom, quantity, c.now.slice(0, 10), w.engineeringBomIds)
      const totals = new Map<string, bigint>()
      for (const l of resolved.components) totals.set(l.itemId, (totals.get(l.itemId) ?? 0n) + decimal(l.quantity))
      const components = [...totals].map(([itemId, required]) => ({ id: newId(), itemId, perUnit: format(divide(required, quantity)), required: format(required), supplyRequirements: resolved.components.filter(l => l.itemId === itemId).map(l => ({ supply: l.supply, quantity: l.quantity })), issued: '0' }))
      const standardUnitCost = divide(components.reduce((n: bigint, l: any) => n + times(decimal(l.required), averageCost(c.s, l.itemId)), 0n), quantity)
      const routing = structuredClone(bom.routing)
      for (const step of routing) if (w.plannedCentres?.[step.sequence]) {
        const center = w.plannedCentres[step.sequence], eligible = step.eligibleCentres?.length ? step.eligibleCentres : [step.workCentre]
        if (!eligible.includes(center)) fail('WORK_CENTER', 'The planned split/merge center is not eligible in the release revision.')
        step.workCentre = center
      }
      bump(w, { status: 'released', bomId: bom.id, bomRevision: bom.revision, bomRevisions: resolved.revisions, components, routing, operationStates: bom.routing.map((r: any) => ({ sequence: r.sequence, status: 'pending', acknowledgments: [] })), standardUnitCost: format(standardUnitCost), releasedBy: c.actor.id, releasedAt: c.now })
      w.shortages = components.map((l: any) => {
        const got = reserve(c, { demandKind: 'work', demandId: w.id, lineId: l.id, itemId: l.itemId }, decimal(l.required))
        return { itemId: l.itemId, short: format(decimal(l.required) - got) }
      }).filter((x: any) => x.short !== '0')
      return w
    }
    case 'wo.reserve': {
      allow(c, ['manager', 'production', 'warehouse'])
      const w = get(c.s, 'workOrders', p.workOrderId, 'work order')
      if (w.status !== 'released') fail('STATE', 'Only released work can reserve materials.')
      w.shortages = w.components.map((l: any) => {
        const wanted = max(0n, decimal(l.required) - decimal(l.issued) - reservedQuantity(c.s, w.id, l.id))
        const got = wanted > 0n ? reserve(c, { demandKind: 'work', demandId: w.id, lineId: l.id, itemId: l.itemId }, wanted) : 0n
        return { itemId: l.itemId, short: format(wanted - got) }
      }).filter((x: any) => x.short !== '0')
      return bump(w, {})
    }
    case 'wo.issue': {
      allow(c, ['manager', 'production', 'warehouse'])
      const w = get(c.s, 'workOrders', p.workOrderId, 'work order')
      if (w.status !== 'released') fail('STATE', 'Issue materials only to released work.')
      for (const l of list(p.lines)) {
        const line = component(w, l.itemId), item = get(c.s, 'items', line.itemId, 'item'), location = get(c.s, 'locations', l.locationId, 'location')
        const q = toBase(item, l.quantity, l.unit)
        const fromReservation = min(q, c.s.reservations.find(r => r.demandId === w.id && r.lineId === line.id && r.locationId === location.id)?.quantity ?? 0n)
        if (fromReservation > 0n) consume(c, w.id, line.id, location.id, fromReservation)
        withdraw(c, { itemId: item.id, locationId: location.id, status: 'available', lotId: l.lotId ? get(c.s, 'lots', l.lotId, 'lot').id : undefined, quantity: -q, kind: 'issue', documentKind: 'workOrders', documentId: w.id, reason: optionalText(l.note, 'note', 200) || `Issued to ${w.reference}` })
        line.issued = format(decimal(line.issued) + q)
      }
      return bump(w, {})
    }
    case 'wo.output': {
      allow(c, ['manager', 'production'])
      const w = get(c.s, 'workOrders', p.workOrderId, 'work order'); fresh(w, p.version)
      if (w.status !== 'released') fail('STATE', 'Record output only on released work.')
      if (w.routing.some((r: any) => r.instructions || r.drawings?.length || r.requiredSkills?.length) && w.routing.some((r: any) => !w.operationStates?.some((t: any) => t.sequence === r.sequence && t.status === 'done'))) fail('OPERATIONS', 'Complete the pinned operations before recording output.')
      const item = get(c.s, 'items', w.itemId, 'item'), good = decimal(p.quantity ?? '0', 'good quantity'), scrap = decimal(p.scrap ?? '0', 'scrap quantity')
      if (good === 0n && scrap === 0n) fail('INPUT', 'Record a good or scrap quantity.')
      const hold = workHolds(c.s, w)[0]
      if (hold) fail('QUALITY_HOLD', `${w.reference} cannot record output. ${holdReason(hold)}`, { holdId: hold.id })
      if (good > 0n && !p.lot && ['in-process', 'final'].some(stage => plansFor(c.s, stage, w.itemId, w.bomRevision).some(plan => plan.required))) fail('INPUT', 'Record a batch lot: required inspections hold this output by lot.', { field: 'lot' })
      if (decimal(w.output) + decimal(w.scrap) + good + scrap > decimal(w.quantity)) fail('OVER_OUTPUT', `${w.reference} is for ${w.quantity} ${item.baseUnit}; this would exceed it. Release more work instead.`)
      if (good > 0n) {
        requireCatalogLot(item, p.lot)
        const controlled = requiredTypes(c.s, item.id).length > 0
        if (controlled) text(p.lot, 'lot required for controlled certificates', 80)
        const location = get(c.s, 'locations', p.locationId, 'location'), code = optionalText(p.lot, 'batch', 80), today = c.now.slice(0, 10)
        const dates = p.dates ? lotDates(p.dates, code, today, today) : {}
        const lot = code ? row(c, 'lots', { itemId: item.id, code, supplierId: null, source: 'production', documentId: w.id, status: controlled ? 'quarantined' : 'released', ...dates }) : null
        move(c, { itemId: item.id, locationId: location.id, status: controlled ? 'quarantine' : 'available', lotId: lot?.id, quantity: good, unitCost: decimal(w.standardUnitCost), kind: 'output', documentKind: 'workOrders', documentId: w.id, reason: `Output of ${w.reference}` })
      }
      w.outputs = [...(w.outputs ?? []), { at: c.now, by: c.actor.id, good: format(good), scrap: format(scrap), scrapReason: scrap > 0n ? text(p.scrapReason, 'scrap reason', 400) : '' }]
      return bump(w, { output: format(decimal(w.output) + good), scrap: format(decimal(w.scrap) + scrap) })
    }
    case 'wo.close': {
      allow(c, ['manager', 'production'])
      const w = get(c.s, 'workOrders', p.workOrderId, 'work order'); fresh(w, p.version)
      if (w.status !== 'released') fail('STATE', 'Only released work can be closed.')
      if (w.routing.some((r: any) => r.instructions || r.drawings?.length || r.requiredSkills?.length) && w.routing.some((r: any) => !w.operationStates?.some((t: any) => t.sequence === r.sequence && t.status === 'done'))) fail('OPERATIONS', 'Complete the pinned operations before closing work.')
      release(c, w.id)
      const actual = materialCost(c.s, w), standard = times(decimal(w.output), decimal(w.standardUnitCost))
      return bump(w, { status: 'closed', closedAt: c.now, cost: { materials: format(actual), standardOutput: format(standard), variance: format(actual - standard), actualUnitCost: format(decimal(w.output) > 0n ? divide(actual, decimal(w.output)) : 0n) } })
    }
  }
}
