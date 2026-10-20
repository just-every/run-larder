// Stock truth: positions are sums of append-only movements; available stock is
// on-hand available status minus reservations. Every write goes through move().
import { requireCatalogLot } from './catalog-fields'
import { blockedQuantity, fefoOrder, lotBlock, utcToday } from './lot-dates'
import { decimal, divide, format, min, times } from './decimal'
import { fail } from './problem'
import { get, newId, type Context, type Movement, type Reservation, type State } from './model'

export function balance(s: State, itemId: string, locationId: string, status = 'available', lotId?: string): bigint {
  let n = 0n
  for (const m of s.movements) if (m.itemId === itemId && m.locationId === locationId && m.status === status && (lotId === undefined || m.lotId === lotId)) n += m.quantity
  return n
}

export function reservedAt(s: State, itemId: string, locationId: string): bigint {
  let n = 0n
  for (const r of s.reservations) if (r.itemId === itemId && r.locationId === locationId) n += r.quantity
  return n
}

// Expired or retest-due lots (TRACE-003) are on hand but not available.
export const availableAt = (s: State, itemId: string, locationId: string, on = utcToday()) => balance(s, itemId, locationId) - blockedQuantity(s, itemId, on, locationId) - reservedAt(s, itemId, locationId)

// Available on-hand stock outside expired or retest-due lots.
export const usableOnHand = (s: State, itemId: string, on = utcToday()) => onHand(s, itemId) - blockedQuantity(s, itemId, on)

export function onHand(s: State, itemId: string, status = 'available') {
  let n = 0n
  for (const m of s.movements) if (m.itemId === itemId && m.status === status) n += m.quantity
  return n
}

export function reservedFor(s: State, demandId: string, lineId?: string) {
  return s.reservations.filter(r => r.demandId === demandId && (lineId === undefined || r.lineId === lineId))
}

export const reservedQuantity = (s: State, demandId: string, lineId: string) => reservedFor(s, demandId, lineId).reduce((n, r) => n + r.quantity, 0n)

// Weighted average cost of what is on hand (both statuses); the last inbound
// cost when nothing is on hand.
export function averageCost(s: State, itemId: string): bigint {
  let quantity = 0n, value = 0n, last = 0n
  for (const m of s.movements) if (m.itemId === itemId) {
    quantity += m.quantity; value += times(m.quantity, m.unitCost)
    if (m.quantity > 0) last = m.unitCost
  }
  return quantity > 0n ? (value > 0n ? divide(value, quantity) : 0n) : last
}

type MoveInput = Pick<Movement, 'itemId' | 'locationId' | 'status' | 'kind' | 'documentKind' | 'documentId' | 'reason'> & { quantity: bigint; lotId?: string; unitCost?: bigint; reversesId?: string | null; importId?: string | null }

// A recovery lot carries its approved allocation, including extra repair costs.
// Preserve that lot's basis instead of blending it into other unrepaired stock.
function recoveryCost(s: State, lotId: string) {
  if (!s.lots.some(l => l.id === lotId && ['rework', 'subcontract'].includes(l.source))) return undefined
  return s.movements.find(m => m.lotId === lotId && ['repair-output', 'recovered-component', 'subcontract-output'].includes(m.kind))?.unitCost
}

export function move(c: Context, x: MoveInput): Movement {
  get(c.s, 'locations', x.locationId, 'location')
  const item = get(c.s, 'items', x.itemId, 'item')
  if (x.quantity === 0n) fail('INPUT', 'A movement needs a non-zero quantity.')
  const lotId = x.lotId ?? ''
  if (c.s.lots.some(l => l.id === lotId && l.ownerId)) fail('OWNERSHIP', 'Customer property cannot enter owned inventory.')
  if (x.quantity > 0n) requireCatalogLot(item, c.s.lots.find(l => l.id === lotId && l.itemId === item.id)?.code)
  if (x.quantity < 0n) {
    if (x.status === 'quarantine') {
      const held = c.s.nonconformances.filter(n => n.status === 'open' && n.itemId === x.itemId && n.locationId === x.locationId && n.lotId === lotId && !(x.documentKind === 'nonconformances' && x.documentId === n.id) && !(x.kind === 'rework-source' && x.documentKind === 'reworkOrders' && c.s.reworkOrders.some(w => w.id === x.documentId && w.nonconformanceId === n.id))).reduce((n, r) => n + decimal(r.remaining), 0n)
      if (balance(c.s, x.itemId, x.locationId, 'quarantine', lotId) + x.quantity < held) fail('NONCONFORMANCE', 'This quantity is protected by an open nonconformance; use its evidenced disposition.')
    }
    const lotBalance = balance(c.s, x.itemId, x.locationId, x.status, lotId)
    if (lotBalance + x.quantity < 0n) fail('INSUFFICIENT_STOCK', 'Not enough stock at that location for this movement.', { itemId: x.itemId, locationId: x.locationId, status: x.status, lotId, onHand: format(lotBalance), needed: format(-x.quantity) })
    if (x.status === 'available' && balance(c.s, x.itemId, x.locationId) + x.quantity < reservedAt(c.s, x.itemId, x.locationId))
      fail('RESERVED_STOCK', 'That stock is reserved for orders or work. Release or use the reservation first.', { itemId: x.itemId, locationId: x.locationId, reserved: format(reservedAt(c.s, x.itemId, x.locationId)) })
  }
  const m: Movement = {
    id: newId(), sequence: (c.s.movements.at(-1)?.sequence ?? 0) + 1, itemId: x.itemId, locationId: x.locationId, status: x.status, lotId,
    quantity: x.quantity, unitCost: x.unitCost ?? (recoveryCost(c.s, lotId) ?? averageCost(c.s, x.itemId)), kind: x.kind, documentKind: x.documentKind, documentId: x.documentId,
    reversesId: x.reversesId ?? null, actorId: c.actor.id, commandId: c.commandId, importId: x.importId ?? null, reason: x.reason, createdAt: c.now,
  }
  if (m.unitCost < 0n) fail('INPUT', 'Unit cost cannot be negative.')
  c.s.movements.push(m)
  return m
}

// Take stock out of a location. With no lot named, draw from the unlotted
// stock first, then from lots first-expiry-first-out, posting one movement per
// lot. Shipments, issues and transfers never use available stock in an expired
// or retest-due lot; counts still record it.
const usesStock = ['shipment', 'issue', 'transfer']
export function withdraw(c: Context, x: Omit<MoveInput, 'lotId'> & { lotId?: string }): Movement[] {
  const today = c.now.slice(0, 10), blocked = (lotId: string) => x.status === 'available' && usesStock.includes(x.kind) ? lotBlock(c.s.lots.find(l => l.id === lotId), today) : ''
  if (x.lotId !== undefined && x.lotId !== '') {
    if (blocked(x.lotId)) fail('LOT_BLOCKED', `Lot ${c.s.lots.find(l => l.id === x.lotId)?.code} ${blocked(x.lotId)} and cannot be used until an owner or manager records its disposition.`, { lotId: x.lotId })
    return [move(c, x)]
  }
  const need = -x.quantity
  if (need <= 0n) return [move(c, { ...x, lotId: '' })]
  const present = [...new Set(c.s.movements.filter(m => m.itemId === x.itemId && m.locationId === x.locationId && m.status === x.status).map(m => m.lotId))]
  const lots = [...(present.includes('') ? [''] : []), ...fefoOrder(c.s, present.filter(lot => lot !== '' && !blocked(lot)))]
  const total = lots.reduce((n, lot) => n + balance(c.s, x.itemId, x.locationId, x.status, lot), 0n)
  if (total < need && present.some(lot => lot && blocked(lot))) fail('LOT_BLOCKED', 'Only expired or retest-due lots cover the rest; an owner or manager records their disposition first.', { itemId: x.itemId, locationId: x.locationId, usable: format(total), needed: format(need) })
  if (total < need) return [move(c, { ...x, lotId: '' })]
  const out: Movement[] = []
  let left = need
  for (const lot of lots) {
    if (left === 0n) break
    const have = balance(c.s, x.itemId, x.locationId, x.status, lot)
    if (have <= 0n) continue
    const take = min(have, left)
    out.push(move(c, { ...x, lotId: lot, quantity: -take }))
    left -= take
  }
  return out
}

// Reserve up to `wanted` of an item for a demand line from available stock,
// location by location. Returns what was reserved.
export function reserve(c: Context, demand: Pick<Reservation, 'demandKind' | 'demandId' | 'lineId' | 'itemId'>, wanted: bigint, locationId?: string): bigint {
  let left = wanted
  const locations = locationId ? [get(c.s, 'locations', locationId, 'location')] : c.s.locations.filter(l => !l.archived)
  for (const location of locations) {
    if (left <= 0n) break
    const free = availableAt(c.s, demand.itemId, location.id)
    if (free <= 0n) continue
    const take = min(free, left)
    const existing = c.s.reservations.find(r => r.demandId === demand.demandId && r.lineId === demand.lineId && r.locationId === location.id)
    if (existing) existing.quantity += take
    else c.s.reservations.push({ ...demand, id: newId(), locationId: location.id, quantity: take })
    left -= take
  }
  return wanted - left
}

// Consume a demand line's reservation at a location (shipping, issuing).
export function consume(c: Context, demandId: string, lineId: string, locationId: string, quantity: bigint) {
  const r = c.s.reservations.find(x => x.demandId === demandId && x.lineId === lineId && x.locationId === locationId)
  if (!r || r.quantity < quantity) return fail('NOT_RESERVED', 'Only reserved stock can be used for this line. Reserve it first.', { demandId, lineId, locationId, reserved: format(r?.quantity ?? 0n), needed: format(quantity) })
  r.quantity -= quantity
  if (r.quantity === 0n) c.s.reservations.splice(c.s.reservations.indexOf(r), 1)
}

export function release(c: Context, demandId: string, lineId?: string) {
  c.s.reservations = c.s.reservations.filter(r => !(r.demandId === demandId && (lineId === undefined || r.lineId === lineId)))
}

export function positions(s: State) {
  const keyed = new Map<string, { itemId: string; locationId: string; status: string; lotId: string; quantity: bigint }>()
  for (const m of s.movements) {
    const key = `${m.itemId}|${m.locationId}|${m.status}|${m.lotId}`
    const p = keyed.get(key) ?? { itemId: m.itemId, locationId: m.locationId, status: m.status, lotId: m.lotId, quantity: 0n }
    p.quantity += m.quantity
    keyed.set(key, p)
  }
  return [...keyed.values()].filter(p => p.quantity !== 0n).map(p => ({ ...p, quantity: format(p.quantity) }))
}

export const qty = (value: unknown, name = 'quantity') => decimal(value, name, { positive: true })
