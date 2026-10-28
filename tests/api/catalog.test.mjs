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

test('ENG-008 approved catalog batch and serial policies govern receipt, issue, output and shipment without unsafe stock changes', async t => {
  const h = await installation({ now: '2026-10-28T12:00:00.000Z' }); t.after(() => h.close())
  const today = '2026-10-28'
  const receiving = await h.command('location.save', { name: 'Policy receiving' }), dispatch = await h.command('location.save', { name: 'Policy dispatch' })
  const supplier = await h.command('party.save', { kind: 'supplier', name: 'Policy parts supplier' }), customer = await h.command('party.save', { kind: 'customer', name: 'Policy equipment customer' })
  const item = (sku, kind = 'buy') => h.command('item.save', { sku, name: sku, kind, baseUnit: 'each' })
  const physical = s => Object.fromEntries(['items', 'lots', 'movements', 'positions', 'reservations', 'receipts', 'workOrders', 'salesOrders', 'shipments', 'openings', 'transfers', 'returns'].map(key => [key, s[key]]))
  const refused = async (type, payload, error) => {
    const before = physical(await h.state())
    await h.command(type, payload, { error })
    assert.deepEqual(physical(await h.state()), before, `${type} ${error} leaves physical records unchanged`)
  }
  const preview = async (items, tracking, location = receiving) => h.command('catalog.bulkPreview', { file: { name: 'tracking-policy.csv', content: csv([
    ['larder_id', 'location_id', 'tracking'], ...items.map(i => [i.id, location.id, tracking]),
  ]) } })
  const select = async (items, tracking) => {
    const before = await h.state(), review = await preview(items, tracking)
    assert.deepEqual(review.errors, []); assert.equal(review.groups.length, items.length)
    await h.command('catalog.bulkApprove', { previewId: review.id, version: review.version })
    const after = await h.state()
    for (const i of items) assert.equal(after.items.find(row => row.id === i.id).tracking, tracking)
    assert.deepEqual(after.movements, before.movements); assert.deepEqual(after.positions, before.positions)
  }
  const purchase = async (part, quantity) => {
    let po = await h.command('po.draft', { supplierId: supplier.id, expectedDate: today, reason: 'Selected tracking policy', lines: [{ itemId: part.id, quantity, unitPrice: '4' }] })
    return h.command('po.approve', { poId: po.id, version: po.version })
  }

  // Each bin and disposition must independently prevent activating tracking.
  for (const location of [receiving, dispatch]) for (const inspection of ['accept', 'quarantine']) {
    const untracked = await item(`synthetic-larder-${location === receiving ? 851 : 852}-${inspection}`), po = await purchase(untracked, '1')
    await h.command('receipt.create', { poId: po.id, supplierReference: 'Unlotted physical stock', lines: [{ lineId: po.lines[0].id, quantity: '1', locationId: location.id, inspection }] })
    for (const tracking of ['batch', 'serial']) {
      const before = physical(await h.state()), review = await preview([untracked], tracking, location === receiving ? dispatch : receiving)
      assert.equal(review.groups.length, 0); assert.equal(review.errors.length, 1)
      assert.equal(review.errors[0].column, 'tracking'); assert.match(review.errors[0].reason, /physical stock/)
      await h.command('catalog.bulkApprove', { previewId: review.id, version: review.version }, { error: 'INPUT' })
      assert.deepEqual(physical(await h.state()), before)
    }
  }
  // Already-lotted balances permit batch activation but still forbid serial activation.
  const lotted = await item('synthetic-larder-853'), lottedPo = await purchase(lotted, '1')
  await h.command('receipt.create', { poId: lottedPo.id, supplierReference: 'Existing named batch', lines: [{ lineId: lottedPo.lines[0].id, quantity: '1', locationId: receiving.id, lot: 'synthetic-larder-853-lot', inspection: 'quarantine' }] })
  await select([lotted], 'batch')
  const beforeSerialSelection = physical(await h.state())
  const serialReview = await preview([lotted], 'serial')
  assert.equal(serialReview.groups.length, 0); assert.match(serialReview.errors[0].reason, /physical stock/)
  assert.deepEqual(physical(await h.state()), beforeSerialSelection)

  for (const tracking of ['batch', 'serial']) {
    const part = await item(`synthetic-larder-854-${tracking}`), product = await item(`synthetic-larder-855-${tracking}`, 'make')
    await select([part, product], tracking)
    await h.command('bom.revise', { itemId: product.id, components: [{ itemId: part.id, quantity: '1' }] })
    const po = await purchase(part, '3')
    const receive = (quantity, extra = {}) => ({ poId: po.id, supplierReference: 'Tracked delivery', lines: [{ lineId: po.lines[0].id, quantity, locationId: receiving.id, inspection: 'accept', ...extra }] })
    if (tracking === 'batch') {
      await refused('receipt.create', receive('2'), 'LOT_REQUIRED')
      await refused('receipt.create', receive('2', { lot: '   ' }), 'LOT_REQUIRED')
      await h.command('receipt.create', receive('2', { lot: 'synthetic-larder-856' }))
    } else {
      // Opening stock cannot identify new serial units and must leave no records.
      await refused('opening.record', { locationId: dispatch.id, countedOn: today, countedBy: 'Olive', valuationBasis: 'owner-estimate', evidence: evidence(), lines: [{ itemId: part.id, quantity: '1', unitCost: '4', lot: 'synthetic-larder-857' }] }, 'SERIAL_REQUIRED')
      await refused('receipt.create', receive('2', { lot: 'A batch is not serial units' }), 'SERIAL_REQUIRED')
      await refused('receipt.create', receive('2', { serials: ['synthetic-larder-858'] }), 'SERIAL_QUANTITY')
      await refused('receipt.create', receive('2', { serials: ['synthetic-larder-858', 'SYNTHETIC-LARDER-858'] }), 'DUPLICATE_SERIAL')
      await refused('receipt.create', receive('0.5', { serials: ['synthetic-larder-858'] }), 'SERIAL_QUANTITY')
      await h.command('receipt.create', receive('2', { serials: ['synthetic-larder-858', 'synthetic-larder-859'] }))
      await refused('receipt.create', receive('1', { serials: ['synthetic-larder-858'] }), 'DUPLICATE_SERIAL')
      const source = (await h.state()).lots.find(l => l.itemId === part.id && l.code === 'synthetic-larder-858')
      const transfer = { itemId: part.id, fromLocationId: receiving.id, toLocationId: dispatch.id, quantity: '1', reason: 'Move one named unit' }
      await refused('transfer.create', transfer, 'SERIAL_REQUIRED')
      await refused('transfer.create', { ...transfer, quantity: '0.5', lotId: source.id }, 'SERIAL_QUANTITY')
      await h.command('transfer.create', { ...transfer, lotId: source.id })
      await h.command('transfer.create', { ...transfer, fromLocationId: dispatch.id, toLocationId: receiving.id, lotId: source.id })
    }
    let state = await h.invariant()
    const received = state.receipts.filter(r => r.poId === po.id).flatMap(r => r.lines)
    assert.deepEqual(received.map(l => l.quantity).sort(), tracking === 'batch' ? ['2'] : ['1', '1'])
    assert.ok(received.every(l => state.lots.some(lot => lot.id === l.lotId && lot.itemId === part.id && (tracking !== 'serial' || lot.serial))))
    let work = await h.command('wo.draft', { itemId: product.id, quantity: '2', requiredBy: today, reason: 'Selected-policy assembly' })
    work = await h.command('wo.release', { workOrderId: work.id, version: work.version })
    const issue = (quantity, extra = {}) => ({ workOrderId: work.id, lines: [{ itemId: part.id, locationId: receiving.id, quantity, ...extra }] })
    if (tracking === 'serial') {
      await refused('wo.issue', issue('2'), 'SERIAL_REQUIRED')
      await refused('wo.issue', issue('2', { serials: ['synthetic-larder-858', 'synthetic-larder-858'] }), 'DUPLICATE_SERIAL')
      await refused('wo.issue', issue('0.5', { serials: ['synthetic-larder-858'] }), 'SERIAL_QUANTITY')
    }
    work = await h.command('wo.issue', issue('2', tracking === 'serial' ? { serials: ['synthetic-larder-858', 'synthetic-larder-859'] } : { lotId: received[0].lotId }))
    state = await h.state()
    const inputs = state.movements.filter(m => m.documentId === work.id && m.kind === 'issue')
    assert.deepEqual(inputs.map(m => m.quantity).sort(), tracking === 'batch' ? ['-2'] : ['-1', '-1'])
    const output = (quantity, extra = {}) => ({ workOrderId: work.id, version: work.version, locationId: dispatch.id, quantity, ...extra })
    if (tracking === 'batch') {
      await refused('wo.output', output('2'), 'LOT_REQUIRED')
      work = await h.command('wo.output', output('2', { lot: 'synthetic-larder-860' }))
    } else {
      const allocations = index => [{ movementId: inputs[index].id, quantity: '1' }]
      await refused('wo.output', output('1', { allocations: allocations(0) }), 'SERIAL_REQUIRED')
      await refused('wo.output', output('0.5', { serials: ['synthetic-larder-861'] }), 'SERIAL_QUANTITY')
      await refused('wo.output', output('2', { serials: ['synthetic-larder-861', 'synthetic-larder-862'] }), 'SERIAL_QUANTITY')
      work = await h.command('wo.output', output('1', { serials: ['synthetic-larder-861'], allocations: allocations(0) }))
      await refused('wo.output', output('1', { serials: ['SYNTHETIC-LARDER-861'], allocations: allocations(1) }), 'DUPLICATE_SERIAL')
      work = await h.command('wo.output', output('1', { serials: ['synthetic-larder-862'], allocations: allocations(1) }))
    }
    work = await h.command('wo.close', { workOrderId: work.id, version: work.version })
    let order = await h.command('so.quote', { customerId: customer.id, promiseDate: today, lines: [{ itemId: product.id, quantity: '2', unitPrice: '20' }] })
    order = await h.command('so.confirm', { orderId: order.id, version: order.version })
    await h.command('so.reserve', { orderId: order.id })
    const pick = (quantity, extra = {}) => ({ orderId: order.id, lines: [{ lineId: order.lines[0].id, locationId: dispatch.id, quantity, ...extra }] })
    if (tracking === 'serial') {
      await refused('shipment.pick', pick('2'), 'SERIAL_REQUIRED')
      await refused('shipment.pick', pick('2', { serials: ['synthetic-larder-861', 'synthetic-larder-861'] }), 'DUPLICATE_SERIAL')
      await refused('shipment.pick', pick('0.5', { serials: ['synthetic-larder-861'] }), 'SERIAL_QUANTITY')
    }
    state = await h.state()
    const outputLots = state.lots.filter(l => l.itemId === product.id)
    let shipment = await h.command('shipment.pick', pick('2', tracking === 'serial' ? { serials: ['synthetic-larder-861', 'synthetic-larder-862'] } : { lotId: outputLots[0].id }))
    shipment = await h.command('shipment.pack', { shipmentId: shipment.id, version: shipment.version, packages: 1 })
    await h.command('shipment.ship', { shipmentId: shipment.id, version: shipment.version, carrier: 'UPS', tracking: 'synthetic-larder-863' })
    state = await h.invariant()
    const saved = state.shipments.find(s => s.id === shipment.id)
    assert.equal(saved.status, 'shipped'); assert.equal(saved.packages, 1); assert.equal(saved.shippedAt, '2026-10-28T12:00:00.000Z')
    assert.deepEqual(saved.lines.map(l => [l.lotId, l.quantity]).sort(), outputLots.map(l => [l.id, tracking === 'serial' ? '1' : '2']).sort())
    assert.equal(state.salesOrders.find(s => s.id === order.id).lines[0].shipped, '2')
    assert.ok(state.positions.filter(p => p.itemId === product.id).every(p => p.quantity === '0'))
    if (tracking === 'serial') {
      for (const m of state.movements.filter(m => [part.id, product.id].includes(m.itemId))) {
        assert.ok(['1', '-1'].includes(m.quantity)); assert.ok(state.lots.some(l => l.id === m.lotId && l.itemId === m.itemId && l.serial))
      }
      const returned = { orderId: order.id, lineId: order.lines[0].id, quantity: '1', locationId: dispatch.id, disposition: 'quarantine', reason: 'Named unit return' }
      await refused('return.receive', returned, 'SERIAL_REQUIRED')
      await refused('return.receive', { ...returned, quantity: '2', serials: ['synthetic-larder-861', 'SYNTHETIC-LARDER-861'] }, 'DUPLICATE_SERIAL')
      await refused('return.receive', { ...returned, quantity: '0.5', serials: ['synthetic-larder-861'] }, 'SERIAL_QUANTITY')
      await h.command('return.receive', { ...returned, serials: ['synthetic-larder-861'] })
      const afterReturn = await h.invariant()
      assert.deepEqual(afterReturn.movements.filter(m => m.itemId === product.id && m.kind === 'return').map(m => [m.lotId, m.quantity, m.status]), [[outputLots.find(l => l.code === 'synthetic-larder-861').id, '1', 'quarantine']])
      const history = await (await h.request('/api/larder/serials?q=synthetic-larder-861')).json()
      assert.deepEqual(history[0].components.map(c => c.lotId), [inputs[0].lotId])
      assert.equal(history[0].place.state, 'quarantine'); assert.equal(history[0].customers[0].shipmentId, shipment.id)
    }
  }
})
