import test from 'node:test'
import assert from 'node:assert/strict'
import { installation, evidence } from './harness.mjs'

const today = () => new Date().toISOString().slice(0, 10)
const date = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
const record = (s, kind, id) => s.orderStatuses[kind].find(r => r.id === id)
const sources = line => [...line.supplies, ...(line.ingredients ?? []).flatMap(sources)]

test('DEMAND-006 next-read ranked SO/MO status recomputes receipts, quarantine, current ETAs, rank, reservations, cancellations and production without planning', async t => {
  const h = await installation(); t.after(() => h.close())
  const loc = await h.command('location.save', { name: 'Production bin' })
  const raw = await h.command('item.save', { sku: 'BAR-STOCK', name: 'Alloy bar', kind: 'buy', baseUnit: 'each', standardCost: '5' })
  const made = await h.command('item.save', { sku: 'TURNED-PEG', name: 'Turned peg', kind: 'make', baseUnit: 'each', salePrice: '20' })
  const noBom = await h.command('item.save', { sku: 'NO-BOM', name: 'Unengineered job', kind: 'make', baseUnit: 'each' })
  await h.command('bom.revise', { itemId: made.id, components: [{ itemId: raw.id, quantity: '1' }] })
  const supplier = await h.command('party.save', { name: 'Industrial Metals', kind: 'supplier' })
  const customer = await h.command('party.save', { name: 'Equipment Works', kind: 'customer' })
  await h.command('opening.record', { locationId: loc.id, countedOn: today(), countedBy: 'Olive', valuationBasis: 'supplier-invoice', evidence: evidence(), lines: [{ itemId: raw.id, quantity: '2', unitCost: '5' }] })
  const sales = []
  for (let rank = 1; rank <= 3; rank++) {
    let order = await h.command('so.quote', { customerId: customer.id, promiseDate: date(10), lines: [{ itemId: made.id, quantity: '2' }] })
    order = await h.command('so.confirm', { orderId: order.id, version: order.version, reserve: false })
    order = await h.command('order.rank', { kind: 'sales', orderId: order.id, version: order.version, rank })
    sales.push(order)
  }
  const purchases = []
  for (let i = 1; i <= 2; i++) {
    const po = await h.command('po.draft', { supplierId: supplier.id, expectedDate: date(i), reason: 'Ranked demand supply', lines: [{ itemId: raw.id, quantity: '2', unitPrice: '5' }] })
    purchases.push(await h.command('po.approve', { poId: po.id, version: po.version }))
  }
  let s = await h.state()
  assert.equal(record(s, 'sales', sales[0].id).ingredientStatus, 'In stock')
  for (let i = 1; i < 3; i++) {
    const status = record(s, 'sales', sales[i].id)
    assert.equal(status.ingredientStatus, 'Expected')
    const supply = sources(status.lines[0]).find(x => x.kind === 'purchase')
    assert.equal(supply.reference, purchases[i - 1].reference); assert.equal(supply.date, purchases[i - 1].expectedDate)
  }
  // Part receipt changes quantities and allocates from current stock on the
  // very next read; held goods never become an in-stock allocation.
  await h.command('receipt.create', { poId: purchases[0].id, supplierReference: 'PART', lines: [{ lineId: purchases[0].lines[0].id, quantity: '1', locationId: loc.id, inspection: 'accept' }] })
  await h.command('receipt.create', { poId: purchases[1].id, supplierReference: 'HOLD', lines: [{ lineId: purchases[1].lines[0].id, quantity: '1', locationId: loc.id, inspection: 'quarantine', lot: 'HELD-LOT' }] })
  s = await h.state()
  assert.equal(record(s, 'sales', sales[1].id).ingredientStatus, 'Expected')
  assert.equal(record(s, 'sales', sales[2].id).ingredientStatus, 'Not available')
  const held = s.positions.find(p => p.status === 'quarantine')
  assert.equal(held.quantity, '1')
  const revised = await h.command('po.revise', { poId: purchases[0].id, version: s.purchaseOrders.find(p => p.id === purchases[0].id).version, expectedDate: date(8), note: 'Supplier delay' })
  s = await h.state()
  const expected = sources(record(s, 'sales', sales[1].id).lines[0]).filter(x => x.kind === 'purchase')
  for (const supply of expected) assert.equal(supply.date, s.purchaseOrders.find(p => p.id === supply.documentId).expectedDate)
  assert.ok(s.orderStatuses.sales.some(o => o.lines.some(l => sources(l).some(x => x.reference === revised.reference && x.date === revised.expectedDate))))
  // Lower rank numbers win free supply; changing rank never steals an existing
  // hard reservation or changes a customer's promise.
  await h.command('order.rank', { kind: 'sales', orderId: sales[2].id, version: s.salesOrders.find(o => o.id === sales[2].id).version, rank: 1 })
  s = await h.state()
  await h.command('order.rank', { kind: 'sales', orderId: sales[0].id, version: s.salesOrders.find(o => o.id === sales[0].id).version, rank: 4 })
  s = await h.state()
  assert.equal(record(s, 'sales', sales[2].id).ingredientStatus, 'In stock')
  assert.equal(record(s, 'sales', sales[0].id).ingredientStatus, 'Not available')
  assert.ok(s.salesOrders.every(o => o.promiseDate === date(10)))
  const viewer = await h.person('sales-person@example.test', 'sales')
  await viewer.run('order.rank', { kind: 'sales', orderId: sales[0].id, version: s.salesOrders.find(o => o.id === sales[0].id).version, rank: 1 }, { error: 'FORBIDDEN' })
  await h.command('order.rank', { kind: 'sales', orderId: sales[0].id, version: sales[0].version - 1, rank: 1 }, { error: 'STALE' })
  const cancel = s.salesOrders.find(o => o.id === sales[2].id)
  await h.command('so.cancelLine', { orderId: cancel.id, version: cancel.version, lineId: cancel.lines[0].id, quantity: '2' })
  s = await h.state()
  assert.equal(record(s, 'sales', sales[1].id).ingredientStatus, 'In stock')
  // A real released MO protects its component reservations. Sales consuming
  // that MO's output reference it without allocating its ingredients twice.
  let work = await h.command('wo.draft', { itemId: made.id, quantity: '2', requiredBy: date(5), reason: 'Two customer pegs' })
  work = await h.command('wo.release', { workOrderId: work.id, version: work.version })
  work = await h.command('order.rank', { kind: 'work', orderId: work.id, version: work.version, rank: 1 })
  work = await h.command('work.expected', { workOrderId: work.id, version: work.version, expectedOn: date(6) })
  s = await h.invariant()
  assert.equal(record(s, 'work', work.id).ingredientStatus, 'In stock')
  assert.ok(s.orderStatuses.sales.flatMap(o => o.lines).some(l => sources(l).some(x => x.kind === 'work' && x.documentId === work.id && x.date === date(6))))
  await h.command('wo.issue', { workOrderId: work.id, lines: [{ itemId: raw.id, locationId: loc.id, quantity: '2' }] })
  s = await h.state()
  assert.equal(record(s, 'work', work.id).productionStatus, 'in progress')
  work = await h.command('wo.output', { workOrderId: work.id, version: s.workOrders.find(w => w.id === work.id).version, locationId: loc.id, quantity: '2' })
  s = await h.invariant()
  assert.equal(record(s, 'work', work.id).productionStatus, 'done')
  const order = s.salesOrders.find(o => o.id === sales[1].id)
  await h.command('so.reserve', { orderId: order.id })
  s = await h.state()
  assert.equal(record(s, 'sales', order.id).productionStatus, 'ready to ship')
  const missing = await h.command('wo.draft', { itemId: noBom.id, quantity: '1', requiredBy: date(2), reason: 'Engineering prerequisite' })
  s = await h.state(); assert.equal(record(s, 'work', missing.id).ingredientStatus, 'No BOM')
  assert.equal(s.commands.some(c => c.type === 'plan.draft'), false)
})
