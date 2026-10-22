// GOV-002: approval policies and delegated authority. The owner sets, per
// category, a threshold, how many distinct people must sign (one or two) and how
// long a signature stays good. A signature binds the exact inputs it saw; when the
// inputs change, it expires or its signer loses the authority, it stops counting.
// A deputy signs a principal's seat inside a dated delegation; an owner override
// names its accountable human.
import { canonicalJson, sha256 } from '../modules/import-kit/src/d1/index'
import { decimal, format } from './decimal'
import { fail, forbidden } from './problem'
import { approver, type Role } from './roles'
import { balance } from './stock'
import { bump, get, oneOf, optionalText, row, text, type Context, type Row, type State } from './model'
import { integer } from './scheduling/calendars'
import { planningDigest } from './scheduling/fingerprint'

// Categories whose approval doors honour a policy today. A threshold for any other
// category is refused rather than stored and ignored: no Larder door posts to a ledger yet.
// A schedule threshold is whole minutes of per-job delay.
export const enforcedCategories = ['spend', 'inventoryAdjustment', 'margin', 'quality', 'schedule'] as const
// A margin policy is a floor in percent: an order below it, or whose margin is unknown,
// needs the signatures. Every other category is a USD amount at or above its threshold.
const floors = ['margin']
const nonApprovers = ['agent', 'viewer', 'operator']
const maxDelegationMs = 30 * 86400000
// Who holds each category's authority in their own role (the owner holds every one). A door
// may narrow it to its own roles; each signature records the roles it was given under.
const permittedFor: Record<string, string[]> = { spend: ['manager', 'buyer'], inventoryAdjustment: ['manager', 'quality', 'warehouse'], margin: ['manager'], quality: ['manager', 'quality', 'warehouse'], schedule: ['manager', 'planner', 'production'] }
const holdsCategory = (role: string, category: string) => role === 'owner' || (permittedFor[category] ?? []).includes(role)
type Person = { id: string; role: string }

const lineCost = (s: State, itemId: string) => s.items.find(i => i.id === itemId)?.standardCost ?? null
const quarantined = (s: State, t: any) => format(balance(s, t.itemId, t.locationId, 'quarantine', t.lotId ?? ''))
// An expiry-disposition write-off binds the available stock it scraps; a release or rejection binds the quarantine it clears.
const stockOf = (s: State, t: any) => t?.decision === 'scrap' ? { available: format(balance(s, t.itemId, t.locationId, 'available', t.lotId ?? '')) } : { quarantine: quarantined(s, t) }
// The current inputs each kind of decision depends on; the decision's own terms (a quantity,
// an inspection, a deviation) are bound alongside them.
const inputsOf: Record<string, (s: State, r: Row, terms: any, people?: Person[]) => unknown> = {
  purchaseOrders: (_s, po) => ({ supplierId: po.supplierId, currency: po.currency, expectedDate: po.expectedDate, exposure: po.exposure, lines: po.lines.map((l: any) => ({ id: l.id, itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice, tolerancePercent: l.tolerancePercent ?? '0', expectedDate: l.expectedDate, quote: l.supplierQuote ?? null })) }),
  counts: (s, n) => ({ itemId: n.itemId, locationId: n.locationId, lotId: n.lotId, counted: n.counted, system: n.system, variance: n.variance, unitCost: n.unitCost, movedSince: s.movements.some(m => m.sequence > n.frontier && m.itemId === n.itemId && m.locationId === n.locationId && (!n.sessionId || m.lotId === n.lotId)) }),
  salesOrders: (s, o) => ({ customerId: o.customerId, promiseDate: o.promiseDate, status: o.status, lines: o.lines.map((l: any) => ({ id: l.id, itemId: l.itemId, quantity: l.quantity, cancelled: l.cancelled ?? '0', unitPrice: l.unitPrice, standardCost: lineCost(s, l.itemId) })) }),
  orderChanges: (s, x) => ({ status: x.status, stateVersion: x.stateVersion, lines: x.after.lines.map((l: any) => ({ ...l, standardCost: lineCost(s, l.itemId) })) }),
  qualityHolds: (s, h) => ({ status: h.status, held: h.held, lots: h.lots, inspections: s.inspections.filter(i => i.planId === h.planId && i.subjectId === h.subjectId).map(i => i.id), quarantine: h.held.map((x: any) => format(balance(s, s.lots.find(l => l.id === x.lotId)?.itemId ?? '', x.locationId, 'quarantine', x.lotId))) }),
  nonconformances: (s, n, t) => ({ status: n.status, remaining: n.remaining, lotVersion: s.lots.find(l => l.id === n.lotId)?.version ?? null, inspections: s.inspections.filter(i => i.subjectId === n.id).map(i => i.id), deviation: t?.deviationId ? (n.deviationProposals ?? []).find((d: any) => d.id === t.deviationId) ?? null : null }),
  // A schedule plan stops counting once the planning inputs it was built on have changed; a grant or a
  // reschedule proposal is bound by its version and by the work and calendars it moves.
  schedulePlans: (s, p, _t, people) => ({ status: p.status, inputDigest: p.inputDigest, current: !people || planningDigest(s, people as any) === p.inputDigest, changes: sha256(canonicalJson({ effects: p.effects, changes: p.changes, overtime: p.overtime, extraWork: p.extraWork, operations: p.after.operations })) }),
  scheduleGrants: (_s, g) => ({ status: g.status, eventTypes: g.eventTypes, machineIds: g.machineIds, workOrderIds: g.workOrderIds, maxDelayMinutes: g.maxDelayMinutes, maxDisplacementMinutes: g.maxDisplacementMinutes, expiresAt: g.expiresAt, protectionVersion: g.protectionVersion }),
  proposals: (s, p) => ({ status: p.status, work: (p.plan?.changes ?? []).map((ch: any) => [ch.workOrderId, ch.plannedStart, s.workOrders.find(w => w.id === ch.workOrderId)?.version ?? null]), calendars: [...s.machineCalendars, ...s.laborCalendars].map(x => [x.id, x.version]) }),
  lots: (s, _lot, t) => stockOf(s, t),
  items: (s, _item, t) => stockOf(s, t),
}
// Decisions without terms keep the digest of their inputs alone.
const digestOf = (s: State, kind: string, r: Row, terms: unknown, people?: Person[]) => sha256(canonicalJson((terms === null || terms === undefined ? inputsOf[kind](s, r, null, people) : { inputs: inputsOf[kind](s, r, terms, people), terms }) as any))

// A delegation is live while it is active and in date and its principal still holds the authority.
function liveDelegation(d: Row | undefined, people: Person[] | undefined, permitted: readonly string[], now: string) {
  const principal = people?.find(x => x.id === d?.principalId)
  return !!d && d.status === 'active' && d.validFrom <= now && now < d.validUntil && !!principal && (principal.role === 'owner' || permitted.includes(principal.role))
}

// Whether a signature's signer, or the principal a deputy stood in for, still holds the authority
// it was given under (judged against the active people).
export function authorityHeld(s: State, sig: Row, now: string, people: Person[]) {
  const signer = people.find(x => x.id === sig.signerId), permitted: string[] = sig.permitted ?? permittedFor[sig.category] ?? []
  return !!signer && (sig.delegationId ? !nonApprovers.includes(signer.role) && liveDelegation(s.approvalDelegations.find(d => d.id === sig.delegationId), people, permitted, now) : signer.role === 'owner' || permitted.includes(signer.role))
}

// valid: counts toward approval now; invalidated: the version or exact inputs changed; expired;
// withdrawn: the signer, or the principal a deputy stood in for, no longer holds the authority
// (judged when the active people are known); used: spent by the approval it completed. A change
// to the owner's policy never moves a signature between these: it applies to the next decision.
export function signatureStatus(s: State, sig: Row, now: string, people?: Person[]) {
  if (sig.consumedBy) return 'used'
  const subject = (s as any)[sig.subjectKind]?.find((r: Row) => r.id === sig.subjectId) as Row | undefined
  if (!subject || subject.version !== sig.subjectVersion || digestOf(s, sig.subjectKind, subject, sig.terms, people) !== sig.inputsDigest) return 'invalidated'
  if (now > sig.expiresAt) return 'expired'
  if (people && !authorityHeld(s, sig, now, people)) return 'withdrawn'
  return 'valid'
}

// Who is signing: the person in their own role, or a deputy for a principal's seat.
export function authorize(c: Context, permitted: Role[], category: string, preparedBy?: string): { seat: string; deputy?: Row } {
  if (c.actor.role === 'agent' || c.actor.role === 'viewer') forbidden('Agents prepare; a person with authority approves.')
  const own = c.actor.role === 'owner' || permitted.includes(c.actor.role as Role)
  const deputy = own ? undefined : c.s.approvalDelegations.find(d => d.deputyId === c.actor.id && d.categories.includes(category) && liveDelegation(d, c.people, permitted, c.now))
  if (!deputy) { approver(c, permitted, preparedBy); return { seat: c.actor.id } }
  if (preparedBy && (preparedBy === c.actor.id || preparedBy === deputy.principalId)) forbidden('A different person must approve what you or your principal prepared.')
  return { seat: deputy.principalId, deputy }
}

// The enabled policy a decision falls under, with the measured value, when the value crosses it.
// The measure is computed only when the owner set a policy for the category.
export function policyFor(c: Context, category: string, measure: () => bigint | null) {
  const policy = c.s.approvalPolicies.find(x => x.category === category && x.enabled)
  if (!policy) return null
  const value = measure(), threshold = decimal(policy.threshold)
  const applies = floors.includes(category) ? value === null || value < threshold : value !== null && value >= threshold
  return applies ? { policy, value } : null
}

type Gate = { pending: Row } | { signatureIds: string[]; override: Row['override']; seat: string; consume: (byId: string) => void }
type Decision = { category: string; subjectKind: string; subject: Row; measure: () => bigint | null; permitted: Role[]; preparedBy?: string; terms?: Record<string, unknown>; p: any }

// Null when no policy applies: the door keeps its single-approver behaviour. A decision that
// already holds a valid signature completes under the policy it began under, so changing a
// threshold, signature count or lifetime takes effect on the next decision, never mid-decision.
export function gate(c: Context, o: Decision): Gate | null {
  const terms = o.terms ?? null, same = canonicalJson(terms as any)
  const live = c.s.approvalSignatures.filter(x => x.subjectKind === o.subjectKind && x.subjectId === o.subject.id && x.category === o.category && canonicalJson((x.terms ?? null) as any) === same && signatureStatus(c.s, x, c.now, c.people ?? []) === 'valid')
  const begun = live[0], hit = policyFor(c, o.category, o.measure)
  if (!hit && !begun) return null
  const policy = begun ? { id: begun.policyId, version: begun.policyVersion, signatures: begun.signaturesRequired ?? hit?.policy.signatures ?? 2, expiryMinutes: begun.expiryMinutes ?? hit?.policy.expiryMinutes ?? 1440 } : hit!.policy
  const value = hit?.value ?? o.measure()
  const who = authorize(c, o.permitted, o.category, o.preparedBy)
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
    category: o.category, policyId: policy.id, policyVersion: policy.version, signaturesRequired: policy.signatures, expiryMinutes: policy.expiryMinutes, subjectKind: o.subjectKind, subjectId: o.subject.id, subjectVersion: o.subject.version, inputsDigest: digestOf(c.s, o.subjectKind, o.subject, terms, c.people), terms, permitted: o.permitted,
    ...(floors.includes(o.category) ? { marginPercent: value === null ? null : format(value) } : o.category === 'schedule' ? { delayMinutes: format(value!) } : { valueUsd: format(value!) }),
    signerId: c.actor.id, signerName: c.actor.name, signerRole: c.actor.role, seat: who.seat, onBehalfOf: who.deputy ? who.seat : null, delegationId: who.deputy?.id ?? null,
    note: optionalText(o.p.note, 'note', 400), signedAt: c.now, expiresAt: new Date(Date.parse(c.now) + policy.expiryMinutes * 60000).toISOString(), override, remainingAtSigning: Math.max(0, needed - live.length - 1),
  })
  if (live.length + 1 < needed) return { pending: signature }
  return { signatureIds: [...live.map(x => x.id), signature.id], override, seat: who.seat, consume: byId => { for (const x of [...live, signature]) bump(x, { consumedBy: byId }) } }
}

export function approvalCommand(c: Context, type: string, p: any): Row | undefined {
  switch (type) {
    case 'approval.policy': {
      if (c.actor.role !== 'owner') forbidden('Only the owner sets approval policies.')
      const category = oneOf(p.category, enforcedCategories, 'category'), floor = floors.includes(category), minutes = category === 'schedule'
      const threshold = format(floor ? decimal(p.thresholdPercent, 'margin floor (percent)') : minutes ? decimal(String(integer(p.thresholdMinutes, 'schedule threshold (minutes of per-job delay)', 0, 86400))) : decimal(p.thresholdUsd, 'threshold (USD)'))
      if (floor && decimal(threshold) > decimal('100')) fail('INPUT', 'A margin floor is a percentage from 0 to 100.', { field: 'thresholdPercent' })
      const signatures = p.signatures === 1 || p.signatures === 2 ? p.signatures as number : fail('INPUT', 'signatures must be 1 or 2.', { field: 'signatures' })
      const expiryMinutes = p.expiryMinutes === undefined ? 1440 : Number.isSafeInteger(p.expiryMinutes) && p.expiryMinutes >= 1 && p.expiryMinutes <= 43200 ? p.expiryMinutes : fail('INPUT', 'expiryMinutes must be a whole number from 1 to 43200.', { field: 'expiryMinutes' })
      const reason = text(p.reason, 'reason', 400), enabled = p.enabled !== false, unit = floor ? 'percent' : minutes ? 'minutes' : 'USD'
      const existing = c.s.approvalPolicies.find(x => x.category === category)
      const entry = { at: c.now, by: c.actor.id, reason, threshold, unit, signatures, expiryMinutes, enabled }
      if (!existing) return row(c, 'approvalPolicies', { category, threshold, unit, signatures, expiryMinutes, enabled, history: [entry] })
      return bump(existing, { threshold, unit, signatures, expiryMinutes, enabled, history: [...existing.history, entry] })
    }
    case 'approval.deputize': {
      const held = enforcedCategories.filter(x => holdsCategory(c.actor.role, x))
      if (!held.length) forbidden('Only a person holding approval authority names a deputy.')
      const deputy = c.people?.find(x => x.id === p.deputyId)
      if (!deputy || deputy.id === c.actor.id || nonApprovers.includes(deputy.role)) fail('INPUT', 'Choose another active person who can hold approval authority (not an agent, viewer or operator).', { field: 'deputyId' })
      const until = typeof p.validUntil === 'string' ? Date.parse(p.validUntil) : NaN, now = Date.parse(c.now)
      if (!(until > now) || until - now > maxDelegationMs) fail('INPUT', 'validUntil must be a future time within 30 days.', { field: 'validUntil' })
      const categories = p.categories === undefined ? held : (Array.isArray(p.categories) && p.categories.length ? p.categories : fail('INPUT', 'Choose at least one category.')).map((x: unknown) => oneOf(x, held, 'category'))
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
