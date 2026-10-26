// Explicit owner decisions only. Production and financial history remain intact.
import { bump, fresh, get, oneOf, row, text, type Context, type Row, type State } from './model'
import { fail, forbidden } from './problem'
import { scrubPersonalValues, tombstone } from './audit-erasure'

export const retentionKinds = ['parties', 'certificates', 'sourceHistory', 'receipts', 'handoffs'] as const

export function retentionPreview(s: State, actor: { role: string }, partyId: unknown) {
  if (actor.role !== 'owner') forbidden('Only the owner reviews retention or erasure.')
  const party = get(s, 'parties', partyId, 'contact')
  const holds = s.retentionHolds.filter(h => h.active)
  const linked = [...s.salesOrders.filter(r => r.customerId === party.id).map(r => ({ kind: 'salesOrders', id: r.id })), ...s.purchaseOrders.filter(r => r.supplierId === party.id).map(r => ({ kind: 'purchaseOrders', id: r.id }))]
  return {
    version: s.version, partyId: party.id, contactVersion: party.version,
    eligibleFields: ['name', 'email'],
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

export function retention(c: Context, type: string, p: any): Row | undefined {
  if (!['retention.hold', 'retention.release', 'erasure.contact'].includes(type)) return
  if (c.actor.role !== 'owner') forbidden('Only the owner decides retention or erasure.')
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
  const preview = retentionPreview(c.s, c.actor, p.partyId)
  if (p.reviewedVersion !== c.s.version) fail('STALE', 'Review current retention outcomes before erasure.')
  if (p.consent !== true) fail('INPUT', 'Explicit consent to the reviewed contact-only erasure is required.')
  if (preview.blocked) fail('LEGAL_HOLD', 'A legal hold retains this contact. Release it explicitly before erasure.')
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
