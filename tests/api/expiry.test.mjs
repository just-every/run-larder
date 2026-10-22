import test from 'node:test'
import assert from 'node:assert/strict'
import { installation, evidence } from './harness.mjs'

const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

test('TRACE-003 dated lots plan and pick FEFO for a customer shelf-life rule; expired and retest-due stock stays blocked until a documented disposition', async t => {
  const h = await installation(); t.after(() => h.close())
  const manager = await h.person('quality-manager@example.test', 'manager'), warehouse = await h.person('warehouse@example.test', 'warehouse'), agent = await h.person('agent@example.test', 'agent')
  const today = day(0), cold = await h.command('location.save', { name: 'Cold room' })
  const extract = await h.command('item.save', { sku: 'VAN-EXT', name: 'Vanilla extract', kind: 'buy', baseUnit: 'each' })
  const syrup = await h.command('item.save', { sku: 'VAN-SYR', name: 'Vanilla syrup', kind: 'make', baseUnit: 'each' })
  await h.command('bom.revise', { itemId: syrup.id, components: [{ itemId: extract.id, quantity: '1' }], routing: [{ name: 'Blend', workCentre: 'Kitchen', minutes: 10 }] })
  const supplier = await h.command('party.save', { name: 'Madagascar Botanicals', kind: 'supplier' })
  await h.command('party.save', { name: 'Fresh Market', kind: 'customer', minShelfLifeDays: -1 }, { error: 'INPUT' })
  const fresh = await h.command('party.save', { name: 'Fresh Market', kind: 'customer', minShelfLifeDays: 60 }), deli = await h.command('party.save', { name: 'Corner Deli', kind: 'customer' })
  assert.equal(fresh.minShelfLifeDays, 60); assert.equal(deli.minShelfLifeDays, undefined)

  // Receive two current dated lots plus one already expired and one past its retest date.
  let po = await h.command('po.draft', { supplierId: supplier.id, expectedDate: today, reason: 'Extract for syrup', lines: [{ itemId: extract.id, quantity: '40', unitPrice: '5' }] })
  po = await h.command('po.approve', { poId: po.id, version: po.version })
  const line = (lot, quantity, dates) => ({ lineId: po.lines[0].id, locationId: cold.id, quantity, lot, dates })
  await warehouse.run('receipt.create', { poId: po.id, supplierReference: 'No lot', lines: [line(undefined, '1', { expiresOn: day(10) })] }, { error: 'INPUT' })
  await warehouse.run('receipt.create', { poId: po.id, supplierReference: 'Future', lines: [line('F', '1', { manufacturedOn: day(1) })] }, { error: 'INPUT' })
  await warehouse.run('receipt.create', { poId: po.id, supplierReference: 'Backwards', lines: [line('W', '1', { manufacturedOn: day(-2), expiresOn: day(-3) })] }, { error: 'INPUT' })
  await warehouse.run('receipt.create', { poId: po.id, supplierReference: 'Invalid calendar day', lines: [line('INVALID', '1', { expiresOn: '2026-02-30' })] }, { error: 'INPUT' })
  const receipt = await warehouse.run('receipt.create', { poId: po.id, supplierReference: 'MB-77', lines: [
    line('A', '10', { manufacturedOn: day(-10), expiresOn: day(20), storage: 'Refrigerate 2-8 °C' }),
    line('B', '20', { manufacturedOn: day(-5), supplierShelfLifeDays: 120, retestOn: day(90), storage: 'Refrigerate 2-8 °C' }),
    line('X', '5', { manufacturedOn: day(-400), expiresOn: day(-1) }),
    line('R', '5', { expiresOn: day(200), retestOn: day(-1) }),
  ] })
  const [A, B, X, R] = receipt.lines.map(l => l.lotId)
  let s = await h.state()
  const lot = id => s.lots.find(l => l.id === id)
  assert.deepEqual(lot(A).dates, { manufacturedOn: day(-10), expiresOn: day(20), retestOn: '', storage: 'Refrigerate 2-8 °C' })
  assert.equal(lot(B).dates.expiresOn, day(115)); assert.equal(lot(B).dates.supplierShelfLifeDays, 120)
  const status = id => s.lotStatuses.find(l => l.lotId === id)
  assert.deepEqual([A, B, X, R].map(id => [status(id).state, status(id).remainingDays]), [['expiring', 20], ['current', 115], ['expired', -1], ['retest due', 200]])
  const stock = () => s.availability.find(a => a.itemId === extract.id)
  assert.deepEqual([stock().onHand, stock().expired, stock().available], ['40', '10', '30'])
  const alerts = s.exceptions.filter(x => x.kind === 'expiry')
  assert.deepEqual(alerts.map(x => [x.id, x.resolvable]).sort(), [[A, true], [X, false], [R, false]].sort())
  assert.match(alerts.find(x => x.id === X).title, new RegExp(`expired on ${day(-1)}`)); assert.match(alerts.find(x => x.id === R).title, new RegExp(`retest was due on ${day(-1)}`))

  // Plan FEFO for the customer's 60-day rule on the promised ship day.
  const confirmed = async (customerId, quantity, promiseDate) => {
    const quote = await h.command('so.quote', { customerId, promiseDate, lines: [{ itemId: extract.id, quantity, unitPrice: '12' }] })
    const order = await h.command('so.confirm', { orderId: quote.id, version: quote.version })
    await h.command('so.reserve', { orderId: order.id }); return order
  }
  const strict = await confirmed(fresh.id, '8', day(3))
  s = await h.state()
  const plan = s.fefoPlans.find(p => p.orderId === strict.id)
  assert.equal(plan.on, day(3)); assert.equal(plan.minShelfLifeDays, 60)
  assert.deepEqual(plan.lots.map(x => [x.code, x.remainingDays, x.eligible]), [['X', -4, false], ['A', 17, false], ['B', 112, true], ['R', 197, false]])
  assert.match(plan.lots[1].reason, /17 days of shelf life left.*needs 60/); assert.match(plan.lots[3].reason, /retest was due/)
  const pickLine = lotId => ({ orderId: strict.id, lines: [{ lineId: strict.lines[0].id, locationId: cold.id, quantity: '8', lotId }] })
  await warehouse.run('shipment.pick', pickLine(A), { error: 'FEFO_INELIGIBLE' })
  await warehouse.run('shipment.pick', pickLine(X), { error: 'FEFO_INELIGIBLE' })
  const strictPick = await warehouse.run('shipment.pick', pickLine(undefined))
  assert.deepEqual(strictPick.lines.map(l => [l.lotId, l.quantity]), [[B, '8']])

  // Without a customer rule FEFO takes the earliest usable lot first, then the next.
  const open = await confirmed(deli.id, '14', today)
  const openPick = await warehouse.run('shipment.pick', { orderId: open.id, lines: [{ lineId: open.lines[0].id, locationId: cold.id, quantity: '14' }] })
  assert.deepEqual(openPick.lines.map(l => [l.lotId, l.quantity]), [[A, '10'], [B, '4']])
  for (const pick of [strictPick, openPick]) {
    const packed = await warehouse.run('shipment.pack', { shipmentId: pick.id, version: pick.version, packages: 1 })
    await warehouse.run('shipment.ship', { shipmentId: packed.id, version: packed.version, carrier: 'UPS' })
  }
  s = await h.state()
  const shipped = id => s.movements.filter(m => m.documentKind === 'shipments' && m.documentId === id).map(m => [m.lotId, m.quantity])
  assert.deepEqual(shipped(strictPick.id), [[B, '-8']]); assert.deepEqual(shipped(openPick.id), [[A, '-10'], [B, '-4']])

  // Expired and retest-due stock is neither reserved, issued nor transferred; output records its own dates.
  const draft = await h.command('wo.draft', { itemId: syrup.id, quantity: '6', requiredBy: today, reason: 'Syrup batch' })
  const work = await h.command('wo.release', { workOrderId: draft.id, version: draft.version })
  assert.deepEqual(work.shortages, [])
  await h.command('wo.draft', { itemId: syrup.id, quantity: '5', requiredBy: today, reason: 'Second batch' }).then(d => h.command('wo.release', { workOrderId: d.id, version: d.version })).then(w => assert.deepEqual(w.shortages, [{ itemId: extract.id, short: '3' }]))
  await h.command('wo.issue', { workOrderId: work.id, lines: [{ itemId: extract.id, locationId: cold.id, quantity: '6', lotId: X }] }, { error: 'LOT_BLOCKED' })
  await h.command('wo.issue', { workOrderId: work.id, lines: [{ itemId: extract.id, locationId: cold.id, quantity: '6' }] })
  await warehouse.run('transfer.create', { itemId: extract.id, fromLocationId: cold.id, toLocationId: (await h.command('location.save', { name: 'Dock' })).id, quantity: '1', lotId: X, reason: 'Move' }, { error: 'INSUFFICIENT_STOCK' })
  s = await h.state()
  assert.deepEqual(s.movements.filter(m => m.documentId === work.id && m.kind === 'issue').map(m => [m.lotId, m.quantity]), [[B, '-6']])
  const current = s.workOrders.find(w => w.id === work.id)
  await h.command('wo.output', { workOrderId: work.id, version: current.version, locationId: cold.id, quantity: '6', lot: 'SY-1', dates: { expiresOn: day(180), storage: 'Ambient, sealed' } })
  s = await h.state()
  assert.deepEqual(s.lots.find(l => l.code === 'SY-1').dates, { manufacturedOn: today, expiresOn: day(180), retestOn: '', storage: 'Ambient, sealed' })

  // Only an owner or manager disposes of a blocked lot, with a reason and evidence; history is kept.
  const dispose = (lotId, more = {}) => ({ lotId, version: s.lots.find(l => l.id === lotId).version, reason: 'Retest passed', evidence: [evidence('Retest certificate R')], ...more })
  await warehouse.run('lot.dispose', dispose(R, { decision: 'extend', retestOn: day(30) }), { error: 'FORBIDDEN' })
  await agent.run('lot.dispose', dispose(R, { decision: 'extend', retestOn: day(30) }), { error: 'FORBIDDEN' })
  await manager.run('lot.dispose', dispose(R, { decision: 'extend', retestOn: day(30), evidence: [] }), { error: 'EVIDENCE' })
  await manager.run('lot.dispose', dispose(R, { decision: 'extend', retestOn: day(30), version: 99 }), { error: 'STALE' })
  await manager.run('lot.dispose', dispose(R, { decision: 'extend', retestOn: today }), { error: 'INPUT' })
  await manager.run('lot.dispose', dispose(B, { decision: 'extend', retestOn: day(30) }), { error: 'STATE' })
  const extended = await manager.run('lot.dispose', dispose(R, { decision: 'extend', retestOn: day(30) }))
  assert.equal(extended.dates.retestOn, day(30)); assert.equal(extended.dispositions[0].before.retestOn, day(-1)); assert.equal(extended.dispositions[0].evidence[0].name, 'count-sheet.txt')
  const scrapped = await manager.run('lot.dispose', dispose(X, { decision: 'scrap', locationId: cold.id, reason: 'Expired; destroyed' }))
  assert.equal(scrapped.dispositions[0].quantity, '5')
  s = await h.invariant()
  assert.deepEqual(s.movements.filter(m => m.lotId === X && m.kind === 'scrap').map(m => m.quantity), ['-5'])
  assert.deepEqual([stock().onHand, stock().expired], ['7', '0'])
  assert.deepEqual(s.exceptions.filter(x => x.kind === 'expiry' && !x.resolvable), [])
  assert.equal(s.lotStatuses.find(l => l.lotId === R).state, 'current')

  // Opening dates obey the same validation. Inclusive expiry/retest days stay
  // usable, and an unlotted balance precedes dated lots when no minimum applies.
  const boundary = await h.command('item.save', { sku: 'DATE-BOUNDARY', name: 'Boundary stock', kind: 'buy', baseUnit: 'each' })
  const opening = { locationId: cold.id, countedOn: today, countedBy: 'Olive', valuationBasis: 'supplier-invoice', evidence: evidence(), lines: [{ itemId: boundary.id, quantity: '1', unitCost: '1', dates: { expiresOn: today } }] }
  await h.command('opening.record', opening, { error: 'INPUT' })
  opening.lines[0].dates = undefined
  await h.command('opening.record', opening)
  let datedPo = await h.command('po.draft', { supplierId: supplier.id, expectedDate: today, reason: 'Inclusive lot dates', lines: [{ itemId: boundary.id, quantity: '2', unitPrice: '1' }] })
  datedPo = await h.command('po.approve', { poId: datedPo.id, version: datedPo.version })
  await h.command('receipt.create', { poId: datedPo.id, supplierReference: 'Bad retest', lines: [{ lineId: datedPo.lines[0].id, locationId: cold.id, quantity: '2', lot: 'TODAY', dates: { expiresOn: today, retestOn: day(1) } }] }, { error: 'INPUT' })
  const datedReceipt = await h.command('receipt.create', { poId: datedPo.id, supplierReference: 'Inclusive dates', lines: [{ lineId: datedPo.lines[0].id, locationId: cold.id, quantity: '2', lot: 'TODAY', dates: { expiresOn: today, retestOn: today } }] })
  const todayLot = datedReceipt.lines[0].lotId
  s = await h.state()
  assert.deepEqual(s.availability.find(x => x.itemId === boundary.id), { itemId: boundary.id, onHand: '3', quarantine: '0', reserved: '0', expired: '0', available: '3', expectedPurchase: '0', expectedProduction: '0', unreservedDemand: '0', availableToPromise: '3' })
  let boundaryOrder = await h.command('so.quote', { customerId: deli.id, promiseDate: today, lines: [{ itemId: boundary.id, quantity: '2', unitPrice: '3' }] })
  boundaryOrder = await h.command('so.confirm', { orderId: boundaryOrder.id, version: boundaryOrder.version }); await h.command('so.reserve', { orderId: boundaryOrder.id })
  const boundaryPick = await h.command('shipment.pick', { orderId: boundaryOrder.id, lines: [{ lineId: boundaryOrder.lines[0].id, locationId: cold.id, quantity: '2' }] })
  assert.deepEqual(boundaryPick.lines.map(l => [l.lotId, l.quantity]), [['', '1'], [todayLot, '1']])
  const boundaryPacked = await h.command('shipment.pack', { shipmentId: boundaryPick.id, version: boundaryPick.version, packages: 1 })
  // A newly recorded customer rule is checked again at dispatch: a previous
  // eligible pick cannot prove an undated balance meets that rule.
  await h.command('party.save', { id: deli.id, version: deli.version, name: deli.name, kind: 'customer', minShelfLifeDays: 0 })
  await h.command('shipment.ship', { shipmentId: boundaryPacked.id, version: boundaryPacked.version, carrier: 'UPS' }, { error: 'FEFO_INELIGIBLE' })
  s = await h.state()
  assert.equal(s.shipments.find(x => x.id === boundaryPacked.id).status, 'packed')
  assert.equal(s.movements.filter(m => m.documentId === boundaryPacked.id).length, 0)

})

test('GOV-011 expiry scrap and quarantine and nonconformance rejections honour the inventory-adjustment threshold: two signatures on the exact lot, location and quantity, a deputy, invalidation when stock moves, agents denied and a named owner override', async t => {
  const h = await installation(); t.after(() => h.close())
  const person = (name, role) => h.person(`gov11-${name}@example.test`, role)
  const quality = await person('quality', 'quality'), mgrA = await person('a', 'manager'), mgrB = await person('b', 'manager'), deputy = await person('deputy', 'sales'), agent = await person('agent', 'agent'), warehouse = await person('wh', 'warehouse')
  const cold = await h.command('location.save', { name: 'Write-off room' })
  const item = await h.command('item.save', { sku: 'GOV11-EXT', name: 'Write-off extract', kind: 'buy', baseUnit: 'each' })
  const supplier = await h.command('party.save', { name: 'Write-off supplier', kind: 'supplier' })
  let po = await h.command('po.draft', { supplierId: supplier.id, expectedDate: day(0), reason: 'Write-off proof', lines: [{ itemId: item.id, quantity: '40', unitPrice: '10' }] })
  po = await h.command('po.approve', { poId: po.id, version: po.version })
  const line = (lot, quantity, more = {}) => ({ lineId: po.lines[0].id, locationId: cold.id, quantity, lot, ...more })
  await h.command('receipt.create', { poId: po.id, supplierReference: 'synthetic-larder-41', lines: [line('GOV11-OLD', '10', { dates: { expiresOn: day(-1) } }), line('GOV11-OVERRIDE', '10', { dates: { expiresOn: day(-1) } }), line('GOV11-QUARANTINE', '10', { inspection: 'quarantine' }), line('GOV11-CASE', '10')] })
  const lotOf = async code => (await h.state()).lots.find(l => l.code === code)
  await h.command('approval.policy', { category: 'inventoryAdjustment', thresholdUsd: '50', signatures: 2, expiryMinutes: 60, reason: 'Two people write off stock above $50' })
  await mgrB.run('approval.deputize', { deputyId: deputy.id, validUntil: new Date(Date.now() + 7 * 86400000).toISOString(), reason: 'Cover the stores review', categories: ['inventoryAdjustment'] })
  const signature = async id => (await h.state()).approvalSignatures.find(x => x.id === id)
  const available = async lotId => (await h.state()).positions.find(p => p.lotId === lotId && p.status === 'available')?.quantity ?? '0'
  const scrap = async (who, code, more = {}, error) => { const lot = await lotOf(code); return who.run('lot.dispose', { lotId: lot.id, version: lot.version, decision: 'scrap', locationId: cold.id, reason: 'Expired; destroyed', evidence: [evidence('Disposal record')], ...more }, error && { error }) }

  // Expired stock worth $100: an agent and a warehouse person cannot decide; one signature scraps nothing.
  await scrap(agent, 'GOV11-OLD', {}, 'FORBIDDEN'); await scrap(warehouse, 'GOV11-OLD', {}, 'FORBIDDEN'); await scrap(mgrA, 'GOV11-OLD', { override: { reason: 'Nobody checked', accountableId: mgrA.id } }, 'FORBIDDEN')
  const first = await scrap(quality, 'GOV11-OLD')
  assert.deepEqual([first.category, first.valueUsd, first.remainingAtSigning, first.terms.decision, first.terms.quantity], ['inventoryAdjustment', '100', 1, 'scrap', '10'])
  const old = await lotOf('GOV11-OLD')
  assert.deepEqual([await available(old.id), old.dispositions ?? []], ['10', []])
  // Stock moves at that location after the signature, so it no longer counts.
  const count = await warehouse.run('count.record', { itemId: item.id, locationId: cold.id, lotId: old.id, counted: '9' })
  await mgrA.run('count.approve', { countId: count.id, version: count.version })
  assert.equal((await signature(first.id)).status, 'invalidated')
  assert.equal((await scrap(quality, 'GOV11-OLD')).valueUsd, '90')
  await scrap(quality, 'GOV11-OLD', {}, 'DUPLICATE_SIGNATURE')
  const done = await scrap(deputy, 'GOV11-OLD')
  assert.deepEqual([done.dispositions[0].quantity, done.dispositions[0].signatureIds.length, await available(old.id)], ['9', 2, '0'])
  assert.equal((await signature(done.dispositions[0].signatureIds.at(-1))).onBehalfOf, mgrB.id)
  // The owner overrides a second scrap, naming the accountable manager.
  const overridden = await scrap({ run: h.command }, 'GOV11-OVERRIDE', { override: { reason: 'Audit tomorrow', accountableId: mgrA.id } })
  assert.deepEqual([overridden.dispositions[0].override.accountableId, overridden.dispositions[0].signatureIds.length, await available(overridden.id)], [mgrA.id, 1, '0'])

  // A $100 quarantine rejection and a $50 nonconformance rejection write stock off the same way.
  const quarantined = await lotOf('GOV11-QUARANTINE')
  const reject = (who, error) => who.run('quarantine.decide', { itemId: item.id, locationId: cold.id, lotId: quarantined.id, quantity: '10', decision: 'reject', reason: 'Failed receipt check' }, error && { error })
  await reject(agent, 'FORBIDDEN')
  assert.equal((await reject(mgrA)).category, 'inventoryAdjustment')
  assert.equal((await reject(mgrB)).decision, 'rejected')
  const caseLot = await lotOf('GOV11-CASE')
  const n = await mgrA.run('nonconformance.open', { lotId: caseLot.id, locationId: cold.id, quantity: '5', complaint: 'Contaminated', dueOn: day(0), evidence: [evidence('Complaint')] })
  const rejectCase = who => who.run('nonconformance.reject', { caseId: n.id, version: n.version, quantity: '5', reason: 'Scrap contaminated units', evidence: [evidence('Scrap record')] })
  assert.equal((await rejectCase(quality)).valueUsd, '50')
  assert.equal((await rejectCase(mgrA)).remaining, '0')
  await h.invariant()
})
