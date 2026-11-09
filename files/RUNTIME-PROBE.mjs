import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { installation, workshop, evidence } from '/workspace/run-larder/tests/api/harness.mjs'
import { journal, followEvent } from '/workspace/run-larder/tests/api/change-event-proof.mjs'

const h = await installation({ now: '2026-10-29T12:00:00.000Z' })
let target
try {
  const w = await workshop(h)
  const observations = []
  const observed = async type => {
    const page = await journal(h)
    const event = page.events.at(-1)
    assert.equal(event.type, type)
    await followEvent(h, event)
    observations.push({ type, id: event.id, source: event.source, stateVersion: event.stateVersion, quantities: event.details, evidence: event.evidence })
  }
  let po = await h.command('po.draft', { supplierId: w.supplier.id, expectedDate: '2026-11-01', reason: 'Native event probe', lines: [{ itemId: w.timber.id, quantity: '4', unitPrice: '9.5' }] })
  po = await h.command('po.approve', { poId: po.id, version: po.version })
  const receiptPayload = { poId: po.id, supplierReference: 'synthetic-larder-probe-1', documents: [evidence('Committed delivery')], lines: [{ lineId: po.lines[0].id, locationId: w.loc.id, lot: 'synthetic-larder-probe-1', quantity: '2' }] }
  const receipt = await h.command('receipt.create', receiptPayload, { commandId: 'synthetic-larder-probe-receipt' })
  await observed('receipt.recorded')
  let work = await h.command('wo.draft', { itemId: w.board.id, quantity: '1', requiredBy: '2026-11-01', reason: 'Native event probe' })
  work = await h.command('wo.release', { workOrderId: work.id, version: work.version })
  work = await h.command('wo.issue', { workOrderId: work.id, lines: [{ itemId: w.timber.id, locationId: w.loc.id, quantity: '1' }, { itemId: w.oil.id, locationId: w.loc.id, quantity: '0.05' }] })
  work = await h.command('wo.output', { workOrderId: work.id, version: work.version, locationId: w.loc.id, quantity: '1', lot: 'synthetic-larder-probe-output' })
  await observed('work.output-recorded')
  let plan = await h.command('quality.plan.save', { itemId: w.timber.id, stage: 'receipt', name: 'Probe dimension', sampleSize: 1, measurements: [{ name: 'Width', unit: 'mm', target: '10', lower: '9', upper: '11' }] })
  plan = await h.command('quality.plan.approve', { planId: plan.id, version: plan.version })
  const failed = await h.command('quality.inspect', { planId: plan.id, planVersion: plan.version, lotId: receipt.lines[0].lotId, samples: { Width: ['12'] }, evidence: [evidence('Measured twelve')] })
  await observed('quality.held')
  const hold = (await h.state()).qualityHolds.find(x => x.id === failed.holdId)
  const releasePayload = { holdId: hold.id, version: hold.version, reason: 'Passing retest', evidence: [evidence('Authorized retest release')] }
  const beforeRefusal = await journal(h)
  await h.command('quality.release', releasePayload, { error: 'RETEST' })
  assert.deepEqual(await journal(h), beforeRefusal)
  await h.command('quality.inspect', { planId: plan.id, planVersion: plan.version, lotId: receipt.lines[0].lotId, samples: { Width: ['10'] }, evidence: [evidence('Measured ten')] })
  await h.command('quality.release', releasePayload)
  await observed('quality.released')
  const quote = await h.command('so.quote', { customerId: w.customer.id, promiseDate: '2026-11-01', lines: [{ itemId: w.board.id, quantity: '2', unitPrice: '89' }] })
  const order = await h.command('so.confirm', { orderId: quote.id, version: quote.version })
  let shipment = await h.command('shipment.pick', { orderId: order.id, lines: [{ lineId: order.lines[0].id, itemId: w.board.id, locationId: w.loc.id, lotId: work.outputs[0].lotId, quantity: '1' }] })
  shipment = await h.command('shipment.pack', { shipmentId: shipment.id, version: shipment.version, packages: 1 })
  await h.command('shipment.ship', { shipmentId: shipment.id, version: shipment.version, carrier: 'Local probe' })
  await observed('shipment.dispatched')
  const original = await journal(h)
  assert.equal(original.events.length, 5)
  assert.deepEqual(await h.command('receipt.create', receiptPayload, { commandId: 'synthetic-larder-probe-receipt' }), receipt)
  assert.deepEqual(await journal(h), original)
  await h.restart()
  assert.deepEqual(await journal(h), original)
  const archive = await (await h.request('/api/larder/archive')).json()
  target = await installation({ now: '2026-10-29T12:00:00.000Z' })
  const response = await target.request('/api/larder/archive/restore', { method: 'POST', body: archive })
  assert.equal(response.status, 200, await response.clone().text())
  assert.deepEqual(await journal(target), original)
  assert.deepEqual((await target.state()).movements, (await h.state()).movements)
  assert.equal(target.outboundCount(), 0)
  assert.equal(h.outboundCount(), 0)
  console.log(JSON.stringify({ head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: '/workspace/run-larder', encoding: 'utf8' }).trim(), point: 1, status: 'pass', observations, refusedReleaseEmitted: false, retryEmitted: false, restartStable: true, restoreStable: true, sourceOutbound: h.outboundCount(), targetOutbound: target.outboundCount() }, null, 2))
} finally {
  await h.close()
  if (target) await target.close()
}
