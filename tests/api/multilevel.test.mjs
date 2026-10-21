import test from 'node:test'
import assert from 'node:assert/strict'
import { installation, evidence } from './harness.mjs'

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

test('MRP-001 protects each reservation bin on its demand date, pins released inputs and restores the read-only projection without treating WIP as feasible supply', async t => {
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
  assert.ok(plan.limitations.includes('Unmade BOM demand is not exploded.'))
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
  assert.deepEqual(fractionalFloor.suggestion, { kind: 'buy', quantity: '1', supplierId: supplier.id, receiptOn: date(0), releaseOn: date(-2), leadDays: 2, requiresPastRelease: true })
  assert.ok(fractionalFloor.unavailableStock.some(p => p.reason === 'quarantine'))
  assert.ok(fractionalFloor.unavailableStock.some(p => p.reason === `expired on ${date(-1)}`))
  assert.ok(plan.provisionalSupply.some(p => p.documentId === drafted.id))
  assert.equal(fractionalFloor.sources.some(s => s.documentId === expected.id), false)
  const reserved = plan.requirements.find(r => r.documentId === protectedOrder.id), free = plan.requirements.find(r => r.documentId === competing.id)
  assert.equal(reserved.covered, '4'); assert.ok(reserved.sources.every(s => s.reserved && s.locationId === a.id))
  assert.deepEqual([free.covered, free.shortage], ['3', '1']); assert.equal(free.sources[0].locationId, b.id)
  assert.match(plan.limitations.join(' '), /current physical stock only; future floor replenishment/)
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
