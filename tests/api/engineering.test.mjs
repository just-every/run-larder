import test from 'node:test'
import assert from 'node:assert/strict'
import { installation, evidence, workshop } from './harness.mjs'
const today = () => new Date().toISOString().slice(0, 10)
const tomorrow = () => new Date(Date.parse(today() + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)

test('ENG-005 safety replacement review, eligibility/evidence, effectivity, stock disposition, draft treatment, acknowledgment and immutable released revisions', async t => {
  const h = await installation(); t.after(() => h.close())
  const engineer = await h.person('engineer@example.test', 'production'), manager = await h.person('manager@example.test', 'manager'), agent = await h.person('agent@example.test', 'agent')
  const raw = await h.command('item.save', { sku: 'OLD', name: 'Original fastener', kind: 'buy', baseUnit: 'each' })
  const replacement = await h.command('item.save', { sku: 'SAFE', name: 'Rated replacement fastener', kind: 'buy', baseUnit: 'each' })
  const product = await h.command('item.save', { sku: 'BRACKET', name: 'Safety bracket', kind: 'make', baseUnit: 'each' })
  const parent = await h.command('item.save', { sku: 'FRAME', name: 'Phantom bracket frame', kind: 'make', baseUnit: 'each' })
  const loc = await h.command('location.save', { name: 'Fastener shelf' })
  const source = await h.command('bom.revise', { itemId: product.id, components: [{ itemId: raw.id, quantity: '2' }], routing: [{ name: 'Fasten', workCentre: 'Bench', minutes: 2, instructions: 'Fit original fastener', drawings: [evidence('Original drawing')] }] })
  await h.command('bom.revise', { itemId: parent.id, components: [{ itemId: product.id, quantity: '2', supply: 'phantom' }] })
  await h.command('opening.record', { locationId: loc.id, countedOn: today(), countedBy: 'Olive', valuationBasis: 'owner-estimate', evidence: evidence(), lines: [{ itemId: raw.id, quantity: '20', unitCost: '1' }, { itemId: replacement.id, quantity: '20', unitCost: '2' }] })
  const draft = async (itemId = product.id) => h.command('wo.draft', { itemId, quantity: '2', requiredBy: tomorrow(), reason: 'Customer bracket production' })
  let released = await draft(); released = await h.command('wo.release', { workOrderId: released.id, version: released.version })
  const keep = await draft(), adopt = await draft(), cancel = await draft(), phantom = await draft(parent.id)
  const payload = {
    itemId: product.id, sourceBomId: source.id, safety: true, reason: 'Replace failed fastener with tested rated part', effectiveOn: tomorrow(),
    components: [{ itemId: replacement.id, quantity: '3' }],
    routing: [{ name: 'Fasten', workCentre: 'Bench', minutes: 3, instructions: 'Fit rated fastener and torque', drawings: [evidence('Rated fastener drawing')] }],
    attachments: [evidence('Independent load-test report')], substitutes: [{ fromItemId: raw.id, toItemId: replacement.id, reason: 'Load test at required shear rating passed' }],
    dispositions: [{ itemId: raw.id, locationId: loc.id, lotId: '', status: 'available', quantity: '20', action: 'retain', reason: 'Retain for already released work only' }],
    workTreatments: [keep, adopt, cancel, phantom].map((w, index) => ({ workOrderId: w.id, version: w.version, action: ['keep', 'adopt', 'cancel', 'adopt'][index], reason: 'Reviewed customer disposition' })),
  }
  await agent.run('engineering.propose', payload, { error: 'FORBIDDEN' })
  await engineer.run('engineering.propose', { ...payload, dispositions: [] }, { error: 'INPUT' })
  await engineer.run('engineering.propose', { ...payload, substitutes: [{ fromItemId: raw.id, toItemId: product.id, reason: 'Invalid' }] }, { error: 'INPUT' })
  await engineer.run('engineering.propose', { ...payload, workTreatments: payload.workTreatments.slice(0, 3) }, { error: 'INPUT' })
  let change = await engineer.run('engineering.propose', payload)
  let state = await h.state()
  assert.equal(state.boms.filter(b => b.itemId === product.id).length, 1)
  assert.deepEqual(change.sourceBom, source)
  assert.ok(change.impact.openWork.some(w => w.id === released.id && w.status === 'released'))
  assert.ok(change.impact.openWork.some(w => w.id === phantom.id))
  assert.equal(await (await h.request('/api/larder/attachments/' + change.attachments[0].id)).text(), 'Independent load-test report')
  assert.equal(await (await h.request('/api/larder/attachments/' + change.prospectiveBom.routing[0].drawings[0].id)).text(), 'Rated fastener drawing')
  await h.command('wo.release', { workOrderId: adopt.id, version: adopt.version }, { error: 'ENGINEERING_REVIEW' })
  await h.command('wo.release', { workOrderId: phantom.id, version: phantom.version }, { error: 'ENGINEERING_REVIEW' })
  await h.command('bom.revise', { itemId: product.id, components: [{ itemId: replacement.id, quantity: '1' }] }, { error: 'ENGINEERING_REVIEW' })
  await agent.run('engineering.approve', { changeId: change.id, version: change.version }, { error: 'FORBIDDEN' })
  await engineer.run('engineering.approve', { changeId: change.id, version: change.version }, { error: 'FORBIDDEN' })
  const before = await h.state(), identity = crypto.randomUUID(), decision = { changeId: change.id, version: change.version }
  change = await manager.run('engineering.approve', decision, { commandId: identity })
  assert.deepEqual(await manager.run('engineering.approve', decision, { commandId: identity }), change)
  state = await h.invariant()
  assert.deepEqual(state.movements, before.movements)
  assert.deepEqual(state.reservations, before.reservations)
  assert.deepEqual(state.workOrders.find(w => w.id === released.id), released)
  assert.equal(state.workOrders.find(w => w.id === cancel.id).status, 'cancelled')
  assert.equal(state.workOrders.find(w => w.id === keep.id).engineeringBomIds[product.id], source.id)
  assert.equal(state.workOrders.find(w => w.id === phantom.id).engineeringBomIds[product.id], change.bomId)
  assert.equal(change.approvedBom.effectiveOn, tomorrow())
  assert.deepEqual(change.approvedBom.routing, change.prospectiveBom.routing)
  await engineer.run('wo.release', { workOrderId: keep.id, version: state.workOrders.find(w => w.id === keep.id).version }, { error: 'ENGINEERING_ACK' })
  await agent.run('engineering.acknowledge', { changeId: change.id, version: change.version, note: 'Unauthorized' }, { error: 'FORBIDDEN' })
  await engineer.run('engineering.acknowledge', { changeId: change.id, version: change.version, bomId: source.id, note: 'Wrong revision' }, { error: 'STALE' })
  const approvedSnapshot = structuredClone(change)
  change = await engineer.run('engineering.acknowledge', { changeId: change.id, version: change.version, bomId: change.bomId, note: 'Instructions and dispositions read' })
  assert.equal(change.acknowledgments[0].actorId, engineer.id)
  assert.equal(change.acknowledgments[0].approvedVersion, approvedSnapshot.approvedVersion)
  for (const field of ['sourceBom', 'prospectiveBom', 'approvedBom', 'dispositions', 'workTreatments', 'substitutes', 'approvedAt', 'approvedBy']) assert.deepEqual(change[field], approvedSnapshot[field])
  state = await h.state()
  const kept = await engineer.run('wo.release', { workOrderId: keep.id, version: state.workOrders.find(w => w.id === keep.id).version })
  assert.equal(kept.bomId, source.id); assert.equal(kept.components[0].itemId, raw.id)
  await engineer.run('wo.release', { workOrderId: adopt.id, version: state.workOrders.find(w => w.id === adopt.id).version }, { error: 'EFFECTIVITY' })
  await engineer.run('wo.release', { workOrderId: phantom.id, version: state.workOrders.find(w => w.id === phantom.id).version }, { error: 'EFFECTIVITY' })
  // A second, immediately effective review proves adoption and the inherited
  // instruction/drawing acknowledgment at the operation door.
  const keepAgain = await h.command('wo.draft', { itemId: product.id, quantity: '12', requiredBy: tomorrow(), reason: 'Retain prior recipe pending production' })
  const affected = (await h.state()).workOrders.filter(w => [adopt.id, phantom.id, keepAgain.id].includes(w.id))
  let immediate = await engineer.run('engineering.propose', { ...payload, effectiveOn: today(), workTreatments: affected.map(w => ({ workOrderId: w.id, version: w.version, action: w.id === keepAgain.id ? 'keep' : 'adopt', reason: 'Approved immediate containment' })) })
  immediate = await manager.run('engineering.approve', { changeId: immediate.id, version: immediate.version })
  immediate = await engineer.run('engineering.acknowledge', { changeId: immediate.id, version: immediate.version, bomId: immediate.bomId, note: 'Immediate safe instructions read' })
  state = await h.state()
  assert.equal(state.orderStatuses.work.find(w => w.id === keepAgain.id).lines[0].itemId, raw.id, 'Reviewed keep treatment must guide planning before release')
  assert.equal(state.shortages.find(x => x.itemId === raw.id).shortage, '12')
  assert.ok(state.shortages.find(x => x.itemId === raw.id).pegs.some(p => p.documentId === keepAgain.id && p.quantity === '24'))
  const adopted = await engineer.run('wo.release', { workOrderId: adopt.id, version: state.workOrders.find(w => w.id === adopt.id).version })
  assert.equal(adopted.bomId, immediate.bomId); assert.equal(adopted.components[0].itemId, replacement.id); assert.equal(adopted.components[0].required, '6')
  const parentWork = await engineer.run('wo.release', { workOrderId: phantom.id, version: state.workOrders.find(w => w.id === phantom.id).version })
  assert.equal(parentWork.components[0].itemId, replacement.id); assert.equal(parentWork.components[0].required, '12')
  assert.ok(parentWork.bomRevisions.some(b => b.bomId === immediate.bomId))
  await engineer.run('wo.operation.start', { workOrderId: adopted.id, version: adopted.version, sequence: 1, workCentre: 'Bench' }, { error: 'ACKNOWLEDGMENT' })
  assert.equal(adopted.operationStates[0].acknowledgments.length, 0)
  const archive = await (await h.request('/api/larder/archive')).json()
  assert.deepEqual(archive.records.engineeringChanges, (await h.state()).engineeringChanges)
  const restored = await installation(); t.after(() => restored.close())
  const restore = await restored.request('/api/larder/archive/restore', { method: 'POST', body: archive })
  assert.equal(restore.status, 200, await restore.text())
  assert.deepEqual((await restored.state()).engineeringChanges, archive.records.engineeringChanges)
  assert.equal(await (await restored.request('/api/larder/attachments/' + change.attachments[0].id)).text(), 'Independent load-test report')
  // Manager cannot approve their own proposal; stale review remains immutable
  // and can only be declined, then proposed again against current records.
  const next = await manager.run('engineering.propose', { itemId: product.id, safety: false, reason: 'Routing review', effectiveOn: today(), components: [{ itemId: replacement.id, quantity: '3' }], workTreatments: [{ workOrderId: keepAgain.id, version: state.workOrders.find(w => w.id === keepAgain.id).version, action: 'keep', reason: 'Retain existing reviewed recipe' }], dispositions: [] })
  await manager.run('engineering.approve', { changeId: next.id, version: next.version }, { error: 'FORBIDDEN' })
  await h.command('item.save', { sku: 'OTHER', name: 'Concurrent change', kind: 'buy', baseUnit: 'each' })
  await h.command('engineering.approve', { changeId: next.id, version: next.version }, { error: 'STALE' })
  const declined = await h.command('engineering.decline', { changeId: next.id, version: next.version, reason: 'Refresh changed business state' })
  assert.equal(declined.status, 'declined'); assert.equal(declined.declineReason, 'Refresh changed business state')
})

test('ENG-003 configure two sizes and finishes through the quote, compare the resolved BOM and cost, release both, refuse an invalid choice and keep old work stable after a rule edit', async t => {
  const h = await installation(); t.after(() => h.close())
  const w = await workshop(h), engineer = await h.person('eng3@example.test', 'engineer'), sales = await h.person('sal3@example.test', 'sales'), agent = await h.person('agent3@example.test', 'agent')
  const lacquer = await h.command('item.save', { sku: 'LAC-1L', name: 'Board lacquer', kind: 'buy', baseUnit: 'l', standardCost: '12' })
  await h.command('opening.record', { locationId: w.loc.id, countedOn: '2026-10-01', valuationBasis: 'supplier-invoice', countedBy: 'Olive', evidence: evidence(), lines: [{ itemId: lacquer.id, quantity: '5', unitCost: '12' }] })
  const model = {
    itemId: w.board.id, note: 'Board sizes and finishes',
    attributes: [{ name: 'Size', values: ['Small', 'Large'] }, { name: 'Finish', values: ['Oil', 'Lacquer'] }],
    dimensions: [{ name: 'thickness', unit: 'mm', min: '15', max: '40' }], options: [{ name: 'Engraving' }],
    rules: [
      { name: 'Small blank', when: { Size: 'Small' }, components: [{ itemId: w.timber.id, quantity: '1' }] },
      { name: 'Large blank', when: { Size: 'Large' }, components: [{ itemId: w.timber.id, quantity: '2 * thickness / 20' }] },
      { name: 'Oil finish', when: { Finish: 'Oil' }, components: [{ itemId: w.oil.id, quantity: '0.05' }] },
      { name: 'Lacquer finish', when: { Finish: 'Lacquer' }, components: [{ itemId: lacquer.id, quantity: '0.08' }] },
      { name: 'Plane and cut', routing: [{ name: 'Plane and cut', workCentre: 'Bench', runMinutes: '10 + thickness / 5' }] },
      { name: 'Engraving', when: { Engraving: true }, routing: [{ name: 'Engrave', workCentre: 'Laser', runMinutes: '4' }], cost: '3.5' },
    ],
    invalid: [{ when: { Size: 'Small', Finish: 'Lacquer' }, reason: 'Lacquer is only offered on the Large board.' }],
  }
  // Engineering saves versioned rules; sales and agents cannot, and a formula that cannot run is refused when saved.
  await sales.run('config.save', model, { error: 'FORBIDDEN' }); await agent.run('config.save', model, { error: 'FORBIDDEN' })
  await engineer.run('config.save', { ...model, rules: [{ name: 'Bad', components: [{ itemId: w.timber.id, quantity: 'depth * 2' }] }] }, { error: 'FORMULA' })
  await engineer.run('config.save', { ...model, rules: [{ name: 'Bad', components: [{ itemId: w.timber.id, quantity: '1 / (thickness - thickness)' }] }] }, { error: 'FORMULA' })
  const v1 = await engineer.run('config.save', model)
  assert.deepEqual([v1.revision, v1.status], [1, 'active'])
  const small = { attributes: { Size: 'Small', Finish: 'Oil' }, dimensions: { thickness: '20' }, options: {} }, large = { attributes: { Size: 'Large', Finish: 'Lacquer' }, dimensions: { thickness: '30' }, options: { Engraving: true } }
  const resolve = async (selection, as) => (await h.request(`/api/larder/configurations/resolve?itemId=${w.board.id}&selection=${encodeURIComponent(JSON.stringify(selection))}`, { as })).json()
  // Compare the two resolved BOMs and costs, each figure with the rule and arithmetic behind it.
  const a = await resolve(small), b = await resolve(large)
  assert.deepEqual(a.components.map(l => [l.itemId, l.quantity, l.cost]), [[w.timber.id, '1', '9.5'], [w.oil.id, '0.05', '0.9']])
  assert.deepEqual(b.components.map(l => [l.itemId, l.quantity, l.cost]), [[w.timber.id, '3', '28.5'], [lacquer.id, '0.08', '0.96']])
  assert.deepEqual([a.cost.unit, b.cost.unit, b.cost.extra], ['10.4', '32.96', '3.5'])
  assert.deepEqual([a.routing.map(r => [r.name, r.runMinutes]), b.routing.map(r => [r.name, r.runMinutes])], [[['Plane and cut', 14]], [['Plane and cut', 16], ['Engrave', 4]]])
  assert.match(b.components[0].because[0].formula, /2 \* thickness \/ 20 with thickness = 30 = 3/); assert.equal(b.components[0].because[0].rule, 'Large blank')
  // An invalid combination, a dimension outside its range and an unmade choice are refused through the resolve and quote doors.
  for (const bad of [{ ...small, attributes: { Size: 'Small', Finish: 'Lacquer' } }, { ...small, dimensions: { thickness: '50' } }, { ...small, attributes: { Size: 'Small' } }]) {
    assert.equal((await h.request(`/api/larder/configurations/resolve?itemId=${w.board.id}&selection=${encodeURIComponent(JSON.stringify(bad))}`)).status, 409)
    await sales.run('so.quote', { customerId: w.customer.id, promiseDate: '2026-12-01', lines: [{ itemId: w.board.id, quantity: '1', unitPrice: '99', configuration: { selection: bad } }] }, { error: 'INVALID_CONFIGURATION' })
  }
  assert.equal((await h.state()).salesOrders.length, 0)
  // The quote pins the resolved configuration on each line; both lines confirm and release as their own work.
  const quote = await sales.run('so.quote', { customerId: w.customer.id, promiseDate: '2026-12-01', lines: [{ itemId: w.board.id, quantity: '2', unitPrice: '60', configuration: { selection: small } }, { itemId: w.board.id, quantity: '1', unitPrice: '140', configuration: { selection: large } }] })
  assert.deepEqual(quote.lines.map(l => [l.configuration.revision, l.configuration.cost.unit]), [[1, '10.4'], [1, '32.96']])
  const order = await sales.run('so.confirm', { orderId: quote.id, version: quote.version, reserve: false })
  const drafts = [], released = []
  for (const line of order.lines) {
    const draft = await h.command('wo.draft', { itemId: w.board.id, quantity: line.quantity, requiredBy: '2026-12-01', reason: 'Configured line', orderId: order.id, lineId: line.id })
    assert.equal(draft.configuration.revision, 1); assert.deepEqual(draft.configurationSource, { orderId: order.id, lineId: line.id, reference: order.reference })
    await agent.run('wo.release', { workOrderId: draft.id, version: draft.version }, { error: 'FORBIDDEN' })
    drafts.push(draft); released.push(await h.command('wo.release', { workOrderId: draft.id, version: draft.version }))
  }
  const [wo1, wo2] = released
  assert.deepEqual(wo1.components.map(l => [l.itemId, l.required]), [[w.timber.id, '2'], [w.oil.id, '0.1']])
  assert.deepEqual(wo2.components.map(l => [l.itemId, l.required]), [[w.timber.id, '3'], [lacquer.id, '0.08']])
  assert.deepEqual([wo1.routing.length, wo2.routing.map(r => r.name), wo1.standardUnitCost, wo2.standardUnitCost, wo1.bomRevision], [1, ['Plane and cut', 'Engrave'], '10.4', '32.96', null])
  // A rule edit makes a new revision for new quotes and leaves the old quote and released work exactly as they were.
  const v2 = await engineer.run('config.save', { ...model, note: 'Large boards use a fixed 4 blanks', rules: model.rules.map(r => r.name === 'Large blank' ? { ...r, components: [{ itemId: w.timber.id, quantity: '4' }] } : r) })
  assert.deepEqual([v2.revision, (await h.state()).configModels.find(m => m.id === v1.id).status], [2, 'superseded'])
  assert.equal((await resolve(large)).components[0].quantity, '4')
  const after = await h.state(), line = after.salesOrders[0].lines[1]
  assert.deepEqual([line.configuration.revision, line.configuration.components[0].quantity], [1, '3'])
  assert.deepEqual(after.workOrders.find(x => x.id === wo2.id).components.map(l => l.required), ['3', '0.08'])
  await sales.run('so.quote', { customerId: w.customer.id, promiseDate: '2026-12-01', lines: [{ itemId: w.board.id, quantity: '1', unitPrice: '140', configuration: { modelId: v1.id, selection: large } }] }, { error: 'STALE' })
  // Work drafted later from the old quote line still makes revision 1.
  const late = await h.command('wo.draft', { itemId: w.board.id, quantity: '1', requiredBy: '2026-12-02', reason: 'Repeat of the old line', orderId: order.id, lineId: order.lines[1].id })
  assert.equal((await h.command('wo.release', { workOrderId: late.id, version: late.version })).components[0].required, '3')
  await h.invariant()
})

test('ENG-006 a kit sold twice through one replayed channel event and a separate second sale assembles twice only, consumes exact components and never oversells', async t => {
  const h = await installation(); t.after(() => h.close())
  const w = await workshop(h), engineer = await h.person('eng6@example.test', 'engineer'), manager = await h.person('man6@example.test', 'manager'), sales = await h.person('sal6@example.test', 'sales'), agent = await h.person('agent6@example.test', 'agent')
  const kit = await h.command('item.save', { sku: 'CARE-KIT', name: 'Board care kit', kind: 'make', baseUnit: 'each', salePrice: '70' })
  const parts = [{ itemId: w.timber.id, quantity: '2' }, { itemId: w.oil.id, quantity: '0.5' }]
  const stock = async () => Object.fromEntries((await h.state()).positions.filter(p => p.status === 'available').map(p => [p.itemId, p.quantity]))
  // A kit revision is prepared by one person and its policy approved by another; an agent only prepares and nobody sells before approval.
  await sales.run('kit.save', { itemId: kit.id, mode: 'assemble', components: parts }, { error: 'FORBIDDEN' })
  const draft = await agent.run('kit.save', { itemId: kit.id, mode: 'assemble', components: parts })
  await agent.run('kit.approve', { kitId: draft.id, version: draft.version }, { error: 'FORBIDDEN' })
  const sell = (who, eventId, quantity, extra = {}, opts = {}) => who.run('kit.sell', { itemId: kit.id, channel: 'shopify', eventId, quantity, locationId: w.loc.id, ...extra }, opts)
  await sell(sales, 'evt-1001', '1', {}, { error: 'NO_KIT' })
  const approved = await manager.run('kit.approve', { kitId: draft.id, version: draft.version })
  assert.deepEqual([approved.status, approved.revision, approved.mode], ['active', 1, 'assemble'])
  assert.equal((await h.state()).kitAvailability[kit.id].total, '3')
  await sell(agent, 'evt-1001', '1', {}, { error: 'FORBIDDEN' })
  // One sale: the components leave once, one kit is assembled and sold, and cost reconciles to the components consumed.
  const first = await sell(sales, 'evt-1001', '1')
  assert.deepEqual([first.reference, first.kitRevision, first.mode, first.cost], ['KS-0001', 1, 'assemble', '28'])
  assert.deepEqual(await stock(), { [w.timber.id]: '4', [w.oil.id]: '1.5', [w.board.id]: '4' })
  const movements = (await h.state()).movements.filter(m => m.documentKind === 'kitSales')
  assert.deepEqual(movements.map(m => [m.kind, m.quantity, m.unitCost]), [['issue', '-2', '9.5'], ['issue', '-0.5', '18'], ['assembly', '1', '28'], ['kit-sale', '-1', '28']])
  // The channel repeats the event under a new command identity: the recorded outcome returns and nothing moves again.
  const before = await h.state()
  const replay = await sell(manager, 'evt-1001', '1')
  assert.equal(replay.id, first.id)
  const afterReplay = await h.state()
  assert.deepEqual([afterReplay.movements.length, afterReplay.kitSales.length, afterReplay.kitAvailability[kit.id].total], [before.movements.length, 1, before.kitAvailability[kit.id].total])
  await sell(sales, 'evt-1001', '2', {}, { error: 'IDEMPOTENCY' })
  // A separate second sale is a second assembly; a sale larger than the stock behind it is refused before anything posts.
  const second = await sell(sales, 'evt-1002', '1')
  assert.equal(second.reference, 'KS-0002')
  assert.deepEqual(await stock(), { [w.timber.id]: '2', [w.oil.id]: '1', [w.board.id]: '4' })
  const refused = await sell(sales, 'evt-1003', '2', {}, { error: 'INSUFFICIENT_STOCK' })
  assert.deepEqual(refused.error.details.short.map(x => [x.itemId, x.needed, x.available]), [[w.timber.id, '4', '2']])
  const end = await h.invariant()
  assert.deepEqual([end.kitSales.length, end.movements.filter(m => m.documentKind === 'kitSales').length, end.kitAvailability[kit.id].total], [2, 8, '1'])
  assert.equal(end.positions.some(p => p.itemId === kit.id), false)
  // A new revision needs its own approval; old sales keep the revision they were made on.
  const next = await engineer.run('kit.save', { itemId: kit.id, mode: 'pick', components: [{ itemId: w.timber.id, quantity: '1' }], note: 'Pick one blank only' })
  await sell(sales, 'evt-1004', '1').then(sale => assert.equal(sale.kitRevision, 1))
  await engineer.run('kit.approve', { kitId: next.id, version: next.version }, { error: 'FORBIDDEN' })
  await h.command('kit.approve', { kitId: next.id, version: next.version })
  await h.command('opening.record', { locationId: w.store.id, countedOn: '2026-10-01', valuationBasis: 'supplier-invoice', countedBy: 'Olive', evidence: evidence(), lines: [{ itemId: w.timber.id, quantity: '5', unitCost: '9.5' }] })
  const picked = await sell(sales, 'evt-1005', '1', { locationId: w.store.id })
  assert.deepEqual([picked.kitRevision, picked.mode, picked.cost], [2, 'pick', '9.5'])
  const final = await h.state()
  assert.deepEqual(final.movements.filter(m => m.documentId === picked.id).map(m => [m.itemId, m.kind, m.quantity]), [[w.timber.id, 'issue', '-1']])
  assert.deepEqual(final.kitSales.map(k => k.kitRevision), [1, 1, 1, 2]); assert.equal(final.kits.find(k => k.id === draft.id).status, 'superseded')
  await h.invariant()
})
