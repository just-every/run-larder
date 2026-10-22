// MRP-001: material-feasible WIP, supplier calendars and future dated floor replenishment in the dated projection.
import test from 'node:test'
import assert from 'node:assert/strict'
import { installation, evidence } from './harness.mjs'

const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const shift = (on, n) => new Date(Date.parse(on + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)

// A raw material, a stocked-by-work subassembly and a finished good: F = S + C, S = 2 R.
async function plant(h, { raw, comp }) {
  const loc = await h.command('location.save', { name: 'MRP feasibility stores' })
  const item = (sku, kind) => h.command('item.save', { sku, name: sku, kind, baseUnit: 'each' })
  const [r, c, s, f] = [await item('FEAS-R', 'buy'), await item('FEAS-C', 'buy'), await item('FEAS-S', 'make'), await item('FEAS-F', 'make')]
  await h.command('bom.revise', { itemId: s.id, components: [{ itemId: r.id, quantity: '2' }] })
  await h.command('bom.revise', { itemId: f.id, components: [{ itemId: s.id, quantity: '1' }, { itemId: c.id, quantity: '1' }] })
  await h.command('opening.record', { locationId: loc.id, countedOn: day(0), valuationBasis: 'supplier-invoice', countedBy: 'Olive', evidence: evidence(), lines: [{ itemId: r.id, quantity: raw, unitCost: '1' }, { itemId: c.id, quantity: comp, unitCost: '1' }] })
  const supplier = await h.command('party.save', { name: 'Feasibility supplier', kind: 'supplier' }), customer = await h.command('party.save', { name: 'Feasibility customer', kind: 'customer' })
  const order = async (quantity, days) => {
    const q = await h.command('so.quote', { customerId: customer.id, promiseDate: day(days), lines: [{ itemId: f.id, quantity }] })
    return h.command('so.confirm', { orderId: q.id, version: q.version, reserve: false })
  }
  const job = async (itemId, quantity, requiredBy) => { const d = await h.command('wo.draft', { itemId, quantity, requiredBy: day(requiredBy), reason: 'MRP-001 feasibility proof' }); return h.command('wo.release', { workOrderId: d.id, version: d.version }) }
  const read = async () => { const res = await h.request('/api/larder/planning/materials'); assert.equal(res.status, 200); return res.json() }
  return { loc, r, c, s, f, supplier, customer, order, job, read }
}
const requirement = (plan, documentId, itemId) => plan.requirements.find(r => r.documentId === documentId && r.itemId === itemId)
const feasibility = (plan, id) => plan.workFeasibility.find(w => w.workOrderId === id)

test('MRP-001 released work nets demand on its completion day only while every pinned input is covered, explodes only the remainder and recovers when a PO lands before its inputs are needed', async t => {
  const h = await installation(); t.after(() => h.close())
  const p = await plant(h, { raw: '10', comp: '8' })
  const first = await p.order('4', 10)
  // Without any outstanding work the finished order explodes into a subassembly shortage.
  let plan = await p.read()
  assert.deepEqual([requirement(plan, first.id, p.s.id).shortage, requirement(plan, first.id, p.s.id).supply, plan.workFeasibility], ['4', 'make', []])
  // A released job whose eight raw units are in stock is proven: its output covers the order from its completion day.
  const proven = await p.job(p.s.id, '4', 5)
  plan = await p.read()
  assert.deepEqual([feasibility(plan, proven.id).feasible, feasibility(plan, proven.id).remainingOutput, feasibility(plan, proven.id).completionOn, feasibility(plan, proven.id).shortages], [true, '4', day(5), []])
  const covered = requirement(plan, first.id, p.s.id)
  assert.deepEqual([covered.covered, covered.shortage, covered.sources.map(s => [s.kind, s.documentId, s.date, s.quantity])], ['4', '0', [['work', proven.id, day(5), '4']]])
  assert.deepEqual([plan.blockedExplosions, plan.provisionalSupply.some(s => s.documentId === proven.id)], [[], false])
  // A second job needs eight more raw units but only two remain: it is unproven, so its output covers nothing
  // and the order it would have served stays blocked rather than exploding again beside it.
  const second = await p.order('4', 11), unproven = await p.job(p.s.id, '4', 6)
  plan = await p.read()
  assert.deepEqual([feasibility(plan, unproven.id).feasible, feasibility(plan, unproven.id).reason, feasibility(plan, unproven.id).shortages], [false, 'pinned inputs are not all covered', [{ itemId: p.r.id, quantity: '6' }]])
  assert.deepEqual([requirement(plan, second.id, p.s.id).shortage, plan.blockedExplosions.map(b => [b.documentId, b.quantity, b.workOrderIds])], ['4', [[second.id, '4', [unproven.id]]]])
  assert.ok(plan.provisionalSupply.some(s => s.documentId === unproven.id && s.reason === 'work material feasibility not proven'))
  // A PO landing after the job's inputs are needed does not prove it; the same PO landing before does.
  let po = await h.command('po.draft', { supplierId: p.supplier.id, expectedDate: day(8), reason: 'MRP-001 raw for the second job', lines: [{ itemId: p.r.id, quantity: '6', unitPrice: '1' }] })
  po = await h.command('po.approve', { poId: po.id, version: po.version })
  plan = await p.read()
  assert.equal(feasibility(plan, unproven.id).feasible, false)
  assert.ok(requirement(plan, unproven.id, p.r.id).unavailablePurchases.some(x => x.documentId === po.id && x.reason === 'after required date'))
  await h.command('po.revise', { poId: po.id, version: po.version, expectedDate: day(4), note: 'Supplier pulled the delivery forward' })
  plan = await p.read()
  assert.equal(feasibility(plan, unproven.id).feasible, true)
  assert.deepEqual(requirement(plan, unproven.id, p.r.id).sources.map(s => [s.kind, s.documentId]), [['stock', ''], ['purchase', po.id]])
  const served = requirement(plan, second.id, p.s.id)
  assert.deepEqual([served.shortage, served.sources.map(s => [s.kind, s.documentId])], ['0', [['work', unproven.id]]])
  assert.deepEqual(plan.blockedExplosions, [])
  // The projection is read-only, survives a restart and reproduces from the business archive.
  const before = await h.state(), outbound = h.outboundCount()
  assert.deepEqual(await p.read(), plan); assert.deepEqual(await h.state(), before); assert.equal(h.outboundCount(), outbound)
  await h.restart(); assert.deepEqual(await p.read(), plan)
  const archive = await (await h.request('/api/larder/archive')).json(), target = await installation(); t.after(() => target.close())
  const restored = await target.request('/api/larder/archive/restore', { method: 'POST', body: archive }); assert.equal(restored.status, 200, await restored.text())
  const copy = await (await target.request('/api/larder/planning/materials')).json()
  for (const key of ['requirements', 'workFeasibility', 'blockedExplosions', 'provisionalSupply', 'scope', 'limitations']) assert.deepEqual(copy[key], plan[key], key)
  await h.invariant()
})

test('MRP-001 proven work chains through multilevel jobs and is followed to the demand it supplies', async t => {
  const h = await installation(); t.after(() => h.close())
  const p = await plant(h, { raw: '10', comp: '8' })
  const sub = await p.job(p.s.id, '4', 3), top = await p.job(p.f.id, '4', 6), sale = await p.order('4', 10)
  const plan = await p.read()
  // The finished job is only provable once the subassembly job's output is counted as its input.
  assert.deepEqual([feasibility(plan, sub.id).feasible, feasibility(plan, top.id).feasible, plan.provisionalSupply.filter(s => s.kind === 'work')], [true, true, []])
  assert.deepEqual(requirement(plan, top.id, p.s.id).sources.map(s => [s.kind, s.documentId, s.quantity]), [['work', sub.id, '4']])
  assert.deepEqual(requirement(plan, sale.id, p.f.id).sources.map(s => [s.kind, s.documentId, s.quantity]), [['work', top.id, '4']])
  assert.deepEqual(plan.requirements.filter(r => r.documentId === sale.id && r.itemId !== p.f.id), [])
  const pegs = await (await h.request(`/api/larder/planning/pegging?kind=work&id=${sub.id}`)).json()
  assert.deepEqual(pegs.pegs.filter(x => x.source.kind === 'work' && x.source.documentId === sub.id).map(x => [x.demand.kind, x.demand.documentId, x.source.quantity]), [['work', top.id, '4']])
  // Inputs a released job reserved stay protected: a later job competing for the same raw stock is the unproven one,
  // while the proven chain keeps covering the order.
  const other = await h.command('item.save', { sku: 'FEAS-X', name: 'Unrelated raw consumer', kind: 'make', baseUnit: 'each' })
  await h.command('bom.revise', { itemId: other.id, components: [{ itemId: p.r.id, quantity: '1' }] })
  const rival = await p.job(other.id, '10', 1)
  const after = await p.read()
  assert.deepEqual([feasibility(after, rival.id).feasible, feasibility(after, rival.id).shortages, feasibility(after, sub.id).feasible, feasibility(after, top.id).feasible], [false, [{ itemId: p.r.id, quantity: '8' }], true, true])
  assert.equal(requirement(after, sale.id, p.f.id).shortage, '0')
  await h.invariant()
})

test('MRP-001 bought suggestions follow the supplier calendar, lead working days, MOQ and pack, and restore an uncovered floor from dated supply', async t => {
  const h = await installation(); t.after(() => h.close())
  const item = await h.command('item.save', { sku: 'CAL-BUY', name: 'Calendar-bound material', kind: 'buy', baseUnit: 'each' })
  const floorItem = await h.command('item.save', { sku: 'CAL-FLOOR', name: 'Floor material', kind: 'buy', baseUnit: 'each' })
  const loc = await h.command('location.save', { name: 'Calendar stores' })
  const supplier = await h.command('party.save', { name: 'Weekday supplier', kind: 'supplier' }), customer = await h.command('party.save', { name: 'Weekend customer', kind: 'customer' })
  let saturday = day(14); while (new Date(saturday + 'T00:00:00Z').getUTCDay() !== 6) saturday = shift(saturday, 1)
  const [friday, thursday, tuesday] = [shift(saturday, -1), shift(saturday, -2), shift(saturday, -4)]
  const terms = { itemId: item.id, partyId: supplier.id, partyCode: 'CAL-1', packQuantity: '5', moq: '10', leadDays: 2, weekdays: [1, 2, 3, 4, 5], closedDates: [thursday], price: '3', breaks: [], currency: 'USD', usdRate: '1', rateOn: day(0), rateSource: 'Buyer quotation', paymentTerms: 'Net 30', freightTerms: 'Delivered', preferred: true }
  await h.command('supplier.terms', terms)
  const q = await h.command('so.quote', { customerId: customer.id, promiseDate: saturday, lines: [{ itemId: item.id, quantity: '7' }] })
  const sale = await h.command('so.confirm', { orderId: q.id, version: q.version, reserve: false })
  const read = async () => (await h.request('/api/larder/planning/materials')).json()
  let plan = await read(), row = plan.requirements.find(r => r.documentId === sale.id)
  // Saturday is closed: receipt moves to Friday, and with Thursday closed two working days of lead start on Tuesday.
  assert.deepEqual(row.suggestion, { kind: 'buy', quantity: '10', shortageQuantity: '7', supplierId: supplier.id, receiptOn: friday, releaseOn: tuesday, leadDays: 2, requiresPastRelease: false, basis: 'supplier working days and closed dates, MOQ and pack quantity', quotedUnitPrice: '3' })
  const draft = await h.command('plan.draft', { itemId: item.id, dated: { version: plan.version, asOf: plan.asOf, key: row.key }, unitPrice: '3', reason: 'Calendar-aware dated purchase' })
  assert.deepEqual([draft.status, draft.expectedDate, draft.lines[0].quantity, draft.lines[0].expectedDate], ['draft', friday, '10', friday])
  // Floors: a catalog floor of 5 with 2 on hand is short by 3; an approved PO restores it on its receipt day without
  // counting as physical cover, and the buy suggestion drops to what no supply has scheduled.
  await h.command('item.save', { ...floorItem, catalogLocations: [{ locationId: loc.id, safetyStock: '5' }] })
  await h.command('opening.record', { locationId: loc.id, countedOn: day(0), valuationBasis: 'supplier-invoice', countedBy: 'Olive', evidence: evidence(), lines: [{ itemId: floorItem.id, quantity: '2', unitCost: '1' }] })
  const floor = async () => (await read()).requirements.find(r => r.kind === 'safety' && r.itemId === floorItem.id)
  let restored = await floor()
  assert.deepEqual([restored.covered, restored.shortage, restored.replenishment, restored.restoredOn, restored.suggestion.quantity], ['2', '3', [], null, '3'])
  let po = await h.command('po.draft', { supplierId: supplier.id, expectedDate: day(6), reason: 'MRP-001 floor replenishment', lines: [{ itemId: floorItem.id, quantity: '2', unitPrice: '1' }] })
  po = await h.command('po.approve', { poId: po.id, version: po.version })
  restored = await floor()
  assert.deepEqual([restored.covered, restored.shortage, restored.replenishment.map(r => [r.kind, r.documentId, r.date, r.quantity]), restored.restoredOn, restored.suggestion.quantity], ['2', '3', [['purchase', po.id, day(6), '2']], null, '1'])
  let more = await h.command('po.draft', { supplierId: supplier.id, expectedDate: day(9), reason: 'MRP-001 second floor replenishment', lines: [{ itemId: floorItem.id, quantity: '4', unitPrice: '1' }] })
  more = await h.command('po.approve', { poId: more.id, version: more.version })
  restored = await floor()
  assert.deepEqual([restored.replenishment.map(r => [r.documentId, r.quantity]), restored.restoredOn, restored.suggestion, restored.sources.every(s => s.kind === 'stock')], [[[po.id, '2'], [more.id, '1']], day(9), null, true])
  await h.invariant()
})
