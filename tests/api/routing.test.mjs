// ENG-002: real Worker/D1 commands and retained-file/CSV/archive public doors.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { installation, workshop } from './harness.mjs'

const day = () => new Date().toISOString().slice(0, 10)
const file = content => ({ name: 'bracket-drawing.txt', contentType: 'text/plain', base64: Buffer.from(content).toString('base64') })

test('ENG-002 pinned executable routing, drawings, acknowledgment, skills and predecessors survive revisions and restore', async t => {
  const h = await installation(); t.after(() => h.close())
  const w = await workshop(h), operator = await h.person('operator@example.test', 'production'), other = await h.person('other@example.test', 'production'), agent = await h.person('agent@example.test', 'agent')
  const revision = instructions => ({ itemId: w.board.id, components: [{ itemId: w.timber.id, quantity: '1' }], routing: [
    { name: 'Machine', workCentre: 'Router 1', eligibleCentres: ['Router 1', 'Router 2'], runMinutes: 7.5, setupMinutes: 12, queueMinutes: 5, requiredSkills: ['Router setup'], instructions, drawings: [file(instructions + '\nDimension 3 inches')] },
    { name: 'Finish', workCentre: 'Finish bench', minutes: 2, dependsOn: [1], instructions: 'Deburr all edges.' },
  ] })
  const bom = await h.command('bom.revise', revision('Clamp in fixture A.'))
  assert.deepEqual([bom.routing[0].setupMinutes, bom.routing[0].runMinutes, bom.routing[0].queueMinutes], [12, 7.5, 5])
  const draft = async () => h.command('wo.draft', { itemId: w.board.id, quantity: '2', requiredBy: day(), reason: 'Customer brackets' })
  const d1 = await draft(); let job = await h.command('wo.release', { workOrderId: d1.id, version: d1.version })
  const payload = (sequence = 1, extra = {}) => ({ workOrderId: job.id, version: job.version, sequence, station: 'Router tablet', reason: 'Reviewed routing execution', ...extra })
  await operator.run('wo.operation.start', payload(1, { workCentre: 'Router 1' }), { error: 'ACKNOWLEDGMENT' })
  await agent.run('wo.operation.acknowledge', payload(1, { bomId: job.bomId }), { error: 'FORBIDDEN' })
  await agent.run('wo.operation.start', payload(1, { workCentre: 'Router 1' }), { error: 'FORBIDDEN' })
  await agent.run('wo.operation.complete', payload(), { error: 'FORBIDDEN' })
  await operator.run('wo.operation.acknowledge', payload(1, { bomId: 'wrong-revision' }), { error: 'STALE' })
  const oldVersion = job.version
  job = await operator.run('wo.operation.acknowledge', payload(1, { bomId: job.bomId }))
  await operator.run('wo.operation.start', { ...payload(1, { workCentre: 'Router 1' }), version: oldVersion }, { error: 'STALE' })
  await operator.run('wo.operation.start', payload(1, { workCentre: 'Router 1' }), { error: 'SKILLS' })
  await operator.run('wo.operation.assign', payload(1, { operatorId: operator.id }), { error: 'FORBIDDEN' })
  job = await h.command('wo.operation.assign', payload(1, { operatorId: operator.id }))
  await operator.run('wo.operation.start', payload(1, { workCentre: 'Unapproved router' }), { error: 'WORK_CENTER' })
  job = await other.run('wo.operation.acknowledge', payload(1, { bomId: job.bomId }))
  await other.run('wo.operation.start', payload(1, { workCentre: 'Router 1' }), { error: 'ASSIGNMENT' })
  job = await operator.run('wo.operation.acknowledge', payload(2, { bomId: job.bomId }))
  await operator.run('wo.operation.start', payload(2, { workCentre: 'Finish bench' }), { error: 'DEPENDENCY' })
  await h.command('wo.output', { workOrderId: job.id, version: job.version, locationId: w.loc.id, quantity: '1' }, { error: 'OPERATIONS' })
  const start = await h.send('wo.operation.start', payload(1, { workCentre: 'Router 2' }), { as: operator.cookie })
  assert.equal(start.body.ok, true); job = start.body.result
  const replay = await h.send('wo.operation.start', { ...payload(1, { workCentre: 'Router 2' }), version: job.version - 1 }, { as: operator.cookie, commandId: start.commandId })
  assert.deepEqual(replay.body, start.body)
  await other.run('wo.operation.complete', payload(), { error: 'ASSIGNMENT' })
  job = await operator.run('wo.operation.complete', payload())
  job = await h.command('wo.operation.assign', payload(2, { operatorId: operator.id }))
  job = await operator.run('wo.operation.start', payload(2, { workCentre: 'Finish bench' }))
  job = await operator.run('wo.operation.complete', payload(2))
  const pin = structuredClone(job.routing)
  const newer = await h.command('bom.revise', revision('Clamp in fixture B.'))
  const d2 = await draft(), second = await h.command('wo.release', { workOrderId: d2.id, version: d2.version })
  assert.equal(second.bomId, newer.id); assert.equal(second.operationStates[0].acknowledgments.length, 0)
  assert.deepEqual((await h.state()).workOrders.find(r => r.id === job.id).routing, pin)
  await operator.run('wo.operation.start', { workOrderId: second.id, version: second.version, sequence: 1, workCentre: 'Router 1' }, { error: 'ACKNOWLEDGMENT' })
  const drawing = pin[0].drawings[0], content = 'Clamp in fixture A.\nDimension 3 inches'
  assert.equal(await (await h.request(`/api/larder/attachments/${drawing.id}`, { as: operator.cookie })).text(), content)
  assert.equal(drawing.sha256, createHash('sha256').update(content).digest('hex'))
  const csv = await (await h.request('/api/larder/boms.csv')).text()
  const preview = await h.command('bom.bulkPreview', { file: { name: 'routing.csv', content: csv } })
  assert.deepEqual(preview.errors, [])
  await h.command('bom.bulkApprove', { previewId: preview.id, version: preview.version })
  const after = (await h.state()).boms.find(b => b.revision === newer.revision + 1)
  assert.deepEqual(after.routing, newer.routing)
  const a = await (await h.request('/api/larder/archive')).json(), restored = await installation(); t.after(() => restored.close())
  const result = await (await restored.request('/api/larder/archive/restore', { method: 'POST', body: a })).json()
  assert.equal(result.ok, true, JSON.stringify(result))
  const r = (await restored.state()).workOrders.find(r => r.id === job.id)
  assert.deepEqual(r.routing, pin); assert.deepEqual(r.operationStates, job.operationStates)
  assert.equal(await (await restored.request(`/api/larder/attachments/${drawing.id}`)).text(), content)
})

test('ENG-002 invalid routing definitions fail atomically without a revision or attachment', async t => {
  const h = await installation(); t.after(() => h.close()); const w = await workshop(h)
  const before = await h.state(), input = { itemId: w.board.id, components: [{ itemId: w.timber.id, quantity: '1' }] }
  for (const routing of [
    [{ name: 'Cycle', minutes: 1, dependsOn: [1] }],
    [{ name: 'Negative setup', minutes: 1, setupMinutes: -1 }],
    [{ name: 'Wrong primary', minutes: 1, workCentre: 'Router 1', eligibleCentres: ['Router 2'] }],
    [{ name: 'Bad skills', minutes: 1, requiredSkills: 'Router' }],
    [{ name: 'Conflicting run', minutes: 1, runMinutes: 2 }],
    [{ name: 'Forward dependency', minutes: 1, dependsOn: [2] }, { name: 'Second', minutes: 1 }],
  ]) await h.command('bom.revise', { ...input, routing }, { error: 'INPUT' })
  await h.command('bom.revise', { ...input, routing: [{ name: 'Forged drawing', minutes: 1, drawings: [{ id: crypto.randomUUID() }] }] }, { error: 'EVIDENCE' })
  assert.equal((await h.state()).version, before.version)
  assert.deepEqual((await h.state()).boms, before.boms)
})
