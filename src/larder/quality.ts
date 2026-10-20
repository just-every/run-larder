// TRACE-004 inspection plans by SKU and BOM revision, measured results with
// individual samples, quality holds on failed required results, and the
// authorized release after a passing retest. Until GOV-001 adds a quality role,
// an owner or manager is the qualified person who approves plans and releases.
// Samples are exact decimals to six places; the mean is their sum ÷ count,
// rounded half away from zero to six places. A measurement passes when it has
// exactly the plan's sample size and every sample lies within its inclusive
// lower and upper limits; a result passes when every measurement passes.
import { attach } from './attachments'
import { holdReason, openHolds } from './quality-holds'
import { SCALE, decimal, divide, format } from './decimal'
import { fail, forbidden } from './problem'
import { allow, approver } from './roles'
import { balance, move, reservedAt } from './stock'
import { bump, fresh, get, list, oneOf, optionalText, row, text, type Context, type Row, type State } from './model'

export const stages = ['receipt', 'in-process', 'final'] as const
const signed = (value: unknown, field: string) => decimal(value, field, { signed: true })
const files = (c: Context, value: unknown, label: string) => value === undefined || (Array.isArray(value) && !value.length) ? [] : list(value, label, 5).map(file => attach(c, file))

function measurements(value: unknown) {
  const out = list(value, 'measurements', 20).map((m: any) => {
    const name = text(m?.name, 'measurement name', 120), unit = text(m?.unit, 'measurement unit', 20)
    const target = signed(m?.target, `${name} target`), lower = signed(m?.lower, `${name} lower limit`), upper = signed(m?.upper, `${name} upper limit`)
    if (!(lower <= target && target <= upper)) fail('INPUT', `${name} needs lower limit ≤ target ≤ upper limit.`, { field: name })
    return { name, unit, target: format(target), lower: format(lower), upper: format(upper) }
  })
  if (new Set(out.map(m => m.name.toLowerCase())).size !== out.length) fail('INPUT', 'Each measurement needs a distinct name.')
  return out
}

const lotHolds = (s: State, lotId: string) => s.qualityHolds.filter(h => h.status === 'open' && h.lots.some((x: any) => x.lotId === lotId))

// Refuse using a lot under an open quality hold (pick, ship, quarantine release).
// Quarantine rejection (scrap or return) stays open without a retest.
export function assertLotNotHeld(s: State, lotId: string, action: string) {
  const h = lotId ? lotHolds(s, lotId)[0] : undefined
  if (h) fail('QUALITY_HOLD', `Lot ${s.lots.find(l => l.id === lotId)?.code} cannot be ${action}. ${holdReason(h)}`, { lotId, holdId: h.id })
}

function score(plan: Row, samples: any) {
  if (!samples || typeof samples !== 'object' || Array.isArray(samples)) fail('INPUT', 'Record samples for each measurement.', { field: 'samples' })
  return plan.measurements.map((m: any) => {
    const values = list(samples[m.name], `${m.name} samples`, 1000).map((v: unknown, i: number) => signed(v, `${m.name} sample ${i + 1}`))
    if (values.length !== plan.sampleSize) fail('SAMPLE_SIZE', `${m.name} needs exactly ${plan.sampleSize} samples under the approved plan; ${values.length} were recorded.`, { field: m.name })
    const lower = decimal(m.lower, 'lower', { signed: true }), upper = decimal(m.upper, 'upper', { signed: true })
    const outside = values.filter(v => v < lower || v > upper).length, mean = divide(values.reduce((n, v) => n + v, 0n), BigInt(values.length) * SCALE)
    return { ...m, samples: values.map(format), count: values.length, mean: format(mean), outside, passed: outside === 0 }
  })
}

// Move a lot's available stock into quarantine; reservations it covered are
// released (never silently oversold) and named on the hold.
function holdLot(c: Context, hold: Row, lotId: string) {
  const lot = get(c.s, 'lots', lotId, 'lot')
  for (const locationId of [...new Set(c.s.movements.filter(m => m.lotId === lotId && m.status === 'available').map(m => m.locationId))]) {
    const quantity = balance(c.s, lot.itemId, locationId, 'available', lotId)
    if (quantity <= 0n) continue
    let excess = reservedAt(c.s, lot.itemId, locationId) - (balance(c.s, lot.itemId, locationId) - quantity)
    for (const r of [...c.s.reservations].reverse()) {
      if (excess <= 0n) break
      if (r.itemId !== lot.itemId || r.locationId !== locationId) continue
      const take = r.quantity < excess ? r.quantity : excess
      r.quantity -= take; excess -= take
      if (r.quantity === 0n) c.s.reservations.splice(c.s.reservations.indexOf(r), 1)
      hold.unreserved.push({ demandKind: r.demandKind, demandId: r.demandId, lineId: r.lineId, locationId, quantity: format(take) })
    }
    const out = move(c, { itemId: lot.itemId, locationId, status: 'available', lotId, quantity: -quantity, kind: 'quality-hold', documentKind: 'qualityHolds', documentId: hold.id, reason: holdReason(hold) })
    move(c, { itemId: lot.itemId, locationId, status: 'quarantine', lotId, quantity, unitCost: out.unitCost, kind: 'quality-hold', documentKind: 'qualityHolds', documentId: hold.id, reason: holdReason(hold) })
    hold.held.push({ lotId, locationId, quantity: format(quantity) })
  }
  hold.lots.push({ lotId, priorStatus: lot.status })
  bump(lot, { status: 'quality hold' })
}

const subjectLots = (s: State, subjectKind: string, subjectId: string) => subjectKind === 'lots' ? [subjectId] : s.lots.filter(l => ['production', 'rework'].includes(l.source) && (l.documentId === subjectId || (subjectKind === 'workOrders' && s.workOrders.some(w => w.id === l.documentId && w.lineageSourceIds?.includes(subjectId))))).map(l => l.id)

export function quality(c: Context, type: string, p: any): Row | undefined {
  switch (type) {
    case 'quality.plan.save': {
      if (c.actor.role === 'agent') forbidden('Agents cannot define inspection plans.')
      allow(c, ['manager', 'production'])
      const item = get(c.s, 'items', p.itemId, 'item'), stage = oneOf(p.stage, stages, 'stage')
      const revision = p.revision === undefined || p.revision === null || p.revision === '' ? null : Number(p.revision)
      if (revision !== null && (!Number.isSafeInteger(revision) || !c.s.boms.some(b => b.itemId === item.id && b.revision === revision))) fail('INPUT', `${item.name} has no BOM revision ${p.revision}.`, { field: 'revision' })
      if (stage !== 'receipt' && item.kind !== 'make') fail('INPUT', 'In-process and final inspections apply to made items.', { field: 'stage' })
      const operationSequence = stage === 'in-process' ? Number(p.operationSequence) : null
      if (stage === 'in-process' && (!Number.isSafeInteger(operationSequence) || operationSequence! < 1)) fail('INPUT', 'Name the operation an in-process check follows.', { field: 'operationSequence' })
      const sampleSize = Number(p.sampleSize)
      if (!Number.isSafeInteger(sampleSize) || sampleSize < 1 || sampleSize > 1000) fail('INPUT', 'Sample size must be a whole number from 1 to 1000.', { field: 'sampleSize' })
      return row(c, 'inspectionPlans', { itemId: item.id, revision, stage, operationSequence, name: text(p.name, 'plan name', 120), sampleSize, measurements: measurements(p.measurements), required: p.required !== false, attachments: files(c, p.attachments, 'plan attachments'), status: 'draft', preparedBy: c.actor.id })
    }
    case 'quality.plan.approve': {
      const plan = get(c.s, 'inspectionPlans', p.planId, 'inspection plan'); fresh(plan, p.version)
      approver(c, ['manager'], plan.preparedBy)
      if (plan.status !== 'draft') fail('STATE', 'Only a draft inspection plan can be approved.')
      for (const old of c.s.inspectionPlans) if (old.status === 'approved' && old.itemId === plan.itemId && old.revision === plan.revision && old.stage === plan.stage && old.operationSequence === plan.operationSequence) bump(old, { status: 'superseded', supersededBy: plan.id, supersededAt: c.now })
      return bump(plan, { status: 'approved', approval: { by: c.actor.id, role: c.actor.role, at: c.now } })
    }
    case 'quality.inspect': {
      if (c.actor.role === 'agent') forbidden('Agents cannot record inspection results.')
      allow(c, ['manager', 'production'])
      const plan = get(c.s, 'inspectionPlans', p.planId, 'inspection plan'); fresh(plan, p.planVersion)
      if (plan.status !== 'approved') fail('STATE', 'Record results only against the current approved plan.')
      let subjectKind: 'workOrders' | 'lots' | 'reworkOrders' | 'nonconformances', subject: Row
      if (p.nonconformanceId) {
        subjectKind = 'nonconformances'; subject = get(c.s, 'nonconformances', p.nonconformanceId, 'nonconformance')
        const lot = get(c.s, 'lots', subject.lotId), job = c.s.workOrders.find(w => w.id === lot.documentId)
        if (subject.status !== 'open' || subject.itemId !== plan.itemId || (plan.revision !== null && plan.revision !== job?.bomRevision)) fail('INPUT', 'Use a current applicable plan on an open nonconformance.')
        const quantity = decimal(p.quantity, 'inspected quantity', { positive: true })
        if (quantity > decimal(subject.remaining)) fail('QUANTITY', 'Inspect only units still held by this case.')
      } else if (p.reworkOrderId) {
        subjectKind = 'reworkOrders'; subject = get(c.s, 'reworkOrders', p.reworkOrderId, 'repair/unbuild order')
        if (subject.status !== 'quarantine' || !subject.outputLots.some((x: any) => x.itemId === plan.itemId) || (plan.revision !== null && plan.revision !== subject.bomRevision)) fail('INPUT', 'Inspect executed repair/recovery output against its pinned revision.')
      } else if (plan.stage === 'receipt') {
        subjectKind = 'lots'; subject = get(c.s, 'lots', p.lotId, 'lot')
        if (subject.itemId !== plan.itemId || !['receipt', 'subcontract'].includes(subject.source)) fail('INPUT', 'Inspect a received lot of the plan’s item.')
      } else {
        subjectKind = 'workOrders'; subject = get(c.s, 'workOrders', p.workOrderId, 'work order')
        if (subject.itemId !== plan.itemId || !['released', 'closed'].includes(subject.status) || (plan.revision !== null && plan.revision !== subject.bomRevision)) fail('INPUT', 'This plan does not apply to that work order’s item and pinned BOM revision.')
        if (plan.stage === 'in-process') {
          const task = subject.operationStates?.find((t: any) => t.sequence === plan.operationSequence)
          if (!subject.routing.some((r: any) => r.sequence === plan.operationSequence)) fail('INPUT', 'The pinned routing has no such operation.')
          if (task?.status === 'pending' || !task) fail('STATE', `Start operation ${plan.operationSequence} before its in-process check.`)
        }
      }
      const results = score(plan, p.samples), passed = results.every((m: any) => m.passed)
      const prior = c.s.inspections.filter(x => x.planId === plan.id && x.subjectId === subject.id)
      const inspection = row(c, 'inspections', { ...(subjectKind === 'nonconformances' ? { quantity: format(decimal(p.quantity)) } : {}), planId: plan.id, planVersion: plan.version, planName: plan.name, stage: plan.stage, itemId: plan.itemId, subjectKind, subjectId: subject.id, lotCode: subjectKind === 'lots' ? subject.code : '', measurements: results, passed, retestOf: prior.at(-1)?.id ?? null, evidence: files(c, p.evidence, 'measurement evidence'), note: optionalText(p.note, 'note', 400), inspectedBy: c.actor.id, inspectedAt: c.now })
      if (subjectKind !== 'nonconformances' && !passed && plan.required && !openHolds(c.s, subject.id).some(h => h.planId === plan.id)) {
        const failures = results.filter((m: any) => !m.passed).map((m: any) => `${m.name} ${m.outside} of ${m.count} outside ${m.lower}–${m.upper} ${m.unit}, mean ${m.mean}`)
        const hold = row(c, 'qualityHolds', { subjectKind, subjectId: subject.id, itemId: plan.itemId, planId: plan.id, planName: plan.name, inspectionId: inspection.id, failedBy: c.actor.id, failedAt: c.now, failures, lots: [], held: [], unreserved: [], status: 'open' })
        for (const lotId of subjectLots(c.s, subjectKind, subject.id)) holdLot(c, hold, lotId)
        bump(inspection, { holdId: hold.id })
      }
      return inspection
    }
    case 'quality.release': {
      const hold = get(c.s, 'qualityHolds', p.holdId, 'quality hold'); fresh(hold, p.version)
      approver(c, ['manager'], hold.failedBy)
      if (hold.status !== 'open') fail('STATE', 'This quality hold is already released.')
      const latest = c.s.inspections.filter(x => x.planId === hold.planId && x.subjectId === hold.subjectId).at(-1)
      if (!latest || latest.id === hold.inspectionId || !latest.passed) fail('RETEST', 'Record a passing retest under the approved plan before releasing.')
      const reason = text(p.reason, 'release reason', 400)
      if (!Array.isArray(p.evidence) || !p.evidence.length) fail('EVIDENCE', 'Attach the retest or disposition record.')
      const evidence = files(c, p.evidence, 'release evidence'), released: any[] = []
      for (const x of hold.held) {
        if (hold.subjectKind === 'reworkOrders') continue // Only the dedicated evidence-backed release can make repair output available.
        const lot = get(c.s, 'lots', x.lotId, 'lot'), still = balance(c.s, lot.itemId, x.locationId, 'quarantine', lot.id), quantity = still < decimal(x.quantity) ? still : decimal(x.quantity)
        if (quantity <= 0n) continue
        const out = move(c, { itemId: lot.itemId, locationId: x.locationId, status: 'quarantine', lotId: lot.id, quantity: -quantity, kind: 'quality-release', documentKind: 'qualityHolds', documentId: hold.id, reason })
        move(c, { itemId: lot.itemId, locationId: x.locationId, status: 'available', lotId: lot.id, quantity, unitCost: out.unitCost, kind: 'quality-release', documentKind: 'qualityHolds', documentId: hold.id, reason })
        released.push({ lotId: lot.id, locationId: x.locationId, quantity: format(quantity) })
      }
      for (const x of hold.lots) { const lot = get(c.s, 'lots', x.lotId, 'lot'); if (lot.status === 'quality hold' && !lotHolds(c.s, lot.id).some(h => h.id !== hold.id)) bump(lot, { status: x.priorStatus }) }
      return bump(hold, { status: 'released', release: { by: c.actor.id, role: c.actor.role, at: c.now, reason, evidence, retestId: latest!.id, released } })
    }
  }
}
