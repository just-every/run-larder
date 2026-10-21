import test from 'node:test'
import assert from 'node:assert/strict'
import { installation, evidence, parse } from './harness.mjs'

const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)

test('FLOOR-003 six of ten complete at operation one, four handed on, two held, four backordered with dated commitments, through public doors', async t => {
  const h = await installation(); t.after(() => h.close())
  const first = await h.person('wip-machinist@example.test', 'operator'), second = await h.person('wip-coater@example.test', 'operator')
  const manager = await h.person('wip-manager@example.test', 'manager'), agent = await h.person('wip-agent@example.test', 'agent'), viewer = await h.person('wip-viewer@example.test', 'viewer')
  const loc = await h.command('location.save', { name: 'WIP rack' })
  const raw = await h.command('item.save', { sku: 'WIP-BLANK', name: 'WIP blank', kind: 'buy', baseUnit: 'each' })
  const part = await h.command('item.save', { sku: 'WIP-PLATE', name: 'WIP plate', kind: 'make', baseUnit: 'each' })
  await h.command('bom.revise', { itemId: part.id, components: [{ itemId: raw.id, quantity: '1' }], routing: [
    { name: 'Machine', workCentre: 'WIP mill', minutes: 2, setupMinutes: 10, queueMinutes: 5 },
    { name: 'Coat', workCentre: 'WIP booth', minutes: 3, transferBatch: '4', allowOverlap: true },
  ] })
  await h.command('opening.record', { locationId: loc.id, countedOn: day(0), valuationBasis: 'supplier-invoice', countedBy: 'Olive', evidence: evidence('20 blanks'), lines: [{ itemId: raw.id, quantity: '20', unitCost: '4' }] })
  let w = await h.command('wo.draft', { itemId: part.id, quantity: '10', requiredBy: day(10), reason: 'Ten plates, partly completed' })
  w = await h.command('wo.release', { workOrderId: w.id, version: w.version })
  await h.command('wo.reserve', { workOrderId: w.id })
  w = await h.command('wo.issue', { workOrderId: w.id, lines: [{ itemId: raw.id, locationId: loc.id, quantity: '6' }] })
  const payload = (sequence, extra = {}) => ({ workOrderId: w.id, version: w.version, sequence, ...extra })
  const run = async (who, type, sequence, extra = {}, opts = {}) => { const r = await who.run(type, payload(sequence, extra), opts); if (!opts.error) w = r; return r }
  w = await h.command('wo.operation.assign', payload(1, { operatorId: first.id }))
  w = await h.command('wo.operation.assign', payload(2, { operatorId: second.id }))
  await run(first, 'wo.operation.start', 1, { workCentre: 'WIP mill', station: 'Mill tablet', reason: 'Fixture checked' })
  const ledger = async (who = h.owner()) => (await h.state(who)).operationLedgers[w.id]
  const step = async (n, who) => (await ledger(who)).steps.find(x => x.sequence === n)
  const conserved = async () => {
    const l = await ledger()
    for (const s of l.steps) {
      assert.equal(Object.values(s.quantities).reduce((n, v) => n + parse(v), 0n), parse(l.quantity), `step ${s.sequence} quantities`)
      assert.equal(Object.values(s.costs).reduce((n, v) => n + parse(v), 0n), parse(l.materialsCost), `step ${s.sequence} costs`)
    }
    return l
  }
  const stock = await h.state()

  // Reports are the assigned starter's actual quantities; estimates and strangers cannot make them.
  await run(agent, 'wo.operation.report', 1, { good: '1', reason: 'Agent' }, { error: 'FORBIDDEN' })
  await run(second, 'wo.operation.report', 1, { good: '1', reason: 'Not my operation' }, { error: 'FORBIDDEN' })
  await run(viewer, 'wo.operation.report', 1, { good: '1', reason: 'Viewer' }, { error: 'FORBIDDEN' })
  await run(first, 'wo.operation.report', 1, { good: '11', reason: 'Too many' }, { error: 'QUANTITY' })
  await run(first, 'wo.operation.report', 1, { reason: 'Nothing' }, { error: 'INPUT' })
  await run(first, 'wo.operation.report', 1, { scrap: '1', reason: 'No scrap reason' }, { error: 'INPUT' })
  await run(first, 'wo.operation.progress', 1, { completedQuantity: '10', remainingMinutes: 0, note: 'Estimate only' })
  assert.equal((await step(1)).quantities.completed, '0')
  const identity = crypto.randomUUID(), six = payload(1, { good: '6', reason: 'Six measured and accepted' })
  w = await first.run('wo.operation.report', six, { commandId: identity })
  assert.deepEqual(await first.run('wo.operation.report', six, { commandId: identity }), w)
  await first.run('wo.operation.report', { ...six, good: '1' }, { commandId: identity, error: 'IDEMPOTENCY' })
  await first.run('wo.operation.report', { ...six, good: '1', version: 1 }, { error: 'STALE' })
  let s1 = await step(1)
  assert.deepEqual([s1.quantities.completed, s1.quantities.running], ['6', '4'])

  // Only permitted quantity moves downstream: four of the six, never the held or the unfinished.
  await run(first, 'wo.operation.transfer', 1, { toSequence: 2, quantity: '7', reason: 'More than finished' }, { error: 'QUANTITY' })
  await run(first, 'wo.operation.transfer', 1, { toSequence: 2, quantity: '4', reason: 'First four coated blanks' })
  await run(first, 'wo.operation.hold', 1, { quantity: '3', reason: 'Too many' }, { error: 'QUANTITY' })
  await run(second, 'wo.operation.hold', 1, { quantity: '2', reason: 'Not mine' }, { error: 'FORBIDDEN' })
  await run(first, 'wo.operation.hold', 1, { quantity: '2', reason: 'Burr on two parts, supervisor to decide' })
  await run(first, 'wo.operation.transfer', 1, { toSequence: 2, quantity: '1', reason: 'A held unit' }, { error: 'QUANTITY' })
  await run(first, 'wo.operation.backorder', 1, { quantity: '4', dueOn: day(20), reason: 'Tool wear' }, { error: 'FORBIDDEN' })
  await run(manager, 'wo.operation.backorder', 1, { quantity: '5', dueOn: day(20), reason: 'Too many' }, { error: 'QUANTITY' })
  await run(manager, 'wo.operation.backorder', 1, { quantity: '4', dueOn: day(-1), reason: 'Past' }, { error: 'INPUT' })
  await run(manager, 'wo.operation.backorder', 1, { quantity: '4', dueOn: day(20), reason: 'New tool arrives next week' })

  // Supervisor inspection: WIP by operation, costs, dated backorder commitments, reservations unchanged.
  let l = await conserved(); s1 = l.steps[0]
  assert.deepEqual(s1.quantities, { upstream: '0', waiting: '0', running: '0', backordered: '4', completed: '0', movedOn: '4', held: '2', scrapped: '0' })
  assert.deepEqual(s1.costs, { upstream: '0', waiting: '0', running: '0', backordered: '9.6', completed: '0', movedOn: '9.6', held: '4.8', scrapped: '0' })
  assert.equal(l.materialsCost, '24'); assert.match(l.costBasis, /labor and overhead are not recorded/)
  assert.deepEqual((await step(2)).quantities, { upstream: '6', waiting: '4', running: '0', backordered: '0', completed: '0', movedOn: '0', held: '0', scrapped: '0' })
  const order = l.backorders[0]
  assert.deepEqual([order.quantity, order.dueOn, order.requiredBy, order.late, order.cost], ['4', day(20), day(10), true, '9.6'])
  assert.deepEqual(order.capacity, [{ sequence: 1, workCentre: 'WIP mill', minutes: 23 }, { sequence: 2, workCentre: 'WIP booth', minutes: 12 }])
  assert.deepEqual(order.materials, [{ itemId: raw.id, needed: '4', reserved: '4', issued: '6' }])
  const after = await h.invariant(); assert.deepEqual([after.movements, after.reservations], [stock.movements, stock.reservations])
  assert.equal(w.output, '0'); assert.equal(w.scrap, '0')

  // The job cannot finish or be re-split around an open backorder; second operation still runs on the four handed over.
  await run(first, 'wo.operation.complete', 1, { reason: 'Premature' }, { error: 'BACKORDER' })
  await h.command('wo.close', { workOrderId: w.id, version: w.version }, { error: 'BACKORDER' })
  await h.command('wo.split', { workOrderId: w.id, version: w.version, parts: [{ quantity: '2' }], reason: 'Split around ledger' }, { error: 'WIP_LEDGER' })
  await run(second, 'wo.operation.start', 2, { workCentre: 'WIP booth', station: 'Booth tablet', reason: 'First four available' })
  await run(second, 'wo.operation.complete', 2, { reason: 'Early' }, { error: 'TRANSFER_BATCH' })

  // Holds are released only by a supervisor, never the person who placed them (owner excepted).
  const heldId = (await step(1)).holds[0].id
  await run(first, 'wo.operation.holdRelease', 1, { holdId: heldId, disposition: 'continue', reason: 'Self release' }, { error: 'FORBIDDEN' })
  await run(manager, 'wo.operation.holdRelease', 1, { holdId: heldId, disposition: 'dispose', reason: 'Bad disposition' }, { error: 'INPUT' })
  await run(manager, 'wo.operation.holdRelease', 1, { holdId: heldId, disposition: 'continue', reason: 'Burr removed by hand' })
  await run(manager, 'wo.operation.holdRelease', 1, { holdId: heldId, disposition: 'continue', reason: 'Again' }, { error: 'STATE' })
  assert.equal((await step(1)).quantities.completed, '2')
  await run(manager, 'wo.operation.hold', 1, { quantity: '1', reason: 'Supervisor spot check' })
  const mine = (await step(1)).holds.find(x => x.status === 'open').id
  await run(manager, 'wo.operation.holdRelease', 1, { holdId: mine, disposition: 'scrap', reason: 'Self release' }, { error: 'FORBIDDEN' })
  await h.command('wo.operation.holdRelease', payload(1, { holdId: mine, disposition: 'scrap', reason: 'Fails the check; scrap it' }))
  w = (await h.state()).workOrders.find(x => x.id === w.id)
  s1 = await step(1); assert.deepEqual([s1.quantities.completed, s1.quantities.held, s1.quantities.scrapped], ['1', '0', '1'])

  // The backorder resumes, the rest is reported, and completion closes every unit exactly once.
  await run(manager, 'wo.operation.backorderResume', 1, { backorderId: order.id, reason: 'Tool arrived' })
  await run(manager, 'wo.operation.backorderResume', 1, { backorderId: order.id, reason: 'Again' }, { error: 'STATE' })
  assert.equal((await step(1)).quantities.running, '4')
  await run(first, 'wo.operation.report', 1, { good: '3', scrap: '1', scrapReason: 'Chipped edge', reason: 'Last four done' })
  await run(first, 'wo.operation.complete', 1, { reason: 'All ten accounted for' })
  s1 = (await conserved()).steps[0]
  assert.deepEqual(s1.quantities, { upstream: '0', waiting: '0', running: '0', backordered: '0', completed: '4', movedOn: '4', held: '0', scrapped: '2' })
  await run(first, 'wo.operation.transfer', 1, { toSequence: 2, quantity: '5', reason: 'More than completed' }, { error: 'QUANTITY' })
  await run(first, 'wo.operation.transfer', 1, { toSequence: 2, quantity: '4', reason: 'The rest of the good units' })
  assert.deepEqual([(await step(1)).quantities.completed, (await step(1)).quantities.movedOn], ['0', '8'])
  await conserved()

  // The ledger survives a cold restart and archive restore unchanged.
  await h.restart()
  const before = await ledger(), archive = await (await h.request('/api/larder/archive')).json(), restored = await installation(); t.after(() => restored.close())
  assert.equal((await (await restored.request('/api/larder/archive/restore', { method: 'POST', body: archive })).json()).ok, true)
  assert.deepEqual((await restored.state()).operationLedgers[w.id], before)
  assert.deepEqual((await restored.state()).workOrders.find(x => x.id === w.id).operationStates, (await h.state()).workOrders.find(x => x.id === w.id).operationStates)
})
