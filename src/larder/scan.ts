// FLOOR-008 scan door: a code from a USB, Bluetooth or camera scanner resolves to
// the item, bin, job, order, lot or serial it names. Within a receipt, issue or
// pick the wrong item, a held lot and a stale (expired, used or closed) code are
// refused with a reason the person can act on. Resolving never moves stock.
import { isGs1, parseGs1, type Gs1 } from './gs1'
import { lotBlock } from './lot-dates'
import { assertLotNotHeld } from './quality'
import { serialPlace } from './serials'
import { decimal } from './decimal'
import { fail } from './problem'
import { get, oneOf, type Row, type State } from './model'

export const scanUses = ['receipt', 'issue', 'pick', 'transfer', 'output'] as const
type Use = 'receipt' | 'issue' | 'pick'

const norm = (v: unknown) => typeof v === 'string' ? v.trim().toUpperCase() : ''
// UPC-A, EAN-13 and GTIN-14 name the same product once padded to 14 digits.
const gtin14 = (v: unknown) => typeof v === 'string' && /^\d{8,14}$/.test(v.trim()) ? v.trim().padStart(14, '0') : ''
const brief = (i: Row) => ({ id: i.id, sku: i.sku, name: i.name, tracking: i.tracking ?? 'none' })

function documentFor(s: State, use: Use, id: unknown) {
  if (use === 'receipt') {
    const po = get(s, 'purchaseOrders', id, 'purchase order')
    if (!['approved', 'confirmed', 'part received'].includes(po.status)) fail('SCAN_STALE', `${po.reference} is ${po.status}; nothing is still expected on it.`, { documentId: po.id })
    return { doc: po, lines: po.lines.filter((l: any) => decimal(l.received) < decimal(l.quantity)), name: 'expected on' }
  }
  if (use === 'issue') {
    const w = get(s, 'workOrders', id, 'work order')
    if (w.status !== 'released') fail('SCAN_STALE', `${w.reference} is ${w.status}; issue only to released work.`, { documentId: w.id })
    return { doc: w, lines: w.components, name: 'a component of' }
  }
  const order = get(s, 'salesOrders', id, 'order')
  if (!['confirmed', 'part shipped'].includes(order.status)) fail('SCAN_STALE', `${order.reference} is ${order.status}; pick only a confirmed order.`, { documentId: order.id })
  return { doc: order, lines: order.lines.filter((l: any) => decimal(l.quantity) - decimal(l.shipped) - decimal(l.cancelled ?? '0') > 0n), name: 'open on' }
}

// The lot or serial a person takes from stock must be usable now.
function usable(s: State, lot: Row, today: string, action: string) {
  if (lot.serial) {
    const place = serialPlace(s, lot)
    if (place.state !== 'in stock') fail(place.state === 'quarantine' ? 'SCAN_HELD' : 'SCAN_STALE', `Serial ${lot.code} is ${place.state === 'shipped' ? `shipped on ${place.reference}` : place.state === 'assembled' ? `issued to ${place.reference}` : place.state}; scan a serial in stock.`, { lotId: lot.id })
  }
  assertLotNotHeld(s, lot.id, action)
  const block = lotBlock(lot, today)
  if (block) fail('SCAN_STALE', `Lot ${lot.code} ${block}; an owner or manager records its disposition first.`, { lotId: lot.id })
  const available = s.movements.reduce((n, m) => m.lotId === lot.id && m.status === 'available' ? n + m.quantity : n, 0n)
  const held = s.movements.reduce((n, m) => m.lotId === lot.id && m.status === 'quarantine' ? n + m.quantity : n, 0n)
  if (available <= 0n && held > 0n) fail('SCAN_HELD', `Lot ${lot.code} is in quarantine; release it before using it.`, { lotId: lot.id })
  if (available <= 0n) fail('SCAN_STALE', `Lot ${lot.code} has no stock left; scan another lot.`, { lotId: lot.id })
}

export function resolveScan(s: State, raw: unknown, use: unknown, documentId: unknown, today: string) {
  const code = typeof raw === 'string' ? raw.replace(/[\r\n]+$/, '') : ''
  if (!code.trim() || code.length > 200) fail('SCAN_UNKNOWN', 'Scan or type a code.', { field: 'code' })
  const gs1: Gs1 | null = isGs1(code) ? parseGs1(code, today) : null
  let item: Row | undefined, lot: Row | undefined
  if (gs1) {
    if (!gs1.gtin) fail('SCAN_UNKNOWN', 'This GS1 code names no product (01).', { code })
    item = s.items.find(i => !i.archived && gtin14(i.barcode) === gs1.gtin) ?? fail('SCAN_UNKNOWN', `No item has GTIN ${gs1.gtin}; record it as the item's barcode.`, { gtin: gs1.gtin })
    const named = gs1.serial ?? gs1.lot
    if (named) lot = s.lots.find(l => l.itemId === item!.id && norm(l.code) === norm(named))
  } else {
    const k = norm(code), digits = gtin14(code)
    item = s.items.find(i => !i.archived && (norm(i.sku) === k || norm(i.barcode) === k || (digits !== '' && gtin14(i.barcode) === digits)))
    if (!item && !use) {
      const location = s.locations.find(l => !l.archived && norm(l.name) === k)
      if (location) return { code, kind: 'location', location: { id: location.id, name: location.name } }
      for (const [collection, kind] of [['workOrders', 'workOrder'], ['salesOrders', 'salesOrder'], ['purchaseOrders', 'purchaseOrder']] as const) {
        const doc = s[collection].find(d => norm(d.reference) === k)
        if (doc) return { code, kind, document: { id: doc.id, reference: doc.reference, status: doc.status } }
      }
    }
    if (!item) {
      const lots = s.lots.filter(l => norm(l.code) === k)
      if (lots.length > 1) fail('SCAN_AMBIGUOUS', `${code} is a lot of several items; scan the GS1 label or the item first.`, { code })
      lot = lots[0] ?? fail('SCAN_UNKNOWN', `No item, bin, job, order, lot or serial matches ${code}.`, { code })
      item = s.items.find(i => i.id === lot!.itemId)!
    }
  }
  const found = { code, kind: lot ? (lot.serial ? 'serial' : 'lot') : 'item', gs1, item: brief(item), lot: lot ? { id: lot.id, code: lot.code, serial: !!lot.serial } : null }
  if (!use) return found
  const purpose = oneOf(use, scanUses, 'scan use')
  if (purpose === 'transfer') {
    // A transfer takes stock out of the bin it was scanned in.
    const from = get(s, 'locations', documentId, 'location')
    if (gs1 && (gs1.serial ?? gs1.lot) && !lot) fail('SCAN_UNKNOWN', `${gs1.serial ? 'Serial' : 'Lot'} ${gs1.serial ?? gs1.lot} of ${item.name} was never received.`, { itemId: item.id })
    if (lot) {
      usable(s, lot, today, 'moved')
      if (s.movements.reduce((n, m) => m.lotId === lot!.id && m.locationId === from.id && m.status === 'available' ? n + m.quantity : n, 0n) <= 0n) fail('SCAN_WRONG_ITEM', `${lot.serial ? 'Serial' : 'Lot'} ${lot.code} is not in ${from.name}; scan stock from the bin you are moving out of.`, { lotId: lot.id, locationId: from.id })
    }
    return { ...found, locationId: from.id }
  }
  if (purpose === 'output') {
    // An output label names the job's own product; a serial on it must be new.
    const w = get(s, 'workOrders', documentId, 'work order')
    if (w.status !== 'released') fail('SCAN_STALE', `${w.reference} is ${w.status}; record output only on released work.`, { documentId: w.id })
    if (item.id !== w.itemId) fail('SCAN_WRONG_ITEM', `${item.name} is not what ${w.reference} makes; scan this job's own label.`, { itemId: item.id, documentId: w.id })
    if (gs1?.serial && lot) fail('SCAN_DUPLICATE', `Serial ${gs1.serial} of ${item.name} already exists; this unit was received or made before.`, { lotId: lot.id })
    return { ...found, output: { serial: gs1?.serial ?? '', lot: gs1?.lot ?? '', expiresOn: gs1?.expiresOn ?? '' } }
  }
  const { doc, lines, name } = documentFor(s, purpose, documentId)
  const line = lines.find((l: any) => l.itemId === item!.id) ?? fail('SCAN_WRONG_ITEM', `${item.name} is not ${name} ${doc.reference}; scan an item from this ${purpose}.`, { itemId: item.id, documentId: doc.id })
  if (purpose === 'receipt') {
    // A new delivery carries its own lot or serial; a serial an item already used is a duplicate.
    const serial = gs1?.serial
    if (serial && lot) fail('SCAN_DUPLICATE', `Serial ${serial} of ${item.name} already exists; this unit was received or made before.`, { lotId: lot.id })
    return { ...found, lineId: line.id, receive: { lot: gs1?.lot ?? '', serial: serial ?? '', expiresOn: gs1?.expiresOn ?? '', manufacturedOn: gs1?.producedOn ?? '' } }
  }
  if (gs1 && (gs1.serial ?? gs1.lot) && !lot) fail('SCAN_UNKNOWN', `${gs1.serial ? 'Serial' : 'Lot'} ${gs1.serial ?? gs1.lot} of ${item.name} was never received.`, { itemId: item.id })
  if (lot) usable(s, lot, today, purpose === 'issue' ? 'issued' : 'picked')
  if (purpose === 'pick' && lot?.serial && s.shipments.some(x => ['picked', 'packed'].includes(x.status) && x.lines.some((l: any) => l.lotId === lot!.id))) fail('SCAN_DUPLICATE', `Serial ${lot.code} is already picked.`, { lotId: lot.id })
  return { ...found, lineId: line.id }
}
