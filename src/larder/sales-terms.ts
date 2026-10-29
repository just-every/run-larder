// New shipment lines retain their issued unit price and movement identities.
// Older records explicitly expose that their historical commercial terms are absent.
import { decimal, format, min, times } from './decimal'
import { fail } from './problem'
import { type Movement, type Row, type State } from './model'

export function shipmentPrice(s: State, movement: Movement) {
  const shipment = s.shipments.find(shipment => shipment.id === movement.documentId)
  const exact = shipment?.lines.find((line: any) => line.movementIds?.includes(movement.id))
  const legacy = shipment?.lines.filter((line: any) => !line.movementIds && line.itemId === movement.itemId && line.locationId === movement.locationId) ?? []
  const line = exact ?? (legacy.length === 1 ? legacy[0] : undefined)
  if (line?.unitPrice !== undefined) return { unitPrice: line.unitPrice as string, priceBasis: 'issued shipment price',
    amount: line.deliveryMovements?.find((entry: any) => entry.movementId === movement.id)?.usdAmount as string | undefined }
  return fail('HISTORICAL_TERMS', 'The original issued shipment price is missing or cannot be identified. Reconcile the original source document and its historical price before preparing invoice values, returns or corrections.', { shipmentId: shipment?.id, reference: shipment?.reference, movementId: movement.id })

}

// Allocate an exact cent extension by cumulative quantity. Rounding the
// difference of cumulative values keeps split shipments and lots reconciled.
export function allocatedUsd(amount: string, quantity: string, before: bigint, take: bigint) {
  const total = decimal(amount), whole = decimal(quantity, 'valued quantity', { positive: true })
  const through = (q: bigint) => ((total * q + whole * 5000n) / (whole * 10000n)) * 10000n
  return through(before + take) - through(before)
}

export function shipmentRevenue(s: State, movement: Movement) {
  const terms = shipmentPrice(s, movement)
  return terms.amount === undefined ? times(-movement.quantity, decimal(terms.unitPrice)) : decimal(terms.amount)
}

// The unreversed shipment movements of one order line.
export const shipmentSources = (s: State, order: Row, line: any) => s.movements.filter(movement => movement.documentKind === 'shipments' && movement.itemId === line.itemId
    && !s.movements.some(reverse => reverse.reversesId === movement.id)
    && s.shipments.some(shipment => shipment.id === movement.documentId && shipment.orderId === order.id && shipment.lines.some((issued: any) => issued.lineId === line.id && (issued.movementIds ? issued.movementIds.includes(movement.id) : issued.locationId === movement.locationId))))

// A serial return names its lots, so only those shipment movements come back.
export function returnSources(s: State, order: Row, line: any, quantity: bigint, lotIds?: string[]) {
  const sources = shipmentSources(s, order, line).filter(movement => !lotIds || lotIds.includes(movement.lotId))
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
    if (take > 0n) {
      const terms = shipmentPrice(s, movement)
      allocated.push({ shipmentMovementId: movement.id, quantity: format(take), unitCost: format(movement.unitCost), ...terms,
        ...(terms.amount === undefined ? {} : { amount: format(allocatedUsd(terms.amount, format(-movement.quantity), already + legacy, take)) }) })
    }
    left -= take
  }
  if (left) fail('RETURN_SOURCE', 'Recorded shipment sources do not cover this return. Resolve earlier shipment corrections first.')
  return allocated
}
