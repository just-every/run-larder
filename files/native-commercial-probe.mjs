import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const { installation, workshop } = await import(pathToFileURL(resolve('tests/api/harness.mjs')))
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const h = await installation({ now: '2026-10-29T12:00:00.000Z' })
let restored
const observations = []
const observe = (point, input, output) => observations.push({ clause: 'SURFACE-003', point, door: 'authenticated HTTP commands and state', input, output })
const snapshot = async () => {
  const archive = await (await h.request('/api/larder/archive')).json()
  delete archive.exportedAt
  return archive
}
try {
  const w = await workshop(h)
  const buyer = await h.person(['synthetic-larder-970', 'example.test'].join('@'), 'buyer')
  const manager = await h.person(['synthetic-larder-971', 'example.test'].join('@'), 'manager')
  const sales = await h.person(['synthetic-larder-972', 'example.test'].join('@'), 'sales')
  await h.command('approval.policy', { category: 'spend', thresholdUsd: '20', signatures: 2, expiryMinutes: 60, reason: 'synthetic-larder-973 independent native approval' })
  const outbound = h.outboundCount()
  const draftInput = { supplierId: w.supplier.id, expectedDate: '2026-11-05', reason: 'synthetic-larder-974', lines: [{ itemId: w.timber.id, quantity: '3.125', unitPrice: '9.876543' }] }
  const draft = await buyer.run('po.draft', draftInput)
  assert.deepEqual(draft.classification.classes, ['standard'])
  assert.equal(draft.classification.facts.terms.amount, '30.864197')
  observe('native preparation', draftInput, draft.classification)
  const payload = { poId: draft.id, version: draft.version }
  const pendingId = 'synthetic-larder-probe-pending'
  const pending = await manager.run('po.approve', payload, { commandId: pendingId })
  assert.equal(pending.classification.effect, 'pending')
  assert.deepEqual(pending.classification.classes, ['standard'])
  assert.equal((await h.state()).purchaseOrders.find(p => p.id === draft.id).status, 'draft')
  observe('pending signature', payload, pending.classification)
  const refusedBaseline = await snapshot()
  for (const forged of [{ classes: ['standard'] }, { actionClasses: ['money'] }, { classification: pending.classification }, { signerId: manager.id }])
    await manager.run('po.approve', { ...payload, ...forged }, { error: 'INPUT' })
  await buyer.run('po.approve', payload, { error: 'FORBIDDEN' })
  assert.deepEqual(await snapshot(), refusedBaseline)
  observe('unsafe refusal', 'supplied classes and preparer approval', { forged: 'INPUT', preparer: 'FORBIDDEN', unchanged: true })
  const appliedId = 'synthetic-larder-probe-applied'
  const applied = await h.command('po.approve', payload, { commandId: appliedId })
  assert.deepEqual(applied.classification.classes, ['money', 'commitment'])
  assert.equal(applied.classification.facts.terms.amount, '30.864197')
  assert.equal(applied.classification.facts.terms.currency, 'USD')
  assert.equal(applied.classification.facts.terms.supplierId, w.supplier.id)
  observe('applied purchase', payload, applied.classification)
  const once = await snapshot()
  assert.deepEqual(await h.command('po.approve', payload, { commandId: appliedId }), applied)
  assert.deepEqual(await manager.run('po.approve', payload, { commandId: pendingId }), pending)
  assert.deepEqual(await snapshot(), once)
  let order = await sales.run('so.quote', { customerId: w.customer.id, currency: 'CAD', usdRate: '0.75', rateDate: '2026-10-28', rateReference: 'synthetic-larder-975', promiseDate: '2026-11-05', lines: [{ itemId: w.board.id, quantity: '2.5', unitPrice: '29.95' }] })
  order = await sales.run('so.confirm', { orderId: order.id, version: order.version, reserve: false })
  const preview = await sales.run('so.changePreview', { orderId: order.id, version: order.version, reason: 'synthetic-larder-976', customerApproval: { name: 'synthetic-larder-977', reference: 'synthetic-larder-978', approvedOn: '2026-10-29' }, lines: [{ lineId: order.lines[0].id, itemId: w.board.id, quantity: '3.125', unitPrice: '31.125', schedules: [{ quantity: '3.125', date: '2026-11-12' }] }] })
  assert.deepEqual(preview.classification.classes, ['standard'])
  const changePayload = { previewId: preview.id, version: preview.version }, changeId = 'synthetic-larder-probe-amendment'
  const amended = await sales.run('so.changeApprove', changePayload, { commandId: changeId })
  assert.deepEqual(amended.classification.classes, ['commitment'])
  const terms = amended.classification.facts.terms
  assert.deepEqual([terms.currency, terms.beforeValue, terms.afterValue], ['CAD', '74.875', '97.265625'])
  assert.deepEqual([terms.before.commercialRevision, terms.after.commercialRevision], [1, 2])
  assert.equal(terms.after.promiseDate, '2026-11-12')
  assert.equal(amended.classification.actor.id, sales.id)
  for (const result of [draft, applied, amended])
    for (const flag of ['providerCharge', 'paymentPosted', 'providerAcceptance', 'externalDelivery', 'audienceChanged']) assert.equal(result.classification.facts[flag], false)
  assert.equal(h.outboundCount(), outbound)
  observe('applied amendment and boundary', changePayload, amended.classification)
  const stale = await sales.run('so.changePreview', { orderId: amended.id, version: amended.version, reason: 'synthetic-larder-979', customerApproval: { name: 'synthetic-larder-977', reference: 'synthetic-larder-978', approvedOn: '2026-10-29' }, lines: [{ lineId: amended.lines[0].id, itemId: w.board.id, quantity: '3.125', unitPrice: '31.125', schedules: [{ quantity: '3.125', date: '2026-11-13' }] }] })
  await h.command('location.save', { name: 'synthetic-larder-980' })
  const staleBaseline = await snapshot()
  await sales.run('so.changeApprove', { previewId: stale.id, version: stale.version }, { error: 'STALE' })
  assert.deepEqual(await snapshot(), staleBaseline)
  observe('stale amendment', { previewId: stale.id, version: stale.version }, { code: 'STALE', unchanged: true })
  await h.command('member.scope', { operatorId: sales.id, locations: null, costsRestricted: true })
  const restricted = await sales.run('so.changeApprove', changePayload, { commandId: changeId })
  assert.equal(restricted.classification.facts.terms.beforeValue, 'restricted')
  assert.equal(restricted.classification.facts.terms.afterValue, 'restricted')
  assert.equal(restricted.classification.facts.terms.after.lines[0].unitPrice, 'restricted')
  observe('current replay redaction', changePayload, restricted.classification)
  await h.restart()
  assert.deepEqual((await h.state()).salesOrders.find(o => o.id === order.id).classification, amended.classification)
  const archive = await (await h.request('/api/larder/archive')).json()
  restored = await installation({ now: '2026-10-29T12:00:00.000Z' })
  const restore = await restored.request('/api/larder/archive/restore', { method: 'POST', body: archive })
  assert.equal(restore.status, 200)
  const retained = await restored.invariant()
  assert.deepEqual(retained.salesOrders.find(o => o.id === order.id).classification, amended.classification)
  assert.deepEqual(retained.purchaseOrders.find(p => p.id === draft.id).classification, applied.classification)
  assert.equal(retained.orderChanges.find(p => p.id === stale.id).status, 'preview')
  assert.equal(retained.movements.length, archive.movements.length)
  assert.equal(restored.outboundCount(), 0)
  observe('restart and inert restore', 'business archive restore', { classificationsRetained: true, originalActorRetained: sales.id, pendingPreview: true, outbound: 0 })
  const receipt = { schema: 1, head, status: 'passed', observations }
  await writeFile(process.argv[2], JSON.stringify(receipt, null, 2) + '\n')
  for (const row of observations) console.log('PROBE ' + row.clause + ' ' + row.point + ': ' + JSON.stringify({ door: row.door, input: row.input, output: row.output }))
} finally {
  await restored?.close()
  await h.close()
}
