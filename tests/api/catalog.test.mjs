import test from 'node:test'
import assert from 'node:assert/strict'
import { installation, evidence } from './harness.mjs'
const csv = rows => rows.map(row => row.map(v => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n'
function readCsv(input) {
  const rows = []; let row = [], cell = '', quoted = false
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (c === '"') { if (quoted && input[i + 1] === '"') { cell += '"'; i++ } else quoted = !quoted }
    else if (c === ',' && !quoted) { row.push(cell); cell = '' }
    else if (c === '\n' && !quoted) { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (c !== '\r' || quoted) cell += c
  }
  return rows.map(row => row.map(value => value.startsWith("'") ? value.slice(1) : value))
}

test('ENG-007 export/edit catalog by Larder ID at two locations, preview all field/record impacts and errors, approve valid groups atomically and preserve blanks, units, history and stale protection', async t => {
  const h = await installation(); t.after(() => h.close())
  const buyer = await h.person('buyer@example.test', 'buyer'), engineer = await h.person('engineer@example.test', 'production'), manager = await h.person('manager@example.test', 'manager'), agent = await h.person('assistant@example.test', 'agent')
  const ohio = await h.command('location.save', { name: 'Ohio production stores' }), dispatch = await h.command('location.save', { name: 'Dispatch shelf' })
  const supplier = await h.command('party.save', { name: 'Parts Co', kind: 'supplier' }), alternate = await h.command('party.save', { name: 'Alternate Components', kind: 'supplier' })
  const customer = await h.command('party.save', { name: 'Equipment Works', kind: 'customer' })
  const item = async (sku, attrs) => h.command('item.save', { sku, name: sku, kind: 'buy', baseUnit: 'each', conversions: [{ unit: 'pair', factor: '2' }], template: attrs ? 'Bracket' : '', attributes: attrs ?? {}, salePrice: '20', standardCost: '3', category: 'Hardware', priceList: 'Wholesale', barcode: '000' + sku, catalogLocations: [{ locationId: ohio.id, reorderPoint: '2', safetyStock: '1', minStock: '2', maxStock: '12', defaultBin: ohio.id, leadDays: 3 }] })
  const left = await item('LEFT', { Finish: 'Black' }), right = await item('RIGHT', { Finish: 'White' }), bad = await item('BAD-SUPPLIER'), fixed = await item('USED-UNIT')
  for (const i of [left, right]) await h.command('partyItem.save', { partyId: supplier.id, itemId: i.id, partyCode: 'OLD-' + i.sku, price: '6', unit: 'pair', preferred: true, leadDays: 4 })
  await h.command('opening.record', { locationId: ohio.id, countedOn: new Date().toISOString().slice(0, 10), countedBy: 'Olive', valuationBasis: 'supplier-invoice', evidence: evidence(), lines: [{ itemId: left.id, quantity: '8', unitCost: '3' }, { itemId: fixed.id, quantity: '2', unitCost: '3' }] })
  const quote = await h.command('so.quote', { customerId: customer.id, promiseDate: '2026-12-15', lines: [{ itemId: left.id, quantity: '2' }] })
  const order = await h.command('so.quote', { customerId: customer.id, promiseDate: '2026-12-16', lines: [{ itemId: left.id, quantity: '3' }] })
  await h.command('so.confirm', { orderId: order.id, version: order.version, reserve: true })
  const po = await h.command('po.draft', { supplierId: supplier.id, expectedDate: '2026-12-15', reason: 'Existing issued terms', lines: [{ itemId: left.id, quantity: '10', unitPrice: '3' }] })
  const approvedPo = await h.command('po.approve', { poId: po.id, version: po.version })
  const exported = await h.request('/api/larder/catalog.csv', { as: engineer.cookie }); assert.equal(exported.status, 200)
  const downloaded = await exported.text(), parsed = readCsv(downloaded), header = parsed.shift()
  const at = name => header.indexOf(name), rows = parsed.map(row => Object.fromEntries(header.map((name, i) => [name, row[i]])))
  assert.equal(rows.length, 8)
  for (const i of [left, right]) assert.deepEqual(rows.filter(r => r.larder_id === i.id).map(r => r.location_id).sort(), [ohio.id, dispatch.id].sort())
  assert.equal(rows.find(r => r.larder_id === left.id).purchase_unit, 'pair')
  assert.equal(rows.find(r => r.larder_id === left.id).barcode, '000LEFT')
  assert.equal((await h.request('/api/larder/catalog.csv', { as: '' })).status, 401)
  assert.equal((await h.request('/api/larder/catalog.csv', { as: agent.cookie })).status, 403)
  const change = (i, location, values) => header.map(key => ({ larder_id: i.id, location_id: location.id, ...values })[key] ?? '')
  const edits = [
    change(left, ohio, { sale_price: '29.5', reorder_point: '5', preferred_supplier_id: alternate.id, supplier_code: 'ALT-LEFT', purchase_price: '8', purchase_unit: 'pair', supplier_lead_days: '6' }),
    change(left, dispatch, { reorder_point: '7', safety_stock: '2', min_stock: '3', max_stock: '15', default_bin: dispatch.id, lead_days: '4' }),
    change(right, ohio, { sale_price: '31', reorder_point: '6', preferred_supplier_id: alternate.id, supplier_code: 'ALT-RIGHT', purchase_price: '9', purchase_unit: 'pair', supplier_lead_days: '5' }),
    change(right, dispatch, { reorder_point: '8' }),
    change(bad, ohio, { preferred_supplier_id: 'unknown-supplier', supplier_code: 'BAD' }),
    change(fixed, ohio, { base_unit: 'feet' }),
  ]
  const file = { name: 'edited-catalog.csv', content: csv([header, ...edits]) }
  const preview = await buyer.run('catalog.bulkPreview', { file })
  assert.equal(preview.groups.length, 2); assert.equal(preview.errors.length, 2)
  assert.ok(preview.errors.every(e => e.file === file.name && e.row > 1 && e.column && e.reason))
  assert.ok(preview.errors.some(e => /supplier/i.test(e.reason))); assert.ok(preview.errors.some(e => /base unit|already in use/i.test(e.reason)))
  const impact = preview.impact.find(i => i.itemId === left.id)
  assert.ok(impact.changes.some(c => c.field === 'salePrice' && c.before === '20' && c.after === '29.5'))
  assert.ok(impact.changes.some(c => c.locationId === dispatch.id))
  const rejectedImpact = preview.impact.find(i => i.itemId === fixed.id)
  assert.equal(rejectedImpact.accepted, false); assert.ok(rejectedImpact.stock.length); assert.ok(rejectedImpact.changes.some(c => c.field === 'baseUnit' && c.before === 'each' && c.after === 'feet'))
  assert.ok(impact.quotes.some(q => q.id === quote.id)); assert.ok(impact.orders.some(o => o.id === order.id)); assert.ok(impact.purchases.some(p => p.id === po.id)); assert.ok(impact.stock.length); assert.ok(impact.planning)
  const before = await h.state()
  await buyer.run('catalog.bulkApprove', { previewId: preview.id, version: preview.version, acceptRejected: 2 }, { error: 'FORBIDDEN' })
  await agent.run('catalog.bulkApprove', { previewId: preview.id, version: preview.version, acceptRejected: 2 }, { error: 'FORBIDDEN' })
  await manager.run('catalog.bulkApprove', { previewId: preview.id, version: preview.version }, { error: 'REJECTED_ROWS' })
  const payload = { previewId: preview.id, version: preview.version, acceptRejected: 2 }, commandId = crypto.randomUUID()
  const approved = await manager.run('catalog.bulkApprove', payload, { commandId })
  assert.deepEqual(await manager.run('catalog.bulkApprove', payload, { commandId }), approved)
  let after = await h.invariant()
  const updated = after.items.find(i => i.id === left.id)
  assert.equal(updated.salePrice, '29.5'); assert.equal(updated.category, 'Hardware'); assert.equal(updated.priceList, 'Wholesale'); assert.equal(updated.barcode, '000LEFT')
  assert.deepEqual(updated.conversions, left.conversions); assert.deepEqual(updated.attributes, left.attributes); assert.equal(updated.standardCost, left.standardCost)
  assert.equal(updated.catalogLocations.find(l => l.locationId === ohio.id).reorderPoint, '5'); assert.equal(updated.catalogLocations.find(l => l.locationId === dispatch.id).reorderPoint, '7')
  assert.deepEqual(after.movements, before.movements); assert.deepEqual(after.reservations, before.reservations)
  assert.deepEqual(after.salesOrders, before.salesOrders); assert.deepEqual(after.purchaseOrders.find(p => p.id === po.id), approvedPo)
  assert.deepEqual(after.items.find(i => i.id === fixed.id), fixed); assert.deepEqual(after.items.find(i => i.id === bad.id), bad)
  const terms = after.partyItems.find(p => p.itemId === left.id && p.preferred)
  assert.equal(terms.partyId, alternate.id); assert.equal(terms.unit, 'pair'); assert.equal(terms.price, '8')
  const again = readCsv(await (await h.request('/api/larder/catalog.csv')).text()); again.shift()
  const leftOhio = again.find(row => row[at('larder_id')] === left.id && row[at('location_id')] === ohio.id)
  assert.equal(leftOhio[at('sale_price')], '29.5'); assert.equal(leftOhio[at('reorder_point')], '5'); assert.equal(leftOhio[at('preferred_supplier_id')], alternate.id)
  // Explicit clearing is distinct from blanks; creates group by SKU across bins.
  const clear = await engineer.run('catalog.bulkPreview', { file: { name: 'clear.csv', content: csv([header, change(left, ohio, { category: '#CLEAR', price_list: '#CLEAR', reorder_point: '#CLEAR' }), header.map(k => ({ sku: 'NEW', name: 'New washer', kind: 'buy', base_unit: 'each', location_id: ohio.id, reorder_point: '1' })[k] ?? ''), header.map(k => ({ sku: 'NEW', location_id: dispatch.id, reorder_point: '2' })[k] ?? '')]) } })
  assert.equal(clear.errors.length, 0); assert.equal(clear.groups.length, 2)
  await manager.run('catalog.bulkApprove', { previewId: clear.id, version: clear.version })
  after = await h.state(); const cleared = after.items.find(i => i.id === left.id)
  assert.equal(cleared.category, ''); assert.equal(cleared.priceList, ''); assert.equal(cleared.salePrice, '29.5'); assert.equal(cleared.catalogLocations.find(l => l.locationId === ohio.id).reorderPoint, undefined)
  assert.equal(after.items.filter(i => i.sku === 'NEW').length, 1); assert.equal(after.items.find(i => i.sku === 'NEW').catalogLocations.length, 2)
  // Tracking configuration refuses nonzero unlotted stock in any disposition/bin.
  const tracked = await h.command('catalog.bulkPreview', { file: { name: 'tracking.csv', content: csv([header, change(left, dispatch, { tracking: 'batch' })]) } })
  assert.equal(tracked.groups.length, 0); assert.ok(tracked.errors.some(e => /physical stock|lot/i.test(e.reason)))
  const stale = await buyer.run('catalog.bulkPreview', { file: { name: 'stale.csv', content: csv([header, change(right, ohio, { sale_price: '40' })]) } })
  await h.command('location.save', { name: 'New receiving bay' })
  await manager.run('catalog.bulkApprove', { previewId: stale.id, version: stale.version }, { error: 'STALE' })
  assert.equal((await h.state()).items.find(i => i.id === right.id).salePrice, '31')
  const serial = await h.command('item.save', { sku: 'SERIAL-POLICY', name: 'Serial policy configured', kind: 'make', baseUnit: 'each', tracking: 'serial' })
  await h.command('bom.revise', { itemId: serial.id, components: [{ itemId: fixed.id, quantity: '1' }] })
  const work = await h.command('wo.draft', { itemId: serial.id, quantity: '1', requiredBy: '2026-12-18', reason: 'Configured serial policy' })
  const released = await h.command('wo.release', { workOrderId: work.id, version: work.version })
  const beforePhysical = (await h.state()).movements
  await h.command('wo.output', { workOrderId: work.id, version: released.version, locationId: ohio.id, quantity: '1', lot: 'BATCH-IS-NOT-SERIAL' }, { error: 'SERIAL_REQUIRED' })
  const serialPo = await h.command('po.draft', { supplierId: supplier.id, expectedDate: '2026-12-18', reason: 'Serial receipt policy', lines: [{ itemId: serial.id, quantity: '1', unitPrice: '4' }] })
  await h.command('po.approve', { poId: serialPo.id, version: serialPo.version })
  await h.command('receipt.create', { poId: serialPo.id, supplierReference: 'R-serial', lines: [{ lineId: serialPo.lines[0].id, locationId: ohio.id, quantity: '1', lot: 'NOT-A-SERIAL' }] }, { error: 'SERIAL_REQUIRED' })
  assert.deepEqual((await h.state()).movements, beforePhysical)
  const batch = await h.command('item.save', { sku: 'BATCH-POLICY', name: 'Batch requirement', kind: 'buy', baseUnit: 'each', tracking: 'batch' })
  const opening = { locationId: dispatch.id, countedOn: new Date().toISOString().slice(0, 10), countedBy: 'Olive', valuationBasis: 'owner-estimate', evidence: evidence(), lines: [{ itemId: batch.id, quantity: '1', unitCost: '2' }] }
  await h.command('opening.record', opening, { error: 'LOT_REQUIRED' })
  await h.command('opening.record', { ...opening, lines: [{ ...opening.lines[0], lot: 'LOT-1' }] })
  assert.ok((await h.state()).positions.find(p => p.itemId === batch.id).lotId)
  const literal = await h.command('item.save', { sku: "'=LITERAL", name: 'Literal text', kind: 'buy', baseUnit: 'each', priceList: '#CLEAR', barcode: '0000012345' })
  const literalCsv = await (await h.request('/api/larder/catalog.csv')).text()
  const roundTrip = await h.command('catalog.bulkPreview', { file: { name: 'unchanged.csv', content: literalCsv } })
  assert.equal(roundTrip.errors.length, 0); assert.equal(roundTrip.groups.length, 0)
  assert.equal((await h.state()).items.find(i => i.id === literal.id).priceList, '#CLEAR')
  const archive = await (await h.request('/api/larder/archive')).json()
  assert.ok(archive.records.catalogChanges.some(c => c.id === approved.id && c.content === file.content))
})
