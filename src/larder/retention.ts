// Explicit owner decisions only. Production and financial history remain intact.
import { bump, fresh, get, oneOf, row, text, type Context, type Row, type State, retentionKinds } from './model'
import { fail, forbidden } from './problem'
import { erasurePlan, scrubPersonalValues, tombstone } from './audit-erasure'

export function retentionPreview(s: State, actor: { role: string }, partyId: unknown, now = new Date().toISOString()) {
  if (actor.role !== 'owner') forbidden('Only the owner reviews retention or erasure.')
  const party = get(s, 'parties', partyId, 'contact')
  const holds = s.retentionHolds.filter(h => h.active)
  const policy = s.retentionPolicies.find(r => r.category === 'contacts')
  const created = Date.parse(party.createdAt)
  if (policy && !Number.isFinite(created)) fail('RETENTION', 'This contact needs a dated creation record before retention eligibility can be reviewed.')
  const eligibleAt = policy ? new Date(created + policy.minimumDays * 86400000).toISOString() : null
  const linked = [...s.salesOrders.filter(r => r.customerId === party.id).map(r => ({ kind: 'salesOrders', id: r.id })), ...s.purchaseOrders.filter(r => r.supplierId === party.id).map(r => ({ kind: 'purchaseOrders', id: r.id }))]
  return {
    version: s.version, partyId: party.id, contactVersion: party.version, subject: { name: party.name, email: party.email },
    eligibleFields: ['name', 'email'], policy: policy ?? null, eligibleAt,
    periodBlocked: Boolean(eligibleAt && now < eligibleAt),
    blocked: holds.some(h => h.kind === 'parties' && h.recordId === party.id),
    legalHolds: holds.map(h => ({ id: h.id, kind: h.kind, recordId: h.recordId, reason: h.reason })),
    retained: [
      { category: 'production and financial trace', reason: 'Retained for the life of the installation; quantities, values and record links are unchanged.', linked },
      { category: 'documents and model context', reason: 'Not erased by this contact-only door; original evidence and held certificates are retained.' },
      { category: 'immutable movement text', reason: 'Movement history is append-only; free text is not replaced by this contact-only door.' },
      { category: 'previously downloaded archives', reason: 'Outside installation control; no deletion claimed.' },
    ],
    outcomes: { search: 'Live contact name and email are replaced; other record text is retained.', cache: 'API responses use no-store; client copies are not remotely deleted.', providers: 'Not attempted; this door makes no provider deletion request.', archive: 'Future business archives use the replaced contact and command outcomes; earlier exports remain outside control.' },
  }
}

const operatorRetained = ['Movement identities, quantities, values and immutable text: append-only production trace', 'All documents, messages and model context: indefinite evidence preservation', 'Native security records and external identities: not erased by this limited door', 'Previously downloaded archives and uncontrolled copies: outside installation control']
const operatorOutcomes = { search: 'Native display name and email and cached human labels are replaced.', cache: 'Recorded command labels are replaced; responses use no-store.', archive: 'Future archives replace the former operator display name; earlier downloads are outside control.', providers: 'Not attempted; no outbound request.' }

export async function operatorRetentionPreview(db: D1Database, s: State, actor: { role: string }, operatorId: unknown) {
  const plan = await erasurePlan(db, s, actor, { operatorId })
  return { version: s.version, operatorId: plan.id, operatorVersion: plan.operatorVersion, subject: plan.subject,
    blocked: plan.operatorStatus !== 'inactive' || (plan.subject?.name.trim().length ?? 0) < 3 || s.retentionHolds.some(h => h.active),
    eligibleFields: ['native display name', 'native email', 'cached human labels', 'audit personal values'],
    linkedMovements: s.movements.filter(m => m.actorId === plan.id).map(m => m.id),
    retained: operatorRetained,
    outcomes: operatorOutcomes }
}

export function retention(c: Context, type: string, p: any): Row | undefined {
  if (!['retention.configure', 'retention.hold', 'retention.release', 'erasure.contact', 'erasure.operator'].includes(type)) return
  if (c.actor.role !== 'owner') forbidden('Only the owner decides retention or erasure.')
  if (type === 'retention.configure') {
    const category = oneOf(p.category, ['contacts', 'production and financial trace', 'documents'] as const, 'retention category')
    if (!Number.isSafeInteger(p.minimumDays) || p.minimumDays < 0 || p.minimumDays > 36500) fail('INPUT', 'Enter a minimum retention period from 0 to 36500 whole days.')
    const reason = text(p.reason, 'retention reason', 400)
    const old = c.s.retentionPolicies.find(r => r.category === category)
    const data = { category, jurisdiction: 'US', minimumDays: p.minimumDays, reason, automaticDeletion: false, indefinitePreservation: category !== 'contacts' }
    if (old) { fresh(old, p.version); return bump(old, data) }
    if (p.version !== undefined) fail('STALE', 'This retention category has no current policy.')
    return row(c, 'retentionPolicies', data)
  }
  if (type === 'retention.hold') {
    const kind = oneOf(p.kind, retentionKinds, 'record kind'), record = get(c.s, kind, p.recordId)
    if (c.s.retentionHolds.some(h => h.active && h.kind === kind && h.recordId === record.id)) fail('STATE', 'This record already has a legal hold.')
    return row(c, 'retentionHolds', { kind, recordId: record.id, active: true, reason: text(p.reason, 'legal hold reason', 400) })
  }
  if (type === 'retention.release') {
    const hold = get(c.s, 'retentionHolds', p.holdId, 'legal hold')
    fresh(hold, p.version)
    if (!hold.active) fail('STATE', 'This hold is already released.')
    return bump(hold, { active: false, releasedAt: c.now, releasedBy: c.actor.id, releaseReason: text(p.reason, 'release reason', 400) })
  }
  if (type === 'erasure.operator') {
    const plan = c.erasure ?? fail('INPUT', 'Review the former operator first.')
    if (p.reviewedVersion !== c.s.version || p.operatorVersion !== plan.operatorVersion) fail('STALE', 'Review the current subject and records before erasure.')
    if (p.consent !== true) fail('INPUT', 'Explicit consent to this current operator review is required.')
    if (plan.operatorStatus !== 'inactive') fail('STATE', 'Deactivate the former operator before anonymization.')
    if ((plan.subject?.name.trim().length ?? 0) < 3) fail('INPUT', 'Short operator names need a field-specific audit review before erasure.')
    // Native authority records are not business rows. Any current hold conservatively fences this wider subject decision.
    if (c.s.retentionHolds.some(h => h.active)) fail('LEGAL_HOLD', 'Resolve all current legal holds before former-operator anonymization.')
    if (c.s.contactErasures.some(r => r.subjectKind === 'operator' && r.subjectId === plan.id)) fail('STATE', 'This operator has already been anonymized.')
    return row(c, 'contactErasures', { id: c.commandId, subjectKind: 'operator', subjectId: plan.id, reviewedVersion: p.reviewedVersion, operatorVersion: p.operatorVersion, scope: 'native display name and email, cached human labels and audit personal values', consent: true, reason: scrubPersonalValues(text(p.reason, 'reason', 400), plan.values), outcomes: operatorOutcomes, retained: operatorRetained, linkedMovements: c.s.movements.filter(m => m.actorId === plan.id).map(m => m.id) })
  }
  const preview = retentionPreview(c.s, c.actor, p.partyId, c.now)
  if (p.reviewedVersion !== c.s.version) fail('STALE', 'Review current retention outcomes before erasure.')
  if (p.consent !== true) fail('INPUT', 'Explicit consent to the reviewed contact-only erasure is required.')
  if (preview.blocked) fail('LEGAL_HOLD', 'A legal hold retains this contact. Release it explicitly before erasure.')
  if (preview.periodBlocked) fail('RETENTION', 'The configured minimum retention period has not elapsed.')
  const party = get(c.s, 'parties', p.partyId)
  if (String(party.name).trim().length < 3) fail('INPUT', 'Short contact names need a field-specific audit review before erasure.')
  if (party.contactErasedAt) fail('STATE', 'This contact has already been anonymized.')
  const plan = c.erasure ?? fail('INPUT', 'Review the contact erasure first.')
  const reason = scrubPersonalValues(text(p.reason, 'reason', 400), plan.values)
  bump(party, { name: tombstone, email: '', contactErasedAt: c.now })
  return row(c, 'contactErasures', { id: c.commandId, subjectId: party.id, scope: 'contact name and email', reason, consent: true, reviewedVersion: p.reviewedVersion, outcomes: preview.outcomes, retained: preview.retained })
}

// Holds fence every business command, including import undo and record editors.
export function enforceRetention(before: State, next: State, undoId?: unknown) {
  for (const hold of before.retentionHolds.filter(h => h.active)) {
    if (!next.retentionHolds.some(h => h.id === hold.id && h.active)) continue
    if (!(retentionKinds as readonly string[]).includes(hold.kind)) fail('LEGAL_HOLD', 'Unknown held category requires owner review.')
    const kind = hold.kind as typeof retentionKinds[number]
    for (const batch of next.imports.filter(b => (b.id === undoId && b.status === 'committed') || (b.status === 'undone' && before.imports.some(old => old.id === b.id && old.status === 'committed')))) {
      if ((batch.created ?? []).some((r: any) => r.kind === kind && r.id === hold.recordId) || (batch.changed ?? []).some((r: any) => r.kind === kind && r.data?.id === hold.recordId)) fail('LEGAL_HOLD', 'A held record belongs to this move-in. Release the hold explicitly before undo.')
    }
    const previous = before[kind].find(r => r.id === hold.recordId)
    const current = next[kind].find(r => r.id === hold.recordId)
    if (JSON.stringify(previous) !== JSON.stringify(current)) fail('LEGAL_HOLD', 'This record is legally held. Release the hold explicitly before changing it.')
  }
}
