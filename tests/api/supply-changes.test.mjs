// MRP-002: expedite, defer and cancel recommendations on open purchase lines, their affected orders and the
// buyer's or manager's recorded decision, read through the public planning and command doors.
import test from 'node:test'
import assert from 'node:assert/strict'
import { installation } from './harness.mjs'

const date = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)

test('MRP-002 a delayed component PO recommends an expedite naming the orders it hurts, cancelling a demand turns surplus into a cancel only a manager approves, and no reservation is orphaned', async t => {
  const h = await installation(); t.after(() => h.close())
  const person = (name, role) => h.person(`mrp2-${name}@example.test`, role)
  const buyer = await person('buyer', 'buyer'), manager = await person('manager', 'manager'), agent = await person('agent', 'agent')
  const raw = await h.command('item.save', { sku: 'synthetic-larder-201', name: 'Supply change raw', kind: 'buy', baseUnit: 'each' })
  const location = await h.command('location.save', { name: 'Supply change stores' })
  const customer = await h.command('party.save', { name: 'Supply change customer', kind: 'customer' }), supplier = await h.command('party.save', { name: 'Supply change supplier', kind: 'supplier' })
  await h.command('opening.record', { locationId: location.id, countedOn: date(0), valuationBasis: 'supplier-invoice', countedBy: 'Olive', evidence: { name: 'count.txt', contentType: 'text/plain', base64: Buffer.from('count').toString('base64') }, lines: [{ itemId: raw.id, quantity: '1', unitCost: '2' }] })
  const buy = async (quantity, days) => {
    const p = await h.command('po.draft', { supplierId: supplier.id, expectedDate: date(days), reason: 'synthetic-larder-202 supply', lines: [{ itemId: raw.id, quantity, unitPrice: '2' }] })
    return h.command('po.approve', { poId: p.id, version: p.version })
  }
  const order = async (quantity, days) => {
    const q = await h.command('so.quote', { customerId: customer.id, promiseDate: date(days), lines: [{ itemId: raw.id, quantity, unitPrice: '10' }] })
    return h.command('so.confirm', { orderId: q.id, version: q.version, reserve: false })
  }
  const first = await order('4', 10), second = await order('3', 12)
  await h.command('so.reserve', { orderId: second.id, locationId: location.id })
  const sooner = await buy('4', 4), later = await buy('3', 5)
  const read = async () => { const res = await h.request('/api/larder/planning/supply-changes'); assert.equal(res.status, 200); return res.json() }
  const find = (plan, kind, po) => plan.recommendations.find(r => r.kind === kind && r.poId === po.id)
  const decide = (who, type, plan, rec, extra = {}, opts = {}) => who.run(type, { key: rec.key, version: plan.version, asOf: plan.asOf, reason: 'synthetic-larder-203 planner review', ...extra }, opts)

  // Both POs land before the orders need them. One unit of the later PO is surplus; the manager keeps it as a buffer and the reason is recorded.
  let plan = await read()
  const buffer = find(plan, 'cancel', later)
  assert.deepEqual([plan.recommendations.length, buffer.quantity, buffer.affected.map(a => [a.documentId, a.quantity])], [1, '1', [[second.id, '2']]])
  const lines = async () => (await h.state()).purchaseOrders.find(p => p.id === later.id).lines, untouched = await lines()
  const kept = await decide(manager, 'supply.change.reject', plan, buffer, { reason: 'synthetic-larder-204 keep the buffer' })
  assert.deepEqual([kept.decision, kept.note], ['rejected', 'synthetic-larder-204 keep the buffer']); assert.deepEqual(await lines(), untouched)
  // The supplier slips the first PO past both orders: the orders it hurts are named and the PO is the expedite.
  const slipped = await h.command('po.revise', { poId: sooner.id, version: sooner.version, expectedDate: date(20), note: 'Supplier delay' })
  plan = await read()
  const expedite = find(plan, 'expedite', slipped)
  assert.deepEqual([expedite.requestedDate, expedite.quantity, expedite.affected.map(a => [a.documentId, a.shortage])], [date(10), '3', [[first.id, '1'], [second.id, '2']]])

  // Agents never decide; a stale view, an unknown key or a missing reason is refused.
  await decide(agent, 'supply.change.approve', plan, expedite, {}, { error: 'FORBIDDEN' })
  await decide(buyer, 'supply.change.approve', plan, expedite, { reason: '' }, { error: 'INPUT' })
  await decide(buyer, 'supply.change.approve', { ...plan, version: plan.version - 1 }, expedite, {}, { error: 'STALE' })
  await decide(buyer, 'supply.change.approve', plan, { key: 'unknown' }, {}, { error: 'NOT_FOUND' })
  const before = await h.state(), outbound = h.outboundCount()
  const approved = await decide(buyer, 'supply.change.approve', plan, expedite)
  assert.deepEqual([approved.decision, approved.category, approved.recommendation.affected.map(a => a.documentId)], ['approved', 'supply-change', [first.id, second.id]])
  // An approved expedite is a recorded request: the supplier's date and every commitment stay as they were, and nothing is sent.
  const after = await h.state(), requested = after.purchaseOrders.find(p => p.id === sooner.id).lines[0]
  assert.deepEqual([requested.supplyRequest.kind, requested.supplyRequest.requestedDate, requested.expectedDate], ['expedite', date(10), date(20)])
  assert.deepEqual([after.reservations, after.movements], [before.reservations, before.movements]); assert.equal(h.outboundCount(), outbound)

  // The customer then cancels the second order: its reservation is released, the first is covered by stock and the later PO,
  // and the delayed PO is no longer needed by anyone. Only a manager can cancel it.
  const live = (await h.state()).salesOrders.find(o => o.id === second.id)
  await h.command('so.cancelLine', { orderId: live.id, version: live.version, lineId: live.lines[0].id, quantity: '3', customerApproval: { name: 'Buyer', reference: 'Cancellation email', approvedOn: date(0) }, reason: 'Customer cancelled' })
  const orphans = async () => {
    const s = await h.invariant()
    const open = new Set(s.salesOrders.filter(o => !['cancelled', 'shipped'].includes(o.status)).map(o => o.id))
    return s.reservations.filter(r => !open.has(r.demandId))
  }
  assert.deepEqual(await orphans(), [])
  plan = await read()
  assert.deepEqual(plan.recommendations.filter(r => r.kind === 'expedite'), [])
  const surplus = find(plan, 'cancel', slipped)
  assert.deepEqual([surplus.quantity, surplus.requestedDate, surplus.affected], ['4', null, []])
  await decide(buyer, 'supply.change.approve', plan, surplus, {}, { error: 'FORBIDDEN' })
  await decide(manager, 'supply.change.approve', plan, surplus)
  const trimmed = (await h.state()).purchaseOrders.find(p => p.id === sooner.id)
  assert.deepEqual([trimmed.status, trimmed.lines[0].quantity, trimmed.lines[0].cancelled, trimmed.exposure, trimmed.history.at(-1).change], ['cancelled', '0', '4', '0', 'supply change approved: cancel'])
  assert.deepEqual(await orphans(), [])
  plan = await read()
  assert.equal(find(plan, 'cancel', slipped), undefined)
  const covered = await (await h.request('/api/larder/planning/materials')).json()
  assert.deepEqual(covered.requirements.map(r => [r.documentId, r.shortage]), [[first.id, '0']])

  // The audit holds each decision.
  const trail = await (await h.request('/api/larder/audit?command=supply.change.approve')).json()
  assert.ok(trail.entries.some(e => e.subjectId === sooner.id))

  // Restart and the business archive reproduce the recommendations and the recorded decisions.
  const expected = await read()
  await h.restart(); assert.deepEqual(await read(), expected)
  const archive = await (await h.request('/api/larder/archive')).json(), target = await installation(); t.after(() => target.close())
  const restored = await target.request('/api/larder/archive/restore', { method: 'POST', body: archive }); assert.equal(restored.status, 200, await restored.text())
  assert.deepEqual((await (await target.request('/api/larder/planning/supply-changes')).json()).recommendations, expected.recommendations)
  assert.deepEqual((await target.state()).purchaseOrders.find(p => p.id === sooner.id).lines, (await h.state()).purchaseOrders.find(p => p.id === sooner.id).lines)
  await h.invariant()
})

test('MRP-002 supply that lands weeks before its demand recommends a deferral to the day it is first needed and an approved deferral is only a recorded request', async t => {
  const h = await installation(); t.after(() => h.close())
  const raw = await h.command('item.save', { sku: 'synthetic-larder-205', name: 'Deferral raw', kind: 'buy', baseUnit: 'each' })
  const customer = await h.command('party.save', { name: 'Deferral customer', kind: 'customer' }), supplier = await h.command('party.save', { name: 'Deferral supplier', kind: 'supplier' })
  const draft = await h.command('po.draft', { supplierId: supplier.id, expectedDate: date(2), reason: 'synthetic-larder-206 early supply', lines: [{ itemId: raw.id, quantity: '5', unitPrice: '2' }] })
  const po = await h.command('po.approve', { poId: draft.id, version: draft.version })
  const quote = await h.command('so.quote', { customerId: customer.id, promiseDate: date(30), lines: [{ itemId: raw.id, quantity: '5', unitPrice: '10' }] })
  const sale = await h.command('so.confirm', { orderId: quote.id, version: quote.version, reserve: false })
  const plan = await (await h.request('/api/larder/planning/supply-changes')).json()
  const [defer] = plan.recommendations
  assert.deepEqual([plan.recommendations.length, defer.kind, defer.requestedDate, defer.quantity, defer.affected.map(a => a.documentId)], [1, 'defer', date(30), '5', [sale.id]])
  const done = await h.command('supply.change.approve', { key: defer.key, version: plan.version, asOf: plan.asOf, reason: 'synthetic-larder-207 cash timing' })
  assert.equal(done.recommendation.kind, 'defer')
  const line = (await h.state()).purchaseOrders.find(p => p.id === po.id).lines[0]
  assert.deepEqual([line.supplyRequest.kind, line.supplyRequest.requestedDate, line.expectedDate], ['defer', date(30), date(2)])
  await h.invariant()
})
