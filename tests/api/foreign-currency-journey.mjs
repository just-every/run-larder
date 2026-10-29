import assert from 'node:assert/strict'

// One money journey through authenticated commands and report, state and CSV
// doors. Used by the existing handoff sanity test and its browser readback.
export async function foreignCurrencyJourney(h, tag = 'synthetic-larder-909') {
  const item = await h.command('item.save', { sku: tag, name: tag, kind: 'buy', baseUnit: 'each', standardCost: '0.1' })
  const location = await h.command('location.save', { name: tag })
  const customer = await h.command('party.save', { name: tag, kind: 'customer' })
  await h.command('opening.record', { locationId: location.id, countedOn: '2026-10-01', countedBy: tag, valuationBasis: 'supplier-invoice', evidence: { name: 'count.txt', contentType: 'text/plain', base64: Buffer.from('Counted commercial probe stock').toString('base64') }, lines: [{ itemId: item.id, quantity: '100000', unitCost: '0.1', lot: tag + '-a' }] })
  const current = async id => (await h.state()).salesOrders.find(o => o.id === id)
  const quote = async quantity => h.command('so.quote', { customerId: customer.id, promiseDate: '2099-12-31', currency: 'CAD', usdRate: '0.723456', rateDate: '2026-10-01', rateReference: tag, lines: [{ itemId: item.id, quantity, unitPrice: '0.99' }] })
  const ship = async (order, quantity) => {
    let shipment = await h.command('shipment.pick', { orderId: order.id, lines: [{ lineId: order.lines[0].id, locationId: location.id, quantity }] })
    shipment = await h.command('shipment.pack', { shipmentId: shipment.id, version: shipment.version, packages: 1 })
    return h.command('shipment.ship', { shipmentId: shipment.id, version: shipment.version, carrier: tag })
  }
  const minor = value => BigInt(value.replace('.', ''))
  const money = amount => { const negative = amount < 0n, absolute = negative ? -amount : amount; return (negative ? '-' : '') + (absolute / 100n) + '.' + String(absolute % 100n).padStart(2, '0') }
  const sum = values => money(values.reduce((n, value) => n + minor(value), 0n))
  const receipts = [], invoices = []
  let lastInvoiceCommand
  let lastBatch
  async function reconcile(order, expected, expectedCad) {
    const before = await current(order.id), payload = { orderId: order.id, version: before.version }
    const commandId = `${tag}-invoice-${invoices.length + 1}`
    const invoice = await h.command('so.invoice', payload, { commandId })
    assert.deepEqual(await h.command('so.invoice', payload, { commandId }), invoice, 'Replayed invoice has one immutable identity')
    lastInvoiceCommand = { payload, commandId }
    invoices.push(invoice)
    // Native replay returns the same document; another command cannot invoice
    // the same physical quantity twice or accept caller-supplied money.
    const afterInvoice = await current(order.id)
    await h.command('so.invoice', { orderId: order.id, version: afterInvoice.version }, { error: 'NOTHING_TO_INVOICE' })
    await h.command('so.invoice', { orderId: order.id, version: afterInvoice.version, usdAmount: '1' }, { error: 'INPUT' })
    const unchanged = await current(order.id); assert.deepEqual(unchanged, afterInvoice)
    const handoff = await h.command('handoff.prepare', {})
    receipts.push(handoff); lastBatch = handoff
    const records = (await current(order.id)).invoices
    const movements = new Set(records.flatMap(i => i.lines.map(l => l.movementId)))
    const handed = receipts.flatMap(batch => batch.lines).filter(l => l.movementIds.some(id => movements.has(id)))
    const reportResponse = await h.request(`/api/larder/costing/margins?orderId=${order.id}`)
    assert.equal(reportResponse.status, 200)
    const report = await reportResponse.json(), margin = report.rows[0]
    assert.equal(sum(handed.map(l => l.amountCents)), expected, 'USD handoff reconciles to the independently expected cents')
    assert.equal(margin.recognizedRevenue, expected, 'USD margin revenue reconciles')
    assert.equal(sum(records.map(i => i.usdAmount)), expected, 'USD invoices reconcile')
    assert.equal(sum(records.map(i => i.amount)), expectedCad, 'Customer-currency invoices reconcile')
    assert.equal(margin.customerRevenue, expectedCad)
    for (const entry of records.flatMap(i => i.lines)) {
      assert.equal(handed.find(l => l.movementIds.includes(entry.movementId)).amountCents, entry.usdAmount)
      assert.equal(margin.sources.find(l => l.movementId === entry.movementId).revenue, entry.usdAmount)
    }
    const csv = await h.request(`/api/larder/handoffs/${handoff.id}.csv`)
    assert.equal(csv.status, 200); assert.ok((await csv.text()).includes(invoice.lines[0].usdAmount))
    return invoice
  }
  let once = await quote('20000')
  once = await h.command('so.confirm', { orderId: once.id, version: once.version })
  assert.equal(once.currency, 'CAD'); assert.equal(once.usdRate, '0.723456')
  const preShip = await h.state()
  await h.command('so.invoice', { orderId: once.id, version: once.version }, { error: 'NOTHING_TO_INVOICE' })
  assert.deepEqual(await h.state(), preShip, 'Unshipped invoice refusal has no effect')
  await ship(once, '20000')
  await reconcile(once, '14324.43', '19800.00')

  let split = await quote('20000')
  split = await h.command('so.confirm', { orderId: split.id, version: split.version })
  const first = await ship(split, '10000')
  const firstInvoice = await reconcile(split, '7162.21', '9900.00')
  const firstHandoff = structuredClone(lastBatch)
  await ship(split, '10000')
  await reconcile(split, '14324.43', '19800.00')
  await h.command('movement.reverse', { documentKind: 'shipments', documentId: first.id, reason: tag })
  const correction = await reconcile(split, '7162.22', '9900.00')
  assert.equal(correction.usdAmount, '-7162.21', 'A reversal negates the exact issued cents')
  const reversedState = await h.state()
  await h.command('movement.reverse', { documentKind: 'shipments', documentId: first.id, reason: tag }, { error: 'NOTHING_TO_REVERSE' })
  assert.deepEqual(await h.state(), reversedState, 'Repeated reversal refuses without effects')
  await ship(await current(split.id), '10000')
  await reconcile(split, '14324.43', '19800.00')
  const returned = await h.command('return.receive', { orderId: split.id, lineId: split.lines[0].id, quantity: '1', locationId: location.id, disposition: 'restock', reason: tag })
  await reconcile(split, '14323.71', '19799.01')
  const secondReturn = await h.command('return.receive', { orderId: split.id, lineId: split.lines[0].id, quantity: '1', locationId: location.id, disposition: 'restock', reason: tag })
  await reconcile(split, '14323.00', '19798.02')
  await h.command('movement.reverse', { documentKind: 'returns', documentId: secondReturn.id, reason: tag })
  await reconcile(split, '14323.71', '19799.01')
  await h.command('movement.reverse', { documentKind: 'returns', documentId: returned.id, reason: tag })
  await reconcile(split, '14324.43', '19800.00')
  const final = await h.state(), saved = final.salesOrders.find(o => o.id === split.id)
  assert.deepEqual(saved.invoices[0], firstInvoice, 'Later corrections retain the original invoice')
  assert.deepEqual(final.handoffs.find(h => h.id === firstHandoff.id), firstHandoff, 'Later corrections retain the original handoff')
  await h.command('return.receive', { orderId: split.id, lineId: split.lines[0].id, quantity: '20001', locationId: location.id, disposition: 'restock', reason: tag }, { error: 'RETURN_EXCEEDS' })
  assert.deepEqual(await h.state(), final, 'An excessive return refuses without changing stock or money')
  return { orderId: split.id, onceOrderId: once.id, handoffId: lastBatch.id, itemId: item.id, invoices, customerId: customer.id, lastInvoiceCommand }
}
