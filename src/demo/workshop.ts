// An end-grain board and board butter shop in Asheville, NC, adapted from the public API journey's workshop.
// Use the real domain operations so stock, reservations, documents and the schedule agree.
import { collections, type Context, type Row, type State } from '../larder/model'
import { catalogue } from '../larder/catalogue'
import { warehouse } from '../larder/warehouse'
import { bom } from '../larder/bom'
import { sales } from '../larder/sales'
import { purchasing } from '../larder/purchasing'
import { production } from '../larder/production'
import { handoff } from '../larder/handoff'
import { proposals } from '../larder/proposals'
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
    for (const handle of [catalogue, warehouse, bom, sales, purchasing, production, handoff, proposals]) {
      const result = handle(c, type, payload)
      if (result) {
        commands.push({ id: c.commandId, actorId: c.actor.id, type, payload, result: { ok: true, result, version: commands.length + 1 }, createdAt: c.now })
        return result
      }
    }
    throw new Error(`Unknown demo operation: ${type}`)
  }
  // The shop's people: each joined over the past months and holds one Larder role. The planner is an agent:
  // it prepares proposals and never approves them.
  const team = ([['Dana Whitaker', 'dana', 'manager', -150], ['Luis Romero', 'luis', 'production', -120], ['Mei Chen', 'mei', 'buyer', -90], ['Sam Okafor', 'sam', 'warehouse', -60], ['Jo Bennett', 'jo', 'accounts', -30], ['Larder planner', 'planner', 'agent', -20]] as const)
    .map(([name, mailbox, role, joined]) => {
      const person = { id: crypto.randomUUID(), name, email: `${mailbox}@walnut-workshop.example`, joinedAt: now.getTime() + joined * 86400000 }
      c.commandId = `demo-workshop-role-${mailbox}`
      c.now = new Date(person.joinedAt).toISOString()
      const payload = { operatorId: person.id, role }
      commands.push({ id: c.commandId, actorId: owner.id, type: 'role.set', payload, result: { ok: true, result: roleCommand(c, 'role.set', payload), version: commands.length + 1 }, createdAt: c.now })
      return person
    })
  const member = (name: string, role: string) => ({ ...owner, id: team.find(p => p.name === name)!.id, name, role })
  const dana = member('Dana Whitaker', 'manager'), luis = member('Luis Romero', 'production'), mei = member('Mei Chen', 'buyer'), sam = member('Sam Okafor', 'warehouse'), jo = member('Jo Bennett', 'accounts'), planner = member('Larder planner', 'agent')
  const doer = (type: string) => /^(so\.|po\.approve)/.test(type) ? dana : /^po\./.test(type) ? mei : /^(shipment|receipt|transfer)\./.test(type) ? sam : /^wo\./.test(type) ? luis : /^handoff\./.test(type) ? jo : /^proposal\./.test(type) ? planner : owner
  const rack = run('location.save', { name: 'Lumber rack', note: 'Bays A–D; counted weekly' })
  const floor = run('location.save', { name: 'Shop floor', note: 'Routers, sanding, finishing and the batch room' })
  const goods = run('location.save', { name: 'Finished goods', note: 'Packed stock and outgoing orders' })
  const item = (sku: string, name: string, kind: string, cost: string, price = '0', baseUnit = 'each') => run('item.save', { sku, name, kind, baseUnit, standardCost: cost, salePrice: price })
  const walnut = item('WAL-84', 'Walnut 8/4 lumber', 'buy', '11.6', '0', 'bd ft')
  const maple = item('MAP-84', 'Hard maple 8/4 lumber', 'buy', '7.4', '0', 'bd ft')
  const oil = item('OIL-MIN', 'Food-grade mineral oil', 'buy', '18.5', '0', 'gal')
  const wax = item('WAX-BEE', 'Beeswax pellets', 'buy', '9.2', '0', 'lb')
  const tin = item('TIN-4OZ', '4 oz tin with lid', 'buy', '0.62')
  const box = item('BOX-BRD', 'Board gift box', 'buy', '2.1')
  const walnutBoard = item('EG-1218', 'Walnut end-grain board 12×18', 'make', '46', '129')
  const mapleBoard = item('EG-1014', 'Maple end-grain board 10×14', 'make', '31', '89')
  const butter = item('BB-1020', 'Board butter 4 oz', 'make', '3.9', '14')
  const customers = [['Hearth & Table', 'Charlotte, NC'], ['Saltbox Kitchen Co', 'Asheville, NC'], ['Blue Ridge Mercantile', 'Boone, NC'], ['Piedmont Provisions', 'Greensboro, NC']]
    .map(([name, place]) => run('party.save', { name, kind: 'customer', email: 'orders@' + name.toLowerCase().replace(/[^a-z]+/g, '') + '.example', terms: `Net 30 days · ${place}` }))
  const hardwoods = run('party.save', { name: 'Carolina Hardwoods', kind: 'supplier', email: 'orders@carolinahardwoods.example', terms: 'Net 30 days' })
  const apiary = run('party.save', { name: 'Appalachian Apiary Supply', kind: 'supplier', email: 'sales@appalachianapiary.example', terms: 'Net 15 days' })
  const boxes = run('party.save', { name: 'Southern Box & Label', kind: 'supplier', email: 'sales@southernbox.example', terms: 'Net 30 days' })
  for (const [part, supplier, price, lead] of [[walnut, hardwoods, '11.6', 6], [maple, hardwoods, '7.4', 4], [oil, apiary, '18.5', 3], [wax, apiary, '9.2', 3], [tin, boxes, '0.62', 7], [box, boxes, '2.1', 7]] as const)
    run('partyItem.save', { partyId: supplier.id, itemId: part.id, partyCode: part.sku, price, leadDays: lead, preferred: true })
  const evidence = { name: 'opening-count.csv', contentType: 'text/csv', base64: btoa(`counted_on,counted_by,note\n${day(-8)},Alex Morgan,Shop opening count\n`) }
  run('opening.record', { locationId: rack.id, countedOn: day(-8), countedBy: 'Alex Morgan', valuationBasis: 'supplier-invoice', evidence, lines: [
    { itemId: walnut.id, quantity: '420', unitCost: '11.6' }, { itemId: maple.id, quantity: '100', unitCost: '7.4' }, { itemId: oil.id, quantity: '16', unitCost: '18.5' },
    { itemId: wax.id, quantity: '80', unitCost: '9.2' }, { itemId: tin.id, quantity: '900', unitCost: '0.62' }, { itemId: box.id, quantity: '300', unitCost: '2.1' },
  ] }, -8)
  run('opening.record', { locationId: goods.id, countedOn: day(-8), countedBy: 'Alex Morgan', valuationBasis: 'standard-cost', evidence, lines: [
    { itemId: walnutBoard.id, quantity: '24', unitCost: '46' }, { itemId: mapleBoard.id, quantity: '18', unitCost: '31' }, { itemId: butter.id, quantity: '120', unitCost: '3.9' },
  ] }, -8)
  // Routings: minutes per unit at each work center, in order.
  const board = (router: string, minutes: number[]) => [['Rough cut', router], ['Sand', 'Sanding'], ['Oil and finish', 'Finishing'], ['Pack', 'Pack and ship']].map(([name, workCentre], i) => ({ name, workCentre, minutes: minutes[i] }))
  run('bom.revise', { itemId: walnutBoard.id, components: [{ itemId: walnut.id, quantity: '2.4' }, { itemId: oil.id, quantity: '0.02' }, { itemId: box.id, quantity: '1' }], routing: board('CNC Router 1', [12, 6, 5, 3]), note: 'Current shop specification' })
  run('bom.revise', { itemId: mapleBoard.id, components: [{ itemId: maple.id, quantity: '1.6' }, { itemId: oil.id, quantity: '0.015' }, { itemId: box.id, quantity: '1' }], routing: board('CNC Router 2', [10, 5, 4, 2]), note: 'Current shop specification' })
  run('bom.revise', { itemId: butter.id, components: [{ itemId: wax.id, quantity: '0.12' }, { itemId: oil.id, quantity: '0.015' }, { itemId: tin.id, quantity: '1' }], routing: [{ name: 'Melt and pour', workCentre: 'Batch room', minutes: 1.5 }, { name: 'Label and pack', workCentre: 'Pack and ship', minutes: 0.5 }], note: 'Current batch recipe' })
  const order = (customer: Row, made: Row, quantity: string, due: number, confirm = true) => {
    const o = run('so.quote', { customerId: customer.id, promiseDate: day(due), customerReference: `PO-${customers.indexOf(customer) + 4401}`, lines: [{ itemId: made.id, quantity }] }, -4)
    if (confirm) run('so.confirm', { orderId: o.id, version: o.version }, -4)
    return o
  }
  const [hearth, saltbox, blueRidge, piedmont] = customers as [Row, Row, Row, Row]
  const butterOrder = order(piedmont, butter, '60', 1)
  order(hearth, walnutBoard, '120', 12)
  order(saltbox, walnutBoard, '36', 5)
  order(blueRidge, mapleBoard, '90', 6)
  order(piedmont, butter, '480', 6)
  order(hearth, mapleBoard, '40', 14, false)
  const shipment = run('shipment.pick', { orderId: butterOrder.id, lines: [{ lineId: butterOrder.lines[0].id, locationId: goods.id, quantity: '36' }] }, -2)
  run('shipment.pack', { shipmentId: shipment.id, version: shipment.version, packages: 1, weightKg: '4.1' }, -2)
  run('shipment.ship', { shipmentId: shipment.id, version: shipment.version, carrier: 'UPS Ground', tracking: '1Z4F7W930312845117' }, -2)
  const purchase = (supplier: Row, part: Row, quantity: string, price: string, due: number, approved = true) => {
    const po = run('po.draft', { supplierId: supplier.id, expectedDate: day(due), requiredBy: day(due + 1), reason: 'Replenish stock for confirmed orders', lines: [{ itemId: part.id, quantity, unitPrice: price }] }, -3)
    if (approved) { run('po.approve', { poId: po.id, version: po.version, note: 'Within the weekly materials budget' }, -3); run('po.confirm', { poId: po.id, version: po.version, supplierReference: `CH-${po.reference.slice(3)}`, confirmedDate: day(due) }, -3) }
    return po
  }
  const walnutPo = purchase(hardwoods, walnut, '200', '11.6', -1)
  run('receipt.create', { poId: walnutPo.id, supplierReference: 'DEL-1412', lines: [{ lineId: walnutPo.lines[0].id, locationId: rack.id, quantity: '100', lot: 'CH-1412', inspection: 'quarantine' }] }, -1)
  const maplePo = purchase(hardwoods, maple, '200', '7.4', 3)
  purchase(apiary, wax, '60', '9.2', 4)
  purchase(boxes, box, '400', '2.1', 6, false)
  const work = (made: Row, quantity: string, due: number, start: number, priority: number, released = true) => {
    const w = run('wo.draft', { itemId: made.id, quantity, requiredBy: day(due), plannedStart: day(start), reason: 'Confirmed customer orders', priority }, -2)
    if (released) run('wo.release', { workOrderId: w.id, version: w.version }, -2)
    return w
  }
  // Last week's batch went to the accountant; this week's production waits for the next one.
  run('handoff.prepare', { note: 'Shop movements for the weekly accountant review' }, -2)
  work(walnutBoard, '120', 9, 0, 2)
  work(mapleBoard, '90', 4, 0, 1)
  work(butter, '480', 4, 0, 1)
  const saltboxWork = work(walnutBoard, '36', 4, 1, 0)
  work(mapleBoard, '60', 9, 2, 0, false)
  work(butter, '240', 8, 3, 0, false)
  run('po.revise', { poId: maplePo.id, version: maplePo.version, expectedDate: day(2), note: 'Earlier delivery confirmed by Carolina Hardwoods' }, 0)
  run('transfer.create', { itemId: walnut.id, fromLocationId: rack.id, toLocationId: floor.id, quantity: '40', reason: 'Stage blanks for the router' }, 0)
  // The planner's proposal: run the Saltbox boards first. A person approves it or keeps the current plan.
  run('proposal.prepare', { kind: 'reschedule', summary: 'Run WO-0004 for Saltbox Kitchen Co ahead of WO-0001 on CNC Router 1', assumptions: 'WO-0001 is not needed until later in the week.',
    evidence: ['WO-0004 priority 0, planned behind WO-0001 on CNC Router 1', 'Saltbox Kitchen Co order promised for later this week'], plan: { changes: [{ workOrderId: saltboxWork.id, plannedStart: day(0), priority: 3 }], conflicts: ['WO-0001 starts its rough cut later'] } }, 0)
  c.actor = owner
  return Object.assign(c, { team, commands })
}
