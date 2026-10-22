// BUY-002: a short delivery for two pegged jobs with damaged units, supplier documents and tolerance, then allocation of the
// accepted stock to the demand the dated plan pegs it to, through the public receiving, planning and command doors.
import test from 'node:test'
import assert from 'node:assert/strict'
import { installation, evidence } from './harness.mjs'

const date = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)

async function plant(h) {
  const raw = await h.command('item.save', { sku: 'synthetic-larder-211', name: 'Receiving raw', kind: 'buy', baseUnit: 'each' })
  const widget = await h.command('item.save', { sku: 'synthetic-larder-212', name: 'Receiving widget', kind: 'make', baseUnit: 'each' })
  await h.command('bom.revise', { itemId: widget.id, components: [{ itemId: raw.id, quantity: '1' }] })
  const location = await h.command('location.save', { name: 'Receiving dock' }), supplier = await h.command('party.save', { name: 'Receiving supplier', kind: 'supplier' })
  const job = async (quantity, days) => { const d = await h.command('wo.draft', { itemId: widget.id, quantity, requiredBy: date(days), reason: 'synthetic-larder-213 receiving job' }); return h.command('wo.release', { workOrderId: d.id, version: d.version }) }
  const buy = async (quantity, days, tolerancePercent) => {
    const p = await h.command('po.draft', { supplierId: supplier.id, expectedDate: date(days), reason: 'synthetic-larder-214 supply', lines: [{ itemId: raw.id, quantity, unitPrice: '2', ...(tolerancePercent ? { tolerancePercent } : {}) }] })
    return h.command('po.approve', { poId: p.id, version: p.version })
  }
  const get = async path => { const res = await h.request(path), body = await res.json(); assert.equal(res.status, 200, JSON.stringify(body)); return body }
  return { raw, widget, location, supplier, job, buy, get }
}

test('BUY-002 a short delivery for two pegged jobs quarantines the damaged units, keeps supplier documents, allocates only the accepted stock to the jobs and shows the late remainder as an expedite', async t => {
  const h = await installation(); t.after(() => h.close())
  const p = await plant(h), warehouse = await h.person('mrp2-warehouse@example.test', 'warehouse'), agent = await h.person('mrp2-agent@example.test', 'agent'), buyer = await h.person('mrp2-buyer@example.test', 'buyer')
  const first = await p.job('4', 6), second = await p.job('4', 8)
  const po = await p.buy('10', 3)
  const line = po.lines[0]
  // Ten arrive on the day they are needed: both jobs are pegged to the PO and nothing is short.
  let plan = await p.get('/api/larder/planning/materials')
  assert.deepEqual(plan.requirements.filter(r => r.itemId === p.raw.id).map(r => [r.documentId, r.shortage, r.sources.map(s => [s.kind, s.documentId, s.quantity])]), [[first.id, '0', [['purchase', po.id, '4']]], [second.id, '0', [['purchase', po.id, '4']]]])

  // Seven are delivered, two of them crushed; the delivery note is kept; the supplier says the last three come after the second job needs them.
  const note = evidence('Delivery note DN-7 with crushed pallet photo reference')
  const receipt = await warehouse.run('receipt.create', { poId: po.id, supplierReference: 'DN-7', documents: [note], lines: [{ lineId: line.id, locationId: p.location.id, quantity: '7', lot: 'SYN-LOT', damage: { quantity: '2', reason: 'Crushed pallet corner' } }] })
  assert.deepEqual(receipt.documents.map(d => d.name), [note.name])
  assert.deepEqual(receipt.lines.map(l => [l.quantity, l.inspection, l.damageReason ?? null]), [['5', 'accept', null], ['2', 'quarantine', 'Crushed pallet corner']])
  const [good, bad] = receipt.lines
  let state = await h.state()
  assert.deepEqual([state.lots.find(l => l.id === good.lotId).status, state.lots.find(l => l.id === bad.lotId).status, state.lots.find(l => l.id === bad.lotId).code], ['released', 'quarantined', 'SYN-LOT-DAMAGED'])
  assert.deepEqual([state.purchaseOrders[0].status, state.purchaseOrders[0].lines[0].received], ['part received', '7'])
  await h.command('po.revise', { poId: po.id, version: state.purchaseOrders[0].version, expectedDate: date(12), note: 'Supplier ships the rest late' })
  plan = await p.get('/api/larder/planning/materials')
  const need = plan.requirements.filter(r => r.itemId === p.raw.id)
  assert.deepEqual(need.map(r => [r.documentId, r.covered, r.shortage]), [[first.id, '4', '0'], [second.id, '1', '3']])
  // The late remainder is the proposed date change, naming the job it hurts.
  const changes = await p.get('/api/larder/planning/supply-changes'), expedite = changes.recommendations.find(r => r.kind === 'expedite')
  assert.deepEqual([expedite.quantity, expedite.requestedDate, expedite.affected.map(a => [a.documentId, a.shortage])], ['3', date(8), [[second.id, '3']]])

  // Allocation: agents never allocate; stale pegs are refused; only the five accepted units are reserved, in date order, never the damaged two.
  const pegs = await p.get('/api/larder/planning/pegging?kind=receipt&id=' + receipt.id)
  const allocate = (who, extra = {}, opts = {}) => who.run('receipt.allocate', { receiptId: receipt.id, version: pegs.version, asOf: pegs.asOf, reason: 'synthetic-larder-215 allocate the accepted stock', ...extra }, opts)
  await allocate(agent, {}, { error: 'FORBIDDEN' }); await allocate(buyer, {}, { error: 'FORBIDDEN' })
  await allocate(warehouse, { version: pegs.version - 1 }, { error: 'STALE' })
  const before = await h.state(), outbound = h.outboundCount()
  const done = await allocate(warehouse)
  assert.deepEqual(done.allocated.map(a => [a.demandKind, a.demandId, a.quantity]), [['work', first.id, '4'], ['work', second.id, '1']])
  assert.deepEqual(done.skipped, [])
  state = await h.state()
  assert.deepEqual(state.reservations.filter(r => r.itemId === p.raw.id).map(r => [r.demandId, r.quantity]).sort(), [[first.id, '4'], [second.id, '1']].sort())
  assert.deepEqual([state.movements.length, h.outboundCount()], [before.movements.length, outbound])
  assert.equal((await p.get('/api/larder/planning/pegging?kind=lot&id=' + bad.lotId)).pegs.length, 0)
  // Allocating again changes nothing: every peg is already a reservation.
  const again = await p.get('/api/larder/planning/pegging?kind=receipt&id=' + receipt.id)
  assert.deepEqual((await warehouse.run('receipt.allocate', { receiptId: receipt.id, version: again.version, asOf: again.asOf, reason: 'synthetic-larder-216 repeat' })).allocated, [])
  assert.equal((await h.state()).reservations.filter(r => r.itemId === p.raw.id).reduce((n, r) => n + Number(r.quantity), 0), 5)
  // The buyer approves the expedite as a recorded request; the damaged lot is rejected by a person with authority and stays out of the plan.
  const view = await p.get('/api/larder/planning/supply-changes')
  await buyer.run('supply.change.approve', { key: view.recommendations.find(r => r.kind === 'expedite').key, version: view.version, asOf: view.asOf, reason: 'synthetic-larder-217 ask for the rest sooner' })
  await h.command('quarantine.decide', { itemId: p.raw.id, locationId: p.location.id, lotId: bad.lotId, quantity: '2', decision: 'reject', reason: 'Damaged in transit, supplier credit requested' })
  assert.equal((await h.state()).lots.find(l => l.id === bad.lotId).status, 'rejected')

  // Restart and restore keep the receipt, its documents, the reservations and the open remainder.
  const expected = await p.get('/api/larder/planning/materials')
  await h.restart(); assert.deepEqual((await p.get('/api/larder/planning/materials')).requirements, expected.requirements)
  const archive = await (await h.request('/api/larder/archive')).json(), target = await installation(); t.after(() => target.close())
  const restored = await target.request('/api/larder/archive/restore', { method: 'POST', body: archive }); assert.equal(restored.status, 200, await restored.text())
  const copy = await target.state(), source = await h.state()
  assert.deepEqual([copy.receipts[0].documents, copy.reservations, copy.purchaseOrders[0].lines[0].received], [source.receipts[0].documents, source.reservations, '7'])
  await h.invariant()
})

test('BUY-002 a line tolerance accepts a small over-delivery, refuses more, and a delivery within it offers the manager a close of the remainder', async t => {
  const h = await installation(); t.after(() => h.close())
  const p = await plant(h), manager = await h.person('mrp2-tolerance-manager@example.test', 'manager')
  await h.command('po.draft', { supplierId: p.supplier.id, expectedDate: date(3), reason: 'synthetic-larder-218', lines: [{ itemId: p.raw.id, quantity: '10', unitPrice: '2', tolerancePercent: '25' }] }, { error: 'INPUT' })
  const strict = await p.buy('10', 3)
  await h.command('receipt.create', { poId: strict.id, supplierReference: 'S1', lines: [{ lineId: strict.lines[0].id, locationId: p.location.id, quantity: '11' }] }, { error: 'OVER_RECEIPT' })
  const loose = await p.buy('10', 3, '10')
  await h.command('receipt.create', { poId: loose.id, supplierReference: 'L1', lines: [{ lineId: loose.lines[0].id, locationId: p.location.id, quantity: '12' }] }, { error: 'OVER_RECEIPT' })
  await h.command('receipt.create', { poId: loose.id, supplierReference: 'L2', lines: [{ lineId: loose.lines[0].id, locationId: p.location.id, quantity: '11' }] })
  assert.equal((await h.state()).purchaseOrders.find(x => x.id === loose.id).status, 'received')
  // A delivery inside the tolerance on the short side leaves a remainder nobody is waiting for: closing it is a manager's recorded decision.
  const short = await p.buy('10', 3, '10')
  await h.command('receipt.create', { poId: short.id, supplierReference: 'T1', lines: [{ lineId: short.lines[0].id, locationId: p.location.id, quantity: '9' }] })
  const view = await p.get('/api/larder/planning/supply-changes'), close = view.recommendations.find(r => r.poId === short.id)
  assert.deepEqual([close.kind, close.quantity], ['cancel', '1'])
  await manager.run('supply.change.approve', { key: close.key, version: view.version, asOf: view.asOf, reason: 'synthetic-larder-219 supplier will not send the last unit' })
  const closed = (await h.state()).purchaseOrders.find(x => x.id === short.id)
  assert.deepEqual([closed.status, closed.lines[0].quantity, closed.lines[0].received, closed.lines[0].cancelled], ['received', '9', '9', '1'])
  await h.invariant()
})
