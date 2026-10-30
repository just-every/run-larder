// GOV-009: schedule thresholds, in minutes of per-job delay, gate plan and reschedule adoption and CAP-007 grants.
import test from 'node:test'
import assert from 'node:assert/strict'
import { installation, workshop } from './harness.mjs'
import { recoveryFixture, recoveryBusiness } from './recovery-fixture.mjs'

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
  // A grant needing no signature stays under the threshold and keeps its single approver.
  const modest = await planner.run('schedule.grant.prepare', { ...args, maxDelayMinutes: 300, maxDisplacementMinutes: 300 })
  const modestActive = await approve(reviewer, modest)
  assert.deepEqual([modestActive.status, modestActive.signatureIds], ['active', undefined])
  // One signature reaches at most one threshold, two at most two: the owner's override is one signature, so it cannot switch on the 900-minute grant that a pair could.
  const exception = await planner.run('schedule.grant.prepare', args)
  const refusal = await approve(owned, exception, { override: override('Standing cover for the stoppage') }, 'POLICY')
  assert.deepEqual([refusal.error.details.cap, refusal.error.details.requested], [600, 900])
  const second = await approve(reviewer, exception)
  assert.deepEqual([second.remainingAtSigning, (await h.state()).scheduleGrants.find(g => g.id === exception.id).status], [1, 'draft'])
  assert.equal((await approve(owned, exception, { override: override() }, 'POLICY')).error.details.cap, 600)
  const capped = await planner.run('schedule.grant.prepare', { ...args, maxDelayMinutes: 600, maxDisplacementMinutes: 600 })
  const excepted = await approve(owned, capped, { override: override('Standing cover for the stoppage') })
  assert.deepEqual([excepted.status, excepted.override.accountableId, excepted.signatureIds.length], ['active', manager.id, 1])
  // A one-signature policy caps every grant at one threshold.
  await h.command('approval.policy', { category: 'schedule', thresholdMinutes: 600, signatures: 1, expiryMinutes: 60, reason: 'One signature above ten hours' })
  await planner.run('schedule.grant.prepare', args, { error: 'POLICY' })
  await h.command('approval.policy', { category: 'schedule', thresholdMinutes: 6000, signatures: 2, expiryMinutes: 60, reason: 'Two people for a job delayed four days or more' })

  // A signed grant ends when the plan it was signed against changes or any signer loses authority, and its replacement needs fresh signatures.
  for (const g of (await h.state()).scheduleGrants.filter(x => x.status === 'active')) await planner.run('schedule.grant.revoke', { grantId: g.id, version: g.version, reason: 'Replace standing grants' })
  const standing = { ...args, eventTypes: ['ETA'], maxDelayMinutes: 11000, maxDisplacementMinutes: 11000 }
  let eta = 27
  const rank = async () => { const current = (await h.state()).purchaseOrders.find(x => x.id === po.id); await h.command('po.revise', { poId: current.id, version: current.version, expectedDate: `2026-11-${++eta}`, note: 'synthetic-larder-105 supplier ETA slip' }); return (await h.state()).schedulePlans.filter(p => p.kind === 'reflow').at(-1) }
  const dual = async () => { const g = await planner.run('schedule.grant.prepare', standing); await approve(reviewer, g); return approve(grantDeputy, g) }
  let live = await dual()
  const applied = await rank();
  assert.deepEqual([applied.status, applied.autoApplication.grantVersion], ['adopted', live.version])
  const protection = (await h.state()).schedulePolicies[0]
  await planner.run('schedule.protect', { version: protection.version, asOf: week, days: 14, freezeUntil: '2026-11-26T00:00:00Z', manualLocks: [], reason: 'synthetic-larder-104 the plan the grant was signed against changes' })
  const moved = await rank()
  assert.deepEqual([moved.status, /Protection/.test(moved.automation.reason), (await h.state()).scheduleGrants.find(g => g.id === live.id).status], ['review', true, 'suspended'])
  live = await dual()
  assert.equal((await rank()).status, 'adopted')
  await h.command('role.set', { operatorId: reviewer.id, role: 'viewer' })
  const lost = await rank()
  assert.deepEqual([lost.status, /signer/.test(lost.automation.reason), (await h.state()).scheduleGrants.find(g => g.id === live.id).status], ['review', true, 'suspended'])
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
  const decline = await planner.run('proposal.prepare', payload)
  const beforeDecline = await h.invariant()
  const rejected = await production.run('proposal.reject', { proposalId: decline.id, version: decline.version, note: 'Keep the current finite schedule' })
  assert.equal(rejected.status, 'rejected')
  assert.deepEqual(rejected.decision.classification, decline.classification)
  assert.deepEqual(rejected.decision.classes, ['standard'])
  assert.equal(rejected.decision.by, production.id)
  const afterDecline = await h.invariant()
  for (const key of ['workOrders', 'scheduleBookings', 'movements', 'positions', 'reservations', 'approvalSignatures'])
    assert.deepEqual(afterDecline[key], beforeDecline[key], 'Declining a fresh finite review changes no business effect: ' + key)
  await h.invariant()
})

test('AGENT-001 supplier slip and breakdown continuously compute two material-feasible alternate plans, bind human selection, preserve the ship date and restore inert evidence', async t => {
  const h = await installation({ now: '2026-10-25T12:00:00.000Z' }); t.after(() => h.close())
  const w = await workshop(h), owner = (await h.state()).actor
  const planner = await h.person('recovery-planner@example.test', 'planner'), reviewer = await h.person('recovery-reviewer@example.test', 'production'), agent = await h.person('recovery-agent@example.test', 'agent')
  const { names, order, job, po } = await recoveryFixture(h, w, planner)
  const slip = await h.send('po.revise', { poId: po.id, version: po.version, expectedDate: '2026-11-26', note: 'Supplier reports one day late' })
  assert.equal(slip.body.ok, true)
  const currentPlan = async commandId => (await h.state()).schedulePlans.find(p => p.event?.commandId === commandId)
  const first = await currentPlan(slip.commandId)
  const proveOptions = plan => {
    assert.equal(plan.recoveryOptions.length, 2)
    assert.deepEqual(plan.recoverySearch.sources.purchaseOrderIds, [po.id])
    assert.ok(plan.recoverySearch.sources.demandIds.includes(order.id))
    assert.deepEqual(plan.recoverySearch.sources.workOrderIds, [job.id])
    assert.notEqual(plan.recoveryOptions[0].movedOperations[0].machineId, plan.recoveryOptions[1].movedOperations[0].machineId)
    for (const option of plan.recoveryOptions) {
      const classification = option.classification
      assert.deepEqual([classification.action, classification.classes, classification.effect, classification.inputDigest], ['compare', ['standard'], 'informational', plan.inputDigest])
      assert.match(classification.optionDigest, /^[a-f0-9]{64}$/)
      assert.equal(classification.optionId, option.id)
      const facts = classification.facts
      assert.equal(facts.estimatedCostUsd, option.planningCostUsd)
      assert.match(facts.costBasis, /estimate only/)
      assert.deepEqual([facts.cashExposureUsd, facts.purchasingSpendUsd, facts.customerCommitmentsChanged, facts.outbound, facts.stockChanged, facts.executionAssignmentsChanged], ['0', '0', false, false, false, false])
      assert.deepEqual(facts.displacement, option.effects)
      assert.deepEqual(facts.unchangedPromises, option.promiseEffects)
      assert.deepEqual(facts.changes, option.changes)
      assert.equal(option.feasible, true); assert.equal(option.changedPromiseCount, 0)
      assert.equal(option.after.unscheduled.length, 0)
      const op = option.after.operations.find(o => o.workOrderId === job.id)
      const classified = facts.operations.find(o => o.key === op.key)
      assert.deepEqual([classified.workOrderId, classified.machineId, classified.operatorId, classified.intervals, classified.position, classified.requiredSkills, classified.qualifiedPersonRole], [job.id, op.machineId, owner.id, op.intervals, option.sequence.find(o => o.key === op.key).position, ['recovery cutting'], 'owner'])
      assert.ok(names.slice(1).includes(op.machine)); assert.equal(op.operatorId, owner.id)
      assert.ok(op.startsAt >= '2026-11-26T00:00:00.000Z'); assert.ok(op.endsAt <= order.promiseDate + 'T23:59:59.999Z')
      assert.deepEqual(option.sequence.find(o => o.key === op.key).intervals, op.intervals)
      const promise = option.promiseEffects.find(p => p.orderId === order.id)
      assert.deepEqual([promise.beforeDate, promise.afterDate, promise.feasible], [order.promiseDate, order.promiseDate, true])
      assert.ok(option.effects.some(e => e.workOrderId === job.id)); assert.notEqual(option.planningCostUsd, null)
    }
  }
  proveOptions(first)
  // A real breakdown following the supplier event must retain that same material-ready date.
  const stopped = await h.send('maintenance.create', { workCentre: names[0], kind: 'breakdown', expectedReturnAt: '2026-11-30T00:00:00Z', repairOwner: 'Machine supervisor', note: 'Primary spindle stopped' })
  assert.equal(stopped.body.ok, true)
  const second = await currentPlan(stopped.commandId); proveOptions(second)
  assert.ok(second.recoverySearch.sources.maintenanceIds.includes(stopped.body.result.id))
  const refusalBaseline = await recoveryBusiness(h), outboundBefore = h.outboundCount()
  await reviewer.run('schedule.adopt', { planId: first.id, version: first.version, optionId: first.recoveryOptions[0].id, reason: 'Old ETA event comparison' }, { error: 'STALE' })
  const adopt = (who, optionId, more = {}, error) => who.run('schedule.adopt', { planId: second.id, version: second.version, optionId, reason: 'Exact alternate comparison reviewed', ...more }, error && { error })
  await adopt(agent, second.recoveryOptions[0].id, {}, 'FORBIDDEN')
  await adopt(reviewer, 'not-a-retained-option', {}, 'INPUT')
  for (const forged of [{ classification: second.recoveryOptions[0].classification }, { decisionClassification: { classes: ['standard'] } }, { personDecision: { actorId: owner.id } }, { optionDigest: 'synthetic-larder-822' }, { override: { classification: { classes: [] } } }]) await adopt(reviewer, second.recoveryOptions[0].id, forged, 'AUTHORITY')
  assert.deepEqual(await recoveryBusiness(h), refusalBaseline, 'Forged, unauthorized and stale decisions leave every business record and booking unchanged')
  assert.equal(h.outboundCount(), outboundBefore)
  // Both signatures must name the same option. Signing another option cannot spend the first signature.
  await h.command('approval.policy', { category: 'schedule', thresholdMinutes: 0, signatures: 2, reason: 'Independent exact option signatures' })
  const signatureA = await adopt(planner, second.recoveryOptions[0].id)
  assert.equal(signatureA.remainingAtSigning, 1)
  assert.deepEqual(signatureA.terms.classification.classes, ['standard'])
  assert.equal(signatureA.terms.optionDigest, second.recoveryOptions[0].classification.optionDigest)
  assert.equal(signatureA.terms.classification.inputDigest, second.inputDigest)
  const signatureB = await adopt(reviewer, second.recoveryOptions[1].id)
  assert.equal(signatureB.remainingAtSigning, 1)
  assert.equal((await h.state()).scheduleBookings.length, 0)
  const before = await h.state(), decisionPayload = { planId: second.id, version: second.version, optionId: second.recoveryOptions[1].id, reason: 'Exact alternate comparison reviewed' }, decisionCommand = 'synthetic-larder-823-adopt'
  const done = await planner.run('schedule.adopt', decisionPayload, { commandId: decisionCommand })
  assert.equal(done.status, 'adopted'); assert.equal(done.selectedOptionId, second.recoveryOptions[1].id)
  assert.deepEqual(done.signatureIds, [signatureB.id, (await h.state()).approvalSignatures.find(s => s.subjectId === done.id && s.signerId === planner.id && s.terms.optionId === done.selectedOptionId).id])
  const after = await h.state(), chosen = second.recoveryOptions[1]
  assert.deepEqual(done.decisionClassification, { ...chosen.classification, action: 'adopt', effect: 'reversible-internal-sequencing' })
  assert.deepEqual(done.personDecision, { kind: 'person', actorId: planner.id, role: 'planner', commandId: decisionCommand, at: '2026-10-25T12:00:00.000Z' })
  assert.equal(done.decidedBy, planner.id)
  assert.deepEqual(after.scheduleBookings.find(b => b.id === done.bookingId).classification, done.decisionClassification)
  const replayBaseline = await recoveryBusiness(h)
  assert.deepEqual(await planner.run('schedule.adopt', decisionPayload, { commandId: decisionCommand }), done)
  assert.deepEqual(await recoveryBusiness(h), replayBaseline, 'An identical decision replay adds no booking, signature or business effect')
  await planner.run('schedule.adopt', { ...decisionPayload, optionId: second.recoveryOptions[0].id }, { commandId: decisionCommand, error: 'IDEMPOTENCY' })
  assert.deepEqual(await recoveryBusiness(h), replayBaseline)
  assert.equal(h.outboundCount(), outboundBefore)
  assert.deepEqual(after.scheduleBookings.find(b => b.id === done.bookingId).operations, chosen.after.operations)
  assert.deepEqual(after.workOrders.find(j => j.id === job.id).scheduleChoices, chosen.changes[0].scheduleChoices)
  for (const key of ['salesOrders', 'movements', 'reservations', 'purchaseOrders']) assert.deepEqual(after[key], before[key])
  const calendarBefore = after.machineCalendars.find(m => m.name === names[1])
  const capacityEvent = await h.send('capacity.machine', { ...calendarBefore, reason: 'Re-read current demand and material sources after a capacity change' })
  assert.equal(capacityEvent.body.ok, true)
  const currentRecovery = (await h.state()).schedulePlans.find(p => p.event?.commandId === capacityEvent.commandId)
  assert.equal(currentRecovery.automation.status, 'review'); assert.ok(currentRecovery.recoverySearch.sources.demandIds.includes(order.id))
  assert.equal((await h.state()).scheduleBookings.length, after.scheduleBookings.length)
  const rejectionBaseline = await h.state()
  const rejected = await reviewer.run('schedule.reject', { planId: currentRecovery.id, version: currentRecovery.version, reason: 'synthetic-larder-834 retain the adopted intervals' })
  assert.deepEqual(rejected.decisionClassification, { action: 'reject', classes: ['standard'], effect: 'informational', inputDigest: currentRecovery.inputDigest, options: currentRecovery.recoveryOptions.map(o => ({ ...o.classification, action: 'reject' })) })
  assert.deepEqual([rejected.status, rejected.decidedBy, rejected.personDecision.actorId], ['rejected', reviewer.id, reviewer.id])
  for (const key of ['scheduleBookings', 'workOrders', 'machineCalendars', 'laborCalendars', 'salesOrders', 'purchaseOrders', 'movements', 'reservations']) assert.deepEqual((await h.state())[key], rejectionBaseline[key], key)
  const currentOrder = (await h.state()).salesOrders.find(o => o.id === order.id)
  const cancellation = await h.send('so.cancelLine', { orderId: order.id, version: currentOrder.version, lineId: currentOrder.lines[0].id, quantity: '1', customerApproval: { name: 'synthetic-larder-814 customer', reference: 'synthetic-larder-814 confirmed quantity', approvedOn: '2026-10-25' }, reason: 'Re-read changed approved demand' })
  assert.equal(cancellation.body.ok, true, JSON.stringify(cancellation.body.error))
  assert.equal((await h.state()).schedulePlans.find(p => p.event?.commandId === cancellation.commandId).automation.status, 'review')
  assert.equal((await h.state()).scheduleBookings.length, after.scheduleBookings.length)
  await h.restart(); assert.equal((await h.state()).schedulePlans.filter(p => p.event?.commandId === stopped.commandId).length, 1)
  const archive = await (await h.request('/api/larder/archive')).json()
  const csv = await (await h.request('/api/larder/archive.csv')).text(); assert.ok(csv.includes('recoveryOptions')); assert.ok(csv.includes('selectedOptionId'))
  const target = await installation(); t.after(() => target.close())
  assert.equal((await target.request('/api/larder/archive/restore', { method: 'POST', body: archive })).status, 200)
  const restored = await (await target.request('/api/larder/archive')).json()
  assert.deepEqual(restored.records.schedulePlans, archive.records.schedulePlans)
  assert.deepEqual(restored.records.scheduleBookings, archive.records.scheduleBookings)
  assert.deepEqual(restored.movements, archive.movements)
  await h.invariant(); await target.invariant()
})
