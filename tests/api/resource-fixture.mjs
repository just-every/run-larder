// A real partial delivery, exact component allocation and partial dispatch.
// Used by the existing manufacturing, authority and restoration journeys.
import assert from 'node:assert/strict'
import { evidence } from './harness.mjs'

export async function resourceFixture(h, location, suffix = '') {
  const label = value => value + suffix
  const loc = location ?? await h.command('location.save', { name: label('synthetic-larder-resource-bin') })
  const input = await h.command('item.save', { sku: label('synthetic-larder-resource-input'), name: label('Resource timber'), kind: 'buy', baseUnit: 'each' })
  const output = await h.command('item.save', { sku: label('synthetic-larder-resource-output'), name: label('Resource board'), kind: 'make', baseUnit: 'each' })
  const supplier = await h.command('party.save', { name: label('synthetic-larder-resource-supplier'), kind: 'supplier' })
  const customer = await h.command('party.save', { name: label('synthetic-larder-resource-customer'), kind: 'customer' })
  await h.command('bom.revise', { itemId: output.id, components: [{ itemId: input.id, quantity: '1' }] })
  const purchase = await h.command('po.draft', { supplierId: supplier.id, expectedDate: '2026-11-01', reason: 'Resource journey', lines: [{ itemId: input.id, quantity: '10', unitPrice: '7.25' }] })
  await h.command('po.approve', { poId: purchase.id, version: purchase.version })
  const receipt = await h.command('receipt.create', { poId: purchase.id, supplierReference: 'synthetic-larder-resource-delivery', documents: [evidence('synthetic-larder retained supplier evidence')], lines: [{ lineId: purchase.lines[0].id, quantity: '6', locationId: loc.id, lot: 'synthetic-larder-resource-input-lot' }] })
  const job = await h.command('wo.draft', { itemId: output.id, quantity: '4', requiredBy: '2026-11-03', reason: 'Resource journey' })
  await h.command('wo.release', { workOrderId: job.id, version: job.version })
  const issued = await h.command('wo.issue', { workOrderId: job.id, lines: [{ itemId: input.id, locationId: loc.id, lotId: receipt.lines[0].lotId, quantity: '4' }] })
  const issue = (await h.state()).movements.find(m => m.documentKind === 'workOrders' && m.documentId === job.id && m.kind === 'issue')
  const first = await h.command('wo.output', { workOrderId: job.id, version: issued.version, locationId: loc.id, quantity: '1', lot: label('synthetic-larder-resource-first-lot'), allocations: [{ movementId: issue.id, quantity: '1' }] })
  const produced = await h.command('wo.output', { workOrderId: job.id, version: first.version, locationId: loc.id, quantity: '3', lot: label('synthetic-larder-resource-output-lot'), allocations: [{ movementId: issue.id, quantity: '3' }] })
  const work = await h.command('wo.close', { workOrderId: job.id, version: produced.version })
  const quote = await h.command('so.quote', { customerId: customer.id, promiseDate: '2026-11-05', lines: [{ itemId: output.id, quantity: '5', unitPrice: '20' }] })
  const order = await h.command('so.confirm', { orderId: quote.id, version: quote.version })
  const batch = produced.outputs[1]
  const picked = await h.command('shipment.pick', { orderId: order.id, lines: [{ lineId: order.lines[0].id, locationId: loc.id, lotId: batch.lotId, quantity: '2' }] })
  const packed = await h.command('shipment.pack', { shipmentId: picked.id, version: picked.version, packages: 1 })
  const shipment = await h.command('shipment.ship', { shipmentId: picked.id, version: packed.version, carrier: 'synthetic-larder-carrier' })
  const currentPurchase = (await h.state()).purchaseOrders.find(p => p.id === purchase.id)
  const billed = await h.command('po.bill.capture', { poId: purchase.id, version: currentPurchase.version, reference: 'synthetic-larder-resource-bill', currency: 'USD', freight: '0', tax: '0', reason: 'Retained supplier bill', evidence: evidence('synthetic-larder financial evidence'), lines: [{ lineId: purchase.lines[0].id, quantity: '6', unitPrice: '7.25' }] })
  const next = await h.command('wo.draft', { itemId: output.id, quantity: '2', requiredBy: '2026-11-06', reason: 'Retained receipt pegs' })
  await h.command('wo.release', { workOrderId: next.id, version: next.version })
  return { loc, input, output, purchase, billFile: billed.bills[0].evidence, receipt, work, firstBatch: first.outputs[0], batch, issue, order, shipment }
}

export async function resourceRead(h, kind, id, as = h.owner()) {
  const response = await h.request(`/api/larder/v1/resources/${kind}/${id}`, { as })
  assert.equal(response.status, 200, await response.clone().text())
  return response.json()
}

export async function assertResourceJourney(h, f, as = h.owner()) {
  const before = await h.state(as), all = await h.state()
  const receipt = await resourceRead(h, 'receipts', f.receipt.id, as)
  const output = await resourceRead(h, 'outputs', f.batch.id, as)
  const shipment = await resourceRead(h, 'shipments', f.shipment.id, as)
  for (const [projection, collection] of [[receipt, 'receipts'], [shipment, 'shipments']]) {
    assert.deepEqual(projection.data, before[collection].find(r => r.id === projection.data.id))
    assert.equal(projection.resource.version, projection.data.version)
    assert.equal(projection.version, before.version)
  }
  assert.deepEqual(output.data, { ...before.workOrders.find(r => r.id === f.work.id).outputs.find(o => o.id === f.batch.id), workOrderId: f.work.id, version: f.work.version })
  assert.equal(receipt.data.lines[0].quantity, '6')
  assert.equal(output.data.good, '3')
  assert.equal(output.data.allocations[0].quantity, '3')
  for (const projection of [output, shipment]) {
    assert.deepEqual(projection.physical.allocations.map(a => [a.output.id, a.movement.id, a.lot.id, a.quantity]), [[f.batch.id, f.issue.id, f.receipt.lines[0].lotId, '3']])
    const allocation = projection.physical.allocations[0]
    assert.equal((await resourceRead(h, allocation.movement.kind, allocation.movement.id, as)).data.quantity, '-4', 'A partial output allocation never relabels the full issue quantity')
    for (const l of [allocation.output, allocation.movement, allocation.lot]) assert.deepEqual((await resourceRead(h, l.kind, l.id, as)).resource, l)
  }
  const firstOutput = await resourceRead(h, 'outputs', f.firstBatch.id, as)
  assert.deepEqual(firstOutput.physical.allocations.map(a => a.quantity), ['1'])
  assert.equal(firstOutput.physical.allocations[0].movement.id, f.issue.id)
  assert.equal(shipment.data.lines[0].quantity, '2')
  assert.deepEqual(receipt.physical.lots.map(l => l.id), [f.receipt.lines[0].lotId])
  assert.deepEqual(output.physical.lots.map(l => l.id).sort(), [f.batch.lotId, f.receipt.lines[0].lotId].sort())
  assert.deepEqual(shipment.physical.lots.map(l => l.id), [f.batch.lotId])
  const nativeJob = before.workOrders.find(w => w.id === f.work.id)
  const workLink = output.links.find(l => l.kind === 'work')
  assert.equal((await resourceRead(h, workLink.kind, workLink.id, as)).data.cost.materials, nativeJob.cost.materials)
  const costsRestricted = nativeJob.cost.materials === 'restricted'
  assert.equal(nativeJob.cost.materials, costsRestricted ? 'restricted' : '29')
  for (const projection of [receipt, output, shipment]) {
    assert.match(projection.physical.basis, /not planning pegs/)
    const { href, links: plannedRecords, ...currentPegs } = projection.planning
    const pegging = await h.request(href, { as })
    assert.equal(pegging.status, 200)
    assert.deepEqual(await pegging.json(), currentPegs, 'The navigable current planning door returns the same versioned indicative pegs')
    for (const l of plannedRecords) assert.deepEqual((await resourceRead(h, l.kind, l.id, as)).resource, l, 'Planning references navigate to exact current visible record versions')
    for (const link of projection.links) {
      const r = await resourceRead(h, link.kind, link.id, as)
      assert.deepEqual(r.resource, link)
    }
    for (const link of projection.physical.movements) {
      const r = await resourceRead(h, link.kind, link.id, as)
      assert.deepEqual(r.data, before.movements.find(m => m.id === link.id))
      assert.equal(r.resource.version, r.data.sequence)
      assert.equal(r.data.unitCost, costsRestricted ? 'restricted' : '7.25')
    }
    assert.ok(projection.files.some(a => a.id === f.receipt.documents[0].id), 'Original receipt evidence remains reachable through exact lot provenance')
    for (const file of projection.files) {
      const r = await h.request(file.href, { as })
      assert.equal(r.status, 200)
      assert.equal(await r.text(), file.id === f.billFile.id ? 'synthetic-larder financial evidence' : 'synthetic-larder retained supplier evidence')
      assert.equal(file.sha256, file.id === f.billFile.id ? f.billFile.sha256 : f.receipt.documents[0].sha256)
    }
  }
  const purchase = await resourceRead(h, 'purchases', f.purchase.id, as)
  const financialLink = purchase.files.find(a => a.id === f.billFile.id)
  if (costsRestricted) {
    assert.equal(financialLink, undefined)
    assert.equal((await h.request(`/api/larder/attachments/${f.billFile.id}`, { as })).status, 403)
  } else {
    assert.ok(financialLink)
    assert.equal(await (await h.request(financialLink.href, { as })).text(), 'synthetic-larder financial evidence')
  }
  assert.match(receipt.planning.scope, /indicative/)
  assert.ok(receipt.planning.links.some(l => l.kind === 'work'))
  assert.ok(shipment.planning.links.some(l => l.kind === 'orders' && l.id === f.order.id))
  assert.deepEqual(output.planning.links, [], 'Closed work has no fabricated live material-demand links')
  assert.ok(receipt.planning.pegs.some(p => p.source.lotId === f.receipt.lines[0].lotId && p.source.quantity === '2'))
  assert.ok(shipment.planning.pegs.some(p => p.source.lotId === f.batch.lotId && p.source.quantity === '1'))
  assert.equal(shipment.planning.version, before.version)
  assert.equal(all.salesOrders.find(o => o.id === f.order.id).status, 'part shipped')
  assert.equal(all.purchaseOrders.find(p => p.id === f.purchase.id).lines[0].received, '6')
  assert.deepEqual(await h.state(as), before, 'Following resource links has no business effect')
  return { receipt, output, shipment }
}
