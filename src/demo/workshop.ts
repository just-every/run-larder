// A walnut-board workshop, adapted from the public API journey's workshop.
// Use the real domain operations so stock, reservations and documents agree.
import { collections, type Context, type Row, type State } from '../larder/model'
import { catalogue } from '../larder/catalogue'
import { warehouse } from '../larder/warehouse'
import { bom } from '../larder/bom'
import { sales } from '../larder/sales'
import { purchasing } from '../larder/purchasing'
import { production } from '../larder/production'
import { handoff } from '../larder/handoff'
import { roleCommand } from '../larder/roles'

export function workshop(ownerId: string, now: Date) {
  const s = Object.fromEntries(collections.map(k => [k, []])) as unknown as State
  Object.assign(s, { version: 0, movements: [], reservations: [] })
  const owner = { id: ownerId, name: 'Alex Morgan', role: 'owner', sessionId: '', operatorVersion: 1 }
  const c: Context = { s, actor: owner, commandId: '', now: '', attachments: [] }
  const day = (offset: number) => new Date(now.getTime() + offset * 86400000).toISOString().slice(0, 10)
  let step = 0
  // Each operation runs as the teammate whose Larder role does that work, and is
  // recorded as their command, so Activity reads as the team's week.
  const commands: { id: string; actorId: string; type: string; payload: Record<string, unknown>; result: unknown; createdAt: string }[] = []
  const run = (type: string, payload: Record<string, unknown>, offset = -7): Row => {
    c.commandId = `demo-workshop-${++step}`
    c.now = new Date(now.getTime() + offset * 86400000 + step * 1000).toISOString()
    c.actor = doer(type)
    for (const handle of [catalogue, warehouse, bom, sales, purchasing, production, handoff]) {
      const result = handle(c, type, payload)
      if (result) {
        commands.push({ id: c.commandId, actorId: c.actor.id, type, payload, result: { ok: true, result, version: commands.length + 1 }, createdAt: c.now })
        return result
      }
    }
    throw new Error(`Unknown demo operation: ${type}`)
  }
  // The workshop's people: each joined over the past months and holds one Larder role.
  const team = ([['Priya Shah', 'priya', 'manager', -150], ['Tom Reilly', 'tom', 'production', -120], ['Mei Chen', 'mei', 'buyer', -90], ['Sam Okafor', 'sam', 'warehouse', -60], ['Jo Bennett', 'jo', 'accounts', -30]] as const)
    .map(([name, mailbox, role, joined]) => {
      const person = { id: crypto.randomUUID(), name, email: `${mailbox}@walnut-workshop.example`, joinedAt: now.getTime() + joined * 86400000 }
      c.commandId = `demo-workshop-role-${mailbox}`
      c.now = new Date(person.joinedAt).toISOString()
      const payload = { operatorId: person.id, role }
      commands.push({ id: c.commandId, actorId: owner.id, type: 'role.set', payload, result: { ok: true, result: roleCommand(c, 'role.set', payload), version: commands.length + 1 }, createdAt: c.now })
      return person
    })
  const member = (name: string, role: string) => ({ ...owner, id: team.find(p => p.name === name)!.id, name, role })
  const priya = member('Priya Shah', 'manager'), tom = member('Tom Reilly', 'production'), mei = member('Mei Chen', 'buyer'), sam = member('Sam Okafor', 'warehouse'), jo = member('Jo Bennett', 'accounts')
  const doer = (type: string) => /^(so\.|po\.approve)/.test(type) ? priya : /^po\./.test(type) ? mei : /^(shipment|receipt|transfer)\./.test(type) ? sam : /^wo\./.test(type) ? tom : /^handoff\./.test(type) ? jo : owner
  const stores = run('location.save', { name: 'Timber store', note: 'Racks A–C; counted weekly' })
  const bench = run('location.save', { name: 'Workshop', note: 'Cutting, sanding and finishing' })
  const dispatch = run('location.save', { name: 'Dispatch', note: 'Finished goods and packed orders' })
  const item = (sku: string, name: string, kind: string, cost: string, price = '0', baseUnit = 'each') => run('item.save', { sku, name, kind, baseUnit, standardCost: cost, salePrice: price })
  const walnut = item('WAL-BLANK', 'Walnut board blank', 'buy', '14.5')
  const oak = item('OAK-BLANK', 'Oak paddle blank', 'buy', '9.8')
  const oil = item('OIL-FOOD', 'Food-safe finishing oil', 'buy', '28', '0', 'l')
  const box = item('BOX-GIFT', 'Recycled gift box', 'buy', '3.2')
  const board = item('BRD-WAL', 'Walnut serving board', 'make', '21.4', '89')
  const paddle = item('PAD-OAK', 'Oak pizza paddle', 'make', '15.8', '65')
  const coasters = item('CST-WAL', 'Walnut coaster set', 'make', '12', '39')
  const customers = ['Harbour Kitchen Co', 'Banksia Homewares', 'Little Cove Cafe', 'Marlow & Finch'].map(name => run('party.save', { name, kind: 'customer', email: 'orders@' + name.toLowerCase().replace(/[^a-z]+/g, '') + '.example', terms: 'Net 14 days' }))
  const timber = run('party.save', { name: 'Tasmanian Timber Co', kind: 'supplier', email: 'orders@tasmaniantimber.example', terms: 'Net 30 days' })
  const finish = run('party.save', { name: 'Good Grain Finishes', kind: 'supplier', email: 'sales@goodgrain.example', terms: 'Net 14 days' })
  const packaging = run('party.save', { name: 'Paper & Parcel', kind: 'supplier', email: 'sales@paperandparcel.example', terms: 'Net 30 days' })
  for (const [part, supplier, price] of [[walnut, timber, '14.5'], [oak, timber, '9.8'], [oil, finish, '28'], [box, packaging, '3.2']] as const)
    run('partyItem.save', { partyId: supplier.id, itemId: part.id, partyCode: part.sku, price, leadDays: 5, preferred: true })
  const evidence = { name: 'workshop-opening-count.csv', contentType: 'text/csv', base64: btoa(`counted_on,counted_by,note\n${day(-8)},Alex Morgan,Workshop opening count\n`) }
  run('opening.record', { locationId: stores.id, countedOn: day(-8), countedBy: 'Alex Morgan', valuationBasis: 'supplier-invoice', evidence, lines: [
    { itemId: walnut.id, quantity: '85', unitCost: '14.5' }, { itemId: oak.id, quantity: '50', unitCost: '9.8' },
    { itemId: oil.id, quantity: '8', unitCost: '28' }, { itemId: box.id, quantity: '100', unitCost: '3.2' },
  ] }, -8)
  run('opening.record', { locationId: dispatch.id, countedOn: day(-8), countedBy: 'Alex Morgan', valuationBasis: 'standard-cost', evidence, lines: [
    { itemId: board.id, quantity: '18', unitCost: '21.4' }, { itemId: paddle.id, quantity: '12', unitCost: '15.8' }, { itemId: coasters.id, quantity: '20', unitCost: '12' },
  ] }, -8)
  for (const [made, blank, quantity] of [[board, walnut, '1'], [paddle, oak, '1'], [coasters, walnut, '0.5']] as const)
    run('bom.revise', { itemId: made.id, components: [{ itemId: blank.id, quantity }, { itemId: oil.id, quantity: '0.05' }, { itemId: box.id, quantity: '1' }], routing: [{ name: 'Cut and sand', workCentre: 'Bench 1', minutes: 25 }, { name: 'Oil and finish', workCentre: 'Finishing', minutes: 15 }], note: 'Current workshop specification' })
  const order = (customer: Row, made: Row, quantity: string, due: number, confirm = true) => {
    const o = run('so.quote', { customerId: customer.id, promiseDate: day(due), customerReference: `PO-${customers.indexOf(customer) + 2401}`, lines: [{ itemId: made.id, quantity }] }, -4)
    if (confirm) run('so.confirm', { orderId: o.id, version: o.version }, -4)
    return o
  }
  const harbour = order(customers[0], board, '24', 1)
  order(customers[1], paddle, '18', 3)
  order(customers[2], coasters, '12', 0)
  order(customers[3], board, '10', 7, false)
  order(customers[1], coasters, '8', 4)
  const shipment = run('shipment.pick', { orderId: harbour.id, lines: [{ lineId: harbour.lines[0].id, locationId: dispatch.id, quantity: '6' }] }, -2)
  run('shipment.pack', { shipmentId: shipment.id, version: shipment.version, packages: 2, weightKg: '8.4' }, -2)
  run('shipment.ship', { shipmentId: shipment.id, version: shipment.version, carrier: 'Australia Post', tracking: 'WORKSHOP-2401' }, -2)
  const purchase = (supplier: Row, part: Row, quantity: string, price: string, due: number, approved = true) => {
    const po = run('po.draft', { supplierId: supplier.id, expectedDate: day(due), requiredBy: day(due + 1), reason: 'Replenish workshop stock for confirmed orders', lines: [{ itemId: part.id, quantity, unitPrice: price }] }, -3)
    if (approved) { run('po.approve', { poId: po.id, version: po.version, note: 'Within the weekly materials budget' }, -3); run('po.confirm', { poId: po.id, version: po.version, supplierReference: `SUP-${po.reference}`, confirmedDate: day(due) }, -3) }
    return po
  }
  const timberPo = purchase(timber, walnut, '40', '14.5', -1)
  run('receipt.create', { poId: timberPo.id, supplierReference: 'DEL-1048', lines: [{ lineId: timberPo.lines[0].id, locationId: stores.id, quantity: '20', lot: 'WAL-1048', inspection: 'quarantine' }] }, -1)
  purchase(finish, oil, '10', '28', 2)
  purchase(packaging, box, '200', '3.2', 5, false)
  const work = (made: Row, quantity: string, due: number, released = true) => {
    const w = run('wo.draft', { itemId: made.id, quantity, requiredBy: day(due), plannedStart: day(0), reason: 'Confirmed customer commitments', priority: 1 }, -2)
    if (released) run('wo.release', { workOrderId: w.id, version: w.version }, -2)
    return w
  }
  // Last week's batch went to the accountant; this week's production waits for the next one.
  run('handoff.prepare', { note: 'Workshop movements for the weekly accountant review' }, -2)
  const w = work(board, '12', 1)
  run('wo.issue', { workOrderId: w.id, lines: w.components.map((l: any) => ({ itemId: l.itemId, locationId: stores.id, quantity: l.required })) }, -1)
  run('wo.output', { workOrderId: w.id, version: w.version, locationId: dispatch.id, quantity: '5', lot: 'BRD-FINISH-01' }, -1)
  work(paddle, '8', 3)
  work(coasters, '16', 5, false)
  // A late order the paddle batch does not yet cover: Make & buy shows the shortage.
  order(customers[2], paddle, '10', 6)
  run('transfer.create', { itemId: oak.id, fromLocationId: stores.id, toLocationId: bench.id, quantity: '4', reason: 'Prepare the next paddle batch' }, 0)
  c.actor = owner
  return Object.assign(c, { team, commands })
}
