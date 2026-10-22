// ENG-006: kits and sale-triggered assembly. A sellable kit has versioned component definitions; a revision is prepared
// by one person and its policy (assemble the kit units, or pick the components) is approved by another. An authorized
// sale from a channel names the channel's own event id, so a repeated event replays its recorded outcome and never
// moves stock, kit availability or cost twice. A sale takes exactly the components its pinned revision lists from one
// location and refuses, before anything posts, when any component would oversell.
import { decimal, divide, format, times } from './decimal'
import { fail } from './problem'
import { allow, approver } from './roles'
import { availableAt, move, withdraw } from './stock'
import { toBase } from './catalogue'
import { bump, fresh, get, list, oneOf, optionalText, row, text, type Context, type Row, type State } from './model'

export const activeKit = (s: State, itemId: unknown) => s.kits.filter(k => k.itemId === itemId && k.status === 'active').sort((a, b) => b.revision - a.revision)[0]

// How many kits each location can build or pick now from available stock (reserved and blocked stock excluded).
export function kitAvailability(s: State) {
  return Object.fromEntries(s.kits.filter(k => k.status === 'active').map(k => {
    const places = s.locations.filter(l => !l.archived).map(l => ({ locationId: l.id, buildable: k.components.reduce((n: bigint | null, line: any) => {
      const per = decimal(line.quantity), whole = per === 0n ? 0n : (availableAt(s, line.itemId, l.id) * 1000000n / per) / 1000000n * 1000000n
      return n === null || whole < n ? whole : n
    }, null) ?? 0n })).filter(p => p.buildable > 0n)
    return [k.itemId, { kitId: k.id, revision: k.revision, mode: k.mode, total: format(places.reduce((n, p) => n + p.buildable, 0n)), places: places.map(p => ({ locationId: p.locationId, buildable: format(p.buildable) })) }]
  }))
}

const cost = (movements: { quantity: bigint; unitCost: bigint }[]) => movements.reduce((n, m) => n + times(-m.quantity, m.unitCost), 0n)

export function kits(c: Context, type: string, p: any): Row | undefined {
  if (type === 'kit.save') {
    allow(c, ['manager', 'production', 'engineer', 'agent'])
    const item = get(c.s, 'items', p.itemId, 'item')
    if (item.kind !== 'make') fail('NOT_MADE', `${item.name} is bought, not made. A kit is a made item.`)
    const components = list(p.components, 'kit components', 100).map((line: any) => {
      const component = get(c.s, 'items', line.itemId, 'component')
      if (component.id === item.id) fail('INPUT', 'A kit cannot contain itself.')
      return { itemId: component.id, quantity: format(toBase(component, line.quantity, line.unit, `quantity of ${component.name}`)) }
    })
    if (new Set(components.map(l => l.itemId)).size !== components.length) fail('INPUT', 'List each kit component once per revision.')
    const revision = Math.max(0, ...c.s.kits.filter(k => k.itemId === item.id).map(k => k.revision)) + 1
    // A pending draft is replaced by the next one, so one revision is awaiting approval at a time.
    for (const k of c.s.kits.filter(k => k.itemId === item.id && k.status === 'draft')) bump(k, { status: 'withdrawn' })
    return row(c, 'kits', { itemId: item.id, revision, mode: oneOf(p.mode, ['assemble', 'pick'] as const, 'kit policy'), components, status: 'draft', preparedBy: c.actor.id, note: optionalText(p.note, 'change note', 400) })
  }
  if (type === 'kit.approve') {
    const kit = get(c.s, 'kits', p.kitId, 'kit'); fresh(kit, p.version)
    approver(c, ['manager', 'production'], kit.preparedBy)
    if (kit.status !== 'draft') fail('STATE', 'Only a prepared kit revision can be approved.')
    for (const k of c.s.kits.filter(k => k.itemId === kit.itemId && k.status === 'active')) bump(k, { status: 'superseded' })
    return bump(kit, { status: 'active', approvedBy: c.actor.id, approvedAt: c.now })
  }
  if (type !== 'kit.sell') return
  allow(c, ['manager', 'sales'])
  const item = get(c.s, 'items', p.itemId, 'item'), channel = text(p.channel, 'sales channel', 60), eventId = text(p.eventId, 'channel event id', 200), key = `${channel}:${eventId}`
  const quantity = decimal(p.quantity, 'quantity', { positive: true }), location = get(c.s, 'locations', p.locationId, 'location')
  // The channel's own event identity decides: a repeat returns what was recorded, whatever command carried it.
  const seen = c.s.kitSales.find(k => k.eventKey === key)
  if (seen) {
    if (seen.itemId !== item.id || seen.quantity !== format(quantity) || seen.locationId !== location.id) fail('IDEMPOTENCY', 'This channel event was already recorded with different content.')
    return seen
  }
  const kit = activeKit(c.s, item.id) ?? fail('NO_KIT', `${item.name} has no approved kit definition.`)
  const sale = row(c, 'kitSales', { reference: `KS-${String(c.s.kitSales.length + 1).padStart(4, '0')}`, eventKey: key, channel, eventId, itemId: item.id, kitId: kit.id, kitRevision: kit.revision, mode: kit.mode, quantity: format(quantity), locationId: location.id, customerId: p.customerId ? get(c.s, 'parties', p.customerId, 'customer').id : null, soldBy: c.actor.id, note: optionalText(p.note, 'note', 400) })
  const need: { itemId: string; quantity: bigint }[] = kit.components.map((l: any) => ({ itemId: l.itemId, quantity: times(decimal(l.quantity), quantity) }))
  const short = need.filter(l => availableAt(c.s, l.itemId, location.id) < l.quantity)
  if (short.length) fail('INSUFFICIENT_STOCK', `${location.name} cannot cover ${format(quantity)} × ${item.name}.`, { short: short.map(l => ({ itemId: l.itemId, needed: format(l.quantity), available: format(availableAt(c.s, l.itemId, location.id)) })) })
  const issued = need.flatMap(l => withdraw(c, { itemId: l.itemId, locationId: location.id, status: 'available', quantity: -l.quantity, kind: 'issue', documentKind: 'kitSales', documentId: sale.id, reason: `${kit.mode === 'assemble' ? 'Assembled into' : 'Picked for'} ${sale.reference} (${channel} ${eventId})` }))
  const total = cost(issued)
  if (kit.mode === 'assemble') {
    const unit = divide(total, quantity)
    move(c, { itemId: item.id, locationId: location.id, status: 'available', quantity, unitCost: unit, kind: 'assembly', documentKind: 'kitSales', documentId: sale.id, reason: `Assembled for ${sale.reference}` })
    withdraw(c, { itemId: item.id, locationId: location.id, status: 'available', quantity: -quantity, unitCost: unit, kind: 'kit-sale', documentKind: 'kitSales', documentId: sale.id, reason: `Sold on ${channel} ${eventId}` })
  }
  sale.movementIds = c.s.movements.filter(m => m.documentKind === 'kitSales' && m.documentId === sale.id).map(m => m.id)
  sale.components = need.map(l => ({ itemId: l.itemId, quantity: format(l.quantity) }))
  sale.cost = format(total)
  return sale
}
