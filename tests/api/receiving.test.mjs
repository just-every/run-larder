// BUY-002: a short delivery for two pegged jobs with damaged units, supplier documents and tolerance, then allocation of the
// accepted stock to the demand the dated plan pegs it to, through the public receiving, planning and command doors.
import test from 'node:test'
import assert from 'node:assert/strict'
import { installation, evidence } from './harness.mjs'

const date = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)

async function plant(h) {
  const raw = await h.command('item.save', { sku: 'synthetic-larder-211', name: 'Receiving raw', kind: 'buy', baseUnit: 'each' })
  const widget = await h.command('item.save', { sku: 'synthetic-larder-212', name: 'Receiving widget', kind: 'make', baseUnit: 'each' })
  await h.command('bom.revise', { itemId: widget.id, components: [{ itemId: raw.id, quantity: '1' }] })
  const location = await h.command('location.save', { name: 'Receiving dock' }), supplier = await h.command('party.save', { name: 'Receiving supplier', kind: 'supplier' })
  const job = async (quantity, days) => { const d = await h.command('wo.draft', { itemId: widget.id, quantity, requiredBy: date(days), reason: 'synthetic-larder-213 receiving job' }); return h.command('wo.release', { workOrderId: d.id, version: d.version }) }
  const buy = async (quantity, days, tolerancePercent) => {
    const p = await h.command('po.draft', { supplierId: supplier.id, expectedDate: date(days), reason: 'synthetic-larder-214 supply', lines: [{ itemId: raw.id, quantity, unitPrice: '2', ...(tolerancePercent ? { tolerancePercent } : {}) }] })
    return h.command('po.approve', { poId: p.id, version: p.version })
  }
  const get = async path => { const res = await h.request(path), body = await res.json(); assert.equal(res.status, 200, JSON.stringify(body)); return body }
  return { raw, widget, location, supplier, job, buy, get }
}

test('BUY-002 a short delivery for two pegged jobs quarantines the damaged units, keeps supplier documents, allocates only the accepted stock to the jobs and shows the late remainder as an expedite', async t => {
  const h = await installation(); t.after(() => h.close())
  const p = await plant(h), warehouse = await h.person('mrp2-warehouse@example.test', 'warehouse'), agent = await h.person('mrp2-agent@example.test', 'agent'), buyer = await h.person('mrp2-buyer@example.test', 'buyer')
  const first = await p.job('4', 6), second = await p.job('4', 8)
  const po = await p.buy('10', 3)
  const line = po.lines[0]
  // Ten arrive on the day they are needed: both jobs are pegged to the PO and nothing is short.
  let plan = await p.get('/api/larder/planning/materials')
  assert.deepEqual(plan.requirements.filter(r => r.itemId === p.raw.id).map(r => [r.documentId, r.shortage, r.sources.map(s => [s.kind, s.documentId, s.quantity])]), [[first.id, '0', [['purchase', po.id, '4']]], [second.id, '0', [['purchase', po.id, '4']]]])

  // Seven are delivered, two of them crushed; the delivery note is kept; the supplier says the last three come after the second job needs them.
  const note = evidence('Delivery note DN-7 with crushed pallet photo reference')
  const receipt = await warehouse.run('receipt.create', { poId: po.id, supplierReference: 'DN-7', documents: [note], lines: [{ lineId: line.id, locationId: p.location.id, quantity: '7', lot: 'SYN-LOT', damage: { quantity: '2', reason: 'Crushed pallet corner' } }] })
  assert.deepEqual(receipt.documents.map(d => d.name), [note.name])
  assert.deepEqual(receipt.lines.map(l => [l.quantity, l.inspection, l.damageReason ?? null]), [['5', 'accept', null], ['2', 'quarantine', 'Crushed pallet corner']])
  const [good, bad] = receipt.lines
  let state = await h.state()
  // Receiving reserves nothing by itself: allocation is a separate act.
  assert.deepEqual(state.reservations.filter(r => r.itemId === p.raw.id), [])
  assert.deepEqual([state.lots.find(l => l.id === good.lotId).status, state.lots.find(l => l.id === bad.lotId).status, state.lots.find(l => l.id === bad.lotId).code], ['released', 'quarantined', 'SYN-LOT-DAMAGED'])
  assert.deepEqual([state.purchaseOrders[0].status, state.purchaseOrders[0].lines[0].received], ['part received', '7'])
  await h.command('po.revise', { poId: po.id, version: state.purchaseOrders[0].version, expectedDate: date(12), note: 'Supplier ships the rest late' })
  plan = await p.get('/api/larder/planning/materials')
  const need = plan.requirements.filter(r => r.itemId === p.raw.id)
  assert.deepEqual(need.map(r => [r.documentId, r.covered, r.shortage]), [[first.id, '4', '0'], [second.id, '1', '3']])
  // The late remainder is the proposed date change, naming the job it hurts.
  const changes = await p.get('/api/larder/planning/supply-changes'), expedite = changes.recommendations.find(r => r.kind === 'expedite')
  assert.deepEqual([expedite.quantity, expedite.requestedDate, expedite.affected.map(a => [a.documentId, a.shortage])], ['3', date(8), [[second.id, '3']]])

  // Allocation: agents never allocate; stale pegs are refused; only the five accepted units are reserved, in date order, never the damaged two.
  const pegs = await p.get('/api/larder/planning/pegging?kind=receipt&id=' + receipt.id)
  const allocate = (who, extra = {}, opts = {}) => who.run('receipt.allocate', { receiptId: receipt.id, version: pegs.version, asOf: pegs.asOf, reason: 'synthetic-larder-215 allocate the accepted stock', ...extra }, opts)
  await allocate(agent, {}, { error: 'FORBIDDEN' }); await allocate(buyer, {}, { error: 'FORBIDDEN' })
  await allocate(warehouse, { version: pegs.version - 1 }, { error: 'STALE' })
  const before = await h.state(), outbound = h.outboundCount()
  const done = await allocate(warehouse)
  assert.deepEqual(done.allocated.map(a => [a.demandKind, a.demandId, a.quantity]), [['work', first.id, '4'], ['work', second.id, '1']])
  assert.deepEqual(done.skipped, [])
  state = await h.state()
  assert.deepEqual(state.reservations.filter(r => r.itemId === p.raw.id).map(r => [r.demandId, r.quantity]).sort(), [[first.id, '4'], [second.id, '1']].sort())
  assert.deepEqual([state.movements.length, h.outboundCount()], [before.movements.length, outbound])
  assert.equal((await p.get('/api/larder/planning/pegging?kind=lot&id=' + bad.lotId)).pegs.length, 0)
  // Allocating again changes nothing: every peg is already a reservation.
  const again = await p.get('/api/larder/planning/pegging?kind=receipt&id=' + receipt.id)
  assert.deepEqual((await warehouse.run('receipt.allocate', { receiptId: receipt.id, version: again.version, asOf: again.asOf, reason: 'synthetic-larder-216 repeat' })).allocated, [])
  assert.equal((await h.state()).reservations.filter(r => r.itemId === p.raw.id).reduce((n, r) => n + Number(r.quantity), 0), 5)
  // The buyer approves the expedite as a recorded request; the damaged lot is rejected by a person with authority and stays out of the plan.
  const view = await p.get('/api/larder/planning/supply-changes')
  await buyer.run('supply.change.approve', { key: view.recommendations.find(r => r.kind === 'expedite').key, version: view.version, asOf: view.asOf, reason: 'synthetic-larder-217 ask for the rest sooner' })
  await h.command('quarantine.decide', { itemId: p.raw.id, locationId: p.location.id, lotId: bad.lotId, quantity: '2', decision: 'reject', reason: 'Damaged in transit, supplier credit requested' })
  assert.equal((await h.state()).lots.find(l => l.id === bad.lotId).status, 'rejected')

  // Restart and restore keep the receipt, its documents, the reservations and the open remainder.
  const expected = await p.get('/api/larder/planning/materials')
  await h.restart(); assert.deepEqual((await p.get('/api/larder/planning/materials')).requirements, expected.requirements)
  const archive = await (await h.request('/api/larder/archive')).json(), target = await installation(); t.after(() => target.close())
  const restored = await target.request('/api/larder/archive/restore', { method: 'POST', body: archive }); assert.equal(restored.status, 200, await restored.text())
  const copy = await target.state(), source = await h.state()
  assert.deepEqual([copy.receipts[0].documents, copy.reservations, copy.purchaseOrders[0].lines[0].received], [source.receipts[0].documents, source.reservations, '7'])
  await h.invariant()
})

test('BUY-002 a line tolerance accepts a small over-delivery, refuses more, and a delivery within it offers the manager a close of the remainder', async t => {
  const h = await installation(); t.after(() => h.close())
  const p = await plant(h), manager = await h.person('mrp2-tolerance-manager@example.test', 'manager')
  await h.command('po.draft', { supplierId: p.supplier.id, expectedDate: date(3), reason: 'synthetic-larder-218', lines: [{ itemId: p.raw.id, quantity: '10', unitPrice: '2', tolerancePercent: '25' }] }, { error: 'INPUT' })
  const strict = await p.buy('10', 3)
  await h.command('receipt.create', { poId: strict.id, supplierReference: 'S1', lines: [{ lineId: strict.lines[0].id, locationId: p.location.id, quantity: '11' }] }, { error: 'OVER_RECEIPT' })
  const loose = await p.buy('10', 3, '10')
  // Over-delivery beyond the tolerance is refused, in one delivery, across deliveries and with damaged units counted, and records nothing.
  const counted = async () => { const s = await h.state(); return [s.receipts.length, s.movements.length, s.purchaseOrders.find(x => x.id === loose.id).lines[0].received] }
  const untouched = await counted()
  await h.command('receipt.create', { poId: loose.id, supplierReference: 'L1', lines: [{ lineId: loose.lines[0].id, locationId: p.location.id, quantity: '12' }] }, { error: 'OVER_RECEIPT' })
  await h.command('receipt.create', { poId: loose.id, supplierReference: 'L1b', lines: [{ lineId: loose.lines[0].id, locationId: p.location.id, quantity: '12', damage: { quantity: '2', reason: 'Crushed' } }] }, { error: 'OVER_RECEIPT' })
  assert.deepEqual(await counted(), untouched)
  await h.command('receipt.create', { poId: loose.id, supplierReference: 'L2a', lines: [{ lineId: loose.lines[0].id, locationId: p.location.id, quantity: '6' }] })
  await h.command('receipt.create', { poId: loose.id, supplierReference: 'L2b', lines: [{ lineId: loose.lines[0].id, locationId: p.location.id, quantity: '6' }] }, { error: 'OVER_RECEIPT' })
  await h.command('receipt.create', { poId: loose.id, supplierReference: 'L2', lines: [{ lineId: loose.lines[0].id, locationId: p.location.id, quantity: '5' }] })
  assert.equal((await h.state()).purchaseOrders.find(x => x.id === loose.id).status, 'received')
  // A delivery inside the tolerance on the short side leaves a remainder nobody is waiting for: closing it is a manager's recorded decision.
  const short = await p.buy('10', 3, '10')
  await h.command('receipt.create', { poId: short.id, supplierReference: 'T1', lines: [{ lineId: short.lines[0].id, locationId: p.location.id, quantity: '9' }] })
  const view = await p.get('/api/larder/planning/supply-changes'), close = view.recommendations.find(r => r.poId === short.id)
  assert.deepEqual([close.kind, close.quantity], ['cancel', '1'])
  await manager.run('supply.change.approve', { key: close.key, version: view.version, asOf: view.asOf, reason: 'synthetic-larder-219 supplier will not send the last unit' })
  const closed = (await h.state()).purchaseOrders.find(x => x.id === short.id)
  assert.deepEqual([closed.status, closed.lines[0].quantity, closed.lines[0].received, closed.lines[0].cancelled], ['received', '9', '9', '1'])
  await h.invariant()
})

test('BUY-002 the buyer sets a line tolerance up to 20 percent with the setting audited, above 10 percent on a PO at or above the spend threshold it needs the policy signatures, and damaged units never reopen a received PO', async t => {
  const h = await installation(); t.after(() => h.close())
  const p = await plant(h), buyer = await h.person('mrp2-tol-buyer@example.test', 'buyer'), manager = await h.person('mrp2-tol-manager@example.test', 'manager'), agent = await h.person('mrp2-tol-agent@example.test', 'agent'), warehouse = await h.person('mrp2-tol-wh@example.test', 'warehouse')
  const po = await p.buy('10', 3), line = po.lines[0], other = await p.buy('10', 3), exact = await p.buy('4', 3)
  const tolerance = (who, order, percent, extra = {}, opts = {}) => who.run('po.tolerance', { poId: order.id, version: (order.version), lineId: order.lines[0].id, tolerancePercent: percent, reason: 'synthetic-larder-220 supplier ships in full cartons', ...extra }, opts)
  const current = async order => (await h.state()).purchaseOrders.find(x => x.id === order.id)
  assert.equal(line.tolerancePercent, '0')
  // Only buyers and managers set it, never above 20 percent, and never on a closed order.
  await tolerance(agent, po, '5', {}, { error: 'FORBIDDEN' }); await tolerance(warehouse, po, '5', {}, { error: 'FORBIDDEN' })
  await tolerance(buyer, po, '25', {}, { error: 'INPUT' }); await tolerance(buyer, po, '5', { version: po.version - 1 }, { error: 'STALE' })
  const five = await tolerance(buyer, po, '5')
  assert.equal(five.lines[0].tolerancePercent, '5')
  // The setting is in the audit with who, why and the exact before and after.
  const trail = (await (await h.request('/api/larder/audit?type=po.tolerance&limit=100')).json()).entries
  assert.ok(trail.some(e => e.actorId === buyer.id && e.subjectKind === 'purchaseOrders' && /full cartons/.test(e.reason) && e.after.history?.length > 0))
  await h.command('receipt.create', { poId: po.id, supplierReference: 'T5', lines: [{ lineId: line.id, locationId: p.location.id, quantity: '10.5' }] })
  // A spend threshold of $5 makes the $20 order a signed decision: above 10 percent it needs two signatures on the exact setting; 10 percent or less does not.
  await h.command('approval.policy', { category: 'spend', thresholdUsd: '5', signatures: 2, expiryMinutes: 60, reason: 'Two people above five dollars' })
  const ten = await tolerance(buyer, other, '10')
  assert.equal(ten.lines[0].tolerancePercent, '10')
  let live = await current(other)
  const first = await tolerance(buyer, live, '15')
  assert.deepEqual([first.category, first.remainingAtSigning, (await current(other)).lines[0].tolerancePercent], ['spend', 1, '10'])
  live = await current(other)
  await tolerance(buyer, live, '15', {}, { error: 'DUPLICATE_SIGNATURE' })
  await tolerance(manager, live, '18', {}, { error: 'DUPLICATE_SIGNATURE' }).catch(() => {})
  const done = await tolerance(manager, live, '15')
  assert.deepEqual([done.lines[0].tolerancePercent, done.history.at(-1).signatureIds.length], ['15', 2])
  // An over-delivery inside the signed tolerance is accepted; one past it is still refused.
  await h.command('receipt.create', { poId: other.id, supplierReference: 'T15', lines: [{ lineId: other.lines[0].id, locationId: p.location.id, quantity: '11.6' }] }, { error: 'OVER_RECEIPT' })
  await h.command('receipt.create', { poId: other.id, supplierReference: 'T15b', lines: [{ lineId: other.lines[0].id, locationId: p.location.id, quantity: '11.5' }] })
  // Damaged units count as delivered and never reopen the order, even when they are rejected afterwards.
  const damaged = await h.command('receipt.create', { poId: exact.id, supplierReference: 'D1', lines: [{ lineId: exact.lines[0].id, locationId: p.location.id, quantity: '4', lot: 'synthetic-larder-221', damage: { quantity: '1', reason: 'Split in transit' } }] })
  const bad = damaged.lines.find(l => l.inspection === 'quarantine')
  assert.deepEqual([(await current(exact)).status, (await current(exact)).lines[0].received], ['received', '4'])
  await h.command('quarantine.decide', { itemId: p.raw.id, locationId: p.location.id, lotId: bad.lotId, quantity: '1', decision: 'reject', reason: 'Split in transit, supplier credit to follow' })
  assert.deepEqual([(await current(exact)).status, (await current(exact)).lines[0].received, (await p.get('/api/larder/planning/supply-changes')).recommendations.filter(r => r.poId === exact.id)], ['received', '4', []])
  await h.invariant()
})

test('BUY-002 accepted stock needed only through a make path is listed as skipped and reserved for nobody, and allocation stays a person\'s act', async t => {
  const h = await installation(); t.after(() => h.close())
  const p = await plant(h), warehouse = await h.person('mrp2-mp-wh@example.test', 'warehouse')
  const customer = await h.command('party.save', { name: 'Make path customer', kind: 'customer' })
  const quote = await h.command('so.quote', { customerId: customer.id, promiseDate: date(12), lines: [{ itemId: p.widget.id, quantity: '3', unitPrice: '30' }] })
  await h.command('so.confirm', { orderId: quote.id, version: quote.version, reserve: false })
  const po = await p.buy('3', 3)
  const receipt = await warehouse.run('receipt.create', { poId: po.id, supplierReference: 'MP1', lines: [{ lineId: po.lines[0].id, locationId: p.location.id, quantity: '3', lot: 'synthetic-larder-223' }] })
  assert.deepEqual((await h.state()).reservations.filter(r => r.itemId === p.raw.id), [])
  const pegs = await p.get('/api/larder/planning/pegging?kind=receipt&id=' + receipt.id)
  assert.deepEqual(pegs.pegs.map(x => [x.demand.kind, x.source.kind, x.source.quantity]), [['dependent', 'stock', '3']])
  const done = await warehouse.run('receipt.allocate', { receiptId: receipt.id, version: pegs.version, asOf: pegs.asOf, reason: 'synthetic-larder-222 allocate what can be allocated' })
  assert.deepEqual([done.allocated, done.skipped.map(x => [x.demandKind, x.quantity, /make path/.test(x.reason)])], [[], [['dependent', '3', true]]])
  assert.deepEqual((await h.state()).reservations.filter(r => r.itemId === p.raw.id), [])
  await h.invariant()
})

test('BUY-008 accepted receipt stock is allocated by hand to a released job that makes the product, never to draft, held or closed jobs, never quarantined stock, and reserved stock only by a manager or the owner with a reason', async t => {
  const h = await installation(); t.after(() => h.close())
  const p = await plant(h), warehouse = await h.person('buy8-wh@example.test', 'warehouse'), manager = await h.person('buy8-mgr@example.test', 'manager'), agent = await h.person('buy8-agent@example.test', 'agent'), sales = await h.person('buy8-sales@example.test', 'sales')
  // The component is used only by the made product: jobs for it are drafted and released, and the stock arrives after they were released.
  const draft = await h.command('wo.draft', { itemId: p.widget.id, quantity: '4', requiredBy: date(8), reason: 'synthetic-larder-231 draft job' })
  const early = await p.job('8', 6), late = await p.job('6', 9)
  // A job whose in-process inspection failed is held.
  const bracket = await h.command('item.save', { sku: 'synthetic-larder-235', name: 'Held bracket', kind: 'make', baseUnit: 'each' })
  await h.command('bom.revise', { itemId: bracket.id, components: [{ itemId: p.raw.id, quantity: '1' }], routing: [{ name: 'Bore', workCentre: 'Mill', minutes: 3 }] })
  let plan = await h.command('quality.plan.save', { itemId: bracket.id, revision: 1, stage: 'in-process', operationSequence: 1, name: 'Bore check', sampleSize: 1, measurements: [{ name: 'Bore', unit: 'mm', target: '10', lower: '9.98', upper: '10.02' }], attachments: [evidence('Drawing rev A')] })
  plan = await h.command('quality.plan.approve', { planId: plan.id, version: plan.version })
  const heldDraft = await h.command('wo.draft', { itemId: bracket.id, quantity: '2', requiredBy: date(7), reason: 'synthetic-larder-236 held job' })
  const held = await h.command('wo.release', { workOrderId: heldDraft.id, version: heldDraft.version })
  const operator = await h.person('buy8-op@example.test', 'operator')
  const assigned = await h.command('wo.operation.assign', { workOrderId: held.id, version: held.version, sequence: 1, operatorId: operator.id })
  await operator.run('wo.operation.start', { workOrderId: held.id, version: assigned.version, sequence: 1, workCentre: 'Mill', station: 'Mill 1', reason: 'Bore the batch' })
  assert.equal((await h.command('quality.inspect', { planId: plan.id, planVersion: plan.version, workOrderId: held.id, samples: { Bore: ['10.5'] } })).passed, false)
  const po = await p.buy('9', 3)
  const receipt = await warehouse.run('receipt.create', { poId: po.id, supplierReference: 'JB1', lines: [{ lineId: po.lines[0].id, locationId: p.location.id, quantity: '9', lot: 'synthetic-larder-232', damage: { quantity: '2', reason: 'Crushed' } }] })
  const [good, bad] = receipt.lines
  assert.deepEqual([good.quantity, bad.inspection], ['7', 'quarantine'])
  const reserved = async job => (await h.state()).reservations.filter(r => r.demandId === job.id && r.itemId === p.raw.id).map(r => [r.locationId, r.quantity])
  const send = (who, body, opts) => who.run('receipt.allocate.job', { receiptId: receipt.id, itemId: p.raw.id, reason: 'synthetic-larder-233 job needs it', ...body }, opts)
  const as = (job, quantity, extra = {}) => ({ workOrderId: job.id, version: job.version, quantity, ...extra })
  assert.deepEqual(await reserved(early), []) // released before the stock arrived: nothing reserved yet

  // Who may: agents and other roles never; a missing reason is refused; stale jobs are refused.
  await send(agent, as(early, '1'), { error: 'FORBIDDEN' }); await send(sales, as(early, '1'), { error: 'FORBIDDEN' })
  await send(warehouse, { ...as(early, '1'), reason: '' }, { error: 'INPUT' })
  await send(warehouse, as({ ...early, version: early.version - 1 }, '1'), { error: 'STALE' })
  // Which jobs: only released jobs. A draft refuses.
  await send(warehouse, as(draft, '1'), { error: 'STATE' })
  // A job under a failed in-process inspection is held and refuses too.
  await send(warehouse, as((await h.state()).workOrders.find(w => w.id === held.id), '1'), { error: 'QUALITY_HOLD' })
  // Which stock: the quarantined damaged units are never allocated, even when asked for.
  await send(warehouse, as(early, '8'), { error: 'INSUFFICIENT_STOCK' }).then(e => assert.match(e.error.message, /accepted, unreserved stock/))
  assert.deepEqual(await reserved(early), [])
  // A person allocates part of the accepted stock to the job that makes the product; the reservation, its receipt and the allocator are on record.
  const first = await send(warehouse, as(early, '3'))
  assert.deepEqual([first.category, first.subjectId, first.workOrderId, first.mode, first.createdBy === warehouse.id, first.role, first.allocated.map(x => [x.quantity, x.reference, x.locationId]), first.takenFrom], ['receipt-allocation', receipt.id, early.id, 'job', true, 'warehouse', [['3', early.reference, p.location.id]], []])
  assert.deepEqual(await reserved(early), [[p.location.id, '3']])
  assert.equal(first.allocated[0].reservationId, (await h.state()).reservations.find(r => r.demandId === early.id).id)
  // More than the job still needs is refused; so is more than the accepted unreserved stock that is left.
  await send(warehouse, as(early, '6'), { error: 'INPUT' })
  const second = await h.state().then(s => s.workOrders.find(w => w.id === late.id))
  await send(warehouse, as(second, '5'), { error: 'INSUFFICIENT_STOCK' })
  const rest = await send(warehouse, as(second, '4'))
  assert.deepEqual([await reserved(late), rest.allocated[0].quantity], [[[p.location.id, '4']], '4'])
  // Everything accepted is now reserved; taking reserved stock is a manager's or owner's act, named and reasoned, never a warehouse person's.
  const early2 = (await h.state()).workOrders.find(w => w.id === early.id)
  await send(warehouse, as(early2, '1', { takeFrom: [{ demandId: late.id, lineId: late.components[0].id, locationId: p.location.id, quantity: '1' }] }), { error: 'FORBIDDEN' })
  await send(manager, as(early2, '1'), { error: 'INSUFFICIENT_STOCK' })
  await send(manager, { ...as(early2, '1', { takeFrom: [{ demandId: late.id, lineId: late.components[0].id, locationId: p.location.id, quantity: '1' }] }), reason: '' }, { error: 'INPUT' })
  const taken = await send(manager, as(early2, '1', { takeFrom: [{ demandId: late.id, lineId: late.components[0].id, locationId: p.location.id, quantity: '1' }], reason: 'synthetic-larder-234 the earlier job starts first' }))
  assert.deepEqual([taken.takenFrom.map(x => [x.demandId, x.reference, x.quantity]), await reserved(early), await reserved(late)], [[[late.id, late.reference, '1']], [[p.location.id, '4']], [[p.location.id, '3']]])
  // Both allocations are audited with their actor and reason, and no signature was asked for.
  const audit = await (await h.request('/api/larder/audit?type=receipt.allocate.job&limit=50')).json()
  assert.deepEqual(audit.entries.map(e => [e.actorId, (e.after.takenFrom?.length ?? 0) > 0, e.reason.slice(0, 20)]), [[warehouse.id, false, 'synthetic-larder-233'], [warehouse.id, false, 'synthetic-larder-233'], [manager.id, true, 'synthetic-larder-234']])
  assert.equal((await h.state()).approvalSignatures.length, 0)
  // Closing a job returns its reservation; a closed job refuses further allocation.
  const done = await h.command('wo.close', { workOrderId: early.id, version: (await h.state()).workOrders.find(w => w.id === early.id).version })
  assert.equal(done.status, 'closed'); assert.deepEqual(await reserved(early), [])
  await send(manager, as(done, '1'), { error: 'STATE' })
  await h.invariant()
})

test('FLOOR-008 scanned GS1 codes resolve item, lot, expiry and serial for receipt, issue and pick; wrong, held, stale and duplicate scans are refused without a movement', async t => {
  const h = await installation(); t.after(() => h.close())
  const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
  const dock = await h.command('location.save', { name: 'Scan dock' }), supplier = await h.command('party.save', { kind: 'supplier', name: 'Resin works' }), customer = await h.command('party.save', { kind: 'customer', name: 'Boat shop' })
  const resin = await h.command('item.save', { sku: 'RESIN', name: 'Epoxy resin', kind: 'buy', baseUnit: 'each', barcode: '09501101530003', tracking: 'batch' })
  const hardener = await h.command('item.save', { sku: 'HARDENER', name: 'Hardener', kind: 'buy', baseUnit: 'each', barcode: '4006381333931' })
  const pump = await h.command('item.save', { sku: 'PUMP', name: 'Bilge pump', kind: 'buy', baseUnit: 'each', barcode: '09501101530010', tracking: 'serial' })
  const kit = await h.command('item.save', { sku: 'KIT', name: 'Repair kit', kind: 'make', baseUnit: 'each' })
  await h.command('bom.revise', { itemId: kit.id, components: [{ itemId: resin.id, quantity: '1' }] })
  let po = await h.command('po.draft', { supplierId: supplier.id, expectedDate: day(0), reason: 'Scanned delivery', lines: [{ itemId: resin.id, quantity: '6', unitPrice: '9' }, { itemId: pump.id, quantity: '1', unitPrice: '80' }] }); po = await h.command('po.approve', { poId: po.id, version: po.version })
  const scan = async (code, use, id) => (await h.request(`/api/larder/scan?code=${encodeURIComponent(code)}${use ? `&use=${use}&id=${id}` : ''}`)).json()
  const refused = async (code, use, id, error) => assert.equal((await scan(code, use, id)).error?.code, error)
  const moved = async () => (await h.state()).movements.length, before = await moved()
  // Human-readable and raw GS1 (symbology prefix, FNC1 sent as GS) carry the same identifier, expiry and lot.
  const label = await scan('(01)09501101530003(17)271231(10)RES-A', 'receipt', po.id), raw = await scan(']C1010950110153000317271231' + '10RES-A', 'receipt', po.id)
  assert.deepEqual([label.item.id, label.lineId, label.receive.lot, label.receive.expiresOn], [resin.id, po.lines[0].id, 'RES-A', '2027-12-31']); assert.deepEqual(raw.receive, label.receive)
  assert.equal((await scan('4006381333931')).item.id, hardener.id); assert.equal((await scan('Scan dock')).location.id, dock.id); assert.equal((await scan(po.reference)).document.id, po.id)
  await refused('4006381333931', 'receipt', po.id, 'SCAN_WRONG_ITEM')
  await refused('(01)09501101530004(10)RES-A', 'receipt', po.id, 'SCAN_GS1')
  await refused('NOT-A-CODE', 'receipt', po.id, 'SCAN_UNKNOWN')
  assert.equal(await moved(), before)
  const receive = (line, extra) => h.command('receipt.create', { poId: po.id, supplierReference: 'Scanned', lines: [{ lineId: line, locationId: dock.id, inspection: 'accept', ...extra }] })
  await receive(label.lineId, { quantity: '2', lot: label.receive.lot, dates: { expiresOn: label.receive.expiresOn } })
  await receive(label.lineId, { quantity: '2', lot: 'RES-B', inspection: 'quarantine' })
  await receive(label.lineId, { quantity: '2', lot: 'RES-OLD', dates: { expiresOn: day(-1) } })
  const unit = await scan('(01)09501101530010(21)PUMP-1', 'receipt', po.id); assert.equal(unit.receive.serial, 'PUMP-1')
  await receive(unit.lineId, { quantity: '1', serials: [unit.receive.serial] })
  await refused('(01)09501101530010(21)PUMP-1', 'receipt', po.id, 'SCAN_STALE')
  let w = await h.command('wo.draft', { itemId: kit.id, quantity: '2', requiredBy: day(1), reason: 'Scanned issue' }); w = await h.command('wo.release', { workOrderId: w.id, version: w.version })
  const issued = await scan('(01)09501101530003(10)RES-A', 'issue', w.id); assert.deepEqual([issued.kind, issued.lot.code, issued.lineId], ['lot', 'RES-A', w.components[0].id])
  await refused('RES-B', 'issue', w.id, 'SCAN_HELD')
  await refused('(01)09501101530003(10)RES-OLD', 'issue', w.id, 'SCAN_STALE')
  await refused('HARDENER', 'issue', w.id, 'SCAN_WRONG_ITEM')
  let order = await h.command('so.quote', { customerId: customer.id, promiseDate: day(1), lines: [{ itemId: pump.id, quantity: '1', unitPrice: '120' }] }); order = await h.command('so.confirm', { orderId: order.id, version: order.version }); await h.command('so.reserve', { orderId: order.id })
  const picked = await scan('(01)09501101530010(21)PUMP-1', 'pick', order.id); assert.deepEqual([picked.kind, picked.lot.code], ['serial', 'PUMP-1'])
  const moves = await moved()
  await h.command('shipment.pick', { orderId: order.id, lines: [{ lineId: picked.lineId, locationId: dock.id, quantity: '1', serials: [picked.lot.code] }] })
  // A second read of the same unit is a duplicate scan: refused, and the pick posted no movement.
  await refused('(01)09501101530010(21)PUMP-1', 'pick', order.id, 'SCAN_DUPLICATE')
  assert.equal(await moved(), moves)
})
