// TRACE-005 quantity-scoped containment. Physical truth stays in append-only
// movements; case custody cannot be released through another quarantine door.
import { attach } from './attachments'
import { approvedCertificates } from './certificate-policy'
import { decimal, format } from './decimal'
import { lotBlock } from './lot-dates'
import { bump, date, fresh, get, list, nextReference, row, text, type Context, type Row } from './model'
import { assertLotNotHeld } from './quality'
import { allow, approver } from './roles'
import { fail } from './problem'
import { balance, move, qty, reservedAt } from './stock'

const files = (c: Context, value: unknown) => list(value, 'evidence', 5).map(f => attach(c, f))
export function nonconformance(c: Context, type: string, p: any): Row | undefined {
  if (!type.startsWith('nonconformance.')) return
  allow(c, ['manager'])
  if (type === 'nonconformance.open') {
    const lot = get(c.s, 'lots', p.lotId, 'lot'), location = get(c.s, 'locations', p.locationId), quantity = qty(p.quantity)
    if (lot.ownerId) fail('OWNERSHIP', 'Customer property cannot enter owned nonconformance stock.')
    const n = row(c, 'nonconformances', {
      reference: nextReference(c.s.nonconformances, 'NC'), lotId: lot.id, itemId: lot.itemId, locationId: location.id,
      quantity: format(quantity), remaining: format(quantity), ownerId: c.actor.id, dueOn: date(p.dueOn, 'due date'),
      complaint: text(p.complaint, 'supplier/customer complaint', 2000), rootCause: '', correctiveAction: '',
      evidence: files(c, p.evidence), actions: [], decisions: [], status: 'open',
    })
    // Match TRACE-004: explicitly release only reservations displaced by this hold.
    if (balance(c.s, lot.itemId, location.id, 'available', lot.id) < quantity) throwStock()
    let excess = reservedAt(c.s, lot.itemId, location.id) - (balance(c.s, lot.itemId, location.id) - quantity)
    const unreserved = []
    for (const r of [...c.s.reservations].reverse()) {
      if (excess <= 0n) break
      if (r.itemId !== lot.itemId || r.locationId !== location.id) continue
      const take = r.quantity < excess ? r.quantity : excess
      r.quantity -= take; excess -= take
      if (r.quantity === 0n) c.s.reservations.splice(c.s.reservations.indexOf(r), 1)
      unreserved.push({ demandKind: r.demandKind, demandId: r.demandId, lineId: r.lineId, quantity: format(take) })
    }
    const out = move(c, { itemId: lot.itemId, locationId: location.id, lotId: lot.id, status: 'available', quantity: -quantity, kind: 'nonconformance-hold', documentKind: 'nonconformances', documentId: n.id, reason: n.complaint })
    move(c, { ...out, quantity, status: 'quarantine' })
    Object.assign(n, { unreserved, unitCost: format(out.unitCost), sourceMovementIds: c.s.movements.filter(m => m.lotId === lot.id && m.quantity > 0n && m.documentKind !== 'nonconformances').map(m => m.id) })
    return n
  }
  const n = get(c.s, 'nonconformances', p.caseId, 'nonconformance'); fresh(n, p.version)
  if (n.status !== 'open') fail('STATE', 'This nonconformance is closed; its evidence is retained.')
  if (type === 'nonconformance.update') {
    const action = text(p.nextAction, 'next action', 2000)
    const supplierId = p.supplierId ? get(c.s, 'parties', p.supplierId, 'supplier').id : ''
    if (supplierId && get(c.s, 'parties', supplierId).kind === 'customer') fail('INPUT', 'Choose a supplier for supplier action.')
    const reworkOrderId = p.reworkOrderId ? get(c.s, 'reworkOrders', p.reworkOrderId).id : ''
    if (reworkOrderId) {
      const w = get(c.s, 'reworkOrders', reworkOrderId)
      if (w.status !== 'draft' || w.sourceStatus !== 'quarantine' || (w.nonconformanceId && w.nonconformanceId !== n.id) || w.sourceLotId !== n.lotId || w.locationId !== n.locationId || decimal(w.quantity) > decimal(n.remaining)) fail('SOURCE', 'Route an uncommitted quarantined rework order for this case’s lot, location and remaining quantity.')
      bump(w, { nonconformanceId: n.id })
    }
    n.actions.push({ by: c.actor.id, at: c.now, nextAction: action, supplierId, reworkOrderId, evidence: files(c, p.evidence), delivery: 'recorded in app' })
    return bump(n, { rootCause: text(p.rootCause, 'root cause', 2000), correctiveAction: text(p.correctiveAction, 'corrective action', 2000), dueOn: date(p.dueOn, 'due date') })
  }
  if (['nonconformance.release', 'nonconformance.reject', 'nonconformance.return'].includes(type)) {
    approver(c, ['manager'], n.createdBy)
    const quantity = qty(p.quantity)
    if (quantity > decimal(n.remaining)) fail('QUANTITY', 'Disposition exceeds the quantity still held by this case.')
    const evidence = files(c, p.evidence), reason = text(p.reason, 'disposition reason', 1000)
    let inspectionId = ''
    if (type === 'nonconformance.release') {
      const lot = get(c.s, 'lots', n.lotId)
      assertLotNotHeld(c.s, lot.id, 'released')
      if (lotBlock(lot, c.now.slice(0, 10))) fail('LOT_BLOCKED', 'The lot needs an expiry/retest disposition first.')
      approvedCertificates(c.s, n.itemId, lot.id, c.now.slice(0, 10))
      const inspection = get(c.s, 'inspections', p.inspectionId, 'case inspection'), plan = get(c.s, 'inspectionPlans', inspection.planId)
      const latest = c.s.inspections.filter(i => i.subjectId === n.id).at(-1)
      if (inspection.subjectId !== n.id || !inspection.passed || latest?.id !== inspection.id || plan.status !== 'approved' || plan.version !== inspection.planVersion || decimal(inspection.quantity) !== quantity || n.decisions.some((d: any) => d.inspectionId === inspection.id)) fail('RETEST', 'Use the latest passing case inspection under a current plan for exactly these units, once.')
      // Every applicable required plan must also pass for this same scoped quantity.
      const job = c.s.workOrders.find(w => w.id === lot.documentId)
      for (const required of c.s.inspectionPlans.filter(x => x.status === 'approved' && x.required && x.itemId === n.itemId && (x.revision === null || x.revision === job?.bomRevision) && (lot.source === 'receipt' ? x.stage === 'receipt' : x.stage !== 'receipt'))) {
        const result = c.s.inspections.filter(i => i.subjectId === n.id && i.planId === required.id).at(-1)
        if (!result?.passed || result.planVersion !== required.version || result.quantity !== format(quantity) || n.decisions.some((d: any) => d.inspectionIds?.includes(result.id))) fail('RETEST', `Record a current passing ${required.name} case inspection for exactly these units.`)
      }
      inspectionId = inspection.id
    }
    const decision = type === 'nonconformance.release' ? 'release' : type === 'nonconformance.return' ? 'return' : 'reject'
    const supplier = decision === 'return' ? get(c.s, 'parties', p.supplierId, 'supplier') : undefined
    if (supplier?.kind === 'customer') fail('INPUT', 'Return to a named supplier.')
    const out = move(c, { itemId: n.itemId, lotId: n.lotId, locationId: n.locationId, status: 'quarantine', quantity: -quantity, unitCost: decimal(n.unitCost), kind: `nonconformance-${decision}`, documentKind: 'nonconformances', documentId: n.id, reason })
    if (decision === 'release') move(c, { ...out, status: 'available', quantity })
    n.decisions.push({ by: c.actor.id, at: c.now, decision, ...(supplier ? { supplierId: supplier.id, supplierReference: text(p.supplierReference, 'supplier return reference', 200), delivery: 'recorded in app; not provider-confirmed' } : {}), quantity: format(quantity), reason, evidence, inspectionId, inspectionIds: c.s.inspections.filter(i => i.subjectId === n.id).map(i => i.id) })
    return bump(n, { remaining: format(decimal(n.remaining) - quantity) })
  }
  if (type === 'nonconformance.close') {
    if (decimal(n.remaining) !== 0n) fail('QUANTITY', 'Dispose of every affected unit before closure.')
    if (!n.rootCause || !n.correctiveAction || !n.actions.length) fail('EFFECTIVENESS', 'Record root cause, corrective action and follow-up before closure.')
    if (n.decisions.some((d: any) => d.decision === 'rework' && get(c.s, 'reworkOrders', d.orderId).status !== 'released')) fail('REWORK_RELEASE', 'Record passing inspection and authorized release of case-linked repair output before closure.')
    if (p.effective !== true) fail('EFFECTIVENESS', 'A failed effectiveness check cannot close the case.')
    return bump(n, { status: 'closed', effectiveness: { by: c.actor.id, at: c.now, effective: true, check: text(p.check, 'effectiveness check', 2000), evidence: files(c, p.evidence) } })
  }
  fail('COMMAND', 'Unknown nonconformance command.')
}
const throwStock = () => fail('INSUFFICIENT_STOCK', 'The affected quantity must be available in this lot and location.')
