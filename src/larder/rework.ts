// Dedicated repair/unbuild orders. Approved terms are immutable; execution
// posts real source consumption before any recovery or repaired inventory.
import { attach } from './attachments'
import { approvedCertificates } from './certificate-policy'
import { decimal, divide, format, times } from './decimal'
import { assertLotNotHeld } from './quality'
import { plansFor } from './quality-holds'
import { lotBlock } from './lot-dates'
import { fail } from './problem'
import { allow, approver } from './roles'
import { balance, move, qty, withdraw } from './stock'
import { bump, fresh, get, list, nextReference, oneOf, row, text, type Context, type Row } from './model'

const lines = (v: any) => v === undefined || Array.isArray(v) && !v.length ? [] : list(v)
const files = (c: Context, v: any) => list(v, 'evidence', 5).map(x => attach(c, x))

export function rework(c: Context, type: string, p: any): Row | undefined {
  if (!type.startsWith('rework.')) return
  if (type === 'rework.draft') {
    allow(c, ['manager', 'production'])
    const source = get(c.s, 'lots', p.sourceLotId, 'original lot'), job = get(c.s, 'workOrders', p.sourceJobId, 'original production job')
    if (source.itemId !== job.itemId || source.source !== 'production' || source.documentId !== job.id) fail('SOURCE', 'Choose the production job that made this original lot.')
    const quantity = qty(p.quantity), kind = oneOf(p.kind, ['rework', 'unbuild'] as const, 'order kind')
    const location = get(c.s, 'locations', p.locationId), status = oneOf(p.sourceStatus, ['available', 'quarantine'] as const, 'source status')
    const outputs = list(p.outputs, 'outputs', 20).map((x: any) => {
      const item = get(c.s, 'items', x.itemId), q = qty(x.quantity), value = decimal(x.value, 'allocated output value')
      if (kind === 'rework' && (item.id !== source.itemId || q !== quantity)) fail('RECOVERY', 'Repair output must match the original item and exact repairable source quantity; leave rejected units in quarantine.')
      if (kind === 'unbuild') {
        const component = job.components.find((l: any) => l.itemId === item.id)
        if (!component || decimal(job.output) === 0n || q > times(quantity, divide(decimal(component.issued), decimal(job.output)))) fail('RECOVERY', 'Recovery exceeds components actually issued per original good assembly.')
      }
      return { itemId: item.id, quantity: format(q), value: format(value), lot: text(x.lot, 'output lot', 80) }
    })
    if (new Set(outputs.map(x => x.itemId)).size !== outputs.length) fail('RECOVERY', 'List each output item once.')
    const materials = lines(p.materials).map((x: any) => ({ itemId: get(c.s, 'items', x.itemId).id, locationId: get(c.s, 'locations', x.locationId).id, lotId: x.lotId ? get(c.s, 'lots', x.lotId).id : '', quantity: format(qty(x.quantity)) }))
    const labor = lines(p.labor).map((x: any) => ({ person: text(x.person, 'labor person', 120), hours: format(qty(x.hours, 'labor hours')), rate: format(decimal(x.rate, 'hourly rate')), note: text(x.note, 'labor description', 400) }))
    return row(c, 'reworkOrders', { reference: nextReference(c.s.reworkOrders, kind === 'rework' ? 'RW' : 'UB'), kind, sourceLotId: source.id, sourceJobId: job.id, itemId: source.itemId, bomRevision: job.bomRevision, sourceMovementIds: c.s.movements.filter(m => m.lotId === source.id && m.quantity > 0n).map(m => m.id), locationId: location.id, sourceStatus: status, quantity: format(quantity), disposition: text(p.disposition, 'disposition', 1000), instructions: text(p.instructions, 'authorized instructions', 4000), evidence: files(c, p.evidence), outputs, materials, labor, scrapValue: format(decimal(p.scrapValue ?? '0', 'scrap value')), status: 'draft', preparedBy: c.actor.id })
  }
  const w = get(c.s, 'reworkOrders', p.orderId, 'repair/unbuild order'); fresh(w, p.version)
  if (type === 'rework.approve') {
    approver(c, ['manager'], w.preparedBy)
    if (w.status !== 'draft') fail('STATE', 'Approve a draft order once.')
    return bump(w, { status: 'approved', approval: { by: c.actor.id, at: c.now, version: w.version, reason: text(p.reason, 'approval reason', 400) } })
  }
  if (type === 'rework.execute') {
    allow(c, ['manager', 'production'])
    if (w.status !== 'approved') fail('STATE', 'Execute only approved instructions, once.')
    const nonconformance = w.nonconformanceId ? get(c.s, 'nonconformances', w.nonconformanceId) : undefined
    if (nonconformance && (nonconformance.status !== 'open' || decimal(w.quantity) > decimal(nonconformance.remaining))) fail('NONCONFORMANCE', 'The case no longer holds the approved repair quantity.')
    const source = get(c.s, 'lots', w.sourceLotId), base = { documentKind: 'reworkOrders', documentId: w.id, reason: `${w.reference}: ${w.disposition}` }
    const consumed = move(c, { ...base, itemId: w.itemId, locationId: w.locationId, status: w.sourceStatus, lotId: source.id, quantity: -decimal(w.quantity), ...(nonconformance ? { unitCost: decimal(nonconformance.unitCost) } : {}), kind: 'rework-source' })
    let materialCost = 0n
    for (const m of w.materials) for (const movement of withdraw(c, { ...base, ...m, status: 'available', lotId: m.lotId || undefined, quantity: -decimal(m.quantity), kind: 'issue' })) materialCost -= times(movement.quantity, movement.unitCost)
    const sourceCost = times(-consumed.quantity, consumed.unitCost), laborCost = w.labor.reduce((n: bigint, l: any) => n + times(decimal(l.hours), decimal(l.rate)), 0n)
    const total = sourceCost + materialCost + laborCost, allocated = w.outputs.reduce((n: bigint, x: any) => n + decimal(x.value), 0n)
    if (allocated + decimal(w.scrapValue) !== total) fail('COST', `Allocate exactly ${format(total)} between outputs and scrap; source ${format(sourceCost)}, extra material ${format(materialCost)}, labor ${format(laborCost)}.`)
    const outputLots = []
    for (const x of w.outputs) {
      const q = decimal(x.quantity), unitCost = divide(decimal(x.value), q)
      if (times(q, unitCost) !== decimal(x.value)) fail('COST', 'Output value must reconcile at six-place unit cost precision.')
      const lot = row(c, 'lots', { itemId: x.itemId, code: x.lot, source: 'rework', documentId: w.id, originalLotId: source.id, originalJobId: w.sourceJobId, status: 'quarantined', supplierId: null, ...(source.dates ? { dates: structuredClone(source.dates) } : {}) })
      const m = move(c, { ...base, itemId: x.itemId, locationId: w.locationId, status: 'quarantine', lotId: lot.id, quantity: q, unitCost, kind: w.kind === 'rework' ? 'repair-output' : 'recovered-component' })
      outputLots.push({ lotId: lot.id, movementId: m.id, itemId: x.itemId, quantity: x.quantity, value: x.value })
    }
    if (nonconformance) {
      nonconformance.decisions.push({ by: c.actor.id, at: c.now, decision: 'rework', orderId: w.id, quantity: w.quantity, approval: structuredClone(w.approval) })
      bump(nonconformance, { remaining: format(decimal(nonconformance.remaining) - decimal(w.quantity)) })
    }
    return bump(w, { status: 'quarantine', executedBy: c.actor.id, executedAt: c.now, consumedMovementId: consumed.id, outputLots, cost: { source: format(sourceCost), extraMaterials: format(materialCost), labor: format(laborCost), total: format(total), outputs: format(allocated), scrap: w.scrapValue } })
  }
  if (type === 'rework.release') {
    approver(c, ['manager'], w.executedBy)
    if (w.status !== 'quarantine') fail('STATE', 'Release executed quarantined output once.')
    const evidence = files(c, p.evidence), reason = text(p.reason, 'release reason', 400)
    assertLotNotHeld(c.s, w.sourceLotId, 'released through repair')
    for (const x of w.outputLots) {
      assertLotNotHeld(c.s, x.lotId, 'released')
      const lot = get(c.s, 'lots', x.lotId)
      if (lotBlock(lot, c.now.slice(0, 10))) fail('LOT_BLOCKED', `Recovery lot ${lot.code} ${lotBlock(lot, c.now.slice(0, 10))}; record its documented disposition first.`)
      approvedCertificates(c.s, x.itemId, lot.id, c.now.slice(0, 10))
      for (const stage of ['receipt', 'in-process', 'final']) for (const plan of plansFor(c.s, stage, x.itemId, w.bomRevision).filter(p => p.required)) {
        const result = c.s.inspections.filter(i => i.subjectId === w.id && i.planId === plan.id).at(-1)
        if (!result?.passed || result.planVersion !== plan.version) fail('RETEST', `Record a passing ${plan.name} inspection on this order before release.`)
      }
      const quantity = decimal(x.quantity)
      if (balance(c.s, x.itemId, w.locationId, 'quarantine', lot.id) !== quantity) fail('DEPENDENCY', 'Output stock changed; investigate before release.')
      const out = move(c, { itemId: x.itemId, locationId: w.locationId, status: 'quarantine', lotId: lot.id, quantity: -quantity, kind: 'repair-release', documentKind: 'reworkOrders', documentId: w.id, reason })
      move(c, { ...out, quantity, status: 'available' })
      bump(lot, { status: 'released' })
    }
    return bump(w, { status: 'released', release: { by: c.actor.id, at: c.now, reason, evidence } })
  }
  fail('COMMAND', 'Unknown repair/unbuild command.')
}
