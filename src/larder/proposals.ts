// Agent-prepared proposals. An agent (or a person) prepares; a different person
// with authority approves the exact version, and only then does anything change.
// Supplied documents such as an emailed enquiry are kept as data, never obeyed.
import { capacityPreview, approveCapacity } from './scheduling/reschedule'
import { finitePlan } from './scheduling/finite'
import { sha256, canonicalJson } from '../modules/import-kit/src/d1/index'
import { cents, decimal, format, times } from './decimal'
import { fail, forbidden } from './problem'
import { allow, approver, type Role } from './roles'
import { authorize, gate, policyFor } from './approval-policy'
import { largestJobDelay } from './scheduling/delay'
import { createQuote, quoteLines } from './sales'
import { draftPurchase } from './purchasing'
import { shortages } from './planning'
import { move, positions } from './stock'
import { bump, date, fresh, get, list, optionalText, row, text, type Context, type Row, type State } from './model'
import { handoff } from './handoff'

export const proposalKinds = ['order-intake', 'replenishment', 'item-merge', 'reschedule', 'reconciliation'] as const
const approvers: Record<string, Role[]> = { 'order-intake': ['manager', 'sales'], replenishment: ['manager', 'buyer'], 'item-merge': ['manager'], reschedule: ['manager', 'production', 'planner'], reconciliation: ['manager', 'accounts'] }

const shortageFingerprint = (s: State, itemIds: string[]) => sha256(canonicalJson(shortages(s).filter(x => itemIds.includes(x.itemId)).map(x => [x.itemId, x.shortage, x.expected])))

function mergeImpact(s: State, duplicateId: string, keepId: string) {
  const dup = get(s, 'items', duplicateId, 'duplicate item'), keep = get(s, 'items', keepId, 'item to keep')
  if (dup.id === keep.id) fail('INPUT', 'Choose two different items.')
  if (dup.baseUnit !== keep.baseUnit) fail('UNIT_MISMATCH', `${dup.sku} counts in ${dup.baseUnit} and ${keep.sku} in ${keep.baseUnit}; they cannot be merged.`)
  return {
    references: s.partyItems.filter(p => p.itemId === dup.id).map(p => p.id),
    quotes: s.salesOrders.filter(o => o.status === 'quote' && o.lines.some((l: any) => l.itemId === dup.id)).map(o => o.reference),
    draftPurchases: s.purchaseOrders.filter(p => p.status === 'draft' && p.lines.some((l: any) => l.itemId === dup.id)).map(p => p.reference),
    boms: s.boms.filter(b => b.status === 'active' && b.components.some((l: any) => l.itemId === dup.id)).map(b => `${s.items.find(i => i.id === b.itemId)?.sku} rev ${b.revision}`),
    stock: positions(s).filter(p => p.itemId === dup.id),
    blocking: [...s.reservations.filter(r => r.itemId === dup.id).map(r => r.demandId), ...s.salesOrders.filter(o => o.status !== 'quote' && o.status !== 'shipped' && o.status !== 'cancelled' && o.lines.some((l: any) => l.itemId === dup.id)).map(o => o.reference), ...s.purchaseOrders.filter(p => !['draft', 'received'].includes(p.status) && p.lines.some((l: any) => l.itemId === dup.id)).map(p => p.reference)],
  }
}

// Classification is a description of this native action, never an authority
// grant. Use the same quote and purchase normalization as execution on an
// isolated state, so units, supplier constraints and exposure cannot diverge.
const versions = (rows: Row[]) => rows.map(({ id, version }) => ({ id, version }))

function classification(c: Context, proposal: Row) {
  const { kind, plan, context } = proposal, s = c.s
  const isolated: Context = { ...c, s: structuredClone(s), attachments: [] }
  const itemIds: string[] = kind === 'order-intake' ? plan.lines.map((l: any) => l.itemId)
    : kind === 'replenishment' ? plan.purchases.flatMap((p: any) => p.lines.map((l: any) => l.itemId))
    : kind === 'item-merge' ? [plan.duplicateItemId, plan.keepItemId] : []
  const items = [...new Set(itemIds)].map(id => get(s, 'items', id))
  const facts: Record<string, any> = {
    cashExposureUsd: '0', externalDelivery: false, providerAcceptance: false,
    destructive: false, customerCommitment: false,
  }
  let business: Record<string, any> = { items }, classes = ['standard']
  if (kind === 'order-intake') {
    const missing = plan.lines.filter((l: any) => l.quantity === null).length
    const lines = missing ? plan.lines : quoteLines(isolated, plan.lines).map(({ id, ...line }) => line)
    Object.assign(facts, { effect: 'create quote draft', customerId: plan.customerId, promiseDate: plan.promiseDate, missingQuantities: missing, lines,
      quoteValueUsd: missing ? null : format(lines.reduce((n: bigint, l: any) => n + times(decimal(l.quantity), decimal(l.unitPrice)), 0n)) })
    business = { items, customer: versions([get(s, 'parties', plan.customerId)])[0],
      sourceLocations: s.movements.filter(m => itemIds.includes(m.itemId)).map(m => m.locationId) }
  }
  if (kind === 'replenishment') {
    const purchases = plan.purchases.map((p: any) => {
      const po = draftPurchase(isolated, { ...p, reason: 'Reviewed proposal' }, proposal.preparedBy)
      return { supplierId: po.supplierId, supplier: po.supplierSnapshot, currency: po.currency, expectedDate: po.expectedDate,
        requiredBy: po.requiredBy, exposure: po.exposure, lines: po.lines.map(({ id, ...line }: any) => line) }
    })
    classes = ['money', 'commitment']
    Object.assign(facts, { effect: 'create approved purchase orders', purchases,
      cashExposureUsd: format(purchases.reduce((n: bigint, p: any) => n + decimal(p.exposure), 0n)),
      supplierCommitment: true, paymentPosted: false,
      shortages: shortages(s).filter(x => itemIds.includes(x.itemId)) })
    business = { items, sourceLocations: s.movements.filter(m => itemIds.includes(m.itemId)).map(m => m.locationId), suppliers: versions([...new Set<string>(plan.purchases.map((p: any) => p.supplierId))].map(id => get(s, 'parties', id))),
      supplierTerms: versions(s.partyItems.filter(r => itemIds.includes(r.itemId) && plan.purchases.some((p: any) => p.supplierId === r.partyId))) }
  }
  if (kind === 'item-merge') {
    const impact = mergeImpact(s, plan.duplicateItemId, plan.keepItemId)
    Object.assign(facts, { effect: 'archive duplicate with compensating stock movements', duplicateItemId: plan.duplicateItemId,
      keepItemId: plan.keepItemId, impact, physicalQuantityChange: '0', recordsDeleted: false })
    business = { items, references: versions(s.partyItems.filter(r => r.itemId === plan.duplicateItemId)),
      quotes: versions(s.salesOrders.filter(r => r.status === 'quote' && r.lines.some((l: any) => l.itemId === plan.duplicateItemId))),
      draftPurchases: versions(s.purchaseOrders.filter(r => r.status === 'draft' && r.lines.some((l: any) => l.itemId === plan.duplicateItemId))),
      boms: versions(s.boms.filter(r => r.status === 'active' && r.components.some((l: any) => l.itemId === plan.duplicateItemId))),
      stockInputs: s.movements.filter(m => itemIds.includes(m.itemId)).map(m => ({ id: m.id, itemId: m.itemId, locationId: m.locationId, status: m.status, lotId: m.lotId, quantity: format(m.quantity) })),
      costValuations: versions(s.costValuations.filter(v => v.lines.some((l: any) => itemIds.includes(l.itemId)))) }
  }
  if (kind === 'reschedule') {
    const work = plan.changes.map((ch: any) => get(s, 'workOrders', ch.workOrderId))
    Object.assign(facts, { effect: 'change internal work sequence', changes: plan.changes.map((ch: any, i: number) => ({
      workOrderId: ch.workOrderId, before: { priority: work[i].priority, plannedStart: work[i].plannedStart },
      after: { priority: Number.isSafeInteger(ch.priority) ? ch.priority : work[i].priority, plannedStart: ch.plannedStart,
        ...(ch.scheduleChoices ? { scheduleChoices: ch.scheduleChoices } : {}) },
    })), changedPromiseCount: 0, capacity: context.capacity ?? null })
    business = { work: versions(work) }
    if (context.capacity) {
      const preview = context.capacity, clone = structuredClone(s)
      for (const ch of plan.changes) Object.assign(get(clone, 'workOrders', ch.workOrderId), ch)
      business.capacityBefore = { ...finitePlan(s, c.people ?? [], preview.asOf, preview.days), version: 0 }
      business.capacityAfter = { ...finitePlan(clone, c.people ?? [], preview.asOf, preview.days), version: 0 }
    }
  }
  if (kind === 'reconciliation') {
    const h = get(s, 'handoffs', plan.handoffId)
    const entries = plan.entries.map((e: any) => {
      const line = h.lines.find((l: any) => l.id === e.lineId) ?? fail('NOT_FOUND', 'An acknowledged line is not in this batch.')
      const amount = cents(decimal(String(e.amount ?? ''), 'acknowledged amount', { signed: true }))
      return { lineId: line.id, ledgerId: text(e.ledgerId, 'ledger reference', 120), amount, expectedAmount: line.amountCents,
        state: amount === line.amountCents ? 'matched' : 'mismatch' }
    })
    Object.assign(facts, { effect: 'record local handoff acknowledgments', handoffId: h.id, entries, ledgerPosting: false })
    business = { handoff: versions([h])[0] }
  }
  const inputs = JSON.parse(JSON.stringify({ kind, plan, context, summary: proposal.summary, assumptions: proposal.assumptions, evidence: proposal.evidence, business }))
  const computed = JSON.parse(JSON.stringify({ preparationClasses: ['standard'], classes, facts, inputs, proposalVersion: proposal.version }))
  return { ...computed, inputsDigest: sha256(canonicalJson(computed)) }
}

function currentClassification(c: Context, proposal: Row) {
  // Legacy unclassified proposals need a fresh review; archive restoration does
  // not manufacture risk review or a person's approval.
  if (!proposal.classification) fail('STALE', 'Prepare a new classified proposal before deciding it.')
  const computed = classification(c, proposal)
  if (canonicalJson(computed) !== canonicalJson(proposal.classification)) fail('STALE', 'The reviewed proposal inputs or consequences changed. Prepare a fresh proposal.')
  return computed
}

function prepare(c: Context, p: any) {
  const kind = proposalKinds.includes(p.kind) ? p.kind : fail('INPUT', `kind must be one of ${proposalKinds.join(', ')}.`)
  const plan = structuredClone(p.plan ?? fail('INPUT', 'A proposal needs a plan.'))
  const evidence = list<string>(p.evidence, 'evidence', 50).map(e => text(e, 'evidence', 1000))
  let context: Record<string, unknown> = {}
  if (kind === 'order-intake') {
    const customer = get(c.s, 'parties', plan.customerId, 'customer')
    const lines = list(plan.lines).map((l: any) => ({ itemId: get(c.s, 'items', l.itemId, 'item').id, quantity: l.quantity === null || l.quantity === undefined ? null : format(decimal(l.quantity, 'quantity', { positive: true })), unitPrice: format(decimal(l.unitPrice, 'unit price')) }))
    context = { customer: customer.name, enquiry: text(plan.enquiry, 'enquiry', 20000), missing: lines.filter(l => l.quantity === null).length }
    Object.assign(plan, { lines, promiseDate: date(plan.promiseDate, 'promise date'), message: text(plan.message, 'draft reply', 4000), questions: (plan.questions ?? []).map((q: unknown) => text(q, 'question', 400)) })
  }
  if (kind === 'replenishment') {
    const purchases = list(plan.purchases, 'purchases', 50)
    const itemIds = [...new Set(purchases.flatMap((x: any) => list(x.lines).map((l: any) => get(c.s, 'items', l.itemId, 'item').id)))]
    for (const x of purchases) { get(c.s, 'parties', x.supplierId, 'supplier'); date(x.expectedDate, 'expected date') }
    const exposure = purchases.flatMap((x: any) => x.lines).reduce((n: bigint, l: any) => n + times(decimal(l.quantity, 'quantity', { positive: true }), decimal(l.unitPrice, 'unit price')), 0n)
    context = { shortages: shortages(c.s).filter(x => itemIds.includes(x.itemId)), cashExposure: format(exposure), fingerprint: shortageFingerprint(c.s, itemIds), itemIds }
    plan.explanation = text(plan.explanation, 'explanation', 4000)
  }
  if (kind === 'item-merge') context = { impact: mergeImpact(c.s, plan.duplicateItemId, plan.keepItemId) }
  if (kind === 'reschedule') {
    for (const ch of list(plan.changes)) { const w = get(c.s, 'workOrders', ch.workOrderId, 'work order'); if (!['draft', 'released'].includes(w.status)) fail('STATE', `${w.reference} is ${w.status}.`); date(ch.plannedStart, 'planned start') }
    context = { before: plan.changes.map((ch: any) => { const w = get(c.s, 'workOrders', ch.workOrderId); return { workOrderId: w.id, reference: w.reference, priority: w.priority, plannedStart: w.plannedStart, version: w.version } }), conflicts: (plan.conflicts ?? []).map((x: unknown) => text(x, 'conflict', 400)) }
    if (plan.capacity || c.s.machineCalendars.length) { const preview = capacityPreview(c, plan); plan.changes = preview.changes; context.capacity = preview }
  }
  if (kind === 'reconciliation') { const h = get(c.s, 'handoffs', plan.handoffId, 'handoff'); list(plan.entries, 'entries', 5000); context = { handoff: h.reference, handoffVersion: h.version } }
  const proposal = row(c, 'proposals', { kind, summary: text(p.summary, 'summary', 400), assumptions: optionalText(p.assumptions, 'assumptions', 4000), evidence, plan, context, status: 'awaiting approval', preparedBy: c.actor.id, preparedRole: c.actor.role, snapshotVersion: c.s.version })
  proposal.classification = classification(c, proposal)
  if (kind === 'replenishment') {
    context.cashExposure = proposal.classification.facts.cashExposureUsd
    proposal.classification = classification(c, proposal)
  }
  return proposal
}

function execute(c: Context, proposal: Row, earlierSignatures: number): unknown {
  const plan = proposal.plan
  if (proposal.kind === 'order-intake') {
    if (plan.lines.some((l: any) => l.quantity === null)) fail('INCOMPLETE', 'Some quantities are still missing. Ask the customer, then prepare the proposal again.')
    return createQuote(c, { customerId: plan.customerId, promiseDate: plan.promiseDate, lines: plan.lines, note: `Prepared from enquiry; reply approved: ${plan.message}` }, proposal.preparedBy).id
  }
  if (proposal.kind === 'replenishment') {
    if (shortageFingerprint(c.s, proposal.context.itemIds) !== proposal.context.fingerprint) fail('STALE', 'Orders, stock or supply changed since this was prepared. Ask for a fresh proposal.')
    return plan.purchases.map((x: any) => {
      const po = draftPurchase(c, { ...x, reason: `${plan.explanation} (proposal ${proposal.summary})` }, proposal.preparedBy)
      // Adopting a proposal is not a signature on the purchase order's exact spend.
      // Leave policy-controlled purchases in draft for the ordinary po.approve door.
      if (policyFor(c, 'spend', () => decimal(po.exposure))) return po.id
      const approval = row(c, 'approvals', { subjectKind: 'purchaseOrders', subjectId: po.id, subjectVersion: po.version, decision: 'approved', role: c.actor.role, note: `Approved with proposal`, proposalId: proposal.id, terms: { supplierId: po.supplierId, lines: po.lines, expectedDate: po.expectedDate, exposure: po.exposure } })
      return bump(po, { status: 'approved', approvalId: approval.id, approvedBy: c.actor.id }).id
    })
  }
  if (proposal.kind === 'item-merge') {
    const impact = mergeImpact(c.s, plan.duplicateItemId, plan.keepItemId)
    if (impact.blocking.length) fail('MERGE_BLOCKED', 'Open orders or reservations use the duplicate. Finish or cancel them first.', { blocking: impact.blocking })
    const dup = get(c.s, 'items', plan.duplicateItemId), keep = get(c.s, 'items', plan.keepItemId)
    for (const p of c.s.partyItems.filter(x => x.itemId === dup.id)) bump(p, { itemId: keep.id })
    for (const o of [...c.s.salesOrders.filter(x => x.status === 'quote'), ...c.s.purchaseOrders.filter(x => x.status === 'draft')]) if (o.lines.some((l: any) => l.itemId === dup.id)) { o.lines = o.lines.map((l: any) => l.itemId === dup.id ? { ...l, itemId: keep.id } : l); bump(o, {}) }
    for (const b of c.s.boms.filter(x => x.status === 'active' && x.components.some((l: any) => l.itemId === dup.id))) {
      bump(b, { status: 'superseded' })
      const merged = new Map<string, any>()
      for (const l of b.components) { const id = l.itemId === dup.id ? keep.id : l.itemId, prev = merged.get(id); merged.set(id, prev ? { ...prev, quantity: format(decimal(prev.quantity) + decimal(l.quantity)) } : { ...l, itemId: id }) }
      row(c, 'boms', { itemId: b.itemId, revision: Math.max(...c.s.boms.filter(x => x.itemId === b.itemId).map(x => x.revision)) + 1, components: [...merged.values()], routing: b.routing, note: `Merged ${dup.sku} into ${keep.sku}`, status: 'active' })
    }
    for (const p of positions(c.s).filter(x => x.itemId === dup.id)) {
      const q = decimal(p.quantity, 'quantity', { signed: true })
      const out = move(c, { itemId: dup.id, locationId: p.locationId, status: p.status as any, lotId: p.lotId, quantity: -q, kind: 'merge', documentKind: 'proposals', documentId: proposal.id, reason: `Merged into ${keep.sku}` })
      move(c, { itemId: keep.id, locationId: p.locationId, status: p.status as any, lotId: p.lotId, quantity: q, unitCost: out.unitCost, kind: 'merge', documentKind: 'proposals', documentId: proposal.id, reason: `Merged from ${dup.sku}` })
    }
    return bump(dup, { archived: true, mergedInto: keep.id }).id
  }
  if (proposal.kind === 'reschedule') {
    if (c.s.machineCalendars.length && !proposal.context.capacity) fail('STALE', 'Capacity calendars were configured after this proposal. Prepare a finite preview before approval.')
    if (proposal.context.capacity) approveCapacity(c, proposal, earlierSignatures)
    return plan.changes.map((ch: any) => {
      const w = get(c.s, 'workOrders', ch.workOrderId), before = proposal.context.before.find((b: any) => b.workOrderId === w.id)
      if (w.version !== before.version) fail('STALE', `${w.reference} changed since this was prepared. Ask for a fresh proposal.`)
      return bump(w, { priority: Number.isSafeInteger(ch.priority) ? ch.priority : w.priority, plannedStart: ch.plannedStart, ...(ch.scheduleChoices ? { scheduleChoices: ch.scheduleChoices } : {}) }).id
    })
  }
  if (proposal.kind === 'reconciliation') {
    const h = get(c.s, 'handoffs', plan.handoffId)
    if (h.version !== proposal.context.handoffVersion) fail('STALE', 'The batch changed since this was prepared.')
    return handoff(c, 'handoff.acknowledge', { handoffId: h.id, version: h.version, entries: plan.entries.map((e: any) => ({ ...e, note: `Matched by proposal: ${proposal.summary}` })) })!.id
  }
}

export function proposals(c: Context, type: string, p: any): Row | undefined {
  if (type.startsWith('proposal.')) {
    const allowed = type === 'proposal.prepare' ? ['kind', 'summary', 'assumptions', 'evidence', 'plan']
      : ['proposalId', 'version', 'note', 'override']
    if (Object.keys(p).some(k => !allowed.includes(k))) fail('INPUT', 'Proposal classes, consequences and decision attribution are computed by the server.')
  }
  switch (type) {
    case 'proposal.prepare':
      allow(c, ['manager', 'sales', 'planner', 'buyer', 'production', 'warehouse', 'accounts', 'agent'])
      return prepare(c, p)
    case 'proposal.approve':
    case 'proposal.reject': {
      if (c.actor.role === 'agent' || c.actor.role === 'viewer') forbidden('Agents prepare; a person with authority approves.')
      const proposal = get(c.s, 'proposals', p.proposalId, 'proposal'); fresh(proposal, p.version)
      const rescheduling = proposal.kind === 'reschedule' && type === 'proposal.approve'
      if (rescheduling) authorize(c, approvers.reschedule, 'schedule', proposal.preparedBy)
      else approver(c, approvers[proposal.kind], proposal.preparedBy)
      if (proposal.status !== 'awaiting approval') fail('STATE', 'This proposal was already decided.')
      const decision = type === 'proposal.approve' ? 'approved' : 'rejected'
      // GOV-009: a reschedule whose largest per-job delay is at or above the schedule threshold needs the policy signatures.
      const signed = rescheduling ? gate(c, { category: 'schedule', subjectKind: 'proposals', subject: proposal, measure: () => largestJobDelay(proposal.context.capacity?.effects), permitted: approvers.reschedule, preparedBy: proposal.preparedBy, p }) : null
      if (signed && 'pending' in signed) return signed.pending
      const computed = currentClassification(c, proposal)
      const recordedDecision = { decision, by: c.actor.id, role: c.actor.role, at: c.now, commandId: c.commandId,
        proposalVersion: proposal.version, inputsDigest: computed.inputsDigest,
        actionClasses: computed.classes, classes: decision === 'approved' ? computed.classes : ['standard'],
        effect: decision === 'approved' ? computed.facts.effect : 'no business action', classification: computed }
      const approval = row(c, 'approvals', { subjectKind: 'proposals', subjectId: proposal.id, subjectVersion: proposal.version, decision, role: c.actor.role, recordedDecision, note: optionalText(p.note, 'note', 1000), ...(signed ? { signatureIds: signed.signatureIds, override: signed.override } : {}) })
      signed?.consume(approval.id)
      // Each earlier signature was its own command, so the preview's snapshot has moved on by exactly that many versions.
      const result = decision === 'approved' ? execute(c, proposal, signed ? signed.signatureIds.length - 1 : 0) : null
      return bump(proposal, { status: decision, approvalId: approval.id, decidedBy: c.actor.id, decision: recordedDecision, result })
    }
  }
}

