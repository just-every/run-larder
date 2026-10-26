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
  const heldParty = s.parties[0]
  const hold = await h.command('retention.hold', { kind: 'parties', recordId: heldParty.id, reason: 'Retain source contact during legal review' })
  await h.command('import.undo', { importId: preview.id, version: committed.version, reason: 'Wrong count date' }, { error: 'LEGAL_HOLD' })
  assert.equal((await h.state()).parties.some(p => p.id === heldParty.id), true)
  await h.command('retention.release', { holdId: hold.id, version: hold.version, reason: 'Review complete' })
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

// MOVE-007: rehearse twice, reconcile stock value to the cent, compare a day, approve one cutover time, route each channel to one system and keep undo refused after a shipment.
test('MOVE-007 rehearsed Odoo move-in reconciles stock value to the cent, blocks cutover until a difference is accepted, then routes live orders to one system', async t => {
  const h = await installation(); t.after(() => h.close())
  const files = await odooFiles(), manager = await h.person('cut-manager@example.test', 'manager'), agent = await h.person('cut-agent@example.test', 'agent'), accounts = await h.person('cut-accounts@example.test', 'accounts')
  const aud = { code: 'AUD', rateToUsd: '0.65', recordedOn: '2026-10-01', source: 'Bank rate, 1 Oct 2026' }
  // A clean source (only the three internal rows that move) matches to the cent and needs no review.
  const quant = files.find(f => f.name === 'stock.quant.csv')
  const clean = files.map(f => f === quant ? { ...f, content: f.content.split('\n').slice(0, 4).join('\n') + '\n' } : f)
  const matched = (await h.command('import.preview', { label: 'Clean source', files: clean, opening })).valuation
  assert.deepEqual([matched.matched, matched.differenceUsd, matched.source.totalUsd, matched.larder.totalUsd, matched.reviewCount], [true, '0.00', '430.00', '430.00', 0])
  // The messy source previews items, BOMs, lots, open orders and dated stock values, both totals, the exact difference and every row to review.
  await h.command('import.preview', { label: 'No rate', files, opening, currency: { code: 'AUD' } }, { error: 'DECIMAL' })
  await h.command('import.preview', { label: 'No rate date', files, opening, currency: { code: 'AUD', rateToUsd: '0.65', source: 'Bank' } }, { error: 'INPUT' })
  const usdPreview = await h.command('import.preview', { label: 'Odoo USD', files, opening }), usd = usdPreview.valuation
  assert.deepEqual([usdPreview.counts.products, usdPreview.counts.boms, usdPreview.counts.salesOrders, usdPreview.counts.purchaseOrders], [4, 1, 2, 2])
  assert.deepEqual([usd.matched, usd.source.totalUsd, usd.larder.totalUsd, usd.differenceUsd, usd.reviewCount], [false, '446.00', '430.00', '-16.00', 2])
  assert.deepEqual(usd.exceptions.map(e => [e.kind, e.line, e.sourceValueUsd]), [['not-moved', 6, '16'], ['unvalued', 7, null]])
  assert.deepEqual([/was rejected/.test(usd.exceptions[0].reason), usd.excluded.map(e => e.line), usd.lots, usd.stockValues.map(v => [v.sku, v.valueUsd, v.asOf])], [true, [5], [{ sku: 'WAL-BLANK', lot: 'TT-0926', quantity: '26' }], [['WAL-BLANK', '247.00', '2026-10-01'], ['OIL-1L', '63.00', '2026-10-01'], ['BRD-WAL-L', '120.00', '2026-10-01']]])
  // A non-USD source converts at its recorded rate.
  const preview = await h.command('import.preview', { label: 'Odoo AUD', files, opening, currency: aud })
  const v = preview.valuation
  assert.deepEqual([v.currency, v.rateToUsd, v.source.total, v.source.totalUsd, v.larder.totalUsd, v.differenceUsd, v.reviewCount], ['AUD', '0.65', '446', '289.90', '279.50', '-10.40', 2])
  assert.equal(preview.plan.items.find(i => i.sku === 'WAL-BLANK').standardCost, '6.175')
  // Rehearse the same migration twice: nothing live changes and the results are identical.
  const before = await h.state()
  let plan = await agent.run('cutover.plan', { label: 'Odoo cutover', importIds: [preview.id] })
  plan = await agent.run('cutover.rehearse', { cutoverId: plan.id, version: plan.version })
  plan = await manager.run('cutover.rehearse', { cutoverId: plan.id, version: plan.version })
  assert.deepEqual([plan.rehearsals.map(r => r.identical), plan.rehearsals[1].results[0].differenceUsd, plan.rehearsals[1].results[0].reviewCount], [[null, true], '-10.40', 2])
  const after = await h.state()
  assert.deepEqual([after.items.length, after.movements.length, after.salesOrders.length], [before.items.length, before.movements.length, before.salesOrders.length])
  await agent.run('cutover.plan', { label: 'Second', importIds: [preview.id] }, { error: 'STATE' })
  // Commit and run both systems in parallel: a reservation, released work and issued material.
  await h.command('import.commit', { importId: preview.id, version: preview.version, acceptRejected: preview.rejected.length })
  let s = await h.state()
  const sku = code => s.items.find(i => i.sku === code), board = sku('BRD-WAL-L'), blank = sku('WAL-BLANK'), oil = sku('OIL-1L')
  const stock = s.locations.find(l => l.sourceId === 'stock.stock_location_stock'), shelf = s.locations.find(l => l.name === 'WH/Stock/Dispatch shelf')
  await h.command('so.reserve', { orderId: s.salesOrders.find(o => o.sourceReference === 'S00031').id })
  const wo = await manager.run('wo.draft', { itemId: board.id, quantity: '2', requiredBy: '2026-11-01', reason: 'Parallel-run job' })
  await h.command('wo.release', { workOrderId: wo.id, version: wo.version })
  await h.command('wo.issue', { workOrderId: wo.id, lines: [{ itemId: blank.id, locationId: stock.id, quantity: '2' }, { itemId: oil.id, locationId: stock.id, quantity: '0.1' }] })
  // Compare a day: stock is dated (Larder held nothing before the move-in); the other totals are compared on the day itself.
  const today = new Date().toISOString().slice(0, 10), yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const compare = (source, day = today, error) => accounts.run('cutover.compare', { cutoverId: plan.id, version: plan.version, day, source }, error && { error })
  await compare({ bogus: '1' }, today, 'INPUT')
  await compare({ openSalesOrders: '1' }, yesterday, 'INPUT')
  plan = await compare({ stockUnits: '0', stockValueUsd: '0' }, yesterday)
  assert.equal(plan.comparisons.at(-1).matched, true)
  const odoo = { stockUnits: '31.4', stockValueUsd: '265.98', reservedUnits: '4', activeBoms: '2', openWorkOrders: '1', wipValueUsd: '13.52', capacityMinutes: '50', openSalesOrders: '1', openSalesValueUsd: '2080', openPurchaseOrders: '1', openPurchaseValueUsd: '185.25' }
  plan = await compare(odoo)
  const day = plan.comparisons.at(-1)
  assert.deepEqual([day.matched, day.unmatched, day.differences.find(d => d.metric === 'activeBoms').difference], [false, ['activeBoms'], '-1'])
  assert.deepEqual(day.larder, { ...odoo, activeBoms: '1' })
  // Only the owner approves the opening total and the cutover time; a nonzero valuation difference blocks it until a person accepts that exact figure.
  const ask = (extra = {}) => ({ cutoverId: plan.id, version: plan.version, cutoverAt: new Date(Date.now() + 3000).toISOString(), openingTotalUsd: '279.50', reason: 'Parallel run agreed', acceptDifferences: [], ...extra })
  await manager.run('cutover.approve', ask(), { error: 'FORBIDDEN' })
  await agent.run('cutover.approve', ask(), { error: 'FORBIDDEN' })
  const blocked = (await h.command('cutover.approve', ask({ openingTotalUsd: '280.00' }), { error: 'CUTOVER_BLOCKED' })).error.details.blocking
  assert.deepEqual(blocked.map(b => b.reason).sort(), ['COMPARISON_DIFFERENCES', 'OPENING_TOTAL', 'VALUATION_DIFFERENCE'])
  const valuation = blocked.find(b => b.reason === 'VALUATION_DIFFERENCE')
  assert.deepEqual([valuation.sourceTotalUsd, valuation.larderTotalUsd, valuation.differenceUsd, valuation.reviewCount, blocked.find(b => b.reason === 'OPENING_TOTAL').openingTotalUsd], ['289.90', '279.50', '-10.40', 2, '279.50'])
  const reconcile = (who, differenceUsd, note, error) => who.run('cutover.reconcile', { cutoverId: plan.id, version: plan.version, importId: preview.id, differenceUsd, note }, error && { error })
  await reconcile(agent, '-10.40', 'x', 'FORBIDDEN')
  await reconcile(accounts, '-10.00', 'Wrong figure', 'STALE')
  plan = await reconcile(accounts, '-10.40', 'Felt pads and the malformed row are written off in Odoo')
  assert.deepEqual((await h.command('cutover.approve', ask(), { error: 'CUTOVER_BLOCKED' })).error.details.blocking.map(b => b.reason), ['COMPARISON_DIFFERENCES'])
  await h.command('cutover.approve', ask({ cutoverAt: '2020-01-01T00:00:00Z', acceptDifferences: ['activeBoms'] }), { error: 'INPUT' })
  const approval = ask({ acceptDifferences: ['activeBoms'] })
  plan = await h.command('cutover.approve', approval)
  assert.deepEqual([plan.status, plan.cutoverAt, plan.openingTotalUsd, plan.acceptedDifferences], ['approved', approval.cutoverAt, '279.50', ['activeBoms']])
  // Source currency and the recorded rate are kept on every moved-in amount.
  s = await h.state()
  const so = s.salesOrders.find(o => o.sourceReference === 'S00031'), po = s.purchaseOrders.find(o => o.sourceReference === 'P00018'), wal = s.items.find(i => i.id === blank.id)
  assert.deepEqual([wal.standardCost, wal.sourceCurrency, wal.sourceStandardCost, wal.conversionRate], ['6.175', 'AUD', '9.5', '0.65'])
  assert.deepEqual([so.lines[0].unitPrice, so.lines[0].sourceUnitPrice, so.lines[0].sourceCurrency, po.lines[0].unitPrice, po.lines[0].sourceUnitPrice, po.currency, po.sourceCurrency, po.conversionRate], ['57.85', '89', 'AUD', '6.175', '9.5', 'USD', 'AUD', '0.65'])
  const openingLine = s.openings.flatMap(o => o.lines).find(l => l.itemId === blank.id)
  assert.deepEqual([openingLine.unitCost, openingLine.sourceUnitCost, openingLine.sourceCurrency, openingLine.conversionRate], ['6.175', '9.5', 'AUD', '0.65'])
  // One system writes each channel. Both run until the cutover time; then a channel routed to the source system refuses every Larder write to it.
  const quote = { customerId: s.parties.find(p => p.kind === 'customer').id, promiseDate: '2026-12-01', lines: [{ itemId: blank.id, quantity: '1' }] }
  const route = (channel, authority, reason) => h.command('cutover.route', { cutoverId: plan.id, version: plan.version, channel, authority, reason })
  await manager.run('cutover.route', { cutoverId: plan.id, version: plan.version, channel: 'sales-orders', authority: 'source', reason: 'x' }, { error: 'FORBIDDEN' })
  plan = await route('sales-orders', 'source', 'Orders stay in Odoo until Friday')
  await manager.run('so.quote', quote)
  await new Promise(r => setTimeout(r, Math.max(0, Date.parse(approval.cutoverAt) - Date.now()) + 300))
  assert.deepEqual((await manager.run('so.quote', quote, { error: 'AUTHORITY' })).error.details.channels, ['sales-orders'])
  const quoted = s.salesOrders.find(o => o.sourceReference === 'S00032')
  await h.command('so.confirm', { orderId: quoted.id, version: quoted.version }, { error: 'AUTHORITY' })
  await manager.run('po.draft', { supplierId: s.parties.find(p => p.kind === 'supplier').id, expectedDate: '2026-12-01', reason: 'Purchasing stays here', lines: [{ itemId: blank.id, quantity: '1', unitPrice: '1' }] })
  plan = await route('stock-ledger', 'source', 'Counts and transfers stay in Odoo this week')
  await h.command('transfer.create', { itemId: blank.id, fromLocationId: stock.id, toLocationId: shelf.id, quantity: '1', reason: 'Restock the shelf' }, { error: 'AUTHORITY' })
  plan = await route('accounting-handoff', 'source', 'Odoo feeds the books this month')
  await h.command('handoff.prepare', {}, { error: 'AUTHORITY' })
  for (const channel of ['sales-orders', 'stock-ledger', 'accounting-handoff']) plan = await route(channel, 'larder', 'Larder writes this channel from now on')
  await h.command('cutover.cancel', { cutoverId: plan.id, version: plan.version, reason: 'Too late' }, { error: 'STATE' })
  await manager.run('so.quote', quote)
  // After a real shipment the move-in cannot be undone and points at the shipment.
  s = await h.state()
  const order = s.salesOrders.find(o => o.sourceReference === 'S00031'), line = order.lines.find(l => l.itemId === board.id)
  const picked = await h.command('shipment.pick', { orderId: order.id, lines: [{ lineId: line.id, locationId: shelf.id, quantity: '2' }] })
  const packed = await h.command('shipment.pack', { shipmentId: picked.id, version: picked.version, packages: 1, weightKg: '3' })
  await h.command('shipment.ship', { shipmentId: picked.id, version: packed.version, carrier: 'UPS Ground' })
  const batch = (await h.state()).imports.find(i => i.id === preview.id)
  const refused = await h.command('import.undo', { importId: batch.id, version: batch.version, reason: 'After the first shipment' }, { error: 'DEPENDENCY' })
  assert.ok(refused.error.details.blocking.some(b => /shipment/.test(b)), JSON.stringify(refused.error.details))
  await h.invariant()
})
