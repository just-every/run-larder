// This review separates indicative supply allocation from potential shared
// supply. It never claims an SKU match is a dedicated customer commitment.
import { decimal, format, max, times } from './decimal'
import { orderStatuses } from './order-status'
import { pickedQuantity } from './sales-schedules'
import { type Row, type State } from './model'
import { open } from './availability'

export function changeImpact(s: State, order: Row, after: Row) {
  const items = new Set<string>(order.lines.map((line: any) => line.itemId))
  for (const line of after.lines) items.add(line.itemId)
  let expanded = true
  while (expanded) {
    expanded = false
    for (const bom of s.boms) if (items.has(bom.itemId)) for (const line of bom.components) if (!items.has(line.itemId)) { items.add(line.itemId); expanded = true }
  }
  const status = orderStatuses(s).sales.find(entry => entry.id === order.id)
  const allocations = status?.lines.flatMap(line => [...line.supplies, ...(line.ingredients ?? []).flatMap(part => part.supplies)]) ?? []
  const work = s.workOrders.filter(work => items.has(work.itemId)).map(work => {
    const sources = s.movements.filter(movement => movement.documentKind === 'workOrders' && movement.documentId === work.id && movement.kind === 'issue')
    const corrections = s.movements.filter(movement => movement.kind === 'issue-reversal' && sources.some(source => source.id === movement.reversesId))
    const materialCost = [...sources, ...corrections].reduce((total, movement) => total - times(movement.quantity, movement.unitCost), 0n)
    return { id: work.id, reference: work.reference, status: work.status, itemId: work.itemId, quantity: work.quantity, output: work.output,
      relation: allocations.some(source => source.kind === 'work' && source.documentId === work.id) ? 'indicative allocated supply' : 'potential shared supply',
      treatment: 'retained; production changes require separate authorization', incurredMaterialCost: format(materialCost),
      costMovementIds: [...sources, ...corrections].map(movement => movement.id), recordedCost: work.cost ?? null,
      remainingQuantity: format(['draft', 'released'].includes(work.status) ? max(0n, decimal(work.quantity) - decimal(work.output) - decimal(work.scrap)) : 0n) }
  })
  const procurement = s.purchaseOrders.filter(po => po.lines.some((line: any) => items.has(line.itemId))).map(po => ({
    id: po.id, reference: po.reference, status: po.status, supplierId: po.supplierId, expectedDate: po.expectedDate,
    relation: allocations.some(source => source.kind === 'purchase' && source.documentId === po.id) ? 'indicative allocated supply' : 'potential shared supply',
    treatment: 'retained; supplier commitment changes require separate authorization',
    outstandingExposure: format(['draft', 'approved', 'confirmed', 'part received'].includes(po.status) ? po.lines.reduce((total: bigint, line: any) => total + times(max(0n, decimal(line.quantity) - decimal(line.received)), decimal(line.unitPrice)), 0n) : 0n),
    lines: po.lines.filter((line: any) => items.has(line.itemId)),
  }))
  return {
    reservations: s.reservations.filter(reservation => reservation.demandId === order.id).map(reservation => ({ ...reservation, quantity: format(reservation.quantity),
      openAfter: format(open(after.lines.find((line: any) => line.id === reservation.lineId))), treatment: 'retain up to new open quantity; release excess unpicked quantity' })),
    lineBalances: after.lines.map((line: any) => ({ lineId: line.id, itemId: line.itemId, shipped: line.shipped, cancelled: line.cancelled, openAfter: format(open(line)), picked: format(pickedQuantity(s, order.id, line.id)) })),
    shipments: s.shipments.filter(shipment => shipment.orderId === order.id).map(shipment => ({ id: shipment.id, reference: shipment.reference, status: shipment.status,
      commercialTerms: shipment.commercialTerms ?? null, lines: shipment.lines, treatment: 'issued terms and movements retained',
      historicalTerms: shipment.commercialTerms ? 'recorded at picking' : 'legacy shipment has no recorded commercial snapshot' })),
    allocations, work, procurement,
  }
}
