import test from 'node:test'
import assert from 'node:assert/strict'
import { installation } from './harness.mjs'

test('FLOOR-007 broken-tool pause, supervisor notice/ack, real intervals, progress history and unchanged physical completion', async t => {
  const h = await installation(); t.after(() => h.close())
  const operator = await h.person('operator@example.test', 'production'), other = await h.person('other@example.test', 'production'), manager = await h.person('supervisor@example.test', 'manager'), secondManager = await h.person('second-supervisor@example.test', 'manager'), agent = await h.person('agent@example.test', 'agent')
  const raw = await h.command('item.save', { sku: 'BLANK', name: 'Steel blank', kind: 'buy', baseUnit: 'each' })
  const product = await h.command('item.save', { sku: 'PLATE', name: 'Ohio mounting plate', kind: 'make', baseUnit: 'each' })
  await h.command('bom.revise', { itemId: product.id, components: [{ itemId: raw.id, quantity: '1' }], routing: [{ name: 'Drill', workCentre: 'Drill press', minutes: 2 }, { name: 'Deburr', workCentre: 'Bench', minutes: 1 }] })
  let work = await h.command('wo.draft', { itemId: product.id, quantity: '10', requiredBy: '2026-12-10', reason: 'Customer plates' })
  work = await h.command('wo.release', { workOrderId: work.id, version: work.version })
  const start = { workOrderId: work.id, version: work.version, sequence: 1, workCentre: 'Drill press' }
  work = await operator.run('wo.operation.start', start)
  const before = await h.state(), resume = new Date(Date.now() + 2 * 86400000).toISOString()
  const pausePayload = { workOrderId: work.id, version: work.version, sequence: 1, reason: 'breakdown', note: 'Drill bit snapped; replacement tool required', escalationOwnerId: manager.id, anticipatedResumeAt: resume }
  await other.run('wo.operation.pause', pausePayload, { error: 'FORBIDDEN' })
  await agent.run('wo.operation.pause', pausePayload, { error: 'FORBIDDEN' })
  await operator.run('wo.operation.pause', { ...pausePayload, escalationOwnerId: operator.id }, { error: 'INPUT' })
  await operator.run('wo.operation.pause', { ...pausePayload, anticipatedResumeAt: '2020-01-01T00:00:00.000Z' }, { error: 'INPUT' })
  await operator.run('wo.operation.pause', { ...pausePayload, reason: 'unknown' }, { error: 'INPUT' })
  const identity = crypto.randomUUID()
  work = await operator.run('wo.operation.pause', pausePayload, { commandId: identity })
  assert.deepEqual(await operator.run('wo.operation.pause', pausePayload, { commandId: identity }), work)
  let task = work.operationStates[0], interval = task.downtime[0]
  assert.equal(task.status, 'paused'); assert.equal(task.downtime.length, 1)
  assert.equal(interval.notification, 'recorded in app'); assert.equal(interval.escalationOwnerId, manager.id)
  assert.equal(interval.anticipatedResumeAt, resume)
  await operator.run('wo.operation.pause', { ...pausePayload, version: work.version }, { error: 'STATE' })
  await operator.run('wo.operation.complete', { workOrderId: work.id, version: work.version, sequence: 1 }, { error: 'STATE' })
  await operator.run('wo.operation.start', { workOrderId: work.id, version: work.version, sequence: 2, workCentre: 'Bench' }, { error: 'DEPENDENCY' })
  let state = await h.state(manager.cookie), report = state.lostTimeReport.find(d => d.id === interval.id)
  assert.equal(report.status, 'open'); assert.equal(report.operationStatus, 'paused'); assert.equal(report.workOrderReference, work.reference)
  assert.equal(report.reason, 'breakdown'); assert.equal(report.note, pausePayload.note)
  assert.equal(report.startedAt, interval.startedAt); assert.equal(report.stoppedAt, null)
  assert.ok(Number(report.elapsedMinutes) >= 0)
  await secondManager.run('wo.operation.escalationAck', { workOrderId: work.id, version: work.version, sequence: 1, downtimeId: interval.id, note: 'Not my notice' }, { error: 'FORBIDDEN' })
  work = await manager.run('wo.operation.escalationAck', { workOrderId: work.id, version: work.version, sequence: 1, downtimeId: interval.id, note: 'Replacement tool ordered; I own recovery' })
  assert.equal(work.operationStates[0].downtime[0].acknowledgedBy, manager.id)
  await operator.run('wo.operation.progress', { workOrderId: work.id, version: work.version, sequence: 1, completedQuantity: '11', remainingMinutes: 20, note: 'Impossible' }, { error: 'QUANTITY' })
  await operator.run('wo.operation.progress', { workOrderId: work.id, version: work.version, sequence: 1, completedQuantity: '2', remainingMinutes: -1, note: 'Impossible' }, { error: 'INPUT' })
  work = await operator.run('wo.operation.progress', { workOrderId: work.id, version: work.version, sequence: 1, completedQuantity: '2.5', remainingMinutes: 960, note: 'Replacement setup and remaining drilling' })
  assert.deepEqual([work.output, work.scrap, work.status, work.operationStates[0].status], ['0', '0', 'released', 'paused'])
  assert.equal(work.operationStates[0].progress.remainingMinutes, 960)
  await operator.run('wo.operation.progress', { workOrderId: work.id, version: work.version, sequence: 1, completedQuantity: '2', remainingMinutes: 900, note: 'Backwards count' }, { error: 'QUANTITY' })
  // A supervisor can report with a reason; zero remaining is still a report,
  // never a production movement or completion.
  await manager.run('wo.operation.progress', { workOrderId: work.id, version: work.version, sequence: 1, completedQuantity: '3', remainingMinutes: 900, note: 'Updated estimate' }, { error: 'INPUT' })
  work = await manager.run('wo.operation.progress', { workOrderId: work.id, version: work.version, sequence: 1, completedQuantity: '3', remainingMinutes: 0, note: 'Tool ready; operator must confirm completion', reason: 'Supervisor site observation' })
  assert.equal(work.operationStates[0].status, 'paused')
  assert.equal(work.operationStates[0].progressReports.length, 2)
  assert.equal(work.operationStates[0].progressReports[0].remainingMinutes, 960)
  const pausedVersion = work.version
  work = await operator.run('wo.operation.resume', { workOrderId: work.id, version: work.version, sequence: 1, reason: 'Replacement tool installed and checked' })
  task = work.operationStates[0]; interval = task.downtime[0]
  assert.equal(task.status, 'running'); assert.ok(interval.stoppedAt >= interval.startedAt)
  assert.equal(interval.resumeReason, 'Replacement tool installed and checked')
  await operator.run('wo.operation.resume', { workOrderId: work.id, version: pausedVersion, sequence: 1, reason: 'Stale duplicate' }, { error: 'STALE' })
  state = await h.invariant(); report = state.lostTimeReport.find(d => d.id === interval.id)
  assert.equal(report.status, 'closed')
  const duration = Math.max(0, Date.parse(interval.stoppedAt) - Date.parse(interval.startedAt))
  const scaled = (BigInt(duration) * 1000000n + 30000n) / 60000n
  assert.equal(Math.round(Number(report.elapsedMinutes) * 1000000), Number(scaled))
  assert.deepEqual(state.movements, before.movements); assert.deepEqual(state.reservations, before.reservations)
  assert.equal(state.workOrders.find(w => w.id === work.id).requiredBy, before.workOrders.find(w => w.id === work.id).requiredBy)
  for (const reason of ['waiting-material', 'changeover', 'quality', 'other']) {
    work = await operator.run('wo.operation.pause', { ...pausePayload, version: work.version, reason, note: `Recorded ${reason}` })
    work = await operator.run('wo.operation.resume', { workOrderId: work.id, version: work.version, sequence: 1, reason: `${reason} resolved` })
  }
  assert.deepEqual(work.operationStates[0].downtime.map(d => d.reason), ['breakdown', 'waiting-material', 'changeover', 'quality', 'other'])
  // A removed supervisor is rejected on the next pause without a new notice.
  await h.command('role.set', { operatorId: manager.id, role: 'viewer' })
  await operator.run('wo.operation.pause', { ...pausePayload, version: work.version }, { error: 'INPUT' })
  assert.equal((await h.state()).workOrders.find(w => w.id === work.id).operationStates[0].downtime.length, 5)
  work = await operator.run('wo.operation.complete', { workOrderId: work.id, version: work.version, sequence: 1 })
  assert.equal(work.operationStates[0].status, 'done'); assert.equal(work.output, '0')
  const archive = await (await h.request('/api/larder/archive')).json()
  assert.deepEqual(archive.records.workOrders.find(w => w.id === work.id).operationStates, work.operationStates)
})
