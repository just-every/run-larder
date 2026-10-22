// GOV-008: quality-hold, nonconformance and deviation releases honour the owner's quality threshold.
import test from 'node:test'
import assert from 'node:assert/strict'
import { installation, evidence } from './harness.mjs'

const today = new Date().toISOString().slice(0, 10)

test('GOV-008 quality-hold, nonconformance and deviation releases under a two-signature quality threshold need independent signatures on exact terms, invalidate when the held quantity changes and take the named owner override', async t => {
  const h = await installation(); t.after(() => h.close())
  const person = (name, role) => h.person(`gov8-${name}@example.test`, role)
  const mgr = await person('mgr', 'manager'), opener = await person('opener', 'quality'), qA = await person('a', 'quality'), qB = await person('b', 'quality'), agent = await person('agent', 'agent')
  const location = await h.command('location.save', { name: 'Quality shelf' })
  const item = await h.command('item.save', { sku: 'GOV8-PLATE', name: 'Release plate', kind: 'buy', baseUnit: 'each' })
  const supplier = await h.command('party.save', { name: 'Plate supplier', kind: 'supplier' })
  let po = await h.command('po.draft', { supplierId: supplier.id, expectedDate: today, reason: 'Held plates', lines: [{ itemId: item.id, quantity: '40', unitPrice: '10' }] })
  po = await h.command('po.approve', { poId: po.id, version: po.version })
  const codes = ['HOLD', 'HOLD-OVERRIDE', 'CASE', 'DEVIATION']
  await h.command('receipt.create', { poId: po.id, supplierReference: 'synthetic-larder-31', lines: codes.map(code => ({ lineId: po.lines[0].id, locationId: location.id, quantity: '10', lot: `GOV8-${code}` })) })
  const state = () => h.state(), lots = Object.fromEntries((await state()).lots.map(l => [l.code.replace('GOV8-', ''), l.id]))
  let plan = await h.command('quality.plan.save', { itemId: item.id, stage: 'receipt', name: 'Plate finish', sampleSize: 1, measurements: [{ name: 'Roughness', unit: 'um', target: '1', lower: '0', upper: '2' }] })
  plan = await h.command('quality.plan.approve', { planId: plan.id, version: plan.version })
  await h.command('approval.policy', { category: 'quality', thresholdUsd: '15', signatures: 2, expiryMinutes: 60, reason: 'Two people release held stock above $15' })
  const override = (reason = 'Customer line is stopped') => ({ reason, accountableId: mgr.id })
  const signature = async id => (await state()).approvalSignatures.find(x => x.id === id)
  const available = async lotId => (await state()).positions.find(p => p.lotId === lotId && p.status === 'available')?.quantity ?? '0'
  const inspect = (who, body, value) => who.run('quality.inspect', { planId: plan.id, planVersion: plan.version, ...body, samples: { Roughness: [value] } })
  const reject = async (caseId, quantity) => { const n = (await state()).nonconformances.find(x => x.id === caseId); return mgr.run('nonconformance.reject', { caseId, version: n.version, quantity, reason: 'Scrap the cracked unit', evidence: [evidence('Scrap record')] }) }

  // Quality hold: the manager who recorded the failure, an agent and any non-quality role cannot release.
  await inspect(mgr, { lotId: lots.HOLD }, '3'); await inspect(mgr, { lotId: lots.HOLD }, '1')
  const hold = (await state()).qualityHolds.find(x => x.subjectId === lots.HOLD)
  const releaseHold = (who, more = {}, error) => who.run('quality.release', { holdId: hold.id, version: hold.version, reason: 'Retest passed', evidence: [evidence('Retest record')], ...more }, error && { error })
  await releaseHold(agent, {}, 'FORBIDDEN'); await releaseHold(mgr, {}, 'FORBIDDEN'); await releaseHold(qA, { override: override() }, 'FORBIDDEN')
  const first = await releaseHold(qA)
  assert.deepEqual([first.category, first.valueUsd, first.remainingAtSigning], ['quality', '100', 1])
  assert.equal((await state()).qualityHolds.find(x => x.id === hold.id).status, 'open')
  // Rejecting four held units changes the quantity the signature saw.
  await mgr.run('quarantine.decide', { itemId: item.id, locationId: location.id, lotId: lots.HOLD, quantity: '4', decision: 'reject', reason: 'Out of tolerance' })
  assert.equal((await signature(first.id)).status, 'invalidated')
  assert.equal((await releaseHold(qA)).valueUsd, '60')
  await releaseHold(qA, {}, 'DUPLICATE_SIGNATURE')
  const released = await releaseHold(qB)
  assert.deepEqual([released.status, released.release.signatureIds.length, await available(lots.HOLD)], ['released', 2, '6'])
  // The owner overrides a second hold, naming the accountable manager.
  await inspect(mgr, { lotId: lots['HOLD-OVERRIDE'] }, '3'); await inspect(mgr, { lotId: lots['HOLD-OVERRIDE'] }, '1')
  const second = (await state()).qualityHolds.find(x => x.subjectId === lots['HOLD-OVERRIDE'])
  const overridden = await h.command('quality.release', { holdId: second.id, version: second.version, reason: 'Retest passed', evidence: [evidence('Retest record')], override: override() })
  assert.deepEqual([overridden.release.override.accountableId, overridden.release.signatureIds.length, await available(lots['HOLD-OVERRIDE'])], [mgr.id, 1, '10'])

  // Nonconformance: the opener, the failure recorder and an agent cannot release; two quality people sign the exact quantity and inspection.
  let n = await opener.run('nonconformance.open', { lotId: lots.CASE, locationId: location.id, quantity: '6', complaint: 'Cracked plates', dueOn: today, evidence: [evidence('Complaint')] })
  await inspect(mgr, { nonconformanceId: n.id, quantity: '6' }, '3')
  let passed = await inspect(mgr, { nonconformanceId: n.id, quantity: '3' }, '1')
  const releaseCase = async (who, more = {}, error) => { const c = (await state()).nonconformances.find(x => x.id === n.id); return who.run('nonconformance.release', { caseId: n.id, version: c.version, quantity: '3', reason: 'Three plates passed', evidence: [evidence('Signed disposition')], inspectionId: passed.id, ...more }, error && { error }) }
  await releaseCase(agent, {}, 'FORBIDDEN'); await releaseCase(opener, {}, 'FORBIDDEN'); await releaseCase(mgr, {}, 'FORBIDDEN')
  const pending = await releaseCase(qA)
  assert.deepEqual([pending.valueUsd, pending.remainingAtSigning, pending.terms.quantity], ['30', 1, '3'])
  await reject(n.id, '1')
  assert.equal((await signature(pending.id)).status, 'invalidated')
  await releaseCase(qA, {}, 'RETEST')
  passed = await inspect(mgr, { nonconformanceId: n.id, quantity: '3' }, '1')
  await releaseCase(qA)
  n = await releaseCase(qB)
  assert.deepEqual([n.remaining, n.decisions.at(-1).decision, n.decisions.at(-1).signatureIds.length, await available(lots.CASE)], ['2', 'release', 2, '7'])
  const rest = await inspect(mgr, { nonconformanceId: n.id, quantity: '2' }, '1')
  n = await h.command('nonconformance.release', { caseId: n.id, version: n.version, quantity: '2', reason: 'Last plates passed', evidence: [evidence('Signed disposition')], inspectionId: rest.id, override: override() })
  assert.deepEqual([n.remaining, n.decisions.at(-1).override.accountableId, n.decisions.at(-1).signatureIds.length], ['0', mgr.id, 1])

  // Deviation: the proposer, opener, agent and non-quality roles cannot approve; a changed held quantity voids the signature and stales the proposal.
  n = await opener.run('nonconformance.open', { lotId: lots.DEVIATION, locationId: location.id, quantity: '8', complaint: 'Finish outside specification', dueOn: today, evidence: [evidence('Complaint')] })
  await inspect(mgr, { nonconformanceId: n.id, quantity: '8' }, '3')
  const propose = async quantity => { const c = (await state()).nonconformances.find(x => x.id === n.id); return (await mgr.run('nonconformance.deviation.propose', { caseId: n.id, version: c.version, quantity, reason: 'Fit for intended use', evidence: [evidence('Engineering assessment')] })).deviationProposals.at(-1) }
  const approve = async (who, d, more = {}, error) => { const c = (await state()).nonconformances.find(x => x.id === n.id); return who.run('nonconformance.deviation.approve', { caseId: n.id, version: c.version, deviationId: d.id, note: 'Use as is', ...more }, error && { error }) }
  const dA = await propose('4')
  await approve(agent, dA, {}, 'FORBIDDEN'); await approve(mgr, dA, {}, 'FORBIDDEN'); await approve(opener, dA, {}, 'FORBIDDEN')
  const sig = await approve(qA, dA)
  assert.deepEqual([sig.category, sig.valueUsd, sig.remainingAtSigning, sig.terms.decision], ['quality', '40', 1, 'deviation'])
  await reject(n.id, '1')
  assert.equal((await signature(sig.id)).status, 'invalidated')
  await approve(qB, dA, {}, 'STALE_INPUTS')
  const dB = await propose('4')
  await approve(qA, dB)
  n = await approve(qB, dB)
  assert.deepEqual([n.deviationProposals.at(-1).status, n.deviationProposals.at(-1).signatureIds.length], ['approved; not yet released', 2])
  n = await qA.run('nonconformance.deviation.execute', { caseId: n.id, version: n.version, deviationId: dB.id })
  assert.deepEqual([n.remaining, await available(lots.DEVIATION)], ['3', '6'])
  const dC = await propose('3')
  n = await approve({ run: h.command }, dC, { override: override() })
  assert.deepEqual([n.deviationProposals.at(-1).status, n.deviationProposals.at(-1).override.accountableId, n.deviationProposals.at(-1).signatureIds.length], ['approved; not yet released', mgr.id, 1])
  await h.invariant()
})
