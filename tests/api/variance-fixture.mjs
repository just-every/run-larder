import { evidence } from './harness.mjs'

// Generated records only, used through the public command transport by both
// the integration journey and the explicitly invoked live-model journey.
export async function varianceFixture(h, now = '2026-10-25T12:00:00.000Z') {
  const reason = 'synthetic-larder-814 generated variance experiment', day = now.slice(0, 10)
  const policy = await h.command('costing.policy.prepare', { standardLaborRate: '10', machineRate: '2', overheadRate: '3', overtimeAfterHours: '8', overtimeMultiplier: '1.5', reason })
  await h.command('costing.policy.approve', { policyId: policy.id, version: policy.version, reason })
  const owner = (await h.state()).actor
  const labor = await h.command('capacity.labor', { name: 'synthetic-larder-814 crew', timeZone: 'UTC', effectiveFrom: '2026-01-01', effectiveTo: '2027-12-31', shifts: [{ weekdays: [0, 1, 2, 3, 4, 5, 6], start: 0, end: 1440 }], operatorIds: [owner.id], skills: [], capacity: 1, reason })
  await h.command('capacity.rate', { laborId: labor.id, hourlyRate: '10', burdenRate: '0', reason })
  const location = await h.command('location.save', { name: 'synthetic-larder-814 shelf' })
  const raw = await h.command('item.save', { sku: 'synthetic-larder-814-raw', name: 'Synthetic maple blank', baseUnit: 'each', kind: 'buy', standardCost: '10' })
  const item = await h.command('item.save', { sku: 'synthetic-larder-814-product', name: 'Synthetic serving board', baseUnit: 'each', kind: 'make', standardCost: '25' })
  await h.command('opening.record', { locationId: location.id, countedOn: day, countedBy: 'synthetic-larder-814', valuationBasis: 'supplier-invoice', evidence: evidence('synthetic-larder-814 generated inventory'), lines: [{ itemId: raw.id, quantity: '100', unitCost: '10' }] })
  const routing = [{ name: 'Synthetic finishing', workCentre: 'synthetic-larder-814 bench', minutes: 60 }]
  await h.command('bom.revise', { itemId: item.id, effectiveOn: day, components: [{ itemId: raw.id, quantity: '1' }], routing })
  const customer = await h.command('party.save', { name: 'synthetic-larder-814 buyer', kind: 'customer' })
  const order = await h.command('so.quote', { customerId: customer.id, promiseDate: '2026-12-01', lines: [{ itemId: item.id, quantity: '2', unitPrice: '100' }] })
  const makeJob = async (index, improved = false) => {
    let job = await h.command('wo.draft', { itemId: item.id, quantity: '2', requiredBy: '2026-12-01', reason })
    job = await h.command('wo.release', { workOrderId: job.id, version: job.version })
    let entry = await h.command('time.start', { workOrderId: job.id, sequence: 1, phase: 'run' })
    const startedAt = new Date(Date.parse(now) - (72 - index * 14) * 3600000).toISOString(), stoppedAt = new Date(Date.parse(startedAt) + (improved ? 2 : 10) * 3600000).toISOString()
    entry = await h.command('time.correct', { entryId: entry.id, startedAt, stoppedAt, reason })
    await h.command('time.decide', { entryId: entry.id, correctionId: entry.corrections[0].id, decision: 'approve', reason })
    job = await h.command('wo.issue', { workOrderId: job.id, lines: [{ itemId: raw.id, quantity: improved ? '2' : '3', locationId: location.id }] })
    job = await h.command('wo.output', { workOrderId: job.id, version: job.version, quantity: improved ? '2' : '1', scrap: improved ? '0' : '1', scrapReason: reason, locationId: location.id, lot: `synthetic-larder-814-${index}` })
    job = await h.command('wo.close', { workOrderId: job.id, version: job.version })
    const valuation = await h.command('costing.valuation.prepare', { workOrderId: job.id, reason })
    await h.command('costing.valuation.approve', { valuationId: valuation.id, version: valuation.version, reason })
    return job
  }
  const jobs = [await makeJob(0), await makeJob(1)]
  for (const job of jobs) await h.command('costing.link', { orderId: order.id, lineId: order.lines[0].id, workOrderId: job.id, quantity: '1', reason })
  const confirmed = await h.command('so.confirm', { orderId: order.id, version: order.version })
  let shipment = await h.command('shipment.pick', { orderId: confirmed.id, lines: [{ lineId: confirmed.lines[0].id, quantity: '2', locationId: location.id }] })
  shipment = await h.command('shipment.pack', { shipmentId: shipment.id, version: shipment.version, packages: 1 })
  await h.command('shipment.ship', { shipmentId: shipment.id, version: shipment.version, carrier: 'synthetic-larder-814 carrier' })
  const improve = async () => {
    const change = await h.command('engineering.propose', { itemId: item.id, components: [{ itemId: raw.id, quantity: '1' }], routing: [{ ...routing[0], minutes: 30 }], effectiveOn: day, safety: false, reason })
    const approved = await h.command('engineering.approve', { changeId: change.id, version: change.version })
    await h.command('engineering.acknowledge', { changeId: approved.id, version: approved.version, bomId: approved.bomId, note: reason })
    return { change: approved, next: await makeJob(2, true) }
  }
  return { order, jobs, item, improve }
}
