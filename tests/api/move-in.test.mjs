// LARDER-016: the Odoo move-in kit through the public command door: dry-run preview
// with rejected rows and source IDs, commit through Base's import kit, undo,
// duplicates, and undo refused once later work depends on the batch.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { installation } from './harness.mjs'

export async function odooFiles(names) {
  const all = (await readdir('fixtures/odoo')).filter(n => n.endsWith('.csv'))
  return Promise.all(all.filter(n => !names || names.includes(n)).map(async name => ({ name, content: await readFile(`fixtures/odoo/${name}`, 'utf8') })))
}
const opening = { countedOn: '2026-10-01', valuationBasis: 'standard-cost', countedBy: 'Olive' }

test('LARDER-016 Odoo move-in: preview rejects with source IDs, commit journals originals, undo is dependency-safe', async t => {
  const h = await installation(); t.after(() => h.close())
  const files = await odooFiles()
  const before = (await h.state()).version
  const preview = await h.command('import.preview', { label: 'Odoo October cutover', files, opening })
  assert.equal(preview.status, 'previewed')
  assert.deepEqual(preview.counts, { contacts: 4, products: 4, locations: 2, boms: 1, openingLines: 3, salesOrders: 2, purchaseOrders: 2 })
  const reasons = preview.rejected.map(r => `${r.file}:${r.line}:${r.sourceId}`)
  for (const expected of ['uom.uom.csv:5:__export__.uom_uom_32_bb02', 'uom.uom.csv:6:__export__.uom_uom_33_cc03', 'product.product.csv:7:__export__.product_product_106_ebfc', 'product.product.csv:8:__export__.product_product_101_e1f2', 'product.product.csv:9:__export__.product_product_107_edfe', 'mrp.bom.csv:4:__export__.mrp_bom_12_b002', 'sale.order.csv:6:__export__.sale_order_304_c004'])
    assert.ok(reasons.includes(expected), `missing rejection ${expected} in ${reasons.join(' | ')}`)
  assert.ok(preview.rejected.some(r => /ambiguous/.test(r.reason)))
  assert.ok(preview.rejected.some(r => r.file === 'stock.quant.csv' && /not a plain number/.test(r.reason)))
  assert.ok(preview.skipped.some(r => r.sourceId === '__export__.sale_order_303_c003'))
  // The preview is a dry run: no business record exists yet.
  let s = await h.state()
  assert.equal(s.items.length, 0); assert.equal(s.movements.length, 0); assert.equal(s.version, before + 1)
  await h.command('import.commit', { importId: preview.id, version: preview.version }, { error: 'REVIEW_REJECTED' })
  await h.command('import.commit', { importId: preview.id, version: preview.version, acceptRejected: preview.rejected.length })
  s = await h.invariant()
  const so = s.salesOrders.find(o => o.sourceReference === 'S00031')
  assert.equal(so.status, 'confirmed')
  assert.deepEqual(so.lines.map(l => [s.items.find(i => i.id === l.itemId).sku, l.quantity, l.unitPrice]), [['BRD-WAL-L', '28', '89'], ['BRD-WAL-S', '12', '59']])
  const po = s.purchaseOrders.find(o => o.sourceReference === 'P00018')
  assert.deepEqual([po.status, po.lines[0].quantity, po.lines[0].unitPrice], ['approved', '30', '9.5'])
  const board = s.items.find(i => i.sku === 'BRD-WAL-L')
  assert.equal(board.sourceId, '__export__.product_product_103_e5f6')
  assert.deepEqual(s.boms.find(b => b.itemId === board.id).components.map(c => c.quantity), ['1', '0.05'])
  // An export with only the work centers' External IDs moves them in under readable names.
  assert.deepEqual(s.boms.find(b => b.itemId === board.id).routing.map(r => r.workCentre), ['Bench', 'Finish'])
  assert.deepEqual(s.positions.map(p => p.quantity).sort(), ['26', '3.5', '4'])
  const jobs = await h.db.prepare("SELECT state FROM ik_jobs WHERE operation_key=?").bind('larder:' + preview.id).all()
  assert.deepEqual(jobs.results.map(j => j.state), ['completed'])
  const originals = await h.db.prepare('SELECT name,sha256 FROM ik_originals ORDER BY name').all()
  assert.equal(originals.results.length, files.length)
  // Sending the same files again finds every row already moved in.
  const again = await h.command('import.preview', { label: 'Repeat', files: await odooFiles(['res.partner.csv']) })
  assert.equal(again.counts.contacts, 0); assert.ok(again.rejected.every(r => /Already moved in/.test(r.reason)))
  // Undo before any live work removes the whole batch.
  const committed = (await h.state()).imports.find(i => i.id === preview.id)
  await h.command('import.undo', { importId: preview.id, version: committed.version, reason: 'Wrong count date' })
  s = await h.invariant()
  assert.equal(s.items.length, 0); assert.equal(s.movements.length, 0); assert.equal(s.imports.find(i => i.id === preview.id).status, 'undone')
  // The audit keeps the committed batch and its undo as import-sourced integration entries; undo removes records, never audit.
  const trail = await (await h.request('/api/larder/audit?domain=integrations&limit=500')).json()
  assert.deepEqual(['import.preview', 'import.commit', 'import.undo'].map(type => trail.entries.some(e => e.commandType === type && e.source === 'import')), [true, true, true])
  // Malformed files fail before anything is staged.
  await h.command('import.preview', { label: 'Bad', files: [{ name: 'product.product.csv', content: 'id,name\nx,"unclosed\n' }] }, { error: 'CSV' })
  await h.command('import.preview', { label: 'Bad', files: [{ name: 'product.product.csv', content: 'id,name\nx,y\n' }] }, { error: 'KIT_SHAPE' })
  // After live work, undo is refused and points at the dependency.
  const second = await h.command('import.preview', { label: 'Second attempt', files, opening: { ...opening, countedOn: '2026-10-02' } })
  await h.command('import.commit', { importId: second.id, version: second.version, acceptRejected: second.rejected.length })
  // Moved-in stock handed to the accountant cannot be undone: the ledger already has it.
  const handed = await h.command('handoff.prepare', {})
  const committedSecond = (await h.state()).imports.find(i => i.id === second.id)
  const ledger = await h.command('import.undo', { importId: second.id, version: committedSecond.version, reason: 'After the handoff' }, { error: 'DEPENDENCY' })
  assert.ok(ledger.error.details.blocking.some(b => b.includes(handed.reference)), JSON.stringify(ledger.error.details))
  s = await h.state()
  const order = s.salesOrders.find(o => o.sourceReference === 'S00031')
  await h.command('so.reserve', { orderId: order.id })
  const latest = (await h.state()).imports.find(i => i.id === second.id)
  const refused = await h.command('import.undo', { importId: second.id, version: latest.version, reason: 'Too late' }, { error: 'DEPENDENCY' })
  assert.ok(refused.error.details.blocking.length > 0)
})
