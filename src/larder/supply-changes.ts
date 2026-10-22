// MRP-002: expedite, defer and cancel recommendations for open purchase lines, read from the shared dated
// MRP-001 allocation, and the buyer's decision on one of them. Approval records the decision with the exact
// recommendation inputs it was given for and, for an excess cancellation, trims only the unallocated
// outstanding quantity; a cancel worth at least the owner's spend threshold needs the GOV-002 signatures. An
// expedite or deferral is a recorded request (nothing is sent and the supplier's delivery date changes only
// through po.revise). Updating the PO line's promise and telling the supplier is MRP-005.
import { canonicalJson, sha256 } from '../modules/import-kit/src/d1/index'
import { gate } from './approval-policy'
import { decimal, format, max, min, times } from './decimal'
import { materialDates } from './material-dates'
import { allow } from './roles'
import { fail } from './problem'
import { addDays } from './forecast-plan'
import { purchaseDate, purchaseNextDate } from './supplier-terms'
import { completeWithinTolerance } from './receiving'
import { status } from './purchasing'
import { bump, row, text, type Context, type Row, type State } from './model'

const openPurchase = ['approved', 'confirmed', 'part received']
export const deferWhenEarlierThanDays = 7

type Served = { kind: string; documentId: string; reference: string; itemId: string; requiredBy: string; quantity: string }

// The exact inputs a decision is given for: the recommendation, the state version and the UTC day it was read on.
const inputsDigest = (version: number, asOf: string, rec: unknown) => sha256(canonicalJson({ version, asOf, rec } as any))

export function supplyChanges(s: State) {
  const plan = materialDates(s), today = plan.asOf
  const served = new Map<string, Served[]>(), needing = new Map<string, typeof plan.requirements>()
  const key = (poId: string, lineId: string) => `${poId}|${lineId}`
  for (const r of plan.requirements) {
    for (const x of r.sources) if (x.kind === 'purchase') {
      const k = key(x.documentId, x.lineId!), list = served.get(k) ?? []
      list.push({ kind: r.kind, documentId: r.documentId, reference: r.reference, itemId: r.itemId, requiredBy: r.requiredBy, quantity: x.quantity }); served.set(k, list)
    }
    for (const x of (r as any).replenishment ?? []) if (x.kind === 'purchase') {
      const k = key(x.documentId, x.lineId), list = served.get(k) ?? []
      list.push({ kind: 'safety', documentId: r.documentId, reference: r.reference, itemId: r.itemId, requiredBy: x.date, quantity: x.quantity }); served.set(k, list)
    }
    if (decimal(r.shortage) > 0n) for (const x of r.unavailablePurchases) if (x.kind === 'purchase' && x.reason === 'after required date') {
      const k = key(x.documentId, x.lineId), list = needing.get(k) ?? []; list.push(r); needing.set(k, list)
    }
  }
  const recommendations: Record<string, unknown>[] = []
  for (const po of s.purchaseOrders.filter(p => openPurchase.includes(p.status))) for (const line of po.lines) {
    const outstanding = max(0n, decimal(line.quantity) - decimal(line.received)), date = purchaseDate(po, line)
    if (outstanding <= 0n || date < today) continue
    const k = key(po.id, line.id), use = served.get(k) ?? [], used = use.reduce((n, x) => n + decimal(x.quantity), 0n), late = needing.get(k) ?? []
    const base = { poId: po.id, lineId: line.id, reference: po.reference, itemId: line.itemId, currentDate: date }
    if (completeWithinTolerance(line)) {
      recommendations.push({ key: JSON.stringify(['cancel', po.id, line.id, format(outstanding)]), kind: 'cancel', ...base, requestedDate: null, quantity: format(outstanding),
        reason: `${format(decimal(line.received))} of ${format(decimal(line.quantity))} delivered, within the line's ${line.tolerancePercent}% tolerance; closing the remainder completes it.`, affected: use })
    } else if (late.length) {
      const requestedDate = late.map(r => r.requiredBy).sort()[0]! > today ? late.map(r => r.requiredBy).sort()[0]! : today
      const quantity = min(outstanding, late.reduce((n, r) => n + decimal(r.shortage), 0n))
      recommendations.push({ key: JSON.stringify(['expedite', po.id, line.id, requestedDate]), kind: 'expedite', ...base, requestedDate, quantity: format(quantity),
        reason: `Arrives ${date}, after ${late.length} short requirement${late.length === 1 ? '' : 's'} need it.`,
        affected: late.map(r => ({ kind: r.kind, documentId: r.documentId, reference: r.reference, itemId: r.itemId, requiredBy: r.requiredBy, shortage: r.shortage })) })
    } else if (outstanding > used) {
      recommendations.push({ key: JSON.stringify(['cancel', po.id, line.id, format(outstanding - used)]), kind: 'cancel', ...base, requestedDate: null, quantity: format(outstanding - used),
        reason: use.length ? `${format(outstanding - used)} of ${format(outstanding)} outstanding is not allocated to any demand.` : 'Nothing allocates this outstanding supply to demand.',
        affected: use })
    } else if (use.length) {
      const first = use.map(x => x.requiredBy).sort()[0]!
      if (first > addDays(date, deferWhenEarlierThanDays - 1))
        recommendations.push({ key: JSON.stringify(['defer', po.id, line.id, first]), kind: 'defer', ...base, requestedDate: first, quantity: format(used),
          reason: `Arrives ${date}, first needed ${first}.`, affected: use })
    }
  }
  // An expedite or deferral already approved for the same date stays visible as a recorded request rather than a new decision.
  const requested = (r: Record<string, unknown>) => {
    const asked = s.purchaseOrders.find(p => p.id === r.poId)?.lines.find((l: any) => l.id === r.lineId)?.supplyRequest
    return asked && asked.kind === r.kind && asked.requestedDate === r.requestedDate ? { by: asked.by, at: asked.at, reason: asked.reason } : null
  }
  return { version: s.version, asOf: today, recommendations: recommendations.map(r => ({ ...r, requested: requested(r), inputsDigest: inputsDigest(s.version, today, r) })),
    scope: 'recommendations on open approved purchase lines from the dated material allocation; a decision records a request or trims excess and sends nothing',
    limitations: ['An expedite or deferral is a recorded request: the supplier’s date changes only through po.revise.', 'A cancellation trims only the unallocated outstanding quantity; received stock and reservations are untouched.', 'Late candidates and shared pools are recomputed on every read, so a recommendation expires when planning inputs or the UTC day change.'] }
}

export function supplyChange(c: Context, type: string, p: any): Row | undefined {
  if (type !== 'supply.change.approve' && type !== 'supply.change.reject') return
  // A buyer decides expedites and deferrals; trimming an order is a manager's (or the owner's) decision. Agents never decide.
  allow(c, ['manager', 'buyer'])
  if (p.version !== c.s.version || p.asOf !== c.now.slice(0, 10)) fail('STALE', 'Planning inputs or the UTC day changed. Read the recommendations again.')
  const rec: any = supplyChanges(c.s).recommendations.find((r: any) => r.key === p.key) ?? fail('NOT_FOUND', 'That recommendation is no longer in the projection.')
  if (p.inputsDigest !== undefined && p.inputsDigest !== rec.inputsDigest) fail('STALE', 'The recommendation inputs changed since you read them. Read the recommendations again.')
  if (rec.requested && type === 'supply.change.approve') fail('STATE', 'That request is already recorded.')
  const reason = text(p.reason, 'decision reason', 400), decision = type === 'supply.change.approve' ? 'approved' : 'rejected'
  const po = c.s.purchaseOrders.find(x => x.id === rec.poId)!, line = po.lines.find((l: any) => l.id === rec.lineId)
  // A cancel is a manager's (or the owner's) decision; at or above the owner's spend threshold it needs the policy signatures on the exact cancellation (GOV-002).
  let signed: ReturnType<typeof gate> = null
  if (rec.kind === 'cancel') {
    if (decision === 'approved') signed = gate(c, { category: 'spend', subjectKind: 'purchaseOrders', subject: po, measure: () => times(decimal(rec.quantity), decimal(line.unitPrice)), permitted: ['manager'], terms: { decision: 'cancel', key: rec.key }, p })
    if (!signed) allow(c, ['manager'])
    if (signed && 'pending' in signed) return signed.pending
  }
  let effect = 'recorded; no change'
  if (decision === 'approved') {
    if (rec.kind === 'cancel') {
      const before = decimal(line.quantity), cancelled = decimal(rec.quantity)
      line.quantity = format(before - cancelled); line.cancelled = format(decimal(line.cancelled ?? '0') + cancelled)
      effect = `cancelled ${rec.quantity} of ${format(before)} ordered`
      po.exposure = format(po.lines.reduce((n: bigint, l: any) => n + times(decimal(l.quantity), decimal(l.unitPrice)), 0n))
    } else {
      line.supplyRequest = { kind: rec.kind, requestedDate: rec.requestedDate, by: c.actor.id, at: c.now, reason }
      // BUY-009: the line's requested date is what we asked for; the supplier's own date (expectedDate) moves only when the supplier confirms.
      line.requestedDate = rec.requestedDate
      effect = `${rec.kind} requested for ${rec.requestedDate}; the supplier's date is unchanged`
    }
  }
  const approval = row(c, 'approvals', { subjectKind: 'purchaseOrders', subjectId: po.id, subjectVersion: po.version, decision, category: 'supply-change', recommendation: structuredClone(rec), inputs: { stateVersion: p.version, asOf: p.asOf, digest: rec.inputsDigest }, role: c.actor.role, note: reason, effect, ...(signed ? { signatureIds: signed.signatureIds, override: signed.override } : {}) })
  signed?.consume(approval.id)
  po.history.push({ at: c.now, by: c.actor.id, change: `supply change ${decision}: ${rec.kind}`, from: rec.currentDate, ...(rec.requestedDate ? { to: rec.requestedDate } : {}), line: line.id, note: reason, effect, approvalId: approval.id })
  if (decision === 'approved' && rec.kind === 'cancel') bump(po, { status: status(po), expectedDate: purchaseNextDate(po) })
  else bump(po, {})
  return approval
}
