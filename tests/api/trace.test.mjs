import { createHash } from 'node:crypto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { installation, evidence } from './harness.mjs'
import { traceProof } from './trace-proof.mjs'
const today = new Date().toISOString().slice(0, 10)
test('TRACE-001 exact batch allocations isolate forward/backward recall and refuse incomplete or reused component lots', async t => {
  const h = await installation(); t.after(() => h.close())
  const loc = await h.command('location.save', { name: 'Production rack' }), supplier = await h.command('party.save', { kind: 'supplier', name: 'Two-heat metals' })
  const part = await h.command('item.save', { sku: 'BAR', name: 'Steel bar', kind: 'buy', baseUnit: 'each' }), item = await h.command('item.save', { sku: 'BRACKET', name: 'Bracket', kind: 'make', baseUnit: 'each' })
  await h.command('bom.revise', { itemId: item.id, components: [{ itemId: part.id, quantity: '1' }] })
  let po = await h.command('po.draft', { supplierId: supplier.id, expectedDate: today, reason: 'Two heats', lines: [{ itemId: part.id, quantity: '4', unitPrice: '5' }] }); po = await h.command('po.approve', { poId: po.id, version: po.version })
  for (const lot of ['HEAT-A', 'HEAT-B']) await h.command('receipt.create', { poId: po.id, supplierReference: lot, lines: [{ lineId: po.lines[0].id, quantity: '2', locationId: loc.id, lot, inspection: 'accept' }] })
  let w = await h.command('wo.draft', { itemId: item.id, quantity: '4', requiredBy: today, reason: 'Two distinct output batches' }); w = await h.command('wo.release', { workOrderId: w.id, version: w.version }); w = await h.command('wo.issue', { workOrderId: w.id, lines: [{ itemId: part.id, locationId: loc.id, quantity: '4' }] })
  let s = await h.state(); const A = s.lots.find(l => l.code === 'HEAT-A'), B = s.lots.find(l => l.code === 'HEAT-B'), issue = id => s.movements.find(m => m.kind === 'issue' && m.lotId === id)
  const output = (work, allocations, lot = 'OUT-A') => ({ workOrderId: work.id, version: work.version, quantity: '2', lot, locationId: loc.id, ...(allocations !== undefined ? { allocations } : {}) })
  await h.command('wo.output', output(w), { error: 'TRACE_ALLOCATION' })
  await h.command('wo.output', output(w, [{ movementId: issue(A.id).id, quantity: '3' }]), { error: 'TRACE_ALLOCATION' })
  w = await h.command('wo.output', output(w, [{ movementId: issue(A.id).id, quantity: '2' }]))
  await h.command('wo.close', { workOrderId: w.id, version: w.version }, { error: 'TRACE_ALLOCATION' })
  await h.command('wo.output', output(w, [{ movementId: issue(A.id).id, quantity: '2' }], 'OUT-B'), { error: 'TRACE_ALLOCATION' })
  await h.command('wo.output', output(w, [{ movementId: issue(B.id).id, quantity: '1' }], 'OUT-B'), { error: 'TRACE_ALLOCATION' })
  w = await h.command('wo.output', output(w, [{ movementId: issue(B.id).id, quantity: '2' }], 'OUT-B'))
  w = await h.command('wo.close', { workOrderId: w.id, version: w.version })
  s = await h.invariant(); const outA = s.lots.find(l => l.code === 'OUT-A'), outB = s.lots.find(l => l.code === 'OUT-B')
  const forwardA = await traceProof(h, A.id, 'downstream', [outA.id]); assert.ok(!forwardA.nodes.some(n => n.lotId === outB.id))
  const backwardB = await traceProof(h, outB.id, 'upstream', [B.id]); assert.ok(!backwardB.nodes.some(n => n.lotId === A.id))
  assert.deepEqual(w.outputs.map(b => b.allocations.map(a => [a.lotId, a.quantity])), [[[A.id, '2']], [[B.id, '2']]])
  assert.equal(w.outputs.reduce((n, b) => n + Number(b.allocations[0].quantity), 0), 4)
  await h.command('movement.reverse', { documentKind: 'workOrders', documentId: w.id, reason: 'Would detach exact batch evidence' }, { error: 'DEPENDENCY' })
  // An older archive genuinely lacks per-output allocations. Restore that
  // public format and disclose its job-level ancestry instead of inventing it.
  const archive = await (await h.request('/api/larder/archive')).json()
  for (const job of archive.records.workOrders) { delete job.traceAllocationVersion; for (const b of job.outputs ?? []) delete b.allocations }
  const { exportedAt, checksum, ledger, ...content } = archive
  const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v
  archive.checksum = createHash('sha256').update(JSON.stringify(canonical(content))).digest('hex')
  const legacy = await installation(); t.after(() => legacy.close())
  const restored = await legacy.request('/api/larder/archive/restore', { method: 'POST', body: archive }); assert.equal(restored.status, 200, await restored.text())
  const oldTrace = await traceProof(legacy, outB.id, 'upstream', [A.id, B.id])
  assert.ok(oldTrace.rows.some(r => r.allocationBasis === 'job'))

  const continuation = await installation(); t.after(() => continuation.close())
  const restoredOpen = await continuation.request('/api/larder/archive/restore', { method: 'POST', body: JSON.parse(await readFile('fixtures/trace/legacy.json', 'utf8')) }); assert.equal(restoredOpen.status, 200, await restoredOpen.text())
  let oldState = await continuation.state(), oldJob = oldState.workOrders[0], sourceA = oldState.lots.find(l => l.code === 'LEGACY-A'), sourceB = oldState.lots.find(l => l.code === 'LEGACY-B')
  const source = lot => oldState.movements.find(m => m.kind === 'issue' && m.lotId === lot.id).id
  const next = { workOrderId: oldJob.id, version: oldJob.version, quantity: '2', lot: 'LEGACY-OUT-B', locationId: oldState.locations[0].id, allocations: [{ movementId: source(sourceB), quantity: '2' }] }
  await continuation.command('wo.output', next, { error: 'TRACE_LEGACY_ALLOCATION' })
  const backfill = { workOrderId: oldJob.id, version: oldJob.version, batchIndex: 0, allocations: [{ movementId: source(sourceA), quantity: '2' }], reason: 'Original traveler names heat A', evidence: evidence('Original legacy traveler: heat A into first batch') }
  const assistant = await continuation.person('legacy-agent@example.test', 'agent')
  await assistant.run('wo.batch.allocate', backfill, { error: 'FORBIDDEN' })
  const { evidence: omitted, ...noFile } = backfill
  await continuation.command('wo.batch.allocate', noFile, { error: 'EVIDENCE' })
  oldJob = await continuation.command('wo.batch.allocate', { workOrderId: oldJob.id, version: oldJob.version, batchIndex: 0, allocations: [{ movementId: source(sourceA), quantity: '2' }], reason: 'Original traveler names heat A', evidence: evidence('Original legacy traveler: heat A into first batch') })
  assert.equal(oldJob.outputs[0].allocationRecorded.reason, 'Original traveler names heat A')
  await continuation.command('wo.batch.allocate', { workOrderId: oldJob.id, version: oldJob.version, batchIndex: 0, allocations: [], reason: 'Overwrite', evidence: evidence() }, { error: 'TRACE_ALLOCATION' })
  oldJob = await continuation.command('wo.output', { ...next, version: oldJob.version })
  await continuation.command('wo.close', { workOrderId: oldJob.id, version: oldJob.version })
  oldState = await continuation.invariant()
  const newLegacyOutput = oldState.lots.find(l => l.code === 'LEGACY-OUT-B')
  const continued = await traceProof(continuation, newLegacyOutput.id, 'upstream', [sourceB.id]); assert.ok(!continued.nodes.some(n => n.lotId === sourceA.id))

})
