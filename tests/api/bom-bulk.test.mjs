import test from 'node:test'
import assert from 'node:assert/strict'
import { installation, workshop } from './harness.mjs'

const csv = rows => rows.map(row => row.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n'
const header = ['item_sku', 'revision', 'effective_on', 'component_sku', 'quantity', 'unit', 'routing', 'note']

test('ENG-004 export ten BOMs and routings, preview CSV substitutions and dated quantities, approve atomically and keep released work pinned', async t => {
  const h = await installation(); t.after(() => h.close())
  const w = await workshop(h)
  const engineer = await h.person('erin@example.test', 'production')
  const manager = await h.person('maria@example.test', 'manager')
  const viewer = await h.person('victor@example.test')
  const replacement = await h.command('item.save', { sku: 'MAPLE', name: 'Maple blank', kind: 'buy', baseUnit: 'each', conversions: [{ unit: 'pair', factor: '2' }] })
  const items = [w.board]
  for (let i = 1; i < 10; i++) {
    const made = await h.command('item.save', { sku: `ASSEMBLY-${i}`, name: `Board size ${i}`, kind: 'make', baseUnit: 'each' })
    await engineer.run('bom.revise', { itemId: made.id, components: [{ itemId: w.timber.id, quantity: '1' }], routing: [{ name: 'Cut', workCentre: 'Bench', minutes: 20 }] })
    items.push(made)
  }
  const wo = await h.command('wo.draft', { itemId: w.board.id, quantity: '1', requiredBy: '2026-11-20', reason: 'Keep this released revision' })
  const pinned = await h.command('wo.release', { workOrderId: wo.id, version: wo.version })
  const draft = await h.command('wo.draft', { itemId: w.board.id, quantity: '1', requiredBy: '2026-11-21', reason: 'Uses approved revision' })
  const download = await h.request('/api/larder/boms.csv', { as: engineer.cookie })
  assert.equal(download.status, 200); assert.match(download.headers.get('content-type'), /text\/csv/)
  const exported = await download.text()
  for (const item of items) assert.ok(exported.includes(`"${item.sku}"`))
  assert.match(exported, /Plane and cut/); assert.match(exported, /Finishing/)
  assert.equal((await h.request('/api/larder/boms.csv', { as: '' })).status, 401)
  assert.equal((await h.request('/api/larder/boms.csv', { as: viewer.cookie })).status, 403)
  const today = new Date().toISOString().slice(0, 10)
  const future = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const routing = JSON.stringify([{ name: 'Cut, inspect', workCentre: 'Bench', minutes: 25 }])
  const rows = items.map(item => [item.sku, 1, today, 'MAPLE', '1.5', 'pair', routing, 'Approved maple substitution'])
  // The CSV is edited as an engineer would edit the downloaded component rows.
  const content = exported.replaceAll('"WAL-BLANK","1","each"', '"MAPLE","1.5","pair"').replaceAll('Plane and cut', 'Cut, inspect')
    + csv([['UNKNOWN', 1, today, 'MAPLE', '2', 'each', routing, 'bad SKU']])
  const preview = await engineer.run('bom.bulkPreview', { file: { name: 'substitutions.csv', content } })
  assert.equal(preview.revisions.length, 10)
  assert.deepEqual(preview.errors.map(e => [e.file, e.row, e.column]), [['substitutions.csv', 13, 'item_sku']])
  const impact = preview.impact.find(x => x.itemId === w.board.id)
  assert.ok(impact.stock.some(x => x.itemId === w.timber.id))
  assert.ok(impact.stock.some(x => x.itemId === w.board.id))
  assert.deepEqual(impact.openWork.map(x => [x.id, x.treatment]).sort(), [[wo.id, 'keeps pinned revision'], [draft.id, 'uses effective revision when released']].sort())
  const before = await h.state()
  assert.equal(before.boms.length, 10)
  await engineer.run('bom.bulkApprove', { previewId: preview.id, version: preview.version, acceptRejected: 1 }, { error: 'FORBIDDEN' })
  await manager.run('bom.bulkApprove', { previewId: preview.id, version: preview.version }, { error: 'REJECTED_ROWS' })
  const approved = await manager.run('bom.bulkApprove', { previewId: preview.id, version: preview.version, acceptRejected: 1 }, { commandId: 'ENG-004-approval' })
  assert.equal(approved.revisionIds.length, 10)
  assert.deepEqual(await manager.run('bom.bulkApprove', { previewId: preview.id, version: preview.version, acceptRejected: 1 }, { commandId: 'ENG-004-approval' }), approved)
  let after = await h.invariant()
  assert.equal(after.boms.length, 20)
  assert.deepEqual(after.workOrders.find(x => x.id === wo.id), pinned)
  assert.deepEqual(after.movements, before.movements); assert.deepEqual(after.reservations, before.reservations)
  for (const item of items) {
    const revision = after.boms.find(b => b.itemId === item.id && b.revision === 2)
    const expected = [[replacement.id, '3'], ...(item.id === w.board.id ? [[w.oil.id, '0.05']] : [])]
    assert.deepEqual(revision.components.map(c => [c.itemId, c.quantity]), expected)
    assert.equal(revision.routing[0].name, item.id === w.board.id ? 'Cut, inspect' : 'Cut')
    assert.equal(revision.effectiveOn, today)
  }
  const reexported = await (await h.request('/api/larder/boms.csv', { as: engineer.cookie })).text()
  assert.ok(reexported.includes('"MAPLE","3","each"')); assert.ok(!reexported.includes('"WAL-BLANK"'))
  // A future effective revision is saved now, but cannot change a release today.
  const dated = csv([header, [w.board.sku, 2, future, 'WAL-BLANK', '2', 'each', routing, 'Next week']])
  const planned = await engineer.run('bom.bulkPreview', { file: { name: 'next-week.csv', content: dated } })
  const futureApproval = await manager.run('bom.bulkApprove', { previewId: planned.id, version: planned.version })
  const scheduled = (await h.state()).boms.find(b => b.id === futureApproval.revisionIds[0])
  assert.equal(scheduled.effectiveOn, future); assert.equal(scheduled.status, 'scheduled')
  const released = await h.command('wo.release', { workOrderId: draft.id, version: draft.version })
  assert.equal(released.bomRevision, 2)
  assert.equal(released.components[0].required, '3')
  // An intervening edit invalidates the entire batch, with no partial revision.
  const stale = await engineer.run('bom.bulkPreview', { file: { name: 'stale.csv', content: reexported } })
  await h.command('location.save', { name: 'New work cell' })
  const preStale = await h.state()
  await manager.run('bom.bulkApprove', { previewId: stale.id, version: stale.version }, { error: 'STALE' })
  after = await h.state(); assert.deepEqual(after.boms, preStale.boms)
  // One bad component excludes the entire affected BOM, never a truncated recipe.
  const invalid = await engineer.run('bom.bulkPreview', { file: { name: 'bad-component.csv', content: csv([header, rows[0], [w.board.sku, 2, today, 'NOT-A-PART', '1', 'each', routing, 'bad']]) } })
  assert.equal(invalid.revisions.length, 0); assert.ok(invalid.errors.some(e => e.column === 'component_sku'))
  await manager.run('bom.bulkApprove', { previewId: invalid.id, version: invalid.version, acceptRejected: invalid.errors.length }, { error: 'INPUT' })
  const malformed = await engineer.run('bom.bulkPreview', { file: { name: 'broken.csv', content: 'item_sku,"unclosed' } })
  assert.equal(malformed.revisions.length, 0); assert.ok(malformed.errors.some(e => e.file === 'broken.csv'))
})
