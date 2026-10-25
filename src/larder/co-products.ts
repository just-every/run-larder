// Explicit batch outputs share actual cost, never an inferred component-lot split.
import { batchAllocation, workMaterialPool } from './production-trace'
import { costFingerprint } from './costing/commands'
import { jobCosts } from './costing/jobs'
import { decimal, exactDivide, format, times } from './decimal'
import { attach } from './attachments'
import { approvedCertificates } from './certificate-policy'
import { assertLotNotHeld } from './quality'
import { lotBlock } from './lot-dates'
import { workHolds, plansFor } from './quality-holds'
import { workRecalls } from './recall-policy'
import { balance, move, release } from './stock'
import { isSerial } from './serials'
import { allow } from './roles'
import { fail } from './problem'
import { bump, fresh, get, list, newId, oneOf, row, text, type Context, type Row } from './model'

export const batchResidueRule = 'Assign a six-place rounding residue of at most USD 0.000001 per output to the final planned output; refuse larger differences or an inexact unit cost.'

// Any intervening business write permanently voids a pending exact approval.
export function voidBatchReviews(c: Context) {
  for (const w of c.s.workOrders) {
    let changed = false
    for (const review of w.coProductReviews ?? []) if (review.status === 'review' && review.stateVersion !== c.s.version + 1) {
      Object.assign(review, { status: 'void', voidedAt: c.now, voidReason: 'Inputs or business records changed; prepare a fresh review and approval.' })
      changed = true
    }
    if (changed) bump(w, {})
  }
}

export function coProducts(c: Context, type: string, p: any): Row | undefined {
  if (!type.startsWith('batch.')) return
  allow(c, ['batch.plan', 'batch.review', 'batch.void'].includes(type) ? ['manager', 'accounts', 'planner'] : [])
  const w = get(c.s, 'workOrders', p.workOrderId); fresh(w, p.version)
  const reason = text(p.reason, 'batch reason', 400)
  if (type === 'batch.void') {
    const review = w.coProductReviews?.find((r: any) => r.id === p.reviewId)
    if (!review || review.status !== 'review') fail('STATE', 'Choose a pending batch review.')
    Object.assign(review, { status: 'void', voidedAt: c.now, voidReason: reason })
    return bump(w, {})
  }
  if (type === 'batch.plan') {
    if (w.status !== 'draft') fail('STATE', 'Plan outputs before releasing the batch.')
    const seen = new Set<string>()
    const outputs = list(p.outputs, 'planned outputs', 20).map(x => {
      const item = get(c.s, 'items', x.itemId), location = get(c.s, 'locations', x.locationId)
      if (item.archived || isSerial(item) || seen.has(item.id)) fail('BATCH_OUTPUT', 'Choose each active non-serial output item once.')
      seen.add(item.id)
      return { itemId: item.id, locationId: location.id, kind: oneOf(x.kind, ['co-product', 'by-product', 'recoverable-scrap'] as const, 'output kind'), quantity: format(decimal(x.quantity, 'planned yield', { positive: true })), lot: text(x.lot, 'output lot', 80) }
    })
    if (!outputs.some(x => x.itemId === w.itemId && x.quantity === w.quantity)) fail('BATCH_OUTPUT', 'The primary output must equal the manufacturing order quantity.')
    if (outputs.length < 2) fail('BATCH_OUTPUT', 'Plan at least two outputs.')
    return bump(w, { coProductPlan: { outputs, reason, by: c.actor.id, at: c.now } })
  }
  if (type === 'batch.review') {
    if (w.status !== 'released' || !w.coProductPlan || w.outputs?.length || w.coProductPosted) fail('STATE', 'Review one released batch with planned outputs and no previous output.')
    if (w.routing.some((r: any) => !w.operationStates?.some((t: any) => t.sequence === r.sequence && t.status === 'done'))) fail('OPERATIONS', 'Complete every pinned operation first.')
    if (w.components.some((x: any) => decimal(x.issued) < decimal(x.required)) || workMaterialPool(c.s, w).unrecorded.length) fail('TRACE_ALLOCATION', 'Issue all required components and reconcile historical allocations first.')
    if (workHolds(c.s, w).length || workRecalls(c.s, w).length) fail('QUALITY_HOLD', 'Resolve batch quality and recall holds first.')
    const report = jobCosts(c.s, w)
    if (report.actualCost === null) fail('COST_INCOMPLETE', 'Resolve actual cost evidence before reviewing output allocation.')
    const inputs = list(p.outputs, 'actual outputs', 20)
    if (inputs.length !== w.coProductPlan.outputs.length) fail('BATCH_OUTPUT', 'Review every planned output exactly once.')
    const residue = decimal(report.actualCost) - inputs.reduce((n, x) => n + decimal(x.value, 'allocated output value'), 0n)
    if (residue > BigInt(inputs.length) || residue < -BigInt(inputs.length)) fail('BATCH_VALUE', 'Allocation differs by more than the permitted six-place rounding residue.')
    const copy = structuredClone(c.s), shadow = get(copy, 'workOrders', w.id)
    const seen = new Set<string>()
    const outputs = inputs.map((x, index) => {
      const plan = w.coProductPlan.outputs.find((o: any) => o.itemId === x.itemId)
      if (!plan || seen.has(x.itemId)) fail('BATCH_OUTPUT', 'Review each planned item exactly once.')
      seen.add(x.itemId)
      if (c.s.lots.some(l => l.itemId === plan.itemId && l.code === plan.lot)) fail('BATCH_OUTPUT', 'Use a new output lot.')
      const quantity = decimal(x.quantity, 'actual yield', { positive: true }), value = decimal(x.value, 'allocated output value') + (index === inputs.length - 1 ? residue : 0n), rate = exactDivide(value, quantity) ?? fail('BATCH_VALUE', 'Each output value must have an exact six-place unit cost.')
      if (value < 0n) fail('BATCH_VALUE', 'A residue cannot make an output value negative.')
      if (times(quantity, rate) !== value) fail('BATCH_VALUE', 'Each output value must have an exact six-place unit cost.')
      if (plan.itemId === w.itemId && format(quantity) !== w.quantity) fail('BATCH_OUTPUT', 'Actual primary output must equal the order quantity.')
      if (plan.kind === 'recoverable-scrap') {
        const component = w.components.find((l: any) => l.itemId === plan.itemId)
        if (!component || quantity > decimal(component.issued) || quantity > decimal(component.required)) fail('BATCH_OUTPUT', 'Recovered components cannot exceed the pinned requirement or actual issue.')
      }
      const allocations = batchAllocation(copy, shadow, { allocations: x.allocations ?? [] }, index === inputs.length - 1)
      shadow.outputs = [...(shadow.outputs ?? []), { allocations }]
      return { ...plan, quantity: format(quantity), value: format(value), roundingResidueValue: format(index === inputs.length - 1 ? residue : 0n), unitCost: format(rate), allocations }
    })
    if (outputs.reduce((n, x) => n + decimal(x.value), 0n) !== decimal(report.actualCost)) fail('BATCH_VALUE', 'Total output value must equal the exact actual batch cost.')
    const review = { id: newId(), outputs, actualCost: report.actualCost, costReport: report, residueRule: batchResidueRule, roundingResidueValue: format(residue), policy: text(p.policy, 'allocation policy', 1000), reason, preparedBy: c.actor.id, at: c.now, stateVersion: c.s.version + 1, digest: costFingerprint(c.s, w), status: 'review' }
    return bump(w, { coProductReviews: [...(w.coProductReviews ?? []), review] })
  }
  if (type === 'batch.post') {
    const review = w.coProductReviews?.find((r: any) => r.id === p.reviewId)
    if (review?.status === 'void') fail('STALE', 'This batch draft is void; prepare a fresh review and approval.')
    if (!review || review.status !== 'review' || w.status !== 'released' || w.coProductPosted) fail('STATE', 'Choose an unposted batch review.')
    if (c.s.version !== review.stateVersion || costFingerprint(c.s, w) !== review.digest) fail('STALE', 'Business or cost evidence changed; prepare a fresh batch review.')
    const lines = []
    for (const x of review.outputs) {
      const batchId = newId(), lot = row(c, 'lots', { itemId: x.itemId, code: x.lot, supplierId: null, source: 'production', documentId: w.id, batchId, coProduct: true, status: 'quarantined', manufacturedOn: c.now.slice(0, 10) })
      const m = move(c, { itemId: x.itemId, locationId: x.locationId, lotId: lot.id, status: 'quarantine', quantity: decimal(x.quantity), unitCost: decimal(x.unitCost), kind: 'output', documentKind: 'workOrders', documentId: w.id, reason })
      w.outputs = [...(w.outputs ?? []), { id: batchId, itemId: x.itemId, kind: x.kind, bomRevision: x.bomRevision, locationId: x.locationId, lotId: lot.id, movementId: m.id, allocations: x.allocations, good: x.quantity, scrap: '0', at: c.now, by: c.actor.id }]
      lines.push({ itemId: x.itemId, lotId: lot.id, movementId: m.id, quantity: x.quantity, unitCost: x.unitCost, targetValue: x.value, roundingResidual: '0', allocationResidueValue: x.roundingResidueValue })
    }
    row(c, 'costValuations', { workOrderId: w.id, currency: 'USD', status: 'approved', batchAllocation: true, residueRule: review.residueRule, allocationResidueValue: review.roundingResidueValue, lines, report: review.costReport, approvedBy: c.actor.id, approvedAt: c.now, approvalReason: reason })
    Object.assign(review, { status: 'posted', approvedBy: c.actor.id, approvedAt: c.now, approvalReason: reason })
    release(c, w.id)
    return bump(w, { coProductPosted: review.id, traceAllocationVersion: 1, output: w.quantity, scrap: '0', status: 'closed', closedAt: c.now })
  }
  if (type === 'batch.release') {
    if (!w.coProductPosted) fail('STATE', 'Post the reviewed batch first.')
    const output = w.outputs.find((x: any) => x.lotId === p.lotId), lot = get(c.s, 'lots', p.lotId)
    if (!output) fail('STATE', 'Choose an output of this batch.')
    assertLotNotHeld(c.s, lot.id, 'released')
    if (lot.status !== 'quarantined') fail('STATE', 'Release a quarantined output of this batch once.')
    if (workHolds(c.s, w).length || workRecalls(c.s, w).length || lotBlock(lot, c.now.slice(0, 10))) fail('QUALITY_HOLD', 'Resolve batch holds and lot dates first.')
    approvedCertificates(c.s, output.itemId, lot.id, c.now.slice(0, 10))
    for (const stage of ['receipt', 'in-process', 'final']) for (const plan of plansFor(c.s, stage, output.itemId, output.bomRevision ?? null).filter(p => p.required)) {
      const latest = c.s.inspections.filter(i => i.subjectId === lot.id && i.planId === plan.id).at(-1)
      if (!latest?.passed || latest.planVersion !== plan.version) fail('RETEST', 'Record passing current inspections for this exact output lot first.')
    }
    const evidence = list(p.evidence, 'release evidence', 5).map(e => attach(c, e))
    const quantity = decimal(output.good)
    if (balance(c.s, output.itemId, output.locationId, 'quarantine', lot.id) !== quantity) fail('DEPENDENCY', 'Quarantined output changed; investigate before release.')
    const movement = move(c, { itemId: output.itemId, locationId: output.locationId, lotId: lot.id, status: 'quarantine', quantity: -quantity, kind: 'batch-release', documentKind: 'workOrders', documentId: w.id, reason })
    move(c, { ...movement, quantity, status: 'available' })
    bump(lot, { status: 'released', release: { by: c.actor.id, at: c.now, reason, evidence } })
    return bump(w, {})
  }
  fail('COMMAND', 'Unknown batch command.')
}
