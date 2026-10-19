// New shipment lines retain their issued unit price and movement identities.
// Older records explicitly expose that their historical commercial terms are absent.
import { decimal, format, min } from './decimal'
import { fail } from './problem'
import { type Movement, type Row, type State } from './model'

export function shipmentPrice(s: State, movement: Movement) {
  const shipment = s.shipments.find(shipment => shipment.id === movement.documentId)
  const exact = shipment?.lines.find((line: any) => line.movementIds?.includes(movement.id))
  const legacy = shipment?.lines.filter((line: any) => !line.movementIds && line.itemId === movement.itemId && line.locationId === movement.locationId) ?? []
  const line = exact ?? (legacy.length === 1 ? legacy[0] : undefined)
  if (line?.unitPrice !== undefined) return { unitPrice: line.unitPrice as string, priceBasis: 'issued shipment price' }
  return fail('HISTORICAL_TERMS', 'The original issued shipment price is missing or cannot be identified. Reconcile the original source document and its historical price before preparing invoice values, returns or corrections.', { shipmentId: shipment?.id, reference: shipment?.reference, movementId: movement.id })

}

export function returnSources(s: State, order: Row, line: any, quantity: bigint) {
  const sources = s.movements.filter(movement => movement.documentKind === 'shipments' && movement.itemId === line.itemId
    && !s.movements.some(reverse => reverse.reversesId === movement.id)
    && s.shipments.some(shipment => shipment.id === movement.documentId && shipment.orderId === order.id && shipment.lines.some((issued: any) => issued.lineId === line.id && (issued.movementIds ? issued.movementIds.includes(movement.id) : issued.locationId === movement.locationId))))
  const prior = s.returns.filter(record => record.orderId === order.id && record.lineId === line.id && record.status !== 'reversed')
  let legacyReturned = prior.filter(record => !record.sources).reduce((total, record) => total + decimal(record.quantity), 0n)
  let left = quantity
  const allocated = []
  for (const movement of sources) {
    const already = prior.flatMap(record => record.sources ?? []).filter((source: any) => source.shipmentMovementId === movement.id && !s.movements.some(reverse => reverse.reversesId === source.returnMovementId))
      .reduce((total: bigint, source: any) => total + decimal(source.quantity), 0n)
    let available = -movement.quantity - already
    const legacy = min(legacyReturned, available); legacyReturned -= legacy; available -= legacy
    const take = min(left, available)
    if (take > 0n) allocated.push({ shipmentMovementId: movement.id, quantity: format(take), unitCost: format(movement.unitCost), ...shipmentPrice(s, movement) })
    left -= take
  }
  if (left) fail('RETURN_SOURCE', 'Recorded shipment sources do not cover this return. Resolve earlier shipment corrections first.')
  return allocated
}
