// Quotes, confirmed orders, atomic reservation, pick/pack/ship and cancellation.
import { open } from './availability'
import { toBase } from './catalogue'
import { decimal, format, max } from './decimal'
import { fail } from './problem'
import { allow } from './roles'
import { consume, release, reserve, reservedQuantity, withdraw } from './stock'
import { bump, date, fresh, get, list, newId, nextReference, optionalText, row, text, type Context, type Row, type State } from './model'

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
  return row(c, 'salesOrders', { reference: nextReference(c.s.salesOrders, 'SO'), customerId: customer.id, customerReference: optionalText(p.customerReference, 'customer reference', 120), promiseDate: date(p.promiseDate, 'promise date'), note: optionalText(p.note, 'note', 1000), lines: quoteLines(c, p.lines), status: 'quote', preparedBy: preparedBy ?? c.actor.id })
}

const lineOf = (order: Row, lineId: unknown) => order.lines.find((l: any) => l.id === lineId) ?? fail('NOT_FOUND', 'That order line was not found.')

function reserveOrder(c: Context, order: Row, locationId?: string) {
  return order.lines.map((l: any) => {
    const wanted = max(0n, open(l) - reservedQuantity(c.s, order.id, l.id))
    const got = wanted > 0n ? reserve(c, { demandKind: 'sales', demandId: order.id, lineId: l.id, itemId: l.itemId }, wanted, locationId) : 0n
    return { lineId: l.id, reserved: format(reservedQuantity(c.s, order.id, l.id)), short: format(wanted - got) }
  })
}

const pickedOpen = (s: State, orderId: string, lineId: string, locationId: string) =>
  s.shipments.filter(x => x.orderId === orderId && x.status !== 'shipped' && x.status !== 'reversed').flatMap(x => x.lines)
    .filter((l: any) => l.lineId === lineId && l.locationId === locationId).reduce((n: bigint, l: any) => n + decimal(l.quantity), 0n)

export function sales(c: Context, type: string, p: any): Row | undefined {
  switch (type) {
    case 'so.quote': {
      allow(c, ['manager', 'sales'])
      if (!p.orderId) return createQuote(c, p)
      const order = get(c.s, 'salesOrders', p.orderId, 'order'); fresh(order, p.version)
      if (order.status !== 'quote') fail('STATE', 'Only a quote can be edited. Confirmed orders change by cancellation or a new order.')
      return bump(order, { customerReference: optionalText(p.customerReference, 'customer reference', 120), promiseDate: date(p.promiseDate, 'promise date'), note: optionalText(p.note, 'note', 1000), lines: quoteLines(c, p.lines) })
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
      line.cancelled = format(decimal(line.cancelled) + q)
      const excess = reservedQuantity(c.s, order.id, line.id) - open(line)
      if (excess > 0n) {
        // Release the excess from the last reserved locations first.
        let left = excess
        for (const r of [...c.s.reservations].reverse()) if (left > 0n && r.demandId === order.id && r.lineId === line.id) {
          const take = r.quantity < left ? r.quantity : left
          r.quantity -= take; left -= take
        }
        c.s.reservations = c.s.reservations.filter(r => r.quantity > 0n)
      }
      if (order.lines.every((l: any) => open(l) === 0n)) { release(c, order.id); order.status = order.lines.some((l: any) => decimal(l.shipped) > 0n) ? 'shipped' : 'cancelled' }
      return bump(order, {})
    }
    case 'shipment.pick': {
      allow(c, ['manager', 'warehouse'])
      const order = get(c.s, 'salesOrders', p.orderId, 'order')
      if (!['confirmed', 'part shipped'].includes(order.status)) fail('STATE', 'Only a confirmed order can be picked.')
      const lines = list(p.lines).map((l: any) => {
        const line = lineOf(order, l.lineId), item = get(c.s, 'items', line.itemId, 'item'), location = get(c.s, 'locations', l.locationId, 'location')
        const q = toBase(item, l.quantity, l.unit)
        const reservedHere = c.s.reservations.find(r => r.demandId === order.id && r.lineId === line.id && r.locationId === location.id)?.quantity ?? 0n
        if (pickedOpen(c.s, order.id, line.id, location.id) + q > reservedHere) fail('NOT_RESERVED', `Only ${format(reservedHere - pickedOpen(c.s, order.id, line.id, location.id))} ${item.baseUnit} of ${item.name} is reserved at ${location.name} and not yet picked.`)
        return { lineId: line.id, itemId: item.id, locationId: location.id, lotId: l.lotId ? get(c.s, 'lots', l.lotId, 'lot').id : '', quantity: format(q) }
      })
      return row(c, 'shipments', { reference: nextReference(c.s.shipments, 'SH'), orderId: order.id, lines, status: 'picked', packages: 0, weightKg: '0', carrier: '', tracking: '' })
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
        consume(c, order.id, l.lineId, l.locationId, q)
        withdraw(c, { itemId: l.itemId, locationId: l.locationId, status: 'available', lotId: l.lotId, quantity: -q, kind: 'shipment', documentKind: 'shipments', documentId: shipment.id, reason: `Shipped on ${order.reference}` })
        line.shipped = format(decimal(line.shipped) + q)
      }
      order.status = order.lines.every((l: any) => open(l) === 0n) ? 'shipped' : 'part shipped'
      bump(order, {})
      return bump(shipment, { status: 'shipped', carrier: text(p.carrier, 'carrier', 120), tracking: optionalText(p.tracking, 'tracking', 120), shippedAt: c.now, shippedBy: c.actor.id })
    }
  }
}
