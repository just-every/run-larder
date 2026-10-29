import test from 'node:test'
import assert from 'node:assert/strict'
import { installation, evidence, parse } from './harness.mjs'

const date = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
test('ENG-001 three-level shared netting, stocked subassembly, phantom/yield/make-buy choices, effective cycles and immutable released recipes', async t => {
  const h = await installation(); t.after(() => h.close())
  const item = async (sku, kind = 'make') => h.command('item.save', { sku, name: sku, kind, baseUnit: 'each', standardCost: '2' })
  const raw = await item('ALLOY', 'buy'), left = await item('LEFT'), right = await item('RIGHT'), kit = await item('FASTENER-KIT'), product = await item('FRAME')
  const location = await h.command('location.save', { name: 'Ohio production stores' })
  const customer = await h.command('party.save', { name: 'Equipment Works', kind: 'customer' })
  const supplier = await h.command('party.save', { name: 'Components Co', kind: 'supplier' })
  await h.command('partyItem.save', { partyId: supplier.id, itemId: raw.id, partyCode: 'AL-1', price: '2', preferred: true })
  await h.command('bom.revise', { itemId: left.id, yield: '0.5', components: [{ itemId: raw.id, quantity: '2' }] })
  await h.command('bom.revise', { itemId: right.id, components: [{ itemId: raw.id, quantity: '3' }] })
  const kitBom = await h.command('bom.revise', { itemId: kit.id, components: [{ itemId: raw.id, quantity: '1' }] })
  const recipe = [{ itemId: left.id, quantity: '1' }, { itemId: right.id, quantity: '1' }, { itemId: kit.id, quantity: '1', supply: 'phantom' }]
  await h.command('bom.revise', { itemId: product.id, components: recipe })
  await h.command('opening.record', { locationId: location.id, countedOn: date(0), countedBy: 'Olive', valuationBasis: 'supplier-invoice', evidence: evidence(), lines: [{ itemId: raw.id, quantity: '3', unitCost: '2' }, { itemId: left.id, quantity: '1', unitCost: '8' }, { itemId: kit.id, quantity: '100', unitCost: '2' }] })
  const quote = await h.command('so.quote', { customerId: customer.id, promiseDate: date(10), lines: [{ itemId: product.id, quantity: '2' }] })
  await h.command('so.confirm', { orderId: quote.id, version: quote.version, reserve: false })
  const short = async id => (await h.state()).shortages.find(r => r.itemId === id)
  assert.equal((await short(left.id)).shortage, '1')
  assert.equal((await short(right.id)).shortage, '2')
  assert.equal(await short(kit.id), undefined) // phantom stock is never coverage
  let material = await short(raw.id)
  assert.deepEqual([material.demand, material.available, material.shortage], ['12', '3', '9'])
  assert.equal(material.pegs.reduce((n, p) => n + Number(p.quantity), 0), 12)
  assert.ok(material.pegs.every(p => p.documentId === quote.id && p.path.length === 2))
  const topDraft = await h.command('plan.draft', { itemId: product.id })
  assert.equal((await short(raw.id)).shortage, '9') // draft supply and its inputs once
  const released = await h.command('wo.release', { workOrderId: topDraft.id, version: topDraft.version })
  assert.deepEqual(released.components.map(l => [l.itemId, l.required]).sort(), [[left.id, '2'], [right.id, '2'], [raw.id, '2']].sort())
  assert.ok(released.bomRevisions.some(b => b.bomId === kitBom.id))
  assert.equal((await short(raw.id)).shortage, '9')
  const subDraft = await h.command('plan.draft', { itemId: left.id })
  assert.equal(subDraft.quantity, '1'); assert.equal((await short(raw.id)).shortage, '9')
  const subReleased = await h.command('wo.release', { workOrderId: subDraft.id, version: subDraft.version })
  assert.equal(subReleased.components[0].required, '4'); assert.equal((await short(raw.id)).shortage, '9')
  const po = await h.command('plan.draft', { itemId: raw.id })
  assert.equal(po.lines[0].quantity, '9'); assert.equal(await short(raw.id), undefined)
  await h.command('bom.revise', { itemId: kit.id, components: [{ itemId: raw.id, quantity: '8' }] })
  await h.command('bom.revise', { itemId: product.id, components: recipe.map(l => l.itemId === right.id ? { ...l, supply: 'buy' } : l) })
  let s = await h.invariant()
  assert.deepEqual(s.workOrders.find(w => w.id === released.id), released)
  assert.deepEqual(s.workOrders.find(w => w.id === subReleased.id), subReleased)
  // A second order uses the new explicit buy choice: no new right recipe demand.
  const second = await h.command('so.quote', { customerId: customer.id, promiseDate: date(11), lines: [{ itemId: product.id, quantity: '1' }] })
  await h.command('so.confirm', { orderId: second.id, version: second.version, reserve: false })
  assert.equal((await short(right.id)).supplyChoices.buy, '1')
  const bought = await h.command('plan.draft', { itemId: right.id, supply: 'buy', supplierId: supplier.id, unitPrice: '6' })
  assert.equal(bought.lines[0].quantity, '1')
  s = await h.state(); const boms = s.boms
  await h.command('bom.revise', { itemId: left.id, components: [{ itemId: product.id, quantity: '1' }] }, { error: 'BOM_CYCLE' })
  await h.command('bom.revise', { itemId: left.id, effectiveOn: date(5), components: [{ itemId: product.id, quantity: '1' }] }, { error: 'BOM_CYCLE' })
  assert.deepEqual((await h.state()).boms, boms)
  await h.command('bom.revise', { itemId: left.id, yield: '0', components: [{ itemId: raw.id, quantity: '1' }] }, { error: 'DECIMAL' })
  // Six-place upward rounding; an effective future revision stays out of today's plan/release.
  await h.command('bom.revise', { itemId: left.id, yield: '0.3', components: [{ itemId: raw.id, quantity: '1' }] })
  await h.command('bom.revise', { itemId: left.id, effectiveOn: date(7), components: [{ itemId: raw.id, quantity: '100' }] })
  const fractional = await h.command('wo.draft', { itemId: left.id, quantity: '1', requiredBy: date(20), reason: 'Yield rounding' })
  const rounded = await h.command('wo.release', { workOrderId: fractional.id, version: fractional.version })
  assert.equal(rounded.components[0].required, '3.333334')
  const csv = await (await h.request('/api/larder/boms.csv')).text()
  assert.match(csv, /"yield","supply"/)
  assert.match(csv, /"phantom"/)
  const preview = await h.command('bom.bulkPreview', { file: { name: 'recipes.csv', content: csv } })
  assert.equal(preview.errors.length, 0)
  assert.equal(preview.revisions.find(r => r.itemId === left.id).yield, '0.3')
  assert.equal(preview.revisions.find(r => r.itemId === product.id).components.find(l => l.itemId === kit.id).supply, 'phantom')
  await h.command('bom.bulkApprove', { previewId: preview.id, version: preview.version })
  const approved = await h.state()
  assert.equal(approved.boms.filter(b => b.itemId === product.id).at(-1).components.find(l => l.itemId === kit.id).supply, 'phantom')
  assert.deepEqual(approved.workOrders.find(w => w.id === released.id), released)
  await h.invariant()
})

// MRP-001 remains partial: these journeys prove dated physical/purchase
// coverage and current physical floors, not multilevel WIP feasibility or approval of a dated plan.
test('MRP-001 dated physical and PO pools never cover earlier demand with late, held, expired, overdue or draft supply', async t => {
  const h = await installation(); t.after(() => h.close())
  const location = await h.command('location.save', { name: 'MRP dated stores' })
  const raw = await h.command('item.save', { sku: 'MRP-RAW', name: 'Dated raw material', kind: 'buy', baseUnit: 'each' })
  const supplier = await h.command('party.save', { name: 'Dated Components', kind: 'supplier' })
  const customer = await h.command('party.save', { name: 'Dated Customer', kind: 'customer' })
  await h.command('partyItem.save', { partyId: supplier.id, itemId: raw.id, partyCode: 'DATE-1', leadDays: 3, preferred: true })
  const opening = await h.command('po.draft', { supplierId: supplier.id, expectedDate: date(0), reason: 'MRP-001 initial dated lots', lines: [{ itemId: raw.id, quantity: '7', unitPrice: '1' }] })
  await h.command('po.approve', { poId: opening.id, version: opening.version })
  await h.command('receipt.create', { poId: opening.id, supplierReference: 'Opening dated lots', lines: [
    { lineId: opening.lines[0].id, locationId: location.id, quantity: '2', lot: 'EXPIRES-BOUNDARY', dates: { expiresOn: date(2) } },
    { lineId: opening.lines[0].id, locationId: location.id, quantity: '1', lot: 'RETEST-BOUNDARY', dates: { expiresOn: date(20), retestOn: date(2) } },
    { lineId: opening.lines[0].id, locationId: location.id, quantity: '1', lot: 'LONG-LIFE', dates: { expiresOn: date(30) } },
    { lineId: opening.lines[0].id, locationId: location.id, quantity: '3', lot: 'ALREADY-EXPIRED', dates: { expiresOn: date(-1) } },
  ] })
  const purchase = async (quantity, expectedDate, approve = true) => {
    const po = await h.command('po.draft', { supplierId: supplier.id, expectedDate, reason: 'MRP-001 dated supply', lines: [{ itemId: raw.id, quantity, unitPrice: '1' }] })
    return approve ? h.command('po.approve', { poId: po.id, version: po.version }) : po
  }
  let po = await purchase('10', date(5))
  const draft = await purchase('100', date(1), false), overdue = await purchase('100', date(-1)), held = await purchase('4', date(0))
  await h.command('receipt.create', { poId: held.id, supplierReference: 'Damaged shipment', lines: [{ lineId: held.lines[0].id, locationId: location.id, quantity: '4', lot: 'HELD', inspection: 'quarantine' }] })
  const order = async (quantity, promiseDate) => {
    const q = await h.command('so.quote', { customerId: customer.id, promiseDate, lines: [{ itemId: raw.id, quantity, unitPrice: '2' }] })
    return h.command('so.confirm', { orderId: q.id, version: q.version, reserve: false })
  }
  const boundary = await order('3', date(2)), before = await order('6', date(3)), on = await order('7', date(5)), after = await order('5', date(6))
  const read = async () => { const res = await h.request('/api/larder/planning/materials'); assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'no-store'); return res.json() }
  const snapshot = await h.state(), outbound = h.outboundCount()
  const plan = await read(), row = id => plan.requirements.find(r => r.documentId === id)
  assert.equal(plan.version, snapshot.version)
  assert.deepEqual([boundary, before, on, after].map(o => [row(o.id).covered, row(o.id).shortage]), [['3', '0'], ['1', '5'], ['7', '0'], ['3', '2']])
  assert.deepEqual(row(boundary.id).sources.map(s => [s.reference, s.quantity]).sort(), [['EXPIRES-BOUNDARY', '2'], ['RETEST-BOUNDARY', '1']])
  assert.deepEqual(row(before.id).sources.map(s => [s.reference, s.quantity]), [['LONG-LIFE', '1']])
  assert.deepEqual(row(on.id).sources.map(s => [s.documentId, s.quantity, s.date]), [[po.id, '7', date(5)]])
  assert.equal(row(after.id).sources[0].quantity, '3')
  assert.ok(row(before.id).unavailablePurchases.some(p => p.documentId === po.id && p.date === date(5) && p.reason === 'after required date'))
  assert.ok(row(before.id).unavailablePurchases.some(p => p.documentId === overdue.id && p.reason === 'overdue; receipt not recorded'))
  assert.ok(row(before.id).unavailableStock.some(p => p.reason === `expired on ${date(2)}`))
  assert.ok(row(before.id).unavailableStock.some(p => p.reason === `retest was due on ${date(2)}`))
  assert.ok(plan.excludedStock.some(p => p.reason === 'quarantine' && p.quantity === '4'))
  assert.ok(plan.excludedStock.some(p => p.reason === `expired on ${date(-1)}`))
  assert.ok(plan.provisionalSupply.some(p => p.documentId === draft.id && p.quantity === '100'))
  assert.deepEqual(row(before.id).suggestion, { kind: 'buy', quantity: '5', supplierId: supplier.id, receiptOn: date(3), releaseOn: date(0), leadDays: 3, requiresPastRelease: false })
  assert.deepEqual(row(after.id).suggestion, { kind: 'buy', quantity: '2', supplierId: supplier.id, receiptOn: date(6), releaseOn: date(3), leadDays: 3, requiresPastRelease: false })
  assert.deepEqual(await read(), plan)
  assert.deepEqual(await h.state(), snapshot); assert.equal(h.outboundCount(), outbound)
  // An ETA change recomputes from current inputs, never a cached projection.
  po = await h.command('po.revise', { poId: po.id, version: po.version, expectedDate: date(1), note: 'Supplier expedited the same quantity' })
  let changed = await read(), by = id => changed.requirements.find(r => r.documentId === id)
  assert.deepEqual([before, on, after].map(o => [by(o.id).covered, by(o.id).shortage]), [['6', '0'], ['5', '2'], ['0', '5']])
  assert.equal(by(before.id).sources.find(s => s.kind === 'purchase').date, date(1))
  // A quarantined partial receipt reduces future PO quantity but supplies no usable stock.
  await h.command('receipt.create', { poId: po.id, supplierReference: 'Short damaged partial', lines: [{ lineId: po.lines[0].id, locationId: location.id, quantity: '2', lot: 'PART-HELD', inspection: 'quarantine' }] })
  changed = await read()
  assert.deepEqual([before, on, after].map(o => [by(o.id).covered, by(o.id).shortage]), [['6', '0'], ['3', '4'], ['0', '5']])
  // Residual forecast consumes actual demand once and keeps exact base units;
  // an unrecorded lead time stays unknown rather than becoming zero days.
  const fractional = await h.command('item.save', { sku: 'MRP-FRACTION', name: 'Fractional material', kind: 'buy', baseUnit: 'kg' })
  const monday = new Date(date(0) + 'T00:00:00Z'); monday.setUTCDate(monday.getUTCDate() + 8 - (monday.getUTCDay() || 7))
  const week = monday.toISOString().slice(0, 10), sunday = new Date(monday.getTime() + 6 * 86400000).toISOString().slice(0, 10)
  await h.command('opening.record', { locationId: location.id, countedOn: date(0), valuationBasis: 'owner-estimate', countedBy: 'Olive', evidence: evidence(), lines: [{ itemId: fractional.id, quantity: '0.111111', unitCost: '1' }] })
  await h.command('forecast.import', { stateVersion: (await h.state()).version, file: { name: 'fractional.csv', content: `sku,week,quantity,seasonality\nMRP-FRACTION,${week},0.333333,1\n` }, reason: 'MRP-001 exact residual forecast' })
  const fq = await h.command('so.quote', { customerId: customer.id, promiseDate: week, lines: [{ itemId: fractional.id, quantity: '0.111111' }] })
  await h.command('so.confirm', { orderId: fq.id, version: fq.version, reserve: false })
  const residual = (await read()).requirements.find(r => r.itemId === fractional.id && r.kind === 'forecast')
  assert.deepEqual([residual.quantity, residual.covered, residual.shortage, residual.requiredBy], ['0.222222', '0', '0.222222', sunday])
  assert.deepEqual([residual.suggestion.supplierId, residual.suggestion.releaseOn, residual.suggestion.leadDays], [null, null, null])
  await h.command('partyItem.save', { partyId: supplier.id, itemId: fractional.id, partyCode: 'FRAC-1', leadDays: 30, preferred: true })
  const lead = (await read()).requirements.find(r => r.itemId === fractional.id && r.kind === 'forecast').suggestion
  assert.equal(lead.requiresPastRelease, true)
  assert.equal(lead.releaseOn, new Date(Date.parse(sunday + 'T00:00:00Z') - 30 * 86400000).toISOString().slice(0, 10))
  await h.invariant()
})

test('MRP-001 protects each reservation bin on its demand date, pins released inputs and restores the read-only projection without treating unproven WIP as feasible supply', async t => {
  const h = await installation(); t.after(() => h.close())
  const a = await h.command('location.save', { name: 'Reserved bin A' }), b = await h.command('location.save', { name: 'Free bin B' })
  const item = async (sku, kind = 'buy') => h.command('item.save', { sku, name: sku, kind, baseUnit: 'each' })
  const expiring = await item('MRP-RES-EXP'), long = await item('MRP-RES-LONG'), product = await item('MRP-PRODUCT', 'make')
  const customer = await h.command('party.save', { name: 'Reserved Customer', kind: 'customer' })
  for (const [location, lines] of [[a, [
    { itemId: expiring.id, quantity: '4', unitCost: '1', lot: 'RES-EXP', dates: { expiresOn: date(4) } },
    { itemId: long.id, quantity: '2', unitCost: '1', lot: 'RES-LONG', dates: { expiresOn: date(30) } },
  ]], [b, [{ itemId: expiring.id, quantity: '4', unitCost: '1', lot: 'FREE-LONG', dates: { expiresOn: date(30) } }]]])
    await h.command('opening.record', { locationId: location.id, countedOn: date(0), valuationBasis: 'supplier-invoice', countedBy: 'Olive', evidence: evidence(), lines })
  const order = async (itemId, quantity, promiseDate, reserve = false) => {
    const q = await h.command('so.quote', { customerId: customer.id, promiseDate, lines: [{ itemId, quantity, unitPrice: '2' }] })
    const o = await h.command('so.confirm', { orderId: q.id, version: q.version, reserve: false })
    if (reserve) await h.command('so.reserve', { orderId: o.id, locationId: a.id })
    return o
  }
  const later = await order(expiring.id, '4', date(8), true), early = await order(expiring.id, '4', date(2))
  const protectedLong = await order(long.id, '2', date(8), true), earlyLong = await order(long.id, '2', date(2))
  const bom = await h.command('bom.revise', { itemId: product.id, components: [{ itemId: long.id, quantity: '1' }] })
  const draft = await h.command('wo.draft', { itemId: product.id, quantity: '2', requiredBy: date(10), reason: 'Pinned MRP-001 inputs' })
  const work = await h.command('wo.release', { workOrderId: draft.id, version: draft.version })
  await h.command('bom.revise', { itemId: product.id, components: [{ itemId: long.id, quantity: '7' }] })
  const madeDemand = await order(product.id, '2', date(12))
  const read = async instance => { const res = await instance.request('/api/larder/planning/materials'); assert.equal(res.status, 200); return res.json() }
  const before = await h.state(), plan = await read(h), row = id => plan.requirements.find(r => r.documentId === id)
  assert.equal(row(later.id).shortage, '4')
  assert.equal(row(early.id).covered, '4'); assert.equal(row(early.id).sources[0].locationId, b.id)
  assert.equal(row(protectedLong.id).covered, '2'); assert.equal(row(protectedLong.id).sources[0].reserved, true)
  assert.equal(row(earlyLong.id).shortage, '2')
  assert.deepEqual(plan.unverifiedReservations.map(r => [r.documentId, r.locationId, r.date, r.quantity]), [[later.id, a.id, date(8), '4']])
  assert.equal(work.bomId, bom.id); assert.equal(row(work.id).quantity, '2'); assert.equal(row(work.id).shortage, '2')
  assert.equal(row(madeDemand.id).shortage, '2'); assert.equal(row(madeDemand.id).suggestion, null)
  assert.ok(plan.provisionalSupply.some(s => s.documentId === work.id && s.quantity === '2' && s.reason === 'work material feasibility not proven'))
  assert.deepEqual(plan.blockedExplosions.map(r => [r.documentId, r.quantity, r.workOrderIds]), [[madeDemand.id, '2', [work.id]]])
  assert.deepEqual((await h.state()).reservations, before.reservations)
  assert.deepEqual((await h.state()).movements, before.movements)
  assert.equal((await h.request('/api/larder/planning/materials', { as: '' })).status, 401)
  await h.restart(); assert.deepEqual(await read(h), plan)
  // MOVE-008 inheritance: this computed view is reproducible from the complete
  // business archive. Reading it creates no new command, file or remote effect.
  const archive = await (await h.request('/api/larder/archive')).json()
  const target = await installation(); t.after(() => target.close())
  const restored = await target.request('/api/larder/archive/restore', { method: 'POST', body: archive })
  assert.equal(restored.status, 200, await restored.text())
  const copy = await read(target)
  for (const key of ['requirements', 'unverifiedReservations', 'provisionalSupply', 'excludedStock', 'scope', 'limitations']) assert.deepEqual(copy[key], plan[key], key)
  const person = await h.person('mrp-reader@example.test', 'planner')
  assert.equal((await h.request('/api/larder/planning/materials', { as: person.cookie })).status, 200)
  const disabled = await h.request('/auth/operator/status', { method: 'POST', body: { operatorId: person.id, status: 'inactive' } }); assert.equal(disabled.status, 200)
  assert.equal((await h.request('/api/larder/planning/materials', { as: person.cookie })).status, 401)
  const counter = await h.person('mrp-counter@example.test', 'warehouse')
  await h.command('count.schedule', { locationId: b.id, scheduledOn: date(0), basis: 'bin', counterId: counter.id, recountTolerance: '0' })
  assert.equal((await h.request('/api/larder/planning/materials', { as: counter.cookie })).status, 403)
  await h.invariant()
})

test('MRP-001 current safety floors share bins once, follow catalog edits, protect hard commitments and never treat expected or held stock as physical cover', async t => {
  const h = await installation(); t.after(() => h.close())
  const a = await h.command('location.save', { name: 'Floor bin A' }), b = await h.command('location.save', { name: 'Floor bin B' })
  const alias = await h.command('location.save', { name: 'Catalog alias for A' })
  const customer = await h.command('party.save', { name: 'Safety floor customer', kind: 'customer' })
  const supplier = await h.command('party.save', { name: 'Safety floor supplier', kind: 'supplier' })
  let item = await h.command('item.save', { sku: 'MRP-FLOOR', name: 'Floor material', kind: 'buy', baseUnit: 'each', catalogLocations: [
    { locationId: a.id, safetyStock: '2', minStock: '3' },
    { locationId: alias.id, defaultBin: a.id, safetyStock: '2' },
    { locationId: b.id, safetyStock: '2', minStock: '1' },
  ] })
  const fractional = await h.command('item.save', { sku: 'MRP-FLOOR-FRACTION', name: 'Fractional floor', kind: 'buy', baseUnit: 'kg', catalogLocations: [{ locationId: a.id, safetyStock: '1.000001', minStock: '0.5' }] })
  const zero = await h.command('item.save', { sku: 'MRP-FLOOR-ZERO', name: 'No floor', kind: 'buy', baseUnit: 'each', catalogLocations: [{ locationId: a.id, safetyStock: '0' }] })
  await h.command('partyItem.save', { itemId: fractional.id, partyId: supplier.id, partyCode: 'FLOOR-F', leadDays: 2, preferred: true })
  for (const [locationId, lines] of [[a.id, [{ itemId: item.id, quantity: '6', unitCost: '1' }, { itemId: fractional.id, quantity: '0.000001', unitCost: '1' }]], [b.id, [{ itemId: item.id, quantity: '5', unitCost: '1' }]]])
    await h.command('opening.record', { locationId, countedOn: date(0), countedBy: 'Olive', valuationBasis: 'owner-estimate', evidence: evidence(), lines })
  const order = async (quantity, days, reserve = false) => {
    const q = await h.command('so.quote', { customerId: customer.id, promiseDate: date(days), lines: [{ itemId: item.id, quantity }] })
    const o = await h.command('so.confirm', { orderId: q.id, version: q.version, reserve: false })
    if (reserve) await h.command('so.reserve', { orderId: o.id, locationId: a.id })
    return o
  }
  const protectedOrder = await order('4', 10, true), competing = await order('4', 2)
  const purchase = async (quantity, itemId, expectedDate, approve = true) => {
    const p = await h.command('po.draft', { supplierId: supplier.id, expectedDate, reason: 'MRP-001 floor proof', lines: [{ itemId, quantity, unitPrice: '1' }] })
    return approve ? h.command('po.approve', { poId: p.id, version: p.version }) : p
  }
  const expected = await purchase('10', fractional.id, date(0))
  const held = await purchase('4', fractional.id, date(0))
  await h.command('receipt.create', { poId: held.id, supplierReference: 'Held floor delivery', lines: [{ lineId: held.lines[0].id, locationId: a.id, quantity: '4', lot: 'FLOOR-HELD', inspection: 'quarantine' }] })
  const expired = await purchase('4', fractional.id, date(0))
  await h.command('receipt.create', { poId: expired.id, supplierReference: 'Expired floor delivery', lines: [{ lineId: expired.lines[0].id, locationId: a.id, quantity: '4', lot: 'FLOOR-EXPIRED', dates: { expiresOn: date(-1) } }] })
  const drafted = await purchase('20', fractional.id, date(0), false)
  const read = async instance => { const r = await instance.request('/api/larder/planning/materials'); assert.equal(r.status, 200); return r.json() }
  const before = await h.state(), outbound = h.outboundCount(), plan = await read(h)
  const floors = plan.requirements.filter(r => r.kind === 'safety'), floor = (id, bin) => floors.find(r => r.itemId === id && r.locationId === bin)
  assert.equal(floors.length, 3); assert.equal(floors.some(r => r.itemId === zero.id), false)
  assert.deepEqual([floor(item.id, a.id).quantity, floor(item.id, a.id).covered, floor(item.id, a.id).shortage], ['3', '2', '1'])
  assert.deepEqual(floor(item.id, a.id).catalogLocationIds, [a.id, alias.id].sort())
  assert.deepEqual([floor(item.id, b.id).quantity, floor(item.id, b.id).covered, floor(item.id, b.id).shortage], ['2', '2', '0'])
  for (const row of floors) {
    assert.equal(row.requiredBy, date(0))
    assert.ok(row.sources.every(s => s.kind === 'stock' && s.locationId === row.locationId && !s.reserved))
  }
  const fractionalFloor = floor(fractional.id, a.id)
  assert.deepEqual([fractionalFloor.quantity, fractionalFloor.covered, fractionalFloor.shortage], ['1.000001', '0.000001', '1'])
  // The approved PO dated today restores the floor on its receipt day; it is never physical cover and leaves nothing to buy.
  assert.deepEqual([fractionalFloor.suggestion, fractionalFloor.restoredOn, fractionalFloor.replenishment.map(r => [r.kind, r.documentId, r.date, r.quantity])], [null, date(0), [['purchase', expected.id, date(0), '1']]])
  assert.deepEqual([floor(item.id, a.id).restoredOn, floor(item.id, a.id).replenishment, floor(item.id, a.id).suggestion.quantity], [null, [], '1'])
  assert.ok(fractionalFloor.unavailableStock.some(p => p.reason === 'quarantine'))
  assert.ok(fractionalFloor.unavailableStock.some(p => p.reason === `expired on ${date(-1)}`))
  assert.ok(plan.provisionalSupply.some(p => p.documentId === drafted.id))
  assert.equal(fractionalFloor.sources.some(s => s.documentId === expected.id), false)
  const reserved = plan.requirements.find(r => r.documentId === protectedOrder.id), free = plan.requirements.find(r => r.documentId === competing.id)
  assert.equal(reserved.covered, '4'); assert.ok(reserved.sources.every(s => s.reserved && s.locationId === a.id))
  assert.deepEqual([free.covered, free.shortage], ['3', '1']); assert.equal(free.sources[0].locationId, b.id)
  assert.match(plan.limitations.join(' '), /automatic adoption is not applied; open supply restores an uncovered floor/)
  assert.deepEqual(await read(h), plan); assert.deepEqual(await h.state(), before); assert.equal(h.outboundCount(), outbound)
  await h.restart(); assert.deepEqual(await read(h), plan)
  const archive = await (await h.request('/api/larder/archive')).json(), target = await installation(); t.after(() => target.close())
  const restored = await target.request('/api/larder/archive/restore', { method: 'POST', body: archive }); assert.equal(restored.status, 200, await restored.text())
  const copy = await read(target)
  for (const key of ['requirements', 'unverifiedReservations', 'provisionalSupply', 'excludedStock', 'scope', 'limitations']) assert.deepEqual(copy[key], plan[key], key)
  await target.command('receipt.create', { poId: expected.id, supplierReference: 'Actual usable floor delivery', lines: [{ lineId: expected.lines[0].id, locationId: a.id, quantity: '1', lot: 'FLOOR-ACCEPTED' }] })
  const receivedFloor = (await read(target)).requirements.find(r => r.kind === 'safety' && r.itemId === fractional.id)
  assert.equal(receivedFloor.covered, '1.000001'); assert.equal(receivedFloor.shortage, '0')
  // Current catalog values are authoritative; neither a read nor an edit moves
  // physical stock or silently reallocates the protected customer's commitment.
  item = await h.command('item.save', { ...item, catalogLocations: [{ locationId: a.id, safetyStock: '1' }, { locationId: alias.id, defaultBin: a.id, minStock: '4' }, { locationId: b.id, safetyStock: '0' }] })
  const changed = await read(h), changedFloor = changed.requirements.find(r => r.kind === 'safety' && r.itemId === item.id)
  assert.equal(changedFloor.quantity, '4'); assert.equal(changedFloor.shortage, '2')
  assert.equal(changed.requirements.filter(r => r.kind === 'safety' && r.itemId === item.id).length, 1)
  assert.equal(changed.requirements.find(r => r.documentId === competing.id).covered, '4')
  assert.deepEqual((await h.state()).movements, before.movements); assert.deepEqual((await h.state()).reservations, before.reservations)
  await h.invariant()
})

test('MRP-001 dated multilevel pegs share stock and ETA pools, honor make/buy/phantom and aggregate yields, and disclose unresolved work without duplicate explosion', async t => {
  const h = await installation(); t.after(() => h.close())
  const item = async (sku, kind = 'make') => h.command('item.save', { sku, name: sku, kind, baseUnit: 'each' })
  const raw = await item('DATED-ALLOY', 'buy'), deep = await item('DATED-INNER'), left = await item('DATED-LEFT')
  const right = await item('DATED-RIGHT'), kit = await item('DATED-KIT'), product = await item('DATED-FRAME')
  const bin = await h.command('location.save', { name: 'Dated assembly stores' })
  const supplier = await h.command('party.save', { name: 'Dated alloy supplier', kind: 'supplier' })
  const customer = await h.command('party.save', { name: 'Dated shelf-life customer', kind: 'customer', minShelfLifeDays: 60 })
  await h.command('partyItem.save', { partyId: supplier.id, itemId: raw.id, partyCode: 'D-ALLOY', leadDays: 2, preferred: true })
  const innerBom = await h.command('bom.revise', { itemId: deep.id, components: [{ itemId: raw.id, quantity: '2' }] })
  const leftBom = await h.command('bom.revise', { itemId: left.id, yield: '0.5', components: [{ itemId: deep.id, quantity: '1' }] })
  await h.command('bom.revise', { itemId: right.id, components: [{ itemId: raw.id, quantity: '3' }] })
  await h.command('bom.revise', { itemId: kit.id, components: [{ itemId: raw.id, quantity: '1' }] })
  const recipe = [{ itemId: left.id, quantity: '1' }, { itemId: right.id, quantity: '1' }, { itemId: kit.id, quantity: '1', supply: 'phantom' }]
  const topBom = await h.command('bom.revise', { itemId: product.id, components: recipe })
  await h.command('bom.revise', { itemId: deep.id, effectiveOn: date(2), components: [{ itemId: raw.id, quantity: '100' }] })
  await h.command('opening.record', { locationId: bin.id, countedOn: date(0), countedBy: 'Olive', valuationBasis: 'owner-estimate', evidence: evidence(), lines: [
    { itemId: raw.id, quantity: '3', unitCost: '1', lot: 'RAW-VALID-INTERNALLY', dates: { expiresOn: date(20) } },
    { itemId: left.id, quantity: '1', unitCost: '4' }, { itemId: kit.id, quantity: '100', unitCost: '1' },
    { itemId: product.id, quantity: '1', unitCost: '8', lot: 'FINISHED-TOO-SHORT', dates: { expiresOn: date(20) } },
  ] })
  let po = await h.command('po.draft', { supplierId: supplier.id, expectedDate: date(5), reason: 'MRP-001 dependent dates', lines: [{ itemId: raw.id, quantity: '10', unitPrice: '1' }] })
  po = await h.command('po.approve', { poId: po.id, version: po.version })
  const order = async (id, quantity, days) => {
    const q = await h.command('so.quote', { customerId: customer.id, promiseDate: date(days), lines: [{ itemId: id, quantity }] })
    return h.command('so.confirm', { orderId: q.id, version: q.version, reserve: false })
  }
  const early = await order(product.id, '1', 3), late = await order(product.id, '1', 8)
  const read = async instance => { const r = await instance.request('/api/larder/planning/materials'); assert.equal(r.status, 200); return r.json() }
  const snapshot = await h.state(), outbound = h.outboundCount(), plan = await read(h)
  const raws = plan.requirements.filter(r => r.itemId === raw.id)
  const sums = id => raws.filter(r => r.documentId === id).reduce((n, r) => n + Number(r.quantity), 0)
  assert.equal(sums(early.id), 4); assert.equal(sums(late.id), 8)
  assert.equal(raws.reduce((n, r) => n + Number(r.covered), 0), 11)
  assert.equal(raws.reduce((n, r) => n + Number(r.shortage), 0), 1)
  assert.ok(raws.every(r => r.kind === 'dependent' && r.path[0].bomId === topBom.id))
  const deepest = raws.find(r => r.path.length === 3)
  assert.deepEqual(deepest.path.map(p => p.bomId), [topBom.id, leftBom.id, innerBom.id])
  assert.ok(raws.filter(r => r.documentId === early.id).every(r => r.requiredBy === date(3)))
  assert.ok(raws.filter(r => r.documentId === late.id).every(r => r.requiredBy === date(8)))
  assert.equal(raws.flatMap(r => r.sources).filter(s => s.kind === 'stock').reduce((n, s) => n + Number(s.quantity), 0), 3)
  assert.equal(raws.flatMap(r => r.sources).filter(s => s.kind === 'purchase').reduce((n, s) => n + Number(s.quantity), 0), 8)
  const short = raws.find(r => r.shortage === '1')
  assert.deepEqual([short.suggestion.quantity, short.suggestion.receiptOn, short.suggestion.releaseOn], ['1', date(3), date(1)])
  assert.ok(short.unavailablePurchases.some(p => p.documentId === po.id))
  assert.ok(plan.requirements.filter(r => r.itemId === kit.id).every(r => r.supply === 'phantom' && r.covered === '0'))
  assert.ok(plan.requirements.filter(r => r.itemId === product.id).every(r => r.shortage === '1'))
  assert.deepEqual(await h.state(), snapshot); assert.equal(h.outboundCount(), outbound)
  // The same PO can cover the component on its ETA, but never before it.
  po = await h.command('po.revise', { poId: po.id, version: po.version, expectedDate: date(3), note: 'Arrives on first component requirement' })
  assert.ok((await read(h)).requirements.filter(r => r.itemId === raw.id).every(r => r.shortage === '0'))
  po = await h.command('po.revise', { poId: po.id, version: po.version, expectedDate: date(9), note: 'After both assemblies need material' })
  assert.equal((await read(h)).requirements.filter(r => r.itemId === raw.id).reduce((n, r) => n + Number(r.shortage), 0), 9)
  // Explicit buy stops the current branch; future revisions stay out of it.
  await h.command('bom.revise', { itemId: product.id, components: recipe.map(l => l.itemId === right.id ? { ...l, supply: 'buy' } : l) })
  const changed = await read(h)
  assert.ok(changed.requirements.filter(r => r.itemId === right.id).every(r => r.supply === 'buy' && r.suggestion?.kind === 'buy'))
  assert.equal(changed.requirements.filter(r => r.itemId === raw.id).reduce((n, r) => n + Number(r.quantity), 0), 6)
  // Aggregate before rounding: two roots need 0.000007, not 0.000008.
  const tinyRaw = await item('DATED-TINY-RAW', 'buy'), tiny = await item('DATED-TINY')
  await h.command('bom.revise', { itemId: tiny.id, yield: '0.3', components: [{ itemId: tinyRaw.id, quantity: '0.000001' }] })
  await order(tiny.id, '1', 3); await order(tiny.id, '1', 8)
  assert.deepEqual((await read(h)).requirements.filter(r => r.itemId === tinyRaw.id).map(r => r.quantity), ['0.000004', '0.000003'])
  // Existing work remains provisional and blocks new make explosion explicitly.
  const draft = await h.command('wo.draft', { itemId: product.id, quantity: '1', requiredBy: date(8), reason: 'MRP-001 work reconciliation boundary' })
  let blocked = await read(h)
  assert.equal(blocked.requirements.filter(r => r.itemId === raw.id).length, 0)
  assert.deepEqual(blocked.blockedExplosions.map(r => [r.documentId, r.quantity, r.workOrderIds]), [[early.id, '1', [draft.id]], [late.id, '1', [draft.id]]])
  const released = await h.command('wo.release', { workOrderId: draft.id, version: draft.version })
  await h.command('bom.revise', { itemId: product.id, components: [{ itemId: raw.id, quantity: '77' }] })
  blocked = await read(h)
  assert.equal(blocked.requirements.filter(r => r.itemId === raw.id).reduce((n, r) => n + Number(r.quantity), 0), 1)
  assert.ok(blocked.requirements.filter(r => r.itemId === raw.id).every(r => r.documentId === released.id))
  assert.ok(blocked.provisionalSupply.some(r => r.documentId === released.id && r.quantity === '1'))
  const before = await h.state(); assert.deepEqual(await read(h), blocked); assert.deepEqual(await h.state(), before)
  await h.restart(); assert.deepEqual(await read(h), blocked)
  const archive = await (await h.request('/api/larder/archive')).json(), target = await installation(); t.after(() => target.close())
  const restored = await target.request('/api/larder/archive/restore', { method: 'POST', body: archive }); assert.equal(restored.status, 200, await restored.text())
  const copy = await read(target)
  for (const key of ['requirements', 'blockedExplosions', 'unverifiedReservations', 'provisionalSupply', 'excludedStock', 'scope', 'limitations']) assert.deepEqual(copy[key], blocked[key], key)
  await h.invariant()
})


test('MRP-001 manufacturing offsets reject completion-day material, follow multilevel full-batch routing and keep released timing pinned across edits and restore', async t => {
  const h = await installation(); t.after(() => h.close())
  const item = async (sku, kind = 'make') => h.command('item.save', { sku, name: sku, kind, baseUnit: 'each' })
  const raw = await item('OFFSET-RAW', 'buy'), sub = await item('OFFSET-SUB'), kit = await item('OFFSET-PHANTOM'), top = await item('OFFSET-FINISHED')
  const bin = await h.command('location.save', { name: 'Offset materials' })
  const customer = await h.command('party.save', { name: 'Offset buyer', kind: 'customer' }), supplier = await h.command('party.save', { name: 'Offset supplier', kind: 'supplier' })
  await h.command('partyItem.save', { partyId: supplier.id, itemId: raw.id, partyCode: 'OFFSET', leadDays: 2, preferred: true })
  await h.command('bom.revise', { itemId: sub.id, components: [{ itemId: raw.id, quantity: '1' }], routing: [{ name: 'Subassembly', runMinutes: 960 }] })
  await h.command('bom.revise', { itemId: kit.id, components: [{ itemId: raw.id, quantity: '1' }], routing: [{ name: 'Not a separate phantom operation', runMinutes: 100000 }] })
  const components = [{ itemId: sub.id, quantity: '1' }, { itemId: kit.id, quantity: '1', supply: 'phantom' }]
  const routing = [
    { name: 'Prepare', setupMinutes: 400, queueMinutes: 320, runMinutes: 480 },
    { name: 'Independent cure', dependsOn: [], setupMinutes: 1440, runMinutes: 0 },
    { name: 'Join', dependsOn: [1, 2], runMinutes: 1e-6, transferBatch: '1', allowOverlap: true },
  ]
  const bom = await h.command('bom.revise', { itemId: top.id, components, routing })
  await h.command('opening.record', { locationId: bin.id, countedOn: date(0), countedBy: 'Olive', valuationBasis: 'owner-estimate', evidence: evidence(), lines: [
    { itemId: top.id, quantity: '0.5', unitCost: '1' },
    { itemId: raw.id, quantity: '1', unitCost: '1', lot: 'OFFSET-EXPIRES', dates: { expiresOn: date(8) } },
  ] })
  let po = await h.command('po.draft', { supplierId: supplier.id, expectedDate: date(8), reason: 'Material arrives before completion but after subassembly start', lines: [{ itemId: raw.id, quantity: '20', unitPrice: '1' }] })
  po = await h.command('po.approve', { poId: po.id, version: po.version })
  const order = async (id, quantity, days) => {
    const q = await h.command('so.quote', { customerId: customer.id, promiseDate: date(days), lines: [{ itemId: id, quantity }] })
    return h.command('so.confirm', { orderId: q.id, version: q.version, reserve: false })
  }
  const sale = await order(top.id, '2', 10)
  const read = async instance => { const r = await instance.request('/api/larder/planning/materials'); assert.equal(r.status, 200); return r.json() }
  const before = await h.state(), outbound = h.outboundCount(), plan = await read(h)
  const rows = plan.requirements.filter(r => r.documentId === sale.id)
  const finished = rows.find(r => r.itemId === top.id), assembly = rows.find(r => r.itemId === sub.id)
  assert.deepEqual([finished.covered, finished.shortage, finished.suggestion.quantity], ['0.5', '1.5', '1.5'])
  // Independent operations share time; joining both adds a positive fractional
  // minute beyond one complete day. The full uncovered batch needs two days.
  assert.deepEqual([finished.suggestion.kind, finished.suggestion.leadDays, finished.suggestion.receiptOn, finished.suggestion.releaseOn], ['make', 2, date(10), date(8)])
  assert.deepEqual([assembly.quantity, assembly.requiredBy, assembly.suggestion.leadDays, assembly.suggestion.releaseOn], ['1.5', date(8), 1, date(7)])
  const subInput = rows.find(r => r.itemId === raw.id && r.path.some(p => p.itemId === sub.id))
  const phantomInput = rows.find(r => r.itemId === raw.id && r.path.some(p => p.itemId === kit.id))
  assert.deepEqual([subInput.requiredBy, subInput.quantity, subInput.covered, subInput.shortage], [date(7), '1.5', '1', '0.5'])
  assert.deepEqual([subInput.suggestion.receiptOn, subInput.suggestion.releaseOn], [date(7), date(5)])
  assert.ok(subInput.unavailablePurchases.some(p => p.documentId === po.id))
  assert.deepEqual(subInput.path.map(p => [p.timing.receiptOn, p.timing.releaseOn]), [[date(10), date(8)], [date(8), date(7)]])
  assert.deepEqual([phantomInput.requiredBy, phantomInput.quantity, phantomInput.covered], [date(8), '1.5', '1.5'])
  assert.equal(phantomInput.sources[0].documentId, po.id)
  assert.equal(phantomInput.path.at(-1).timing.leadDays, 0)
  assert.deepEqual(await h.state(), before); assert.equal(h.outboundCount(), outbound)
  // Earlier declared arrival is now useful; an ETA one day later cannot cover.
  po = await h.command('po.revise', { poId: po.id, version: po.version, expectedDate: date(7), note: 'Arrives at subassembly start' })
  assert.ok((await read(h)).requirements.filter(r => r.documentId === sale.id && r.itemId === raw.id).every(r => r.shortage === '0'))
  // A released job uses its own routing and full job quantity, never the latest
  // BOM or a fabricated remaining-time estimate. Its ETA is still declarative.
  const draft = await h.command('wo.draft', { itemId: top.id, quantity: '2', requiredBy: date(10), reason: 'Pinned material dates' })
  let work = await h.command('wo.release', { workOrderId: draft.id, version: draft.version })
  work = await h.command('work.expected', { workOrderId: work.id, version: work.version, expectedOn: date(12) })
  const revision = await h.command('bom.revise', { itemId: top.id, components, routing: [{ name: 'Much later revision', runMinutes: 100000 }] })
  let pinned = await read(h)
  const inputs = pinned.requirements.filter(r => r.kind === 'work' && r.documentId === work.id)
  assert.ok(inputs.length > 0)
  assert.ok(inputs.every(r => r.requiredBy === date(10) && r.workTiming.bomId === bom.id && r.workTiming.leadDays === 2 && r.workTiming.receiptOn === date(12)))
  assert.equal(pinned.requirements.find(r => r.documentId === sale.id && r.itemId === top.id).manufacturing.bomId, revision.id)
  const known = await item('OFFSET-KNOWN-ZERO'), unknown = await item('OFFSET-UNKNOWN')
  await h.command('bom.revise', { itemId: known.id, components: [{ itemId: raw.id, quantity: '1' }], routing: [{ name: 'Recorded zero', runMinutes: 0 }] })
  await h.command('bom.revise', { itemId: unknown.id, components: [{ itemId: raw.id, quantity: '1' }] })
  const zeroSale = await order(known.id, '1', 1), unknownSale = await order(unknown.id, '1', 1)
  pinned = await read(h)
  assert.deepEqual([pinned.requirements.find(r => r.documentId === zeroSale.id && r.itemId === known.id).suggestion.leadDays, pinned.requirements.find(r => r.documentId === zeroSale.id && r.itemId === known.id).suggestion.releaseOn], [0, date(1)])
  assert.deepEqual([pinned.requirements.find(r => r.documentId === unknownSale.id && r.itemId === unknown.id).manufacturing.leadDays, pinned.requirements.find(r => r.documentId === unknownSale.id && r.itemId === unknown.id).manufacturing.releaseOn], [null, null])
  // Exact decimal minutes must not create an extra day at a rounding boundary.
  await h.command('bom.revise', { itemId: known.id, components: [{ itemId: raw.id, quantity: '1' }], routing: [{ name: 'One exact day', setupMinutes: 1439.7, queueMinutes: 0.1, runMinutes: 0.2 }] })
  let exact = await read(h), timing = exact.requirements.find(r => r.documentId === zeroSale.id && r.itemId === known.id).suggestion
  assert.deepEqual([timing.leadDays, timing.releaseOn], [1, date(0)])
  await h.command('bom.revise', { itemId: known.id, components: [{ itemId: raw.id, quantity: '1' }], routing: [{ name: 'Past release', setupMinutes: 2880, runMinutes: 0 }] })
  const past = (await read(h)).requirements.find(r => r.documentId === zeroSale.id && r.itemId === known.id).suggestion
  assert.equal(past.releaseOn, date(-1)); assert.equal(past.requiresPastRelease, true)
  // An accepted large batch can exceed the calendar's range; report a blocked
  // branch and explicit shortage instead of crashing or inferring late supply.
  const huge = await order(known.id, '10000000', 3)
  await h.command('bom.revise', { itemId: known.id, components: [{ itemId: raw.id, quantity: '0.000001' }], routing: [{ name: 'Long job', runMinutes: 100000 }] })
  exact = await read(h)
  const outOfRange = exact.requirements.find(r => r.documentId === huge.id && r.itemId === known.id)
  assert.equal(outOfRange.manufacturing.releaseOn, null); assert.equal(outOfRange.suggestion, null)
  assert.ok(exact.blockedExplosions.some(r => r.documentId === huge.id && r.reason.includes('four-digit calendar')))
  assert.equal(exact.requirements.some(r => r.documentId === huge.id && r.itemId === raw.id), false)
  const hugeDraft = await h.command('wo.draft', { itemId: known.id, quantity: '10000000', requiredBy: date(3), reason: 'Unrepresentable pinned release date' })
  const hugeWork = await h.command('wo.release', { workOrderId: hugeDraft.id, version: hugeDraft.version })
  exact = await read(h)
  const hugeInput = exact.requirements.find(r => r.kind === 'work' && r.documentId === hugeWork.id)
  assert.deepEqual([hugeInput.covered, hugeInput.shortage, hugeInput.suggestion, hugeInput.workTiming.releaseOn], ['0', '10', null, null])
  assert.ok(exact.blockedExplosions.some(r => r.documentId === hugeWork.id && r.reason.includes('four-digit calendar')))
  // Dispatch includes a request-time asOf clock; compare every other exposed
  // field and the dispatch facts, without pretending that clock is persisted.
  const stable = state => ({ ...state, dispatch: state.dispatch.map(({ asOf, ...facts }) => facts) })
  const finalState = stable(await h.state()); assert.deepEqual(await read(h), exact); assert.deepEqual(stable(await h.state()), finalState)
  await h.restart(); assert.deepEqual(await read(h), exact)
  const archive = await (await h.request('/api/larder/archive')).json(), target = await installation(); t.after(() => target.close())
  const restored = await target.request('/api/larder/archive/restore', { method: 'POST', body: archive }); assert.equal(restored.status, 200, await restored.text())
  const copy = await read(target)
  for (const key of ['requirements', 'blockedExplosions', 'unverifiedReservations', 'provisionalSupply', 'excludedStock', 'scope', 'limitations']) assert.deepEqual(copy[key], exact[key], key)
  await h.invariant()
})

test('MRP-002 follows shared dated supply to customer demand and back through PO lines and received lots without changing commitments', async t => {
  const h = await installation(); t.after(() => h.close())
  const item = async (sku, kind = 'buy') => h.command('item.save', { sku, name: sku, kind, baseUnit: 'each' })
  const raw = await item('PEG-RAW'), left = await item('PEG-LEFT', 'make'), right = await item('PEG-RIGHT', 'make'), product = await item('PEG-PRODUCT', 'make')
  const location = await h.command('location.save', { name: 'Pegging stores' })
  const customer = await h.command('party.save', { name: 'Pegging customer', kind: 'customer' })
  const supplier = await h.command('party.save', { name: 'Pegging supplier', kind: 'supplier' })
  for (const sub of [left, right]) await h.command('bom.revise', { itemId: sub.id, components: [{ itemId: raw.id, quantity: '1' }] })
  const bom = await h.command('bom.revise', { itemId: product.id, components: [{ itemId: left.id, quantity: '1' }, { itemId: right.id, quantity: '1' }] })
  const buy = async (quantities, approve = true) => {
    const p = await h.command('po.draft', { supplierId: supplier.id, expectedDate: date(2), reason: 'Dated pegging supply', lines: quantities.map(quantity => ({ itemId: raw.id, quantity, unitPrice: '2' })) })
    return approve ? h.command('po.approve', { poId: p.id, version: p.version }) : p
  }
  const receivedPO = await buy(['2.5'])
  const receipt = await h.command('receipt.create', { poId: receivedPO.id, supplierReference: 'Pegging receipt', lines: [
    { lineId: receivedPO.lines[0].id, locationId: location.id, quantity: '1.5', lot: 'PEG-USABLE' },
    { lineId: receivedPO.lines[0].id, locationId: location.id, quantity: '1', lot: 'PEG-HELD', inspection: 'quarantine' },
  ] })
  const order = async (itemId, quantity, days) => {
    const q = await h.command('so.quote', { customerId: customer.id, promiseDate: date(days), lines: [{ itemId, quantity, unitPrice: '10' }] })
    return h.command('so.confirm', { orderId: q.id, version: q.version, reserve: false })
  }
  const reserved = await order(raw.id, '0.5', 15)
  await h.command('so.reserve', { orderId: reserved.id, locationId: location.id })
  const made = await order(product.id, '1', 10), direct = await order(raw.id, '3', 11)
  let po = await buy(['2', '2'])
  const draft = await buy(['100'], false)
  const url = (kind, id, lineId) => '/api/larder/planning/pegging?' + new URLSearchParams({ kind, id, ...(lineId ? { lineId } : {}) })
  const read = async (kind, id, lineId, instance = h) => {
    const res = await instance.request(url(kind, id, lineId)); assert.equal(res.status, 200, res.status === 200 ? '' : await res.text()); return res.json()
  }
  const total = pegs => pegs.reduce((n, p) => n + parse(p.source.quantity), 0n)
  const snapshot = await h.state(), outbound = h.outboundCount()
  const component = await read('item', raw.id), forward = await read('sales', made.id)
  assert.equal(total(component.pegs), parse('5.5'))
  assert.equal(total(forward.pegs), parse('2'))
  assert.ok(forward.pegs.every(p => p.demand.itemId === raw.id && p.demand.path.length === 2 && p.demand.path[0].bomId === bom.id))
  assert.equal(forward.requirements.find(r => r.kind === 'sales').shortage, '1') // product is not physical supply
  const purchase = await read('purchase', po.id)
  const line = await read('purchase', po.id, po.lines[0].id)
  assert.equal(total(purchase.pegs), parse('4'))
  assert.deepEqual(purchase.allocatedSalesOrders.map(o => o.id).sort(), [made.id, direct.id].sort())
  assert.equal(total(line.pegs), parse('2'))
  assert.ok(line.pegs.every(p => p.source.lineId === po.lines[0].id))
  assert.deepEqual(purchase.pegs.filter(p => p.demand.documentId === made.id).map(p => p.source.quantity), ['1'])
  assert.equal(total(purchase.pegs.filter(p => p.demand.documentId === direct.id)), parse('3'))
  assert.equal(total((await read('purchase', po.id, po.lines[1].id)).pegs), parse('2'))
  const lot = await read('lot', receipt.lines[0].lotId), received = await read('receipt', receipt.id)
  assert.equal(total(lot.pegs), parse('1.5')); assert.deepEqual(received.pegs, lot.pegs)
  assert.deepEqual(received.allocatedSalesOrders.map(o => o.id).sort(), [reserved.id, made.id].sort())
  assert.equal(lot.pegs.find(p => p.demand.documentId === reserved.id).source.reserved, true)
  assert.equal((await read('lot', receipt.lines[1].lotId)).pegs.length, 0) // held is never usable
  assert.deepEqual((await read('purchase', receivedPO.id)).pegs, lot.pegs)
  assert.equal((await read('purchase', draft.id)).pegs.length, 0)
  assert.deepEqual(await h.state(), snapshot); assert.equal(h.outboundCount(), outbound)
  // Slip the real PO: allocated edges disappear; alternatives remain explicitly
  // separate and retain dates and shortages rather than promising coverage.
  po = await h.command('po.revise', { poId: po.id, version: po.version, expectedDate: date(20), note: 'Supplier delay' })
  const delayed = await read('purchase', po.id)
  assert.equal(delayed.pegs.length, 0); assert.equal(delayed.allocatedSalesOrders.length, 0)
  assert.deepEqual([...new Set(delayed.lateCandidates.map(p => p.demand.documentId))].sort(), [made.id, direct.id].sort())
  assert.ok(delayed.lateCandidates.every(p => p.source.date === date(20) && p.source.reason === 'after required date'))
  assert.equal((await read('sales', direct.id)).requirements[0].shortage, '3')
  assert.deepEqual((await h.state()).reservations, snapshot.reservations)
  po = await h.command('po.revise', { poId: po.id, version: po.version, expectedDate: date(2), note: 'Confirmed recovery' })
  const current = (await h.state()).salesOrders.find(o => o.id === direct.id)
  await h.command('so.cancelLine', { orderId: current.id, version: current.version, lineId: current.lines[0].id, quantity: '3', customerApproval: { name: 'Buyer', reference: 'Cancellation email', approvedOn: date(0) }, reason: 'Customer cancelled' })
  const cancelled = await read('purchase', po.id)
  assert.equal(total(cancelled.pegs), parse('1'))
  assert.deepEqual(cancelled.allocatedSalesOrders.map(o => o.id), [made.id])
  assert.equal((await read('sales', direct.id)).requirements.length, 0)
  assert.deepEqual((await h.state()).reservations, snapshot.reservations)
  // An unlotted receipt cannot be assigned a made-up ancestry by bin/item.
  const unlotted = await h.command('receipt.create', { poId: po.id, supplierReference: 'Unlotted delivery', lines: [{ lineId: po.lines[1].id, locationId: location.id, quantity: '0.25' }] })
  const untracked = await read('receipt', unlotted.id)
  assert.equal(untracked.pegs.length, 0); assert.equal(untracked.untrackedReceiptLines[0].quantity, '0.25')
  // Work reads its pinned component recipe, never claiming a customer link
  // through output whose material feasibility has not been proved.
  const w = await h.command('wo.draft', { itemId: product.id, quantity: '1', requiredBy: date(12), reason: 'Pinned pegging work' })
  const work = await h.command('wo.release', { workOrderId: w.id, version: w.version })
  await h.command('bom.revise', { itemId: product.id, components: [{ itemId: raw.id, quantity: '99' }] })
  const pinned = await read('work', work.id)
  assert.deepEqual(pinned.requirements.filter(r => r.kind === 'work').map(r => [r.itemId, r.quantity]).sort(), [[left.id, '1'], [right.id, '1']].sort())
  assert.equal(pinned.allocatedSalesOrders.length, 0)
  assert.ok(pinned.blockedExplosions.some(b => b.documentId === made.id && b.workOrderIds.includes(work.id)))
  assert.deepEqual((await read('work', work.id, work.components[0].id)).requirements.filter(r => r.kind === 'work').map(r => r.itemId), [work.components[0].itemId])
  const forecastItem = await item('PEG-FORECAST')
  const monday = new Date(date(0) + 'T00:00:00Z'); monday.setUTCDate(monday.getUTCDate() + 8 - (monday.getUTCDay() || 7))
  await h.command('opening.record', { locationId: location.id, countedOn: date(0), valuationBasis: 'owner-estimate', countedBy: 'Olive', evidence: evidence(), lines: [{ itemId: forecastItem.id, quantity: '0.125', unitCost: '1' }] })
  await h.command('forecast.import', { stateVersion: (await h.state()).version, file: { name: 'pegging-forecast.csv', content: `sku,week,quantity,seasonality\nPEG-FORECAST,${monday.toISOString().slice(0, 10)},0.5,1\n` }, reason: 'Dated forecast pegging' })
  const forecast = (await h.state()).forecasts.find(f => f.itemId === forecastItem.id)
  const forecastPegs = await read('forecast', forecast.id)
  assert.equal(forecastPegs.requirements[0].quantity, '0.5'); assert.equal(forecastPegs.requirements[0].shortage, '0.375')
  assert.equal(total(forecastPegs.pegs), parse('0.125')); assert.equal(forecastPegs.allocatedSalesOrders.length, 0)
  const beforeRead = await h.state(), beforeOutbound = h.outboundCount(), saved = await read('item', raw.id)
  await h.restart(); assert.deepEqual(await read('item', raw.id), saved)
  assert.deepEqual(await h.state(), beforeRead); assert.equal(h.outboundCount(), beforeOutbound)
  const archive = await (await h.request('/api/larder/archive')).json(), target = await installation(); t.after(() => target.close())
  const restored = await target.request('/api/larder/archive/restore', { method: 'POST', body: archive }); assert.equal(restored.status, 200, await restored.text())
  for (const [kind, id] of [['item', raw.id], ['purchase', po.id], ['receipt', receipt.id], ['work', work.id]]) {
    const original = await read(kind, id), copy = await read(kind, id, undefined, target)
    for (const field of ['requirements', 'pegs', 'lateCandidates', 'allocatedSalesOrders', 'untrackedReceiptLines', 'blockedExplosions']) assert.deepEqual(copy[field], original[field])
  }
  assert.equal((await h.request(url('item', raw.id), { as: '' })).status, 401)
  const reader = await h.person('pegging-planner@example.test', 'planner')
  assert.equal((await h.request(url('item', raw.id), { as: reader.cookie })).status, 200)
  assert.equal((await h.request('/auth/operator/status', { method: 'POST', body: { operatorId: reader.id, status: 'inactive' } })).status, 200)
  assert.equal((await h.request(url('item', raw.id), { as: reader.cookie })).status, 401)
  const counter = await h.person('pegging-counter@example.test', 'warehouse')
  await h.command('count.schedule', { locationId: location.id, scheduledOn: date(0), basis: 'bin', counterId: counter.id, recountTolerance: '0' })
  assert.equal((await h.request(url('item', raw.id), { as: counter.cookie })).status, 403)
  assert.equal((await (await h.request(url('item', raw.id, 'not-an-item-option'))).json()).error.code, 'INPUT')
  assert.equal((await (await h.request(url('purchase', po.id, direct.lines[0].id))).json()).error.code, 'NOT_FOUND')
  await h.invariant()
})


test('MRP-006 dated drafts preserve reviewed quantities, release dates and source paths with stale, duplicate, policy and live-authority guards across restart and restore', async t => {
  const h = await installation(); t.after(() => h.close())
  const raw = await h.command('item.save', { sku: 'DATED-DRAFT-RAW', name: 'Dated draft raw', kind: 'buy', baseUnit: 'kg' })
  const made = await h.command('item.save', { sku: 'DATED-DRAFT-MADE', name: 'Dated draft product', kind: 'make', baseUnit: 'each' })
  const unknown = await h.command('item.save', { sku: 'DATED-DRAFT-UNKNOWN', name: 'Unrecorded routing', kind: 'make', baseUnit: 'each' })
  const supplier = await h.command('party.save', { name: 'Dated draft supplier', kind: 'supplier' })
  const customer = await h.command('party.save', { name: 'Dated draft customer', kind: 'customer' })
  const location = await h.command('location.save', { name: 'Dated draft stores' })
  await h.command('partyItem.save', { partyId: supplier.id, itemId: raw.id, partyCode: 'DDR', leadDays: 3, price: '2', preferred: true })
  await h.command('bom.revise', { itemId: made.id, components: [{ itemId: raw.id, quantity: '0.5' }], routing: [{ name: 'Make', minutes: 1440 }] })
  await h.command('bom.revise', { itemId: unknown.id, components: [{ itemId: raw.id, quantity: '1' }] })
  const order = async (itemId, quantity, days) => {
    const q = await h.command('so.quote', { customerId: customer.id, promiseDate: date(days), lines: [{ itemId, quantity }] })
    return h.command('so.confirm', { orderId: q.id, version: q.version, reserve: false })
  }
  const rawOrder = await order(raw.id, '1.25', 9), madeOrder = await order(made.id, '2', 12), unknownOrder = await order(unknown.id, '1', 14)
  const split = await h.command('so.changePreview', { orderId: rawOrder.id, version: rawOrder.version, reason: 'Customer requested two delivery dates', customerApproval: { name: 'Customer', reference: 'Split delivery email', approvedOn: date(0) }, lines: [{ lineId: rawOrder.lines[0].id, itemId: raw.id, quantity: '1.25', unitPrice: '0', schedules: [{ quantity: '0.5', date: date(8) }, { quantity: '0.75', date: date(9) }] }] })
  await h.command('so.changeApprove', { previewId: split.id, version: split.version })
  const planner = await h.person('dated-planner@example.test', 'planner'), viewer = await h.person('dated-viewer@example.test', 'viewer')
  const agent = await h.person('dated-agent@example.test', 'agent')
  const read = async (instance = h) => { const response = await instance.request('/api/larder/planning/materials'); assert.equal(response.status, 200); return response.json() }
  const select = (plan, doc, itemId, requiredBy) => plan.requirements.find(r => r.documentId === doc && r.itemId === itemId && (!requiredBy || r.requiredBy === requiredBy))
  const payload = (plan, row, extra = {}) => ({ itemId: row.itemId, dated: { version: plan.version, asOf: plan.asOf, key: row.key }, unitPrice: '2.5', reason: 'Review exact dated supply', ...extra })
  let plan = await read(), row = select(plan, rawOrder.id, raw.id, date(9))
  const initial = await h.state(), outbound = h.outboundCount()
  await viewer.run('plan.draft', payload(plan, row), { error: 'FORBIDDEN' })
  await h.command('plan.draft', payload(plan, row), { as: '', error: 'AUTH' })
  await planner.run('plan.draft', payload(plan, row, { quantity: '100' }), { error: 'INPUT' })
  await planner.run('plan.draft', payload(plan, row, { unitPrice: undefined }), { error: 'DECIMAL' })
  await planner.run('plan.draft', payload(plan, row, { dated: { ...payload(plan, row).dated, asOf: date(-1) } }), { error: 'STALE' })
  await planner.run('plan.draft', payload(plan, row, { dated: { ...payload(plan, row).dated, key: 'not-a-requirement' } }), { error: 'NOT_FOUND' })
  await planner.run('plan.draft', payload(plan, select(plan, unknownOrder.id, unknown.id)), { error: 'NO_SUGGESTION' })
  assert.deepEqual(await h.state(), initial)
  // Any intervening write invalidates review, including the supplier lead time.
  const terms = initial.partyItems.find(r => r.itemId === raw.id)
  await h.command('partyItem.save', { ...terms, leadDays: 5 })
  await planner.run('plan.draft', payload(plan, row), { error: 'STALE' })
  plan = await read(); row = select(plan, rawOrder.id, raw.id, date(9))
  const beforeRace = await h.state(), proposed = payload(plan, row), commandId = crypto.randomUUID()
  const race = await Promise.all([
    h.send('plan.draft', proposed, { as: planner.cookie, commandId }),
    h.send('plan.draft', proposed, { as: planner.cookie }),
  ])
  assert.equal(race.filter(r => r.body.ok).length, 1)
  assert.equal(race.find(r => !r.body.ok).body.error.code, 'STALE')
  const purchase = race.find(r => r.body.ok).body.result
  // Replay the successful identity after a later write, never a second draft.
  const successful = race.find(r => r.body.ok)
  const replay = await h.command('plan.draft', proposed, { as: planner.cookie, commandId: successful.commandId })
  assert.deepEqual(replay, purchase)
  await h.command('plan.draft', { ...proposed, unitPrice: '9' }, { as: planner.cookie, commandId: successful.commandId, error: 'IDEMPOTENCY' })
  assert.equal(purchase.status, 'draft'); assert.equal(purchase.lines[0].quantity, '0.75'); assert.equal(purchase.lines[0].unitPrice, '2.5')
  assert.equal(purchase.exposure, '1.875'); assert.equal(purchase.expectedDate, date(9)); assert.equal(purchase.requiredBy, date(9))
  assert.equal(purchase.datedPlan.suggestion.releaseOn, date(4)); assert.equal(purchase.datedPlan.stateVersion, plan.version)
  plan = await read(); row = select(plan, rawOrder.id, raw.id, date(9))
  assert.equal(row.shortage, '0.75') // a draft never masquerades as usable supply
  assert.equal(row.linkedSupply[0].documentId, purchase.id)
  await planner.run('plan.draft', payload(plan, row), { error: 'DRAFT_EXISTS' })
  await planner.run('plan.draft', payload(plan, select(plan, rawOrder.id, raw.id, date(8))), { error: 'DRAFT_EXISTS' })
  // The same native approval door still controls consequences; preparation does
  // not buy goods or release production, even for planner/agent preparers.
  await planner.run('po.approve', { poId: purchase.id, version: purchase.version }, { error: 'FORBIDDEN' })
  await h.command('po.approve', { poId: purchase.id, version: purchase.version })
  const afterApproval = await read()
  await planner.run('plan.draft', payload(afterApproval, select(afterApproval, rawOrder.id, raw.id, date(9))), { error: 'DRAFT_EXISTS' })
  assert.equal(select(afterApproval, rawOrder.id, raw.id, date(9)).shortage, '0')
  plan = await read(); row = select(plan, madeOrder.id, made.id)
  const work = await agent.run('plan.draft', payload(plan, row))
  assert.equal(work.status, 'draft'); assert.equal(work.quantity, '2'); assert.equal(work.requiredBy, date(12)); assert.equal(work.plannedStart, date(10))
  assert.equal(work.demandSources[0].documentId, madeOrder.id)
  assert.equal(work.datedPlan.suggestion.leadDays, 2)
  await agent.run('wo.release', { workOrderId: work.id, version: work.version }, { error: 'FORBIDDEN' })
  plan = await read()
  await planner.run('plan.draft', payload(plan, select(plan, madeOrder.id, made.id)), { error: 'DRAFT_EXISTS' })
  const blockedOrder = await order(made.id, '1', 16)
  plan = await read()
  await planner.run('plan.draft', payload(plan, select(plan, blockedOrder.id, made.id)), { error: 'NO_SUGGESTION' })
  // Dependent raw suggestions carry their multilevel root/revision path into
  // the purchase draft, using the parent's release rather than completion day.
  // Outstanding work explicitly blocks that sales explosion now, so use a
  // separate made demand with no outstanding work for the dependent draft.
  const branch = await h.command('item.save', { sku: 'DATED-DRAFT-BRANCH', name: 'Second product', kind: 'make', baseUnit: 'each' })
  await h.command('bom.revise', { itemId: branch.id, components: [{ itemId: raw.id, quantity: '0.75' }], routing: [{ name: 'Build branch', minutes: 1440 }] })
  const branchOrder = await order(branch.id, '2', 20)
  plan = await read(); row = select(plan, branchOrder.id, raw.id)
  const beforeDependent = await h.state()
  const dependent = await planner.run('plan.draft', payload(plan, row))
  assert.equal(dependent.lines[0].quantity, '1.5'); assert.equal(dependent.expectedDate, date(18))
  assert.equal(dependent.datedPlan.suggestion.releaseOn, date(13))
  assert.equal(dependent.datedPlan.requirement.path[0].itemId, branch.id)
  assert.deepEqual((await h.state()).salesOrders, beforeDependent.salesOrders)
  await h.command('bom.revise', { itemId: branch.id, components: [{ itemId: raw.id, quantity: '1' }], routing: [{ name: 'Build revised branch', minutes: 1440 }] })
  plan = await read()
  await planner.run('plan.draft', payload(plan, select(plan, branchOrder.id, raw.id)), { error: 'DRAFT_EXISTS' })
  const after = await h.state()
  assert.deepEqual(after.movements, beforeRace.movements); assert.deepEqual(after.reservations, beforeRace.reservations)
  for (const original of beforeRace.salesOrders) assert.deepEqual(after.salesOrders.find(o => o.id === original.id), original)
  assert.equal(h.outboundCount(), outbound)
  const savedPlan = await read(); await h.restart(); assert.deepEqual(await read(), savedPlan)
  const archive = await (await h.request('/api/larder/archive')).json(), target = await installation(); t.after(() => target.close())
  const csv = await (await h.request('/api/larder/archive.csv')).text()
  const decoded = { records: {} }
  for (const match of csv.matchAll(/^"((?:[^"]|"")*)","((?:[^"]|"")*)","((?:[^"]|"")*)"\r?$/gm)) {
    const [section, index, value] = match.slice(1).map(v => v.replaceAll('""', '"'))
    if (section === 'section') continue
    const root = section.startsWith('records.') ? decoded.records : decoded
    const key = section.startsWith('records.') ? section.slice(8) : section
    if (index === '') root[key] = JSON.parse(value); else root[key][Number(index)] = JSON.parse(value)
  }
  decoded.exportedAt = archive.exportedAt
  assert.deepEqual(decoded, archive) // both downloads retain the reviewed draft provenance
  const restored = await target.request('/api/larder/archive/restore', { method: 'POST', body: decoded }); assert.equal(restored.status, 200, await restored.text())
  const restoredState = await target.state()
  for (const field of ['purchaseOrders', 'workOrders', 'movements', 'reservations']) assert.deepEqual(restoredState[field], after[field])
  assert.deepEqual((await read(target)).requirements, savedPlan.requirements)
  assert.equal(target.outboundCount(), 0)
  const restoredPlan = await read(target)
  await target.command('plan.draft', payload(restoredPlan, select(restoredPlan, rawOrder.id, raw.id, date(9))), { error: 'DRAFT_EXISTS' })
  // Revocation is checked before replay as well as before a fresh command.
  assert.equal((await h.request('/auth/operator/status', { method: 'POST', body: { operatorId: planner.id, status: 'inactive' } })).status, 200)
  await h.command('plan.draft', proposed, { as: planner.cookie, commandId: successful.commandId, error: 'AUTH' })
  // The existing inventory-policy route remains authoritative for that SKU.
  await h.command('inventory.policy', { itemId: branch.id, locationId: location.id, mode: 'make-to-stock', batchSize: '1', orderMultiple: '1', effectiveOn: date(0), reason: 'Use inventory planning' })
  plan = await read()
  await h.command('plan.draft', payload(plan, select(plan, branchOrder.id, branch.id)), { error: 'INVENTORY_POLICY' })
  await h.invariant()
})
