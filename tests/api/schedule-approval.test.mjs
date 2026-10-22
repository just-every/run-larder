// GOV-009: schedule thresholds, in minutes of per-job delay, gate plan and reschedule adoption and CAP-007 grants.
import test from 'node:test'
import assert from 'node:assert/strict'
import { installation, workshop } from './harness.mjs'

const calendar = (name, changes = {}) => ({ name, timeZone: 'America/New_York', effectiveFrom: '2026-01-01', effectiveTo: '2027-12-31', shifts: [{ weekdays: [0, 1, 2, 3, 4, 5, 6], start: 0, end: 1440, breaks: [] }], closedDates: [], usHolidays: false, exceptions: [], capacity: 1, efficiency: 100, reason: 'synthetic-larder-91 calendar approval', ...changes })
const week = '2026-11-25T00:00:00Z'
const inDays = n => new Date(Date.now() + n * 86400000).toISOString()

test('GOV-009 a two-signature schedule threshold gates an above-threshold plan adoption and a grant with a deputy, invalidates on changed inputs, caps every grant, denies agents and takes the named owner override', async t => {
  const h = await installation(); t.after(() => h.close())
  const w = await workshop(h), owner = (await h.state()).actor
  const person = (name, role) => h.person(`gov9-${name}@example.test`, role)
  const manager = await person('manager', 'manager'), planner = await person('planner', 'planner'), production = await person('production', 'production'), reviewer = await person('reviewer', 'manager'), principal = await person('principal', 'manager')
  const planDeputy = await person('plan-deputy', 'sales'), grantDeputy = await person('grant-deputy', 'sales'), agent = await person('agent', 'agent')
  await h.command('capacity.machine', calendar('Bench'))
  await h.command('capacity.labor', calendar('Plan operator', { operatorIds: [owner.id], skills: [] }))
  const machine = (await h.state()).machineCalendars.find(m => m.name === 'Bench')
  for (const [i, start] of [[0, '2026-11-25'], [1, '2026-12-02']]) {
    const item = await h.command('item.save', { sku: `synthetic-larder-92-${i}`, name: `Threshold part ${i}`, kind: 'make', baseUnit: 'each' })
    await h.command('bom.revise', { itemId: item.id, components: [{ itemId: w.timber.id, quantity: '1' }], routing: [{ name: 'Threshold cut', workCentre: 'Bench', minutes: 60 }] })
    const job = await h.command('wo.draft', { itemId: item.id, quantity: '1', requiredBy: '2026-12-06', plannedStart: start, reason: 'synthetic-larder-93 threshold work' })
    await h.command('wo.release', { workOrderId: job.id, version: job.version })
  }
  await h.command('schedule.protect', { asOf: week, days: 14, freezeUntil: '2026-11-26T00:00:00Z', manualLocks: [], reason: 'synthetic-larder-94 protect the first day' })
  const signature = async id => (await h.state()).approvalSignatures.find(x => x.id === id)
  const scenario = (who, end, name) => who.run('schedule.scenario', { asOf: week, days: 14, name, reason: 'synthetic-larder-95 isolated outage', outages: [{ machineId: machine.id, startsAt: '2026-12-02T00:00:00Z', endsAt: end }] })
  const override = (reason = 'Customer line is stopped') => ({ reason, accountableId: manager.id })
  const owned = { run: h.command }

  // Only the owner sets a threshold, in whole minutes; the policy is refused as dollars.
  await manager.run('approval.policy', { category: 'schedule', thresholdMinutes: 600, signatures: 2, reason: 'x' }, { error: 'FORBIDDEN' })
  await h.command('approval.policy', { category: 'schedule', thresholdUsd: '600', signatures: 2, reason: 'x' }, { error: 'INPUT' })
  const policy = await h.command('approval.policy', { category: 'schedule', thresholdMinutes: 600, signatures: 2, expiryMinutes: 60, reason: 'Two people for a job delayed ten hours or more' })
  assert.deepEqual([policy.threshold, policy.unit], ['600', 'minutes'])
  await planner.run('approval.deputize', { deputyId: planDeputy.id, validUntil: inDays(7), reason: 'Cover planning review', categories: ['schedule'] })
  await principal.run('approval.deputize', { deputyId: grantDeputy.id, validUntil: inDays(7), reason: 'Cover grant review', categories: ['schedule'] })

  // A plan delaying a job by about a day: agents and the preparer cannot adopt, one signature adopts nothing and changed inputs void it.
  let plan = await scenario(manager, '2026-12-03T00:00:00Z', 'One day outage')
  const adopt = (who, p, more = {}, error) => who.run('schedule.adopt', { planId: p.id, version: p.version, reason: 'Reviewed outage plan', ...more }, error && { error })
  await adopt(agent, plan, {}, 'FORBIDDEN'); await adopt(manager, plan, {}, 'FORBIDDEN'); await adopt(production, plan, { override: override() }, 'FORBIDDEN')
  const first = await adopt(production, plan)
  assert.deepEqual([first.category, first.remainingAtSigning, Number(first.delayMinutes) >= 600], ['schedule', 1, true])
  assert.deepEqual([(await h.state()).scheduleBookings.length, (await h.state()).schedulePlans.find(x => x.id === plan.id).status], [0, 'review'])
  let po = await h.command('po.draft', { supplierId: w.supplier.id, expectedDate: '2026-11-26', reason: 'synthetic-larder-96 ETA input', lines: [{ itemId: w.timber.id, quantity: '1', unitPrice: '9.5' }] })
  po = await h.command('po.approve', { poId: po.id, version: po.version })
  await h.command('po.revise', { poId: po.id, version: po.version, expectedDate: '2026-11-27', note: 'synthetic-larder-97 supplier ETA slip' })
  assert.equal((await signature(first.id)).status, 'invalidated')
  await adopt(planner, plan, {}, 'STALE')
  // A fresh plan takes a production signature and a deputy signing the planner's seat.
  plan = await scenario(manager, '2026-12-03T00:00:00Z', 'One day outage, refreshed')
  assert.equal((await adopt(production, plan)).remainingAtSigning, 1)
  const adopted = await adopt(planDeputy, plan)
  assert.deepEqual([adopted.status, adopted.signatureIds.length], ['adopted', 2])
  assert.equal((await signature(adopted.signatureIds.at(-1))).onBehalfOf, planner.id)
  // A four-hour outage stays under the threshold: one approver adopts it.
  plan = await scenario(manager, '2026-12-02T04:00:00Z', 'Four hour outage')
  const small = await adopt(production, plan)
  assert.deepEqual([small.status, small.signatureIds], ['adopted', undefined])
  // The owner overrides a two-day outage, naming the accountable manager.
  plan = await scenario(manager, '2026-12-04T00:00:00Z', 'Two day outage')
  const overridden = await adopt(owned, plan, { override: override() })
  assert.deepEqual([overridden.status, overridden.override.accountableId, overridden.signatureIds.length], ['adopted', manager.id, 1])

  // Grants: the policy caps their reach (the threshold for each signature) and life (one signature's lifetime).
  const args = { eventTypes: ['progress', 'breakdown'], machineIds: [machine.id], workOrderIds: [], maxDelayMinutes: 900, maxDisplacementMinutes: 900, expiresAt: inDays(0.02), reason: 'synthetic-larder-98 bounded grant' }
  await planner.run('schedule.grant.prepare', { ...args, maxDelayMinutes: 1300 }, { error: 'POLICY' })
  await planner.run('schedule.grant.prepare', { ...args, maxDisplacementMinutes: 1300 }, { error: 'POLICY' })
  await planner.run('schedule.grant.prepare', { ...args, expiresAt: inDays(1) }, { error: 'POLICY' })
  let grant = await planner.run('schedule.grant.prepare', args)
  const approve = (who, g, more = {}, error) => who.run('schedule.grant.approve', { grantId: g.id, version: g.version, reason: 'Independently bounded', ...more }, error && { error })
  await approve(agent, grant, {}, 'FORBIDDEN'); await approve(planner, grant, {}, 'FORBIDDEN'); await approve(reviewer, grant, { override: override() }, 'FORBIDDEN')
  const sign = await approve(reviewer, grant)
  assert.deepEqual([sign.category, sign.delayMinutes, sign.remainingAtSigning], ['schedule', '900', 1])
  // Revising the grant after one signature voids it.
  const revised = await planner.run('schedule.grant.prepare', { ...args, id: grant.id, version: grant.version, maxDelayMinutes: 800 })
  assert.equal((await signature(sign.id)).status, 'invalidated')
  await approve(reviewer, revised); await approve(reviewer, revised, {}, 'DUPLICATE_SIGNATURE')
  grant = await approve(grantDeputy, revised)
  assert.deepEqual([grant.status, grant.signatureIds.length, grant.approvedBy], ['active', 2, principal.id])
  // A grant below the threshold keeps its single approver; the owner overrides another above it.
  const modest = await planner.run('schedule.grant.prepare', { ...args, maxDelayMinutes: 300, maxDisplacementMinutes: 300 })
  assert.equal((await approve(reviewer, modest)).status, 'active')
  const exception = await planner.run('schedule.grant.prepare', args)
  const excepted = await approve(owned, exception, { override: override('Standing cover for the stoppage') })
  assert.deepEqual([excepted.status, excepted.override.accountableId, excepted.signatureIds.length], ['active', manager.id, 1])
  await h.invariant()
})

test('GOV-009 a reschedule proposal delaying a job past the schedule threshold needs two signatures, a deputy and an unchanged finite preview', async t => {
  const h = await installation(); t.after(() => h.close())
  const w = await workshop(h), person = (name, role) => h.person(`gov9r-${name}@example.test`, role)
  const planner = await person('planner', 'planner'), production = await person('production', 'production'), principal = await person('principal', 'planner'), deputy = await person('deputy', 'sales'), agent = await person('agent', 'agent'), operator = await person('operator', 'operator'), manager = await person('manager', 'manager')
  await h.command('capacity.machine', calendar('Bench'))
  await h.command('capacity.labor', calendar('Reschedule operator', { operatorIds: [operator.id], skills: [] }))
  const jobs = []
  for (let i = 0; i < 2; i++) {
    const product = await h.command('item.save', { sku: `synthetic-larder-99-${i}`, name: `Reschedule assembly ${i}`, kind: 'make', baseUnit: 'each' })
    await h.command('bom.revise', { itemId: product.id, components: [{ itemId: w.timber.id, quantity: '1' }], routing: [{ name: 'Constrained assembly', workCentre: 'Bench', minutes: 120 }] })
    const work = await h.command('wo.draft', { itemId: product.id, quantity: '1', requiredBy: '2026-12-06', plannedStart: '2026-11-25', reason: 'synthetic-larder-100 competing work' })
    jobs.push(await h.command('wo.release', { workOrderId: work.id, version: work.version }))
  }
  const asOf = week, baseline = await (await h.request(`/api/larder/scheduling/finite?asOf=${encodeURIComponent(asOf)}&days=2`)).json()
  const urgent = jobs.find(j => j.id !== baseline.operations[0].workOrderId)
  const payload = { kind: 'reschedule', summary: 'synthetic-larder-101 urgent job first', evidence: ['synthetic-larder-102 capacity review'], plan: { changes: [{ workOrderId: urgent.id, plannedStart: '2026-11-25', priority: 20 }], capacity: { asOf, days: 2, reason: 'synthetic-larder-103 unchanged customer promises' } } }
  await h.command('approval.policy', { category: 'schedule', thresholdMinutes: 60, signatures: 2, expiryMinutes: 60, reason: 'Two people for an hour of delay' })
  await principal.run('approval.deputize', { deputyId: deputy.id, validUntil: inDays(7), reason: 'Cover rescheduling', categories: ['schedule'] })
  const proposal = await planner.run('proposal.prepare', payload)
  assert.ok(proposal.context.capacity.effects.some(e => (Date.parse(e.after) - Date.parse(e.before)) / 60000 >= 60))
  const approve = (who, p, error) => who.run('proposal.approve', { proposalId: p.id, version: p.version }, error && { error })
  await approve(agent, proposal, 'FORBIDDEN'); await approve(planner, proposal, 'FORBIDDEN')
  const first = await approve(production, proposal)
  assert.deepEqual([first.category, first.remainingAtSigning], ['schedule', 1])
  assert.equal((await h.state()).workOrders.find(x => x.id === urgent.id).priority, 0)
  const done = await approve(deputy, proposal)
  assert.deepEqual([done.status, (await h.state()).workOrders.find(x => x.id === urgent.id).priority], ['approved', 20])
  // The owner overrides a fresh proposal, naming the accountable manager.
  const last = await planner.run('proposal.prepare', { ...payload, plan: { ...payload.plan, changes: [{ workOrderId: jobs.find(j => j.id !== urgent.id).id, plannedStart: '2026-11-25', priority: 40 }] } })
  const overridden = await h.command('proposal.approve', { proposalId: last.id, version: last.version, override: { reason: 'Customer line is stopped', accountableId: manager.id } })
  assert.deepEqual([overridden.status, (await h.state()).approvals.find(a => a.id === overridden.approvalId).override.accountableId], ['approved', manager.id])
  // A changed work order after the first signature voids it, and the proposal must be prepared again.
  const next = await planner.run('proposal.prepare', { ...payload, plan: { ...payload.plan, changes: [{ workOrderId: urgent.id, plannedStart: '2026-11-26', priority: 25 }] } })
  const signed = await approve(production, next)
  const moved = (await h.state()).workOrders.find(x => x.id === urgent.id)
  await h.command('order.rank', { kind: 'work', orderId: moved.id, version: moved.version, rank: 1 })
  assert.equal((await h.state()).approvalSignatures.find(x => x.id === signed.id).status, 'invalidated')
  assert.equal((await approve(deputy, next)).remainingAtSigning, 1)
  await approve(production, next, 'STALE')
  await h.invariant()
})
