// TRACE-002 serial lifecycle. A serial is a lot of exactly one unit of a
// serial-tracked item (`serial: true`). Every physical door moves it through
// move() one unit at a time, so TRACE-001 genealogy, holds, recalls, the trace
// CSV and the archive cover serials without a second ledger.
import { SCALE, format } from './decimal'
import { fail } from './problem'
import { allow } from './roles'
import { date, get, oneOf, row, text, type Context, type Row, type State } from './model'

export const isSerial = (item: Row | undefined) => item?.tracking === 'serial'

// Serial codes compare without case or surrounding space: "sn-01" and "SN-01" are one unit.
const key = (code: unknown) => typeof code === 'string' ? code.trim().toUpperCase() : ''

export const serialLot = (s: State, itemId: string, code: string) => s.lots.find(l => l.itemId === itemId && key(l.code) === key(code))

const onHand = (s: State, lotId: string, locationId?: string, status?: string) =>
  s.movements.reduce((n, m) => m.lotId === lotId && (!locationId || m.locationId === locationId) && (!status || m.status === status) ? n + m.quantity : n, 0n)

// Where one serial is now: in stock somewhere, consumed into work, or with a customer.
export function serialPlace(s: State, lot: Row) {
  const here = s.movements.filter(m => m.lotId === lot.id)
  const stocked = [...new Set(here.map(m => `${m.locationId}|${m.status}`))].find(k => { const [location, status] = k.split('|'); return onHand(s, lot.id, location, status) > 0n })
  if (stocked) { const [locationId, status] = stocked.split('|'); return { state: status === 'available' ? 'in stock' : 'quarantine', locationId, documentKind: '', documentId: '', reference: '', customerId: '' } }
  const last = here.filter(m => m.quantity < 0n && !s.movements.some(r => r.reversesId === m.id)).at(-1)
  const shipment = last?.documentKind === 'shipments' ? s.shipments.find(x => x.id === last.documentId) : undefined
  const work = last?.documentKind === 'workOrders' ? s.workOrders.find(x => x.id === last.documentId) : undefined
  const customerId = shipment ? s.salesOrders.find(o => o.id === shipment.orderId)?.customerId ?? '' : ''
  return { state: shipment ? 'shipped' : work ? 'assembled' : last ? last.kind : 'not received', locationId: '', documentKind: last?.documentKind ?? '', documentId: last?.documentId ?? '', reference: shipment?.reference ?? work?.reference ?? '', customerId }
}

const placeText = (s: State, lot: Row) => {
  const p = serialPlace(s, lot)
  if (p.state === 'shipped') return `shipped on ${p.reference} to ${s.parties.find(x => x.id === p.customerId)?.name ?? 'a customer'}`
  if (p.state === 'assembled') return `issued to ${p.reference}`
  if (p.locationId) return `${p.state} at ${s.locations.find(l => l.id === p.locationId)?.name ?? 'a location'}`
  return p.state
}

function codes(raw: unknown, item: Row): string[] {
  const listed = typeof raw === 'string' ? raw.split(/[\n,]/) : raw
  const out = Array.isArray(listed) ? listed.filter(v => typeof v !== 'string' || v.trim() !== '') : []
  if (!out.length || out.length > 500) fail('SERIAL_REQUIRED', `${item.name} is serial-tracked: list one serial per unit.`, { itemId: item.id, field: 'serials' })
  const serials = out.map(v => text(v, 'serial', 80)), seen = new Set<string>()
  for (const code of serials) { if (seen.has(key(code))) fail('DUPLICATE_SERIAL', `Serial ${code} is listed twice.`, { serial: code }); seen.add(key(code)) }
  return serials
}

function oneEach(item: Row, serials: string[], quantity: bigint) {
  if (BigInt(serials.length) * SCALE !== quantity) fail('SERIAL_QUANTITY', `${item.name} is serial-tracked: ${format(quantity)} ${item.baseUnit} needs one serial per whole unit, and ${serials.length} ${serials.length === 1 ? 'is' : 'are'} listed.`, { itemId: item.id, quantity: format(quantity), serials: serials.length })
}

// New units at a receipt or output: unique, and never a code this item used before.
export function newSerials(s: State, item: Row, raw: unknown, quantity: bigint): string[] {
  const serials = codes(raw, item); oneEach(item, serials, quantity)
  for (const code of serials) { const used = serialLot(s, item.id, code); if (used) fail('DUPLICATE_SERIAL', `Serial ${code} of ${item.name} already exists (${placeText(s, used)}).`, { serial: code, lotId: used.id }) }
  return serials
}

// Existing units a door takes from one location (issue, pick): each must be there now.
export function stockSerials(s: State, item: Row, raw: unknown, quantity: bigint, locationId: string, status = 'available'): Row[] {
  const serials = codes(raw, item); oneEach(item, serials, quantity)
  return serials.map(code => {
    const lot = serialLot(s, item.id, code) ?? fail('NOT_FOUND', `Serial ${code} of ${item.name} was not found.`, { serial: code })
    if (onHand(s, lot.id, locationId, status) !== SCALE) {
      const place = serialPlace(s, lot)
      fail(place.state === 'shipped' ? 'SERIAL_SHIPPED' : 'SERIAL_NOT_IN_STOCK', `Serial ${code} cannot be used: it is ${placeText(s, lot)}.`, { serial: code, lotId: lot.id, state: place.state, reference: place.reference })
    }
    return lot
  })
}

// Shipped units coming back on one order line: each must have left on that line.
export function returnedSerials(s: State, item: Row, raw: unknown, quantity: bigint, shippedLotIds: string[]): string[] {
  const serials = codes(raw, item); oneEach(item, serials, quantity)
  return serials.map(code => {
    const shipped = serialLot(s, item.id, code), lot = shipped && shippedLotIds.includes(shipped.id) ? shipped : fail('SERIAL_NOT_SHIPPED', `Serial ${code} was not shipped on this order line.`, { serial: code })
    if (onHand(s, lot.id) !== 0n) fail('DUPLICATE_SERIAL', `Serial ${code} is already back in stock (${placeText(s, lot)}).`, { serial: code, lotId: lot.id })
    return lot.id
  })
}

// The guard every physical door passes through (move()): a serial item moves
// only as a named serial, one unit at a time, and never twice into stock. A
// door that cannot name serials refuses instead of creating untracked stock.
export function requireSerialUnit(s: State, item: Row, lotId: string, quantity: bigint) {
  if (!isSerial(item)) return
  const named = s.lots.find(l => l.id === lotId), lot = named?.serial && named.itemId === item.id ? named : fail('SERIAL_REQUIRED', `${item.name} is serial-tracked: name the serial of every unit.`, { itemId: item.id })
  if (quantity !== SCALE && quantity !== -SCALE) fail('SERIAL_QUANTITY', `Serial ${lot.code} is one unit; move it one unit at a time.`, { lotId: lot.id })
  if (quantity > 0n && onHand(s, lot.id) !== 0n) fail('DUPLICATE_SERIAL', `Serial ${lot.code} is already ${placeText(s, lot)}.`, { lotId: lot.id })
}

export const serviceKinds = ['service', 'warranty repair', 'inspection'] as const

export function serials(c: Context, type: string, p: any): Row | undefined {
  if (type !== 'serial.service') return
  allow(c, ['manager', 'production', 'warehouse', 'quality'])
  const item = get(c.s, 'items', p.itemId, 'item')
  if (!isSerial(item)) fail('INPUT', `${item.name} is not serial-tracked.`, { field: 'itemId' })
  const lot = serialLot(c.s, item.id, text(p.serial, 'serial', 80)) ?? fail('NOT_FOUND', `Serial ${p.serial} of ${item.name} was not found.`, { field: 'serial' })
  const place = serialPlace(c.s, lot)
  return row(c, 'serialEvents', { itemId: item.id, lotId: lot.id, serial: lot.code, kind: oneOf(p.kind, serviceKinds, 'service kind'), on: date(p.on, 'service date'), note: text(p.note, 'service note', 1000), customerId: place.customerId || null, state: place.state })
}

// One serial's searchable history: where it came from, the exact components in
// it, what it went into, every customer it reached and every service record.
export function serialHistory(s: State, lot: Row) {
  const item = s.items.find(i => i.id === lot.itemId)
  const name = (collection: 'parties' | 'locations', id: string) => s[collection].find(r => r.id === id)?.name ?? ''
  const outputs = s.workOrders.flatMap(w => (w.outputs ?? []).map((b: any) => ({ w, b })))
  const made = outputs.find(({ b }) => b.lotId === lot.id)
  const receipt = lot.source === 'receipt' ? s.receipts.find(r => r.id === lot.documentId) : undefined
  const serialOf = (lotId: string) => s.lots.find(l => l.id === lotId)
  const component = (a: any) => ({ lotId: a.lotId, serial: serialOf(a.lotId)?.serial ? serialOf(a.lotId)!.code : '', lot: serialOf(a.lotId)?.code ?? '', itemId: a.itemId, item: s.items.find(i => i.id === a.itemId)?.name ?? '', quantity: a.quantity })
  const into = outputs.filter(({ b }) => (b.allocations ?? []).some((a: any) => a.lotId === lot.id)).map(({ w, b }) => ({ lotId: b.lotId, serial: serialOf(b.lotId)?.code ?? '', itemId: w.itemId, item: s.items.find(i => i.id === w.itemId)?.name ?? '', workOrderId: w.id, reference: w.reference, at: b.at }))
  const movements = s.movements.filter(m => m.lotId === lot.id)
  const customers = movements.filter(m => m.documentKind === 'shipments' && m.quantity < 0n).map(m => {
    const shipment = s.shipments.find(x => x.id === m.documentId)!, order = s.salesOrders.find(o => o.id === shipment.orderId)!
    return { shipmentId: shipment.id, shipment: shipment.reference, orderId: order.id, order: order.reference, customerId: order.customerId, customer: name('parties', order.customerId), shippedAt: shipment.shippedAt ?? m.createdAt, carrier: shipment.carrier ?? '', tracking: shipment.tracking ?? '', reversed: s.movements.some(r => r.reversesId === m.id) }
  })
  const returns = s.returns.filter(r => (r.sources ?? []).some((x: any) => movements.some(m => m.id === x.returnMovementId))).map(r => ({ returnId: r.id, reference: r.reference, orderId: r.orderId, at: r.createdAt, disposition: r.disposition, reason: r.reason }))
  const place = serialPlace(s, lot)
  return {
    lotId: lot.id, serial: lot.code, itemId: lot.itemId, item: item?.name ?? '', sku: item?.sku ?? '',
    place: { ...place, location: name('locations', place.locationId), customer: name('parties', place.customerId) },
    origin: made ? { kind: 'output', workOrderId: made.w.id, reference: made.w.reference, at: made.b.at } : receipt ? { kind: 'receipt', receiptId: receipt.id, reference: receipt.reference, supplierId: lot.supplierId, supplier: name('parties', lot.supplierId), at: receipt.createdAt } : { kind: lot.source ?? '', at: lot.createdAt },
    components: (made?.b.allocations ?? []).map(component), into, customers, returns,
    service: s.serialEvents.filter(e => e.lotId === lot.id).map((e: Row) => ({ id: e.id, kind: e.kind, on: e.on, note: e.note, by: e.createdBy, customer: name('parties', e.customerId ?? ''), state: e.state })),
    movements: movements.map(m => ({ id: m.id, at: m.createdAt, kind: m.kind, quantity: format(m.quantity), status: m.status, locationId: m.locationId, location: name('locations', m.locationId), documentKind: m.documentKind, documentId: m.documentId, reversesId: m.reversesId })),
  }
}

// Search serials by code (whole or part), optionally within one item.
export function serialSearch(s: State, q: string, itemId = '') {
  const want = key(q)
  if (!want) fail('INPUT', 'Enter a serial to search for.', { field: 'q' })
  return s.lots.filter(l => l.serial && (!itemId || l.itemId === itemId) && key(l.code).includes(want)).slice(0, 50).map(l => serialHistory(s, l))
}
