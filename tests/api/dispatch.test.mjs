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
