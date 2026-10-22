// Agent-prepared proposals. An agent (or a person) prepares; a different person
// with authority approves the exact version, and only then does anything change.
// Supplied documents such as an emailed enquiry are kept as data, never obeyed.
import { capacityPreview, approveCapacity } from './scheduling/reschedule'
import { sha256, canonicalJson } from '../modules/import-kit/src/d1/index'
import { decimal, format, times } from './decimal'
import { fail, forbidden } from './problem'
import { allow, approver, type Role } from './roles'
import { createQuote } from './sales'
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

function prepare(c: Context, p: any) {
  const kind = proposalKinds.includes(p.kind) ? p.kind : fail('INPUT', `kind must be one of ${proposalKinds.join(', ')}.`)
  const plan = p.plan ?? fail('INPUT', 'A proposal needs a plan.')
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
  return row(c, 'proposals', { kind, summary: text(p.summary, 'summary', 400), assumptions: optionalText(p.assumptions, 'assumptions', 4000), evidence, plan, context, status: 'awaiting approval', preparedBy: c.actor.id, preparedRole: c.actor.role, snapshotVersion: c.s.version })
}

function execute(c: Context, proposal: Row): unknown {
  const plan = proposal.plan
  if (proposal.kind === 'order-intake') {
    if (plan.lines.some((l: any) => l.quantity === null)) fail('INCOMPLETE', 'Some quantities are still missing. Ask the customer, then prepare the proposal again.')
    return createQuote(c, { customerId: plan.customerId, promiseDate: plan.promiseDate, lines: plan.lines, note: `Prepared from enquiry; reply approved: ${plan.message}` }, proposal.preparedBy).id
  }
  if (proposal.kind === 'replenishment') {
    if (shortageFingerprint(c.s, proposal.context.itemIds) !== proposal.context.fingerprint) fail('STALE', 'Orders, stock or supply changed since this was prepared. Ask for a fresh proposal.')
    return plan.purchases.map((x: any) => {
      const po = draftPurchase(c, { ...x, reason: `${plan.explanation} (proposal ${proposal.summary})` }, proposal.preparedBy)
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
    if (proposal.context.capacity) approveCapacity(c, proposal)
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
  switch (type) {
    case 'proposal.prepare':
      allow(c, ['manager', 'sales', 'planner', 'buyer', 'production', 'warehouse', 'accounts', 'agent'])
      return prepare(c, p)
    case 'proposal.approve':
    case 'proposal.reject': {
      if (c.actor.role === 'agent' || c.actor.role === 'viewer') forbidden('Agents prepare; a person with authority approves.')
      const proposal = get(c.s, 'proposals', p.proposalId, 'proposal'); fresh(proposal, p.version)
      approver(c, approvers[proposal.kind], proposal.preparedBy)
      if (proposal.status !== 'awaiting approval') fail('STATE', 'This proposal was already decided.')
      const decision = type === 'proposal.approve' ? 'approved' : 'rejected'
      const approval = row(c, 'approvals', { subjectKind: 'proposals', subjectId: proposal.id, subjectVersion: proposal.version, decision, role: c.actor.role, note: optionalText(p.note, 'note', 1000) })
      const result = decision === 'approved' ? execute(c, proposal) : null
      return bump(proposal, { status: decision, approvalId: approval.id, decidedBy: c.actor.id, result })
    }
  }
}

