import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { installation, evidence } from './harness.mjs'

test('FLOOR-001 assigned dispatch gates, station/reason history, authority, replay and legacy migration through public doors', async t => {
  const h = await installation(); t.after(() => h.close())
  const operator = await h.person('dispatch-one@example.test', 'production'), next = await h.person('dispatch-two@example.test', 'production')
  const manager = await h.person('dispatch-manager@example.test', 'manager'), agent = await h.person('dispatch-agent@example.test', 'agent')
  const raw = await h.command('item.save', { sku: 'DISP-BLANK', name: 'Dispatch blank', kind: 'buy', baseUnit: 'each' })
  const product = await h.command('item.save', { sku: 'DISP-PART', name: 'Dispatch part', kind: 'make', baseUnit: 'each' })
  await h.command('bom.revise', { itemId: product.id, components: [{ itemId: raw.id, quantity: '1' }], routing: [
    { name: 'Machine', workCentre: 'Dispatch mill', minutes: 2, instructions: 'Clamp securely. Measure the bore.', drawings: [evidence('Bore diameter 10 mm')] },
    { name: 'Inspect', workCentre: 'Inspection bench', minutes: 1 },
  ] })
  const release = async () => { const draft = await h.command('wo.draft', { itemId: product.id, quantity: '2', requiredBy: new Date().toISOString().slice(0, 10), reason: 'Dispatch order' }); return h.command('wo.release', { workOrderId: draft.id, version: draft.version }) }
  let work = await release(), second = await release()
  const payload = (sequence = 1, more = {}) => ({ workOrderId: work.id, version: work.version, sequence, ...more })
  work = await operator.run('wo.operation.acknowledge', payload(1, { bomId: work.bomId }))
  await agent.run('wo.operation.assign', payload(1, { operatorId: operator.id }), { error: 'FORBIDDEN' })
  await operator.run('wo.operation.assign', payload(1, { operatorId: operator.id }), { error: 'FORBIDDEN' })
  work = await manager.run('wo.operation.assign', payload(1, { operatorId: operator.id }))
  work = await manager.run('wo.operation.assign', payload(2, { operatorId: next.id }))
  second = await manager.run('wo.operation.assign', { workOrderId: second.id, version: second.version, sequence: 2, operatorId: next.id })
  const unassigned = { workOrderId: second.id, version: second.version, sequence: 1, workCentre: 'Dispatch mill', station: 'Tablet A', reason: 'Begin' }
  await h.command('wo.operation.start', unassigned, { error: 'ACKNOWLEDGMENT' })
  second = await h.command('wo.operation.acknowledge', { workOrderId: second.id, version: second.version, sequence: 1, bomId: second.bomId })
  await h.command('wo.operation.start', { ...unassigned, version: second.version }, { error: 'ASSIGNMENT' })
  await next.run('wo.operation.start', payload(2, { workCentre: 'Inspection bench', station: 'Tablet B', reason: 'Inspect' }), { error: 'DEPENDENCY' })
  work = await h.command('wo.operation.acknowledge', payload(1, { bomId: work.bomId }))
  await h.command('wo.operation.start', payload(1, { workCentre: 'Dispatch mill', station: 'Tablet A', reason: 'Owner override' }), { error: 'ASSIGNMENT' })
  const start = payload(1, { workCentre: 'Dispatch mill', station: 'Tablet A', reason: 'Fixture and guards checked' })
  await operator.run('wo.operation.start', { ...start, station: '' }, { error: 'INPUT' })
  await operator.run('wo.operation.start', { ...start, reason: '' }, { error: 'INPUT' })
  await operator.run('wo.operation.start', { ...start, workCentre: 'Wrong machine' }, { error: 'WORK_CENTER' })
  const maintenance = await h.command('maintenance.create', { workCentre: 'Dispatch mill', kind: 'breakdown', expectedReturnAt: new Date(Date.now() + 3600000).toISOString(), repairOwner: 'Toolroom', note: 'Broken guard' })
  let state = await h.state(operator.cookie)
  assert.ok(state.dispatch.find(d => d.workOrderId === work.id && d.sequence === 1).gates.some(g => g.code === 'MAINTENANCE'))
  await operator.run('wo.operation.start', start, { error: 'MAINTENANCE' })
  await h.command('maintenance.release', { maintenanceId: maintenance.id, version: maintenance.version, note: 'Guard repaired and checked', evidence: evidence('Repair signoff') })
  state = await h.state(operator.cookie)
  assert.equal(state.dispatch.find(d => d.workOrderId === work.id && d.sequence === 1).ready, true)
  const before = await h.state(), identity = crypto.randomUUID()
  work = await operator.run('wo.operation.start', start, { commandId: identity })
  assert.deepEqual(await operator.run('wo.operation.start', start, { commandId: identity }), work)
  assert.equal(work.operationStates[0].station, 'Tablet A')
  await next.run('wo.operation.complete', payload(1, { reason: 'Not my work' }), { error: 'ASSIGNMENT' })
  work = await operator.run('wo.operation.pause', payload(1, { reason: 'quality', note: 'Check bore gauge', escalationOwnerId: manager.id, anticipatedResumeAt: new Date(Date.now() + 3600000).toISOString() }))
  await operator.run('wo.operation.complete', payload(1, { reason: 'Attempt while paused' }), { error: 'STATE' })
  work = await operator.run('wo.operation.resume', payload(1, { reason: 'Gauge verified' }))
  await operator.run('wo.operation.complete', payload(), { error: 'INPUT' })
  const stale = work.version
  work = await operator.run('wo.operation.complete', payload(1, { reason: 'Bore measured and accepted' }))
  await operator.run('wo.operation.complete', { ...payload(1, { reason: 'Stale second press' }), version: stale }, { error: 'STALE' })
  state = await h.state(next.cookie)
  assert.equal(state.dispatch.find(d => d.workOrderId === work.id && d.sequence === 2).ready, true)
  assert.equal(state.dispatch.find(d => d.workOrderId === second.id && d.sequence === 2).ready, false)
  assert.equal(work.operationStates[0].events.filter(e => e.type === 'started').length, 1)
  assert.equal(work.operationStates[0].events.find(e => e.type === 'completed').station, 'Tablet A')
  assert.equal(work.operationStates[0].completionReason, 'Bore measured and accepted')
  assert.deepEqual(state.movements, before.movements); assert.deepEqual(state.reservations, before.reservations)
  assert.equal(work.output, '0'); assert.equal(work.scrap, '0')
  assert.equal((await h.request('/auth/signout', { method: 'POST', as: operator.cookie, body: {} })).status < 400, true)
  assert.equal((await h.request('/api/larder/state', { as: operator.cookie })).status, 401)
  await next.run('wo.operation.start', payload(2, { workCentre: 'Inspection bench', station: 'Tablet B', reason: 'Final inspection' }))

  // A historical archive is test input at the real restore door. Remove only
  // metadata absent in the earlier edition; migration must not invent it.
  const archive = await (await h.request('/api/larder/archive')).json()
  const restored = await installation(); t.after(() => restored.close())
  const restoredOwner = (await restored.state()).actor
  const restoredOther = await restored.person('legacy-other@example.test')
  archive.records.roles.push({ id: restoredOther.id, version: 1, role: 'production' })
  const legacy = archive.records.workOrders.find(w => w.id === second.id)
  const originalStart = '2026-10-01T09:00:00.000Z'
  legacy.operationStates[0] = { sequence: 1, status: 'running', acknowledgments: [], startedBy: restoredOwner.id, startedAt: originalStart, workCentre: 'Dispatch mill' }
  const { exportedAt, checksum, ledger, ...content } = archive
  archive.checksum = createHash('sha256').update(canonical(content)).digest('hex')
  const result = await (await restored.request('/api/larder/archive/restore', { method: 'POST', body: archive })).json()
  assert.equal(result.ok, true, JSON.stringify(result))
  const migration = { workOrderId: legacy.id, version: legacy.version, sequence: 1, operatorId: restoredOwner.id }
  await restored.command('wo.operation.complete', { ...migration, reason: 'Finish legacy work' }, { error: 'ASSIGNMENT' })
  await restored.command('wo.operation.assign', { ...migration, operatorId: restoredOther.id, reason: 'Wrong starter' }, { error: 'ASSIGNMENT' })
  await restored.command('wo.operation.assign', migration, { error: 'INPUT' })
  const migrated = await restored.command('wo.operation.assign', { ...migration, reason: 'Confirm original starter from station records' })
  const done = await restored.command('wo.operation.complete', { workOrderId: legacy.id, version: migrated.version, sequence: 1, reason: 'Legacy work inspected' })
  assert.equal(done.operationStates[0].startedAt, originalStart)
  assert.equal(done.operationStates[0].station, undefined)
  assert.equal(done.operationStates[0].events.at(-1).station, null)
})

const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'

test('CAP-003 pinned material, predecessor, overlap, actual transfer-batch and QC gates agree at dispatch/start and survive restart/restore', async t => {
  const h = await installation(); t.after(() => h.close())
  const first = await h.person('machining@example.test', 'operator'), second = await h.person('coating@example.test', 'operator')
  const agent = await h.person('dependency-agent@example.test', 'agent'), owner = (await h.state()).actor
  const loc = await h.command('location.save', { name: 'Machining rack' })
  const raw = await h.command('item.save', { sku: 'CAP-BLANK', name: 'Aluminium blank', kind: 'buy', baseUnit: 'each' })
  const part = await h.command('item.save', { sku: 'CAP-PLATE', name: 'Coated plate', kind: 'make', baseUnit: 'each' })
  const definition = { itemId: part.id, components: [{ itemId: raw.id, quantity: '1' }], routing: [
    { name: 'Machine', workCentre: 'Mill', minutes: 3, requireMaterials: true },
    { name: 'Coat', workCentre: 'Coating booth', minutes: 2, transferBatch: '4', allowOverlap: true, requireMaterials: true },
    { name: 'Pack', workCentre: 'Packing bench', minutes: 1, transferBatch: '4', allowOverlap: false },
  ] }
  const beforeInvalid = await h.state()
  for (const routing of [
    [{ name: 'First batch', minutes: 1, transferBatch: '1' }],
    [{ name: 'First', minutes: 1 }, { name: 'No batch', minutes: 1, allowOverlap: true }],
    [{ name: 'Invalid gate', minutes: 1, requireMaterials: 'yes' }],
  ]) await h.command('bom.revise', { ...definition, routing }, { error: 'INPUT' })
  assert.equal((await h.state()).version, beforeInvalid.version)
  const bom = await h.command('bom.revise', definition)
  let w = await h.command('wo.draft', { itemId: part.id, quantity: '10', requiredBy: '2026-12-10', reason: 'Ten coated plates' })
  w = await h.command('wo.release', { workOrderId: w.id, version: w.version })
  const payload = (sequence, extra = {}) => ({ workOrderId: w.id, version: w.version, sequence, ...extra })
  const run = async (who, type, sequence, extra = {}) => { w = await who.run(type, payload(sequence, extra)); return w }
  for (const [sequence, id] of [[1, first.id], [2, second.id], [3, owner.id]]) w = await h.command('wo.operation.assign', payload(sequence, { operatorId: id }))
  const start = (centre) => ({ workCentre: centre, station: centre + ' tablet', reason: 'Ready at station' })
  const blocked = async (who, sequence, code, centre, responsible) => {
    const s = await h.state(who.cookie), task = s.dispatch.find(d => d.workOrderId === w.id && d.sequence === sequence)
    assert.equal(task.ready, false)
    const gate = task.gates.find(g => g.code === code); assert.ok(gate, JSON.stringify(task.gates)); assert.equal(gate.ownerId, responsible)
    const snapshot = [s.version, s.movements, s.reservations]
    const refused = await who.run('wo.operation.start', payload(sequence, start(centre)), { error: code })
    assert.equal(refused.error.message, task.gates[0].message)
    const after = await h.state(); assert.deepEqual([after.version, after.movements, after.reservations], snapshot)
  }
  await blocked(first, 1, 'MATERIAL', 'Mill', owner.id)
  await h.command('opening.record', { locationId: loc.id, countedOn: new Date().toISOString().slice(0, 10), valuationBasis: 'supplier-invoice', countedBy: 'Olive', evidence: evidence('20 blanks at rack'), lines: [{ itemId: raw.id, quantity: '20', unitCost: '4' }] })
  await h.command('wo.reserve', { workOrderId: w.id }); w = (await h.state()).workOrders.find(x => x.id === w.id)
  // Reserved or partly issued material is not a physical full-job release.
  await blocked(first, 1, 'MATERIAL', 'Mill', owner.id)
  w = await h.command('wo.issue', { workOrderId: w.id, lines: [{ itemId: raw.id, locationId: loc.id, quantity: '6' }] })
  await blocked(first, 1, 'MATERIAL', 'Mill', owner.id)
  w = await h.command('wo.issue', { workOrderId: w.id, lines: [{ itemId: raw.id, locationId: loc.id, quantity: '4' }] })
  await run(first, 'wo.operation.start', 1, start('Mill'))
  await blocked(second, 2, 'TRANSFER_BATCH', 'Coating booth', first.id)
  // FLOOR-007 progress estimates cannot satisfy a physical transfer gate.
  await run(first, 'wo.operation.progress', 1, { completedQuantity: '10', remainingMinutes: 0, note: 'Estimated progress only' })
  await blocked(second, 2, 'TRANSFER_BATCH', 'Coating booth', first.id)
  const handoff = (quantity, toSequence = 2) => payload(1, { toSequence, quantity, reason: 'Measured and handed to next station' })
  await agent.run('wo.operation.transfer', handoff('4'), { error: 'FORBIDDEN' })
  await second.run('wo.operation.transfer', handoff('4'), { error: 'ASSIGNMENT' })
  await first.run('wo.operation.transfer', handoff('11'), { error: 'QUANTITY' })
  await first.run('wo.operation.transfer', handoff('1', 3), { error: 'DEPENDENCY' })
  await run(first, 'wo.operation.transfer', 1, { toSequence: 2, quantity: '3', reason: 'First three machined plates' })
  await blocked(second, 2, 'TRANSFER_BATCH', 'Coating booth', first.id)
  const identity = crypto.randomUUID(), exact = handoff('1')
  w = await first.run('wo.operation.transfer', exact, { commandId: identity })
  assert.deepEqual(await first.run('wo.operation.transfer', exact, { commandId: identity }), w)
  await first.run('wo.operation.transfer', { ...exact, quantity: '2' }, { commandId: identity, error: 'IDEMPOTENCY' })
  await h.command('wo.split', { workOrderId: w.id, version: w.version, parts: [{ quantity: '2' }], reason: 'Do not invent allocation' }, { error: 'ACTIVE_CLOCK' })
  let plan = await h.command('quality.plan.save', { itemId: part.id, revision: 1, stage: 'in-process', operationSequence: 1, name: 'Bore check', sampleSize: 1, measurements: [{ name: 'Bore', unit: 'mm', target: '10', lower: '9.9', upper: '10.1' }] })
  plan = await h.command('quality.plan.approve', { planId: plan.id, version: plan.version })
  await blocked(second, 2, 'QUALITY_CHECK', 'Coating booth', owner.id)
  const inspect = samples => h.command('quality.inspect', { planId: plan.id, planVersion: plan.version, workOrderId: w.id, samples: { Bore: samples }, evidence: [evidence('Bore measurement')] })
  await inspect(['10.2'])
  await blocked(second, 2, 'QUALITY_HOLD', 'Coating booth', owner.id)
  await first.run('wo.operation.transfer', handoff('1'), { error: 'QUALITY_HOLD' })
  await inspect(['10'])
  await blocked(second, 2, 'QUALITY_HOLD', 'Coating booth', owner.id)
  const hold = (await h.state()).qualityHolds.find(x => x.subjectId === w.id)
  await h.command('quality.release', { holdId: hold.id, version: hold.version, reason: 'Bore retest passed', evidence: [evidence('Qualified release')] })
  await h.restart()
  assert.equal((await h.state(second.cookie)).dispatch.find(d => d.workOrderId === w.id && d.sequence === 2).ready, true)
  const physical = await h.state()
  await run(second, 'wo.operation.start', 2, start('Coating booth'))
  assert.equal(w.operationStates[0].status, 'running') // Explicit overlap.
  await second.run('wo.operation.complete', payload(2, { reason: 'Too soon' }), { error: 'TRANSFER_BATCH' })
  await second.run('wo.operation.transfer', payload(2, { toSequence: 3, quantity: '5', reason: 'Too many' }), { error: 'QUANTITY' })
  await run(second, 'wo.operation.transfer', 2, { toSequence: 3, quantity: '4', reason: 'First coated batch' })
  await blocked({ cookie: h.owner(), run: h.command }, 3, 'DEPENDENCY', 'Packing bench', second.id)
  await run(first, 'wo.operation.transfer', 1, { toSequence: 2, quantity: '6', reason: 'Remaining machined plates' })
  await run(first, 'wo.operation.complete', 1, { reason: 'All ten machined' })
  await run(second, 'wo.operation.transfer', 2, { toSequence: 3, quantity: '6', reason: 'Remaining coated plates' })
  await run(second, 'wo.operation.complete', 2, { reason: 'All ten coated' })
  assert.equal((await h.state()).dispatch.find(d => d.workOrderId === w.id && d.sequence === 3).ready, true)
  w = await h.command('wo.operation.start', payload(3, start('Packing bench')))
  w = await h.command('wo.operation.complete', payload(3, { reason: 'All ten packed' }))
  const after = await h.invariant(); assert.deepEqual(after.movements, physical.movements); assert.deepEqual(after.reservations, physical.reservations)
  assert.equal(w.output, '0'); assert.equal(w.scrap, '0')
  // The current routing can change; this released job and CSV keep exact rules.
  await h.command('bom.revise', { ...definition, routing: definition.routing.map(r => ({ ...r, allowOverlap: false })) })
  assert.deepEqual((await h.state()).workOrders.find(x => x.id === w.id).routing, bom.routing)
  const csv = await (await h.request('/api/larder/boms.csv')).text(), preview = await h.command('bom.bulkPreview', { file: { name: 'dependencies.csv', content: csv } })
  assert.deepEqual(preview.errors, []); assert.equal(preview.revisions[0].routing[1].transferBatch, '4')
  // FLOOR-005 conserves already handed-off WIP without fabricating operator history.
  let splitWork = await h.command('wo.draft', { itemId: part.id, quantity: '2', requiredBy: '2026-12-10', reason: 'Split a partly handed-off batch' })
  splitWork = await h.command('wo.release', { workOrderId: splitWork.id, version: splitWork.version })
  splitWork = await h.command('wo.issue', { workOrderId: splitWork.id, lines: [{ itemId: raw.id, locationId: loc.id, quantity: '2' }] })
  const splitPayload = (extra = {}) => ({ workOrderId: splitWork.id, version: splitWork.version, sequence: 1, ...extra })
  splitWork = await h.command('wo.operation.assign', splitPayload({ operatorId: owner.id }))
  splitWork = await h.command('wo.operation.start', splitPayload(start('Mill')))
  splitWork = await h.command('wo.operation.transfer', splitPayload({ toSequence: 2, quantity: '1', reason: 'One unit physically handed off' }))
  splitWork = await h.command('wo.operation.complete', splitPayload({ reason: 'Both machined' }))
  const split = await h.command('wo.split', { workOrderId: splitWork.id, version: splitWork.version, parts: [{ quantity: '1' }], reason: 'Separate equal remaining WIP' })
  assert.equal(split.handoffs[0].quantity, '0.5')
  let child = (await h.state()).workOrders.find(x => x.id === split.destinations[0])
  assert.equal(child.operationStates[0].startedBy, undefined)
  child = await h.command('wo.operation.assign', { workOrderId: child.id, version: child.version, sequence: 1, operatorId: owner.id })
  child = await h.command('wo.operation.transfer', { workOrderId: child.id, version: child.version, sequence: 1, toSequence: 2, quantity: '0.5', reason: 'Physically hand off the inherited remainder' })
  child = await h.command('wo.operation.assign', { workOrderId: child.id, version: child.version, sequence: 2, operatorId: owner.id })
  assert.equal((await h.state()).dispatch.find(d => d.workOrderId === child.id && d.sequence === 2).ready, true) // Batch is capped at this one-unit job.
  const source = (await h.state()).workOrders.find(x => x.id === splitWork.id)
  const merged = await h.command('wo.merge', { sources: [{ workOrderId: source.id, version: source.version }, { workOrderId: child.id, version: child.version }], reason: 'Combine compatible WIP again' })
  assert.deepEqual(merged.handoffs.map(a => a.quantity), ['0.5', '1'])
  const mergedWork = (await h.state()).workOrders.find(x => x.id === merged.destinations[0])
  assert.equal(mergedWork.quantity, '2')
  assert.equal(mergedWork.handoffAllocations.reduce((n, a) => n + Number(a.quantity), 0), 1.5)
  const archive = await (await h.request('/api/larder/archive')).json(), restored = await installation(); t.after(() => restored.close())
  assert.equal((await (await restored.request('/api/larder/archive/restore', { method: 'POST', body: archive })).json()).ok, true)
  const restoredWork = (await restored.state()).workOrders.find(x => x.id === w.id)
  assert.deepEqual(restoredWork.routing, w.routing); assert.deepEqual(restoredWork.operationStates, w.operationStates)
})
