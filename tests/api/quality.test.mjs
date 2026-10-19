import test from 'node:test'
import assert from 'node:assert/strict'
import { installation, evidence } from './harness.mjs'

const today = new Date().toISOString().slice(0, 10)

test('TRACE-004 approved inspection plans hold failed work and lots from start, output, pick and ship until an authorized release after a passing retest', async t => {
  const h = await installation(); t.after(() => h.close())
  const manager = await h.person('quality-lead@example.test', 'manager'), operator = await h.person('line-operator@example.test', 'production')
  const warehouse = await h.person('dock@example.test', 'warehouse'), agent = await h.person('quality-agent@example.test', 'agent')
  const shop = await h.command('location.save', { name: 'Fill line' })
  const bar = await h.command('item.save', { sku: 'BAR-6061', name: 'Aluminium bar', kind: 'buy', baseUnit: 'each' })
  const bracket = await h.command('item.save', { sku: 'BRK-10', name: 'Bored bracket', kind: 'make', baseUnit: 'each' })
  const wax = await h.command('item.save', { sku: 'WAX-BASE', name: 'Balm base', kind: 'buy', baseUnit: 'each' })
  const tin = await h.command('item.save', { sku: 'BALM-4OZ', name: 'Balm tin 4 oz', kind: 'make', baseUnit: 'each' })
  await h.command('bom.revise', { itemId: bracket.id, components: [{ itemId: bar.id, quantity: '1' }], routing: [{ name: 'Bore', workCentre: 'Mill', minutes: 3 }, { name: 'Deburr', workCentre: 'Bench', minutes: 1 }] })
  await h.command('bom.revise', { itemId: tin.id, components: [{ itemId: wax.id, quantity: '1' }], routing: [{ name: 'Fill', workCentre: 'Filler', minutes: 1 }, { name: 'Lid', workCentre: 'Capper', minutes: 1 }] })
  await h.command('opening.record', { locationId: shop.id, countedOn: today, valuationBasis: 'supplier-invoice', countedBy: 'Olive', evidence: evidence(), lines: [{ itemId: bar.id, quantity: '20', unitCost: '4' }, { itemId: wax.id, quantity: '60', unitCost: '1' }] })
  const customer = await h.command('party.save', { name: 'Harbor Hardware', kind: 'customer' })

  // A qualified person approves a plan someone else prepared; agents and self-approval are refused.
  const bore = { itemId: bracket.id, revision: 1, stage: 'in-process', operationSequence: 1, name: 'Bore check', sampleSize: 5, measurements: [{ name: 'Bore diameter', unit: 'mm', target: '10', lower: '9.98', upper: '10.02' }], attachments: [evidence('Drawing BRK-10 rev A: bore 10.00 ±0.02 mm')] }
  await agent.run('quality.plan.save', bore, { error: 'FORBIDDEN' })
  await operator.run('quality.plan.save', { ...bore, measurements: [{ name: 'Bore diameter', unit: 'mm', target: '10.05', lower: '9.98', upper: '10.02' }] }, { error: 'INPUT' })
  await operator.run('quality.plan.save', { ...bore, revision: 7 }, { error: 'INPUT' })
  let borePlan = await operator.run('quality.plan.save', bore)
  assert.equal(borePlan.status, 'draft'); assert.equal(borePlan.attachments.length, 1)
  await operator.run('quality.plan.approve', { planId: borePlan.id, version: borePlan.version }, { error: 'FORBIDDEN' })
  await agent.run('quality.plan.approve', { planId: borePlan.id, version: borePlan.version }, { error: 'FORBIDDEN' })
  const draftOnly = await h.command('wo.draft', { itemId: bracket.id, quantity: '6', requiredBy: today, reason: 'Bracket batch' })
  let work = await h.command('wo.release', { workOrderId: draftOnly.id, version: draftOnly.version })
  const samples = values => ({ 'Bore diameter': values })
  await operator.run('quality.inspect', { planId: borePlan.id, planVersion: borePlan.version, workOrderId: work.id, samples: samples(['10', '10', '10', '10', '10']) }, { error: 'STATE' })
  borePlan = await manager.run('quality.plan.approve', { planId: borePlan.id, version: borePlan.version })
  assert.equal(borePlan.approval.by, manager.id)

  // Operation 1 runs; output needs a batch lot because required checks hold stock by lot.
  const op = async (who, type, sequence, more = {}) => { work = await who.run(type, { workOrderId: work.id, version: work.version, sequence, ...more }); return work }
  await op(manager, 'wo.operation.assign', 1, { operatorId: operator.id }); await op(manager, 'wo.operation.assign', 2, { operatorId: operator.id })
  await operator.run('quality.inspect', { planId: borePlan.id, planVersion: borePlan.version, workOrderId: work.id, samples: samples(['10', '10', '10', '10', '10']) }, { error: 'STATE' })
  await op(operator, 'wo.operation.start', 1, { workCentre: 'Mill', station: 'Mill 1', reason: 'Bore the batch' })
  await operator.run('wo.output', { workOrderId: work.id, version: work.version, locationId: shop.id, quantity: '4' }, { error: 'INPUT' })
  work = await operator.run('wo.output', { workOrderId: work.id, version: work.version, locationId: shop.id, quantity: '4', lot: 'BRK-A' })
  let s = await h.state()
  const lotA = s.lots.find(l => l.code === 'BRK-A')

  // Pick and pack the batch before its check fails.
  const quote = await h.command('so.quote', { customerId: customer.id, promiseDate: today, lines: [{ itemId: bracket.id, quantity: '4', unitPrice: '30' }] })
  const order = await h.command('so.confirm', { orderId: quote.id, version: quote.version }); await h.command('so.reserve', { orderId: order.id })
  let shipment = await warehouse.run('shipment.pick', { orderId: order.id, lines: [{ lineId: order.lines[0].id, locationId: shop.id, quantity: '4', lotId: lotA.id }] })
  shipment = await warehouse.run('shipment.pack', { shipmentId: shipment.id, version: shipment.version, packages: 1 })

  // Fail the dimensional check with attached measurements: the lot, operations and shipment are held.
  await agent.run('quality.inspect', { planId: borePlan.id, planVersion: borePlan.version, workOrderId: work.id, samples: samples(['10', '10', '10', '10', '10']) }, { error: 'FORBIDDEN' })
  await operator.run('quality.inspect', { planId: borePlan.id, planVersion: borePlan.version, workOrderId: work.id, samples: samples(['10', '10.01', '10']) }, { error: 'SAMPLE_SIZE' })
  const failed = await operator.run('quality.inspect', { planId: borePlan.id, planVersion: borePlan.version, workOrderId: work.id, samples: samples(['10.00', '10.01', '10.03', '9.99', '10.00']), evidence: [evidence('CMM report: bore 10.03 mm on part 3')] })
  assert.equal(failed.passed, false)
  assert.deepEqual(failed.measurements.map(m => [m.count, m.mean, m.outside, m.passed, m.samples]), [[5, '10.006', 1, false, ['10', '10.01', '10.03', '9.99', '10']]])
  assert.equal(failed.evidence[0].name, 'count-sheet.txt'); assert.ok(failed.holdId)
  s = await h.invariant()
  const hold = s.qualityHolds.find(x => x.id === failed.holdId)
  assert.equal(hold.status, 'open'); assert.deepEqual(hold.held, [{ lotId: lotA.id, locationId: shop.id, quantity: '4' }])
  assert.deepEqual(hold.unreserved.map(r => [r.demandId, r.quantity]), [[order.id, '4']])
  assert.deepEqual(s.positions.filter(p => p.lotId === lotA.id).map(p => [p.status, p.quantity]), [['quarantine', '4']])
  assert.equal(s.lots.find(l => l.id === lotA.id).status, 'quality hold')
  await op(operator, 'wo.operation.complete', 1, { reason: 'Bored' })
  const gate = s.dispatch.find(d => d.workOrderId === work.id && d.sequence === 2).gates.find(g => g.code === 'QUALITY_HOLD')
  assert.match(gate.message, /^Quality hold: Bore check failed on .*Bore diameter 1 of 5 outside 9\.98–10\.02 mm, mean 10\.006/)
  s = await operator.run('wo.operation.start', { workOrderId: work.id, version: work.version, sequence: 2, workCentre: 'Bench', station: 'Bench 1', reason: 'Deburr' }, { error: 'QUALITY_HOLD' })
  assert.equal(s.error.message, gate.message)
  assert.equal((await h.state(operator.cookie)).dispatch.find(d => d.workOrderId === work.id && d.sequence === 2).gates[0].message, gate.message)
  await operator.run('wo.output', { workOrderId: work.id, version: work.version, locationId: shop.id, quantity: '1', lot: 'BRK-B' }, { error: 'QUALITY_HOLD' })
  await warehouse.run('shipment.ship', { shipmentId: shipment.id, version: shipment.version, carrier: 'UPS' }, { error: 'QUALITY_HOLD' })
  await warehouse.run('shipment.pick', { orderId: order.id, lines: [{ lineId: order.lines[0].id, locationId: shop.id, quantity: '1', lotId: lotA.id }] }, { error: 'NOT_RESERVED' })
  await warehouse.run('quarantine.decide', { itemId: bracket.id, locationId: shop.id, lotId: lotA.id, quantity: '4', decision: 'release', reason: 'Looks fine' }, { error: 'QUALITY_HOLD' })

  // Release needs a later passing retest, a qualified person other than the failing inspector, and evidence.
  await manager.run('quality.release', { holdId: hold.id, version: hold.version, reason: 'Reworked', evidence: [evidence('Rework note')] }, { error: 'RETEST' })
  const retest = await operator.run('quality.inspect', { planId: borePlan.id, planVersion: borePlan.version, workOrderId: work.id, samples: samples(['10.00', '10.01', '10.02', '9.99', '10.00']), evidence: [evidence('CMM retest after rework')] })
  assert.equal(retest.passed, true); assert.equal(retest.retestOf, failed.id); assert.equal(retest.holdId, undefined)
  await operator.run('quality.release', { holdId: hold.id, version: hold.version, reason: 'Retest passed', evidence: [evidence('Retest')] }, { error: 'FORBIDDEN' })
  await agent.run('quality.release', { holdId: hold.id, version: hold.version, reason: 'Retest passed', evidence: [evidence('Retest')] }, { error: 'FORBIDDEN' })
  await manager.run('quality.release', { holdId: hold.id, version: hold.version, reason: 'Retest passed' }, { error: 'EVIDENCE' })
  const released = await manager.run('quality.release', { holdId: hold.id, version: hold.version, reason: 'Retest passed after rework', evidence: [evidence('Signed retest record')] })
  assert.equal(released.status, 'released'); assert.equal(released.release.retestId, retest.id); assert.deepEqual(released.release.released, [{ lotId: lotA.id, locationId: shop.id, quantity: '4' }])
  s = await h.invariant()
  assert.deepEqual(s.positions.filter(p => p.lotId === lotA.id).map(p => [p.status, p.quantity]), [['available', '4']])
  assert.equal(s.lots.find(l => l.id === lotA.id).status, 'released')
  assert.deepEqual(s.inspections.filter(x => x.subjectId === work.id).map(x => [x.id, x.passed]), [[failed.id, false], [retest.id, true]])
  assert.equal(s.dispatch.find(d => d.workOrderId === work.id && d.sequence === 2).gates.some(g => g.code === 'QUALITY_HOLD'), false)
  await op(operator, 'wo.operation.start', 2, { workCentre: 'Bench', station: 'Bench 1', reason: 'Deburr' })
  await h.command('so.reserve', { orderId: order.id })
  assert.equal((await warehouse.run('shipment.ship', { shipmentId: shipment.id, version: shipment.version, carrier: 'UPS' })).status, 'shipped')

  // Fill weight during production: count, exact mean and pass/fail against the approved rule on each batch.
  const fillRule = { itemId: tin.id, revision: null, stage: 'in-process', operationSequence: 1, name: 'Fill weight', sampleSize: 20, measurements: [{ name: 'Fill weight', unit: 'oz', target: '4.0', lower: '3.95', upper: '4.15' }] }
  let fill = await manager.run('quality.plan.save', fillRule)
  fill = await h.command('quality.plan.approve', { planId: fill.id, version: fill.version })
  const batch = async (lot, weights) => {
    const draft = await h.command('wo.draft', { itemId: tin.id, quantity: '20', requiredBy: today, reason: `Batch ${lot}` })
    let w = await h.command('wo.release', { workOrderId: draft.id, version: draft.version })
    w = await manager.run('wo.operation.assign', { workOrderId: w.id, version: w.version, sequence: 1, operatorId: operator.id })
    w = await operator.run('wo.operation.start', { workOrderId: w.id, version: w.version, sequence: 1, workCentre: 'Filler', station: 'Filler 1', reason: 'Fill tins' })
    w = await operator.run('wo.output', { workOrderId: w.id, version: w.version, locationId: shop.id, quantity: '20', lot })
    return { w, result: await operator.run('quality.inspect', { planId: fill.id, planVersion: fill.version, workOrderId: w.id, samples: { 'Fill weight': weights } }) }
  }
  const pass = await batch('BB-1020', [...Array(10).fill('4.02'), ...Array(10).fill('4.04')])
  assert.deepEqual(pass.result.measurements.map(m => [m.count, m.mean, m.lower, m.upper, m.unit, m.passed]), [[20, '4.03', '3.95', '4.15', 'oz', true]])
  assert.equal(pass.result.holdId, undefined)
  const fail = await batch('BB-1021', [...Array(18).fill('4.01'), '3.9', '3.92'])
  assert.deepEqual(fail.result.measurements.map(m => [m.count, m.mean, m.outside, m.passed]), [[20, '4', 2, false]])
  s = await h.invariant()
  const lot = code => s.lots.find(l => l.code === code)
  assert.deepEqual([lot('BB-1020').status, lot('BB-1021').status], ['released', 'quality hold'])
  assert.deepEqual(s.positions.filter(p => [lot('BB-1020').id, lot('BB-1021').id].includes(p.lotId)).map(p => [p.lotId === lot('BB-1020').id ? 'BB-1020' : 'BB-1021', p.status, p.quantity]).sort(), [['BB-1020', 'available', '20'], ['BB-1021', 'quarantine', '20']])
  assert.equal(s.inspections.find(x => x.id === pass.result.id).planVersion, fill.version)

  // A newer approved plan supersedes the old one; results keep the version they were scored under.
  let tighter = await manager.run('quality.plan.save', { ...fillRule, sampleSize: 10 })
  tighter = await h.command('quality.plan.approve', { planId: tighter.id, version: tighter.version })
  s = await h.state()
  assert.equal(s.inspectionPlans.find(p => p.id === fill.id).status, 'superseded')
  await operator.run('quality.inspect', { planId: fill.id, planVersion: s.inspectionPlans.find(p => p.id === fill.id).version, workOrderId: fail.w.id, samples: { 'Fill weight': Array(20).fill('4') } }, { error: 'STATE' })

  // Receipt inspection plans apply to received supplier lots.
  const supplier = await h.command('party.save', { name: 'Wax Works', kind: 'supplier' })
  let po = await h.command('po.draft', { supplierId: supplier.id, expectedDate: today, reason: 'Balm base', lines: [{ itemId: wax.id, quantity: '10', unitPrice: '1' }] })
  po = await h.command('po.approve', { poId: po.id, version: po.version })
  const receipt = await warehouse.run('receipt.create', { poId: po.id, supplierReference: 'WW-9', lines: [{ lineId: po.lines[0].id, locationId: shop.id, quantity: '10', lot: 'WAX-77' }] })
  let melt = await operator.run('quality.plan.save', { itemId: wax.id, stage: 'receipt', name: 'Melt point', sampleSize: 3, measurements: [{ name: 'Melt point', unit: '°C', target: '62', lower: '60', upper: '64' }] })
  melt = await manager.run('quality.plan.approve', { planId: melt.id, version: melt.version })
  const meltFail = await operator.run('quality.inspect', { planId: melt.id, planVersion: melt.version, lotId: receipt.lines[0].lotId, samples: { 'Melt point': ['59.5', '62', '61'] } })
  s = await h.invariant()
  assert.equal(s.qualityHolds.find(x => x.id === meltFail.holdId).subjectKind, 'lots')
  assert.deepEqual(s.positions.filter(p => p.lotId === receipt.lines[0].lotId).map(p => [p.status, p.quantity]), [['quarantine', '10']])
})
