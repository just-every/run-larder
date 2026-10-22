// GOV-002: approval policies and delegated authority. The owner sets a USD
// threshold, how many distinct people must sign (one or two) and how long a
// signature stays good. A signature binds the exact inputs it saw; when the
// inputs change, or it expires, it stops counting. A deputy signs a principal's
// seat inside a dated delegation; an owner override names its accountable human.
import { canonicalJson, sha256 } from '../modules/import-kit/src/d1/index'
import { decimal, format } from './decimal'
import { fail, forbidden } from './problem'
import { approver, type Role } from './roles'
import { bump, get, oneOf, optionalText, row, text, type Context, type Row, type State } from './model'

// Categories whose approval doors honour a policy today. A threshold for any other
// category is refused rather than stored and ignored.
export const enforcedCategories = ['spend', 'inventoryAdjustment'] as const
const nonApprovers = ['agent', 'viewer', 'operator']
const maxDelegationMs = 30 * 86400000

const inputsOf: Record<string, (s: State, r: Row) => unknown> = {
  purchaseOrders: (_s, po) => ({ supplierId: po.supplierId, currency: po.currency, expectedDate: po.expectedDate, exposure: po.exposure, lines: po.lines.map((l: any) => ({ id: l.id, itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice, expectedDate: l.expectedDate, quote: l.supplierQuote ?? null })) }),
  counts: (s, n) => ({ itemId: n.itemId, locationId: n.locationId, lotId: n.lotId, counted: n.counted, system: n.system, variance: n.variance, unitCost: n.unitCost, movedSince: s.movements.some(m => m.sequence > n.frontier && m.itemId === n.itemId && m.locationId === n.locationId && (!n.sessionId || m.lotId === n.lotId)) }),
}
const digestOf = (s: State, kind: string, r: Row) => sha256(canonicalJson(inputsOf[kind](s, r) as any))

// valid: counts toward approval now; invalidated: the version or exact inputs changed; expired; used: spent by the approval it completed.
export function signatureStatus(s: State, sig: Row, now: string) {
  if (sig.consumedBy) return 'used'
  const subject = (s as any)[sig.subjectKind]?.find((r: Row) => r.id === sig.subjectId) as Row | undefined
  if (!subject || subject.version !== sig.subjectVersion || digestOf(s, sig.subjectKind, subject) !== sig.inputsDigest) return 'invalidated'
  return now > sig.expiresAt ? 'expired' : 'valid'
}

function activeDelegation(c: Context, d: Row, permitted: Role[]) {
  const principal = c.people?.find(x => x.id === d.principalId)
  return d.status === 'active' && d.validFrom <= c.now && c.now < d.validUntil && !!principal && (principal.role === 'owner' || permitted.includes(principal.role as Role))
}

// Who is signing: the person in their own role, or a deputy for a principal's seat.
export function authorize(c: Context, permitted: Role[], category: string, preparedBy?: string): { seat: string; deputy?: Row } {
  if (c.actor.role === 'agent' || c.actor.role === 'viewer') forbidden('Agents prepare; a person with authority approves.')
  const own = c.actor.role === 'owner' || permitted.includes(c.actor.role as Role)
  const deputy = own ? undefined : c.s.approvalDelegations.find(d => d.deputyId === c.actor.id && d.categories.includes(category) && activeDelegation(c, d, permitted))
  if (!deputy) { approver(c, permitted, preparedBy); return { seat: c.actor.id } }
  if (preparedBy && (preparedBy === c.actor.id || preparedBy === deputy.principalId)) forbidden('A different person must approve what you or your principal prepared.')
  return { seat: deputy.principalId, deputy }
}

type Gate = { pending: Row } | { signatureIds: string[]; override: Row['override']; consume: (approvalId: string) => void }

// Null when no policy applies: the door keeps its single-approver behaviour.
export function gate(c: Context, o: { category: string; subjectKind: string; subject: Row; valueUsd: bigint; permitted: Role[]; preparedBy?: string; p: any }): Gate | null {
  const policy = c.s.approvalPolicies.find(x => x.category === o.category && x.enabled)
  if (!policy || o.valueUsd < decimal(policy.threshold)) return null
  const who = authorize(c, o.permitted, o.category, o.preparedBy)
  const live = c.s.approvalSignatures.filter(x => x.subjectKind === o.subjectKind && x.subjectId === o.subject.id && signatureStatus(c.s, x, c.now) === 'valid'
    && !!c.people?.some(person => person.id === x.signerId) && (!x.delegationId || c.s.approvalDelegations.find(d => d.id === x.delegationId)?.status === 'active'))
  let override: Row['override'] = null
  if (o.p.override !== undefined) {
    if (c.actor.role !== 'owner') forbidden('Only the owner can override a dual approval.')
    const named = c.people?.find(x => x.id === o.p.override?.accountableId && ['owner', 'manager'].includes(x.role))
    if (!named) fail('INPUT', 'Name the accountable owner or manager for this override.', { field: 'override.accountableId' })
    override = { reason: text(o.p.override?.reason, 'override reason', 400), accountableId: named!.id, accountableName: named!.name, overriddenAt: c.now }
  }
  if (live.some(x => x.signerId === c.actor.id || x.seat === who.seat)) fail('DUPLICATE_SIGNATURE', 'You, or the person you stand in for, already signed these exact inputs. A different person must sign next.')
  const needed = override ? 1 : policy.signatures
  const signature = row(c, 'approvalSignatures', {
    category: o.category, policyId: policy.id, policyVersion: policy.version, subjectKind: o.subjectKind, subjectId: o.subject.id, subjectVersion: o.subject.version, inputsDigest: digestOf(c.s, o.subjectKind, o.subject),
    valueUsd: format(o.valueUsd), signerId: c.actor.id, signerName: c.actor.name, signerRole: c.actor.role, seat: who.seat, onBehalfOf: who.deputy ? who.seat : null, delegationId: who.deputy?.id ?? null,
    note: optionalText(o.p.note, 'note', 400), signedAt: c.now, expiresAt: new Date(Date.parse(c.now) + policy.expiryMinutes * 60000).toISOString(), override, remainingAtSigning: Math.max(0, needed - live.length - 1),
  })
  if (live.length + 1 < needed) return { pending: signature }
  return { signatureIds: [...live.map(x => x.id), signature.id], override, consume: approvalId => { for (const x of [...live, signature]) bump(x, { consumedBy: approvalId }) } }
}

export function approvalCommand(c: Context, type: string, p: any): Row | undefined {
  switch (type) {
    case 'approval.policy': {
      if (c.actor.role !== 'owner') forbidden('Only the owner sets approval policies.')
      const category = oneOf(p.category, enforcedCategories, 'category')
      const threshold = format(decimal(p.thresholdUsd, 'threshold (USD)'))
      const signatures = p.signatures === 1 || p.signatures === 2 ? p.signatures as number : fail('INPUT', 'signatures must be 1 or 2.', { field: 'signatures' })
      const expiryMinutes = p.expiryMinutes === undefined ? 1440 : Number.isSafeInteger(p.expiryMinutes) && p.expiryMinutes >= 1 && p.expiryMinutes <= 43200 ? p.expiryMinutes : fail('INPUT', 'expiryMinutes must be a whole number from 1 to 43200.', { field: 'expiryMinutes' })
      const reason = text(p.reason, 'reason', 400), enabled = p.enabled !== false
      const existing = c.s.approvalPolicies.find(x => x.category === category)
      const entry = { at: c.now, by: c.actor.id, reason, threshold, signatures, expiryMinutes, enabled }
      if (!existing) return row(c, 'approvalPolicies', { category, threshold, signatures, expiryMinutes, enabled, history: [entry] })
      return bump(existing, { threshold, signatures, expiryMinutes, enabled, history: [...existing.history, entry] })
    }
    case 'approval.deputize': {
      if (!['owner', 'manager', 'buyer'].includes(c.actor.role)) forbidden('Only a person holding approval authority names a deputy.')
      const deputy = c.people?.find(x => x.id === p.deputyId)
      if (!deputy || deputy.id === c.actor.id || nonApprovers.includes(deputy.role)) fail('INPUT', 'Choose another active person who can hold approval authority (not an agent, viewer or operator).', { field: 'deputyId' })
      const until = typeof p.validUntil === 'string' ? Date.parse(p.validUntil) : NaN, now = Date.parse(c.now)
      if (!(until > now) || until - now > maxDelegationMs) fail('INPUT', 'validUntil must be a future time within 30 days.', { field: 'validUntil' })
      const categories = p.categories === undefined ? [...enforcedCategories] : (Array.isArray(p.categories) && p.categories.length ? p.categories : fail('INPUT', 'Choose at least one category.')).map((x: unknown) => oneOf(x, enforcedCategories, 'category'))
      return row(c, 'approvalDelegations', { principalId: c.actor.id, principalName: c.actor.name, principalRole: c.actor.role, deputyId: deputy!.id, deputyName: deputy!.name, categories, validFrom: c.now, validUntil: new Date(until).toISOString(), reason: text(p.reason, 'reason', 400), status: 'active' })
    }
    case 'approval.revokeDeputy': {
      const d = get(c.s, 'approvalDelegations', p.delegationId, 'delegation')
      if (c.actor.role !== 'owner' && c.actor.id !== d.principalId) forbidden('Only the principal or the owner revokes a deputy.')
      if (d.status !== 'active') fail('STATE', 'This delegation was already revoked.')
      return bump(d, { status: 'revoked', revokedBy: c.actor.id, revokedAt: c.now, revokeReason: text(p.reason, 'reason', 400) })
    }
  }
}
