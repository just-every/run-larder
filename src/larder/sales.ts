// Quotes, confirmed orders, atomic reservation, pick/pack/ship and cancellation.
import { assertLotNotHeld } from './quality'
import { approvedCertificates } from './certificate-policy'
import { open } from './availability'
import { customerAttestation, trimOrderReservations } from './order-changes'
import { commercialSnapshot, pickedQuantity, refreshPromise, removeDeliveries } from './sales-schedules'
import { toBase } from './catalogue'
import { decimal, format, max } from './decimal'
import { fail } from './problem'
import { allow } from './roles'
import { consume, release, reserve, reservedQuantity, withdraw } from './stock'
import { dated, pickLots, shipBlock } from './lot-dates'
import { bump, date, fresh, get, list, newId, nextReference, optionalText, row, text, type Context, type Row } from './model'

export function quoteLines(c: Context, lines: unknown) {
  return list(lines).map((line: any) => {
    const item = get(c.s, 'items', line.itemId, 'item')
    if (item.archived) fail('ARCHIVED', `${item.name} is archived and cannot be sold.`)
    return { id: newId(), itemId: item.id, quantity: format(toBase(item, line.quantity, line.unit)), unitPrice: format(decimal(line.unitPrice ?? item.salePrice, 'unit price')), shipped: '0', returned: '0', cancelled: '0' }
  })
}

export function createQuote(c: Context, p: any, preparedBy?: string): Row {
  const customer = get(c.s, 'parties', p.customerId, 'customer')
  if (customer.kind === 'supplier') fail('INPUT', `${customer.name} is set up as a supplier only.`)
  return row(c, 'salesOrders', { reference: nextReference(c.s.salesOrders, 'SO'), customerId: customer.id, customerReference: optionalText(p.customerReference, 'customer reference', 120), promiseDate: date(p.promiseDate, 'promise date'), note: optionalText(p.note, 'note', 1000), billingAddress: optionalText(p.billingAddress, 'billing address', 2000), shippingAddress: optionalText(p.shippingAddress, 'shipping address', 2000), lines: quoteLines(c, p.lines), status: 'quote', preparedBy: preparedBy ?? c.actor.id })
}

const lineOf = (order: Row, lineId: unknown) => order.lines.find((l: any) => l.id === lineId) ?? fail('NOT_FOUND', 'That order line was not found.')

function reserveOrder(c: Context, order: Row, locationId?: string) {
  return order.lines.map((l: any) => {
    const wanted = max(0n, open(l) - reservedQuantity(c.s, order.id, l.id))
    const got = wanted > 0n ? reserve(c, { demandKind: 'sales', demandId: order.id, lineId: l.id, itemId: l.itemId }, wanted, locationId) : 0n
    return { lineId: l.id, reserved: format(reservedQuantity(c.s, order.id, l.id)), short: format(wanted - got) }
  })
}


export function sales(c: Context, type: string, p: any): Row | undefined {
  switch (type) {
    case 'so.quote': {
      allow(c, ['manager', 'sales'])
      if (!p.orderId) return createQuote(c, p)
      const order = get(c.s, 'salesOrders', p.orderId, 'order'); fresh(order, p.version)
      if (order.status !== 'quote') fail('STATE', 'Only a quote can be edited here. Prepare a reviewed amendment for a confirmed order.')
      return bump(order, { customerReference: optionalText(p.customerReference, 'customer reference', 120), promiseDate: date(p.promiseDate, 'promise date'), note: optionalText(p.note, 'note', 1000), billingAddress: p.billingAddress === undefined ? order.billingAddress ?? '' : optionalText(p.billingAddress, 'billing address', 2000), shippingAddress: p.shippingAddress === undefined ? order.shippingAddress ?? '' : optionalText(p.shippingAddress, 'shipping address', 2000), lines: quoteLines(c, p.lines) })
    }
    case 'so.confirm': {
      allow(c, ['manager', 'sales'])
      const order = get(c.s, 'salesOrders', p.orderId, 'order'); fresh(order, p.version)
      if (order.status !== 'quote') fail('STATE', 'Only a quote can be confirmed.')
      bump(order, { status: 'confirmed', confirmedBy: c.actor.id, confirmedAt: c.now })
      if (p.reserve !== false) order.reservation = reserveOrder(c, order)
      return order
    }
    case 'so.reserve': {
      allow(c, ['manager', 'sales', 'warehouse'])
      const order = get(c.s, 'salesOrders', p.orderId, 'order')
      if (!['confirmed', 'part shipped'].includes(order.status)) fail('STATE', 'Confirm the order before reserving stock.')
      const result = reserveOrder(c, order, p.locationId || undefined)
      bump(order, { reservation: result })
      return order
    }
    case 'so.cancelLine': {
      allow(c, ['manager', 'sales'])
      const order = get(c.s, 'salesOrders', p.orderId, 'order'); fresh(order, p.version)
      const line = lineOf(order, p.lineId), item = get(c.s, 'items', line.itemId, 'item'), q = toBase(item, p.quantity, p.unit)
      if (q > open(line)) fail('INPUT', `Only ${format(open(line))} ${item.baseUnit} is still open on this line.`)
      if (!['confirmed', 'part shipped'].includes(order.status)) fail('STATE', 'Cancel only open confirmed work.')
      if (open(line) - q < pickedQuantity(c.s, order.id, line.id)) fail('PICKED_COMMITMENT', 'Undo the picked or packed shipment before cancelling its quantity.')
      const before = commercialSnapshot(order), customerApproval = customerAttestation(c, p.customerApproval)
      removeDeliveries(order, line, q, true)
      line.cancelled = format(decimal(line.cancelled) + q)
      trimOrderReservations(c, order)
      refreshPromise(order)
      if (order.lines.every((l: any) => open(l) === 0n)) { release(c, order.id); order.status = order.lines.some((l: any) => decimal(l.shipped) > 0n) ? 'shipped' : 'cancelled' }
      bump(order, { commercialRevision: (order.commercialRevision ?? 1) + 1 })
      order.changeHistory = [...(order.changeHistory ?? []), { kind: 'line cancellation', before, after: commercialSnapshot(order), by: c.actor.id, at: c.now, reason: optionalText(p.reason, 'cancellation reason', 1000), customerApproval }]
      return order
    }
    case 'shipment.pick': {
      allow(c, ['manager', 'warehouse'])
      const order = get(c.s, 'salesOrders', p.orderId, 'order')
      if (!['confirmed', 'part shipped'].includes(order.status)) fail('STATE', 'Only a confirmed order can be picked.')
      const selecting = new Map<string, bigint>()
      const lines = list(p.lines).flatMap((l: any) => {
        const line = lineOf(order, l.lineId), item = get(c.s, 'items', line.itemId, 'item'), location = get(c.s, 'locations', l.locationId, 'location')
        const q = toBase(item, l.quantity, l.unit)
        const reservedHere = c.s.reservations.find(r => r.demandId === order.id && r.lineId === line.id && r.locationId === location.id)?.quantity ?? 0n
        const selectionKey = `${line.id}:${location.id}`, selected = selecting.get(selectionKey) ?? 0n
        if (pickedQuantity(c.s, order.id, line.id, location.id) + selected + q > reservedHere) fail('NOT_RESERVED', `Only ${format(reservedHere - pickedQuantity(c.s, order.id, line.id, location.id))} ${item.baseUnit} of ${item.name} is reserved at ${location.name} and not yet picked.`)
        selecting.set(selectionKey, selected + q)
        const promisedSchedules = commercialSnapshot(order).lines.find((snapshot: any) => snapshot.id === line.id)?.schedules
        if (l.lotId) assertLotNotHeld(c.s, get(c.s, 'lots', l.lotId, 'lot').id, 'picked')
        return pickLots(c, order, item.id, location.id, q, l.lotId ? get(c.s, 'lots', l.lotId, 'lot').id : '').map(x => ({ lineId: line.id, itemId: item.id, unitPrice: line.unitPrice, promisedSchedules, locationId: location.id, lotId: x.lotId, quantity: format(x.quantity) }))
      })
      return row(c, 'shipments', { reference: nextReference(c.s.shipments, 'SH'), orderId: order.id, lines, commercialTerms: { billingAddress: order.billingAddress ?? '', shippingAddress: order.shippingAddress ?? '', customerReference: order.customerReference, promiseDate: order.promiseDate, commercialRevision: order.commercialRevision ?? 1, orderVersion: order.version, recordedAt: c.now }, status: 'picked', packages: 0, weightKg: '0', carrier: '', tracking: '' })
    }
    case 'shipment.unpick': {
      allow(c, ['manager', 'warehouse'])
      const shipment = get(c.s, 'shipments', p.shipmentId, 'shipment'); fresh(shipment, p.version)
      if (!['picked', 'packed'].includes(shipment.status)) fail('STATE', 'Only an unshipped pick can be undone.')
      return bump(shipment, { status: 'cancelled', unpickedBy: c.actor.id, unpickedAt: c.now, unpickReason: text(p.reason, 'unpick reason', 400) })
    }
    case 'shipment.pack': {
      allow(c, ['manager', 'warehouse'])
      const shipment = get(c.s, 'shipments', p.shipmentId, 'shipment'); fresh(shipment, p.version)
      if (shipment.status !== 'picked') fail('STATE', 'Only a picked shipment can be packed.')
      if (!Number.isSafeInteger(p.packages) || p.packages < 1 || p.packages > 999) fail('INPUT', 'Packages must be between 1 and 999.')
      return bump(shipment, { status: 'packed', packages: p.packages, weightKg: format(decimal(p.weightKg ?? '0', 'weight')) })
    }
    case 'shipment.ship': {
      allow(c, ['manager', 'warehouse'])
      const shipment = get(c.s, 'shipments', p.shipmentId, 'shipment'); fresh(shipment, p.version)
      if (shipment.status !== 'packed') fail('STATE', 'Pack the shipment before shipping it.')
      const order = get(c.s, 'salesOrders', shipment.orderId, 'order')
      for (const l of shipment.lines) {
        const q = decimal(l.quantity), line = lineOf(order, l.lineId)
        assertLotNotHeld(c.s, l.lotId, `shipped on ${shipment.reference}`)
        const shelf = dated(c.s, l.itemId, order.customerId) ? shipBlock(c.s, l.lotId, c.now.slice(0, 10), order.customerId) : ''
        if (shelf) fail('FEFO_INELIGIBLE', `${shipment.reference} cannot ship lot ${c.s.lots.find(lot => lot.id === l.lotId)?.code ?? 'unlotted'}: ${shelf}. Undo the pick and pick an eligible lot.`, { lotId: l.lotId })
        consume(c, order.id, l.lineId, l.locationId, q)
        const movements = withdraw(c, { itemId: l.itemId, locationId: l.locationId, status: 'available', lotId: l.lotId, quantity: -q, kind: 'shipment', documentKind: 'shipments', documentId: shipment.id, reason: `Shipped on ${order.reference}` })
        l.certificates = movements.map(m => ({ movementId: m.id, itemId: m.itemId, lotId: m.lotId, lot: c.s.lots.find(lot => lot.id === m.lotId)?.code ?? '', sku: get(c.s, 'items', m.itemId).sku, quantity: format(-m.quantity), documents: structuredClone(approvedCertificates(c.s, m.itemId, m.lotId, c.now.slice(0, 10), order.customerId)) }))
        l.movementIds = movements.map(movement => movement.id)
        l.deliveryMovements = movements.map(movement => ({ movementId: movement.id, schedules: removeDeliveries(order, line, -movement.quantity) }))
        l.deliveries = l.deliveryMovements.flatMap((delivery: any) => delivery.schedules)
        line.shipped = format(decimal(line.shipped) + q)
      }
      refreshPromise(order)
      order.status = order.lines.every((l: any) => open(l) === 0n) ? 'shipped' : 'part shipped'
      bump(order, {})
      return bump(shipment, { status: 'shipped', carrier: text(p.carrier, 'carrier', 120), tracking: optionalText(p.tracking, 'tracking', 120), shippedAt: c.now, shippedBy: c.actor.id })
    }
  }
}
