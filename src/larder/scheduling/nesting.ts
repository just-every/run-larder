// Grouping preserves original jobs. Physical posting needs explicit owner approval; no booking or clock is changed.
import { canonicalJson, sha256 } from '../../modules/import-kit/src/d1/index'
import { attach } from '../attachments'
import { decimal, divide, format, times } from '../decimal'
import { bump, fresh, get, list, row, text, type Context, type Row } from '../model'
import { fail, forbidden } from '../problem'
import { allow } from '../roles'
import { scopeOf } from '../scope'
import { refuseHidden, visibleState } from '../scope-view'
import { balance, averageCost, move, withdraw } from '../stock'
import { production } from '../production'
import { requiredTypes } from '../certificate-policy'
import { lotBlock } from '../lot-dates'
import { workHolds, plansFor, openHolds } from '../quality-holds'
import { workRecalls } from '../recall-policy'
import { nestingCapacity } from './nesting-capacity'

function reachable(c: Context, ids: unknown) {
  const scope = scopeOf(c.actor)
  if (scope.locations !== null) refuseHidden(ids, visibleState(c.s, scope).hidden)
}
function job(c: Context, id: unknown, version: unknown) {
  reachable(c, id)
  const w = get(c.s, 'workOrders', id); fresh(w, version)
  if (w.status !== 'released' || decimal(w.output) !== 0n || decimal(w.scrap) !== 0n || w.components.some((l: any) => decimal(l.issued) !== 0n)) fail('STATE', 'Group released jobs before any issue or output.')
  if (w.operationStates?.some((t: any) => t.status !== 'pending')) fail('STATE', 'Group only pending operations; existing execution stays on its original job.')
  if (workHolds(c.s, w).length || workRecalls(c.s, w).length) fail('QUALITY_HOLD', 'Resolve the job quality or recall hold before grouping.')
  return w
}
function member(c: Context, input: any, materialItemId: string) {
  const w = job(c, input.workOrderId, input.version)
  const step = w.routing.find((r: any) => r.sequence === input.sequence)
  if (!step) fail('OPERATION', 'Choose an operation in the pinned routing.')
  if (!w.components.some((l: any) => l.itemId === materialItemId)) fail('INCOMPATIBLE', 'Every grouped job must use the selected material in its pinned recipe.')
  return { workOrderId: w.id, version: w.version, reference: w.reference, itemId: w.itemId, quantity: w.quantity, requiredBy: w.requiredBy,
    reason: w.reason, bomId: w.bomId, bomRevision: w.bomRevision, bomRevisions: structuredClone(w.bomRevisions ?? []),
    configuration: structuredClone(w.configuration ?? null), demandSources: structuredClone(w.demandSources ?? []), sequence: step.sequence,
    operation: structuredClone(step), scheduleChoices: structuredClone(w.scheduleChoices ?? {}),
    locationIds: [...new Set(c.s.reservations.filter(r => r.demandId === w.id).map(r => r.locationId))] }
}
const compatible = (m: any) => canonicalJson({ center: m.operation.workCentre, eligible: m.operation.eligibleCentres ?? [], family: m.operation.setupFamily ?? '', tools: m.operation.requiredTools ?? [], skills: m.operation.requiredSkills ?? [], choice: m.scheduleChoices[m.sequence] ?? '' })
function currentMembers(c: Context, group: Row) {
  return group.members.map((m: any) => {
    const now = member(c, { workOrderId: m.workOrderId, version: m.version, sequence: m.sequence }, group.materialItemId)
    if (canonicalJson(now) !== canonicalJson(m)) fail('STALE', 'Grouped work changed; prepare a fresh group with its current inputs.')
    return now
  })
}

export function nesting(c: Context, type: string, p: any): Row | undefined {
  if (!type.startsWith('nest.')) return
  allow(c, ['manager', 'planner', 'agent'])
  if (type === 'nest.prepare') {
    const material = get(c.s, 'items', p.materialItemId), entries = list<any>(p.members, 'group members', 50)
    if (entries.length < 2 || new Set(entries.map(x => x.workOrderId)).size !== entries.length) fail('DUPLICATE_WORK', 'Group at least two distinct jobs, each listed once.')
    const members = entries.map(x => member(c, x, material.id))
    if (members.some(m => compatible(m) !== compatible(members[0]))) fail('INCOMPATIBLE', 'Grouped operations need the same eligible centers, selected center, setup family, tools and skills.')
    return row(c, 'workGroups', { reference: `NEST-${c.commandId}`, status: 'draft', materialItemId: material.id, members, reason: text(p.reason, 'group reason'),
      preparedBy: c.actor.id, semantics: 'Review only: original jobs, revisions, due dates, reservations, customer promises and finite bookings remain authoritative.' })
  }
  const group = get(c.s, 'workGroups', p.groupId); reachable(c, group); fresh(group, p.version)
  if (type === 'nest.cancel') {
    if (!['draft', 'review'].includes(group.status)) fail('STATE', 'Only an open review group can be cancelled.')
    if (c.actor.role !== 'owner' && c.actor.id !== group.preparedBy) forbidden('Only the owner or the group preparer cancels this review.')
    return bump(group, { status: 'cancelled', cancelledBy: c.actor.id, cancelledAt: c.now, cancellationReason: text(p.reason, 'cancellation reason') })
  }
  if (type === 'nest.approve') {
    // Approved authority: the owner explicitly approves these
    // exact reviewed physical quantities; agents and all other roles refuse.
    if (c.actor.role !== 'owner') forbidden( 'Only the owner approves exact nesting consumption and offcut recovery.')
    if (group.status !== 'review') fail('STATE', 'Approve an unposted nesting review once.')
    if (c.s.version !== group.snapshotVersion + 1 || group.day !== c.now.slice(0, 10)) fail('STALE', 'Business inputs or the UTC day changed; prepare and review a fresh group.')
    currentMembers(c, group)
    const reason = text(p.reason, 'nesting approval reason'), r = group.review, source = r.source
    const lot = get(c.s, 'lots', source.lotId)
    if (lotBlock(lot, c.now.slice(0, 10)) || lot.status !== 'released' || lot.ownerId) fail('QUALITY_HOLD', 'The reviewed source is no longer released, owned and current.')
    if (averageCost(c.s, source.itemId) !== decimal(source.unitCost)) fail('STALE', 'The source valuation changed; review a fresh group.')
    const beforeMovement = c.s.movements.length
    for (const allocation of r.jobs) {
      const w = production(c, 'wo.issue', { workOrderId: allocation.workOrderId, lines: [{ itemId: source.itemId, locationId: source.locationId, lotId: source.lotId, quantity: allocation.materialQuantity, note: reason }] })!
      w.nestingGroups = [...(w.nestingGroups ?? []), { groupId: group.id, quantity: allocation.quantity, materialQuantity: allocation.materialQuantity, materialCost: allocation.materialCost, setupMinutes: allocation.setupMinutes }]
    }
    let offcutLotId = ''
    if (decimal(r.offcut.quantity) > 0n) {
      if (c.s.lots.some(l => l.itemId === source.itemId && l.code === r.offcut.code)) fail('DUPLICATE_LOT', 'Choose a new offcut lot code.')
      const q = decimal(r.offcut.quantity)
      const out = withdraw(c, { itemId: source.itemId, locationId: source.locationId, lotId: source.lotId, quantity: -q, status: 'available', kind: 'transfer', documentKind: 'workGroups', documentId: group.id, reason })[0]
      // Recovery keeps the source dates and disposition. It grants no shelf
      // life extension, quality release, new value or supplier certification.
      const recovered = row(c, 'lots', { itemId: source.itemId, code: r.offcut.code, supplierId: lot.supplierId, source: 'nesting', documentId: group.id, parentLotId: lot.id, status: 'released', ...(lot.dates ? { dates: structuredClone(lot.dates) } : {}),
        manufacturedOn: lot.manufacturedOn, expiresOn: lot.expiresOn, retestOn: lot.retestOn, supplierShelfLifeDays: lot.supplierShelfLifeDays, storage: lot.storage })
      offcutLotId = recovered.id
      move(c, { itemId: source.itemId, locationId: r.offcut.locationId, lotId: recovered.id, quantity: q, unitCost: out.unitCost, status: 'available', kind: 'nesting-offcut', documentKind: 'workGroups', documentId: group.id, reason })
    }
    const movements = c.s.movements.slice(beforeMovement)
    for (const allocation of r.jobs) {
      const actual = -movements.filter(m => m.kind === 'issue' && m.documentId === allocation.workOrderId).reduce((n, m) => n + times(m.quantity, m.unitCost), 0n)
      if (actual !== decimal(allocation.materialCost)) fail('ALLOCATION', 'Posted material costs differ from the reviewed allocation; revise the result precision.')
    }
    return bump(group, { status: 'posted', approvedBy: c.actor.id, approvedAt: c.now, approvalReason: reason, approvalPolicy: 'Owner-only exact physical approval; changed nests require fresh approval. No shared setup booking or output authority.',
      offcutLotId, movementIds: movements.map(m => m.id), semantics: 'Approved material consumption and offcut recovery only. Original jobs retain their output, operation, revision, customer and finite schedule authority.' })
  }
  if (type !== 'nest.import') fail('COMMAND', 'Unknown nesting command.')
  if (group.status !== 'draft') fail('STATE', 'Import one result per draft group; prepare another group for a changed result.')
  const members = currentMembers(c, group)
  if (!p.file || typeof p.file.content !== 'string' || p.file.content.length > 1048576) fail('INPUT', 'Supply a nesting JSON file of at most 1 MiB.')
  const name = text(p.file.name, 'nesting file name', 200)
  let report: any
  try { report = JSON.parse(p.file.content) } catch { fail('INPUT', 'The nesting file must contain valid JSON.') }
  if (report?.format !== 'larder-nesting-v1') fail('INPUT', 'Use the documented larder-nesting-v1 format.')
  const source = report.source
  if (!source || source.itemId !== group.materialItemId) fail('INCOMPATIBLE', 'The nesting material must match the group material.')
  reachable(c, source)
  const material = get(c.s, 'items', source.itemId), location = get(c.s, 'locations', source.locationId), lot = get(c.s, 'lots', source.lotId)
  if (lot.itemId !== material.id) fail('INCOMPATIBLE', 'The source lot must belong to the group material.')
  if (material.tracking === 'serial') fail('TRACKING_NOT_READY', 'Serial execution is not available through nesting.')
  if (requiredTypes(c.s, material.id).length || plansFor(c.s, 'receipt', material.id, null).some(plan => plan.required)) fail('QUALITY_HOLD', 'Nesting recovery for certificate-controlled or inspection-required material needs its own disposition flow; use the existing quality doors.')
  if (lot.ownerId || openHolds(c.s, lot.id).length || lotBlock(lot, c.now.slice(0, 10)) || lot.status !== 'released') fail('QUALITY_HOLD', 'Choose a released, owned, current material lot.')
  const gross = decimal(source.quantity, 'source quantity', { positive: true }), offcut = decimal(report.offcut?.quantity ?? '0', 'offcut quantity')
  if (gross > balance(c.s, material.id, location.id, 'available', lot.id)) fail('INSUFFICIENT_STOCK', 'The source lot does not cover the reported sheet quantity.')
  if (offcut >= gross) fail('ALLOCATION', 'Recoverable offcut must be less than the input quantity.')
  const rows = list<any>(report.jobs, 'nesting job allocations', 50)
  if (rows.length !== members.length || new Set(rows.map(x => x.workOrderId)).size !== rows.length || rows.some(x => !members.some((m: any) => m.workOrderId === x.workOrderId))) fail('ALLOCATION', 'Allocate every original grouped job exactly once.')
  const unitCost = averageCost(c.s, material.id), setupMinutes = decimal(report.sharedSetupMinutes, 'shared setup minutes')
  const jobs = rows.map(x => {
    const m = members.find((m: any) => m.workOrderId === x.workOrderId)!, quantity = decimal(x.quantity, 'output quantity', { positive: true })
    if (quantity > decimal(m.quantity)) fail('OVER_OUTPUT', 'A nesting result cannot exceed its original job quantity.')
    const consumed = decimal(x.materialQuantity, 'allocated material', { positive: true }), good = decimal(x.goodMaterialQuantity, 'good material quantity', { positive: true }), setup = decimal(x.setupMinutes, 'allocated setup minutes')
    if (good > consumed) fail('ALLOCATION', 'Good material cannot exceed allocated consumption.')
    return { ...m, quantity: format(quantity), materialQuantity: format(consumed), goodMaterialQuantity: format(good), scrapQuantity: format(consumed - good), materialCost: format(times(consumed, unitCost)), setupMinutes: format(setup) }
  })
  const consumed: bigint = jobs.reduce((n, j) => n + decimal(j.materialQuantity), 0n), good: bigint = jobs.reduce((n, j) => n + decimal(j.goodMaterialQuantity), 0n)
  if (consumed + offcut !== gross || jobs.reduce((n, j) => n + decimal(j.setupMinutes), 0n) !== setupMinutes) fail('ALLOCATION', 'Consumption plus recoverable offcut must equal input exactly; job setup shares must equal the shared setup.')
  // Allocate the rounding residue explicitly to the last job, so every value
  // reconciles at six places without changing a recorded stock unit cost.
  const grossCost = times(gross, unitCost), offcutCost = times(offcut, unitCost), consumedCost = grossCost - offcutCost
  jobs.at(-1)!.materialCost = format(consumedCost - jobs.slice(0, -1).reduce((n, j) => n + decimal(j.materialCost), 0n))
  if (decimal(jobs.at(-1)!.materialCost, 'allocated cost', { signed: true }) < 0n) fail('ALLOCATION', 'This precision cannot represent the cost shares; revise the allocations.')
  const offcutRecord = offcut > 0n ? { quantity: format(offcut), code: text(report.offcut.code, 'offcut lot code', 80), locationId: get(c.s, 'locations', report.offcut.locationId).id, materialCost: format(offcutCost) } : { quantity: '0', materialCost: '0' }
  reachable(c, offcutRecord)
  const capacity = nestingCapacity(c, group, members, format(setupMinutes), p.capacity)
  let binary = ''
  for (const byte of new TextEncoder().encode(p.file.content)) binary += String.fromCharCode(byte)
  const original = attach(c, { name, contentType: ['text', 'plain'].join('/'), base64: btoa(binary) })
  return bump(group, { status: 'review', importedBy: c.actor.id, importedAt: c.now, original, inputDigest: sha256(canonicalJson({ members, source, day: c.now.slice(0, 10), version: c.s.version })),
    review: { source: { itemId: material.id, locationId: location.id, lotId: lot.id, quantity: format(gross), unitCost: format(unitCost), materialCost: format(grossCost) }, jobs, offcut: offcutRecord,
      materialYield: format(divide(good, gross)), scrapQuantity: format(consumed - good), materialCost: format(consumedCost), sharedSetupMinutes: format(setupMinutes),
      ...(capacity ? { capacity } : {}), baselineSetupMinutes: format(members.reduce((n: bigint, m: any) => n + decimal(String(m.operation.setupMinutes ?? 0)), 0n)), approvalEnabled: true }, snapshotVersion: c.s.version, day: c.now.slice(0, 10) })
}
