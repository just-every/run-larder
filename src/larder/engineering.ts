// ENG-005: a reviewed change retains its evidence and exact before/after state.
import { attach } from './attachments'
import { canonicalJson, sha256 } from '../modules/import-kit/src/d1/index'
import { activeBom, saveBom } from './bom'
import { decimal, format } from './decimal'
import { bump, fresh, get, oneOf, row, text, type Context, type Row, type State } from './model'
import { fail } from './problem'
import { allow, approver } from './roles'
import { positions } from './stock'

const entries = (value: unknown, name: string, max = 500): any[] => {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > max || value.some(v => !v || typeof v !== 'object' || Array.isArray(v))) fail('INPUT', `${name} must be a list of at most ${max} entries.`)
  return value as any[]
}
const positionKey = (p: any) => JSON.stringify([p.itemId, p.locationId, p.lotId ?? '', p.status])

// A stocked made child has its own job; only phantom children are flattened
// into the parent's release. Released jobs are assessed from their saved pins.
export function engineeringAffectedWork(s: State, itemId: string, on = new Date().toISOString().slice(0, 10)): Row[] {
  return s.workOrders.filter(w => {
    if (!['draft', 'released'].includes(w.status)) return false
    if (w.itemId === itemId) return true
    if (w.status === 'released') return (w.bomRevisions ?? []).some((b: any) => b.itemId === itemId)
    const seen = new Set<string>()
    const reaches = (id: string): boolean => {
      if (id === itemId) return true
      if (seen.has(id)) return false
      seen.add(id)
      const pinned = w.engineeringBomIds?.[id] ?? (id === w.itemId ? w.engineeringBomId : undefined)
      const bom = pinned ? s.boms.find(b => b.id === pinned) : activeBom(s, id, on)
      return (bom?.components ?? []).some((line: any) => line.supply === 'phantom' && reaches(line.itemId))
    }
    return reaches(w.itemId)
  })
}

function componentIds(s: State, bom: Row, on: string) {
  const ids = new Set<string>([bom.itemId]), seen = new Set<string>()
  const visit = (b: Row) => {
    if (seen.has(b.id)) return
    seen.add(b.id)
    for (const line of b.components) {
      ids.add(line.itemId)
      const child = line.supply !== 'buy' && activeBom(s, line.itemId, on)
      if (child) visit(child)
    }
  }
  visit(bom)
  return ids
}

function propose(c: Context, p: any): Row {
  allow(c, ['manager', 'production', 'engineer'])
  const item = get(c.s, 'items', p.itemId, 'item')
  const source = activeBom(c.s, item.id, c.now.slice(0, 10)) ?? fail('NO_BOM', 'Create an effective BOM before proposing an engineering change.')
  if (c.s.engineeringChanges.some(change => change.itemId === item.id && change.status === 'proposed')) fail('STATE', 'Decide the open engineering change for this item first.')
  if (p.sourceBomId !== undefined && p.sourceBomId !== source.id) fail('STALE', 'The effective source BOM changed. Review the current revision.')
  const reason = text(p.reason, 'change reason', 2000)
  if (typeof p.safety !== 'boolean') fail('INPUT', 'Specify whether this is a safety-related change.')
  const candidate: Context = { ...c, s: structuredClone(c.s), attachments: [] }
  const prospective = saveBom(candidate, { itemId: item.id, components: p.components, routing: p.routing ?? source.routing,
    yield: p.yield ?? source.yield ?? '1', effectiveOn: p.effectiveOn, note: reason.slice(0, 400) }, true)
  const before = new Set<string>(source.components.map((line: any) => line.itemId))
  const after = new Set<string>(prospective.components.map((line: any) => line.itemId))
  const removed = [...before].filter(id => !after.has(id))
  const substitutes = entries(p.substitutes, 'substitutes', 200).map(entry => {
    if (!removed.includes(entry.fromItemId) || !after.has(entry.toItemId)) fail('INPUT', 'A substitute must replace a removed source component with a component of the proposed revision.')
    return { fromItemId: entry.fromItemId, toItemId: entry.toItemId, reason: text(entry.reason, 'substitute eligibility reason', 1000) }
  })
  if (new Set(substitutes.map(entry => JSON.stringify([entry.fromItemId, entry.toItemId]))).size !== substitutes.length) fail('INPUT', 'List each substitute eligibility once.')
  const affectedItems = componentIds(c.s, source, c.now.slice(0, 10))
  for (const id of componentIds(candidate.s, prospective, prospective.effectiveOn)) affectedItems.add(id)
  const stock = positions(c.s).filter(position => affectedItems.has(position.itemId))
  const obsolete = stock.filter(position => removed.includes(position.itemId) && decimal(position.quantity, 'stock', { signed: true }) > 0n)
  const dispositions = entries(p.dispositions, 'obsolete stock dispositions').map(entry => {
    const position = obsolete.find(stock => positionKey(stock) === positionKey(entry))
    if (!position || decimal(entry.quantity, 'disposition quantity', { positive: true }) !== decimal(position.quantity)) fail('INPUT', 'Each obsolete stock disposition must name a removed component position and its entire current quantity.')
    return { ...position, quantity: format(decimal(entry.quantity)), action: oneOf(entry.action, ['retain', 'return', 'rework', 'scrap'] as const, 'stock disposition'), reason: text(entry.reason, 'disposition reason', 1000) }
  })
  if (dispositions.length !== obsolete.length || new Set(dispositions.map(positionKey)).size !== obsolete.length) fail('INPUT', 'Record one disposition for every positive obsolete component stock position.')
  const openWork = engineeringAffectedWork(c.s, item.id, c.now.slice(0, 10))
  const drafts = openWork.filter(work => work.status === 'draft')
  const workTreatments = entries(p.workTreatments, 'unreleased work treatments').map(entry => {
    const work = drafts.find(work => work.id === entry.workOrderId) ?? fail('INPUT', 'Choose treatment only for an affected draft work order.')
    fresh(work, entry.version)
    return { workOrderId: work.id, version: work.version, action: oneOf(entry.action, ['keep', 'adopt', 'cancel'] as const, 'work treatment'), reason: text(entry.reason, 'work treatment reason', 1000) }
  })
  if (workTreatments.length !== drafts.length || new Set(workTreatments.map(t => t.workOrderId)).size !== drafts.length) fail('INPUT', 'Choose one treatment for every affected draft work order.')
  const attachments = entries(p.attachments, 'change attachments', 10).map(file => attach(c, file))
  c.attachments.push(...candidate.attachments)
  const revisionInput = { itemId: item.id, components: prospective.components, routing: prospective.routing, yield: prospective.yield, effectiveOn: prospective.effectiveOn, note: prospective.note }
  const change = row(c, 'engineeringChanges', { itemId: item.id, reason, safety: p.safety, effectiveOn: prospective.effectiveOn,
    sourceBomId: source.id, sourceBom: structuredClone(source), prospectiveBom: structuredClone(prospective), revisionInput,
    substitutes, dispositions, workTreatments, attachments, acknowledgments: [], status: 'proposed', stateVersion: c.s.version + 1,
    impact: { componentsBefore: structuredClone(source.components), componentsAfter: structuredClone(prospective.components), removedItemIds: removed,
      stock, openWork: structuredClone(openWork) } })
  const review = engineeringReview(c, change)
  change.classification = { version: 1, classes: ['standard'], effect: 'prepared', approvalClasses: ['commitment'],
    commandId: c.commandId, at: c.now, actor: person(c), review, inputsDigest: sha256(canonicalJson(review)) }
  return change
}

const person = (c: Context) => ({ id: c.actor.id, role: c.actor.role, operatorVersion: c.actor.operatorVersion })
const definition = (b: Row) => { const { engineeringDecision, ...inputs } = b; return inputs }
const revision = (b: Row) => ({ id: b.id, version: b.version, revision: b.revision, itemId: b.itemId, effectiveOn: b.effectiveOn })

// Rebuild the exact review from live business inputs before publishing a BOM.
// A disposition here is an instruction, including scrap; no physical act is
// performed or certified by either proposal preparation or revision approval.
function engineeringReview(c: Context, change: Row) {
  const source = get(c.s, 'boms', change.sourceBomId, 'source revision')
  const affected = componentIds(c.s, source, c.now.slice(0, 10))
  for (const id of componentIds(c.s, change.prospectiveBom, change.effectiveOn)) affected.add(id)
  const files = (bom: Row, kind: string) => (bom.routing ?? []).flatMap((step: any) =>
    (step.drawings ?? []).map((file: any) => ({ kind, revisionId: bom.id, sequence: step.sequence, ...file })))
  return JSON.parse(JSON.stringify({
    changeId: change.id, changeVersion: change.version, stateVersion: change.stateVersion,
    source: revision(source), proposed: revision(change.prospectiveBom), effectiveOn: change.effectiveOn,
    // Full normalized revisions bind instructions, quantities and original file
    // references as well as identities. These are review inputs, not signatures.
    sourceBom: definition(source), proposedBom: definition(change.prospectiveBom), revisionInput: change.revisionInput,
    itemVersions: [...affected].sort().map(id => { const item = get(c.s, 'items', id); return { id, version: item.version } }),
    reason: change.reason, safety: change.safety, substitutes: change.substitutes,
    stock: positions(c.s).filter(p => affected.has(p.itemId)), dispositionInstructions: change.dispositions,
    affectedWork: engineeringAffectedWork(c.s, change.itemId, c.now.slice(0, 10)).map(w => ({
      workOrderId: w.id, version: w.version, status: w.status, itemId: w.itemId, quantity: w.quantity,
      requiredBy: w.requiredBy, bomId: w.bomId ?? null, bomRevisions: w.bomRevisions ?? [],
      engineeringBomIds: w.engineeringBomIds ?? {},
      treatment: w.status === 'released' ? { action: 'preserve released revision' } : change.workTreatments.find((t: any) => t.workOrderId === w.id),
    })),
    evidence: [...change.attachments.map((file: any) => ({ kind: 'change evidence', ...file })),
      ...files(source, 'source drawing'), ...files(change.prospectiveBom, 'proposed drawing')],
    physicalStockChanged: false, physicalDestruction: false,
  }))
}

function reviewedClassification(c: Context, change: Row) {
  const review = engineeringReview(c, change)
  const inputsDigest = sha256(canonicalJson(review))
  if (!change.classification || inputsDigest !== change.classification.inputsDigest ||
      canonicalJson(review) !== canonicalJson(change.classification.review))
    fail('STALE', 'The engineering review inputs changed. Prepare and review a new proposal.')
  return { review, inputsDigest }
}

export function engineering(c: Context, type: string, p: any): Row | undefined {
  if (!['engineering.propose', 'engineering.approve', 'engineering.acknowledge', 'engineering.decline'].includes(type)) return
  const allowed = type === 'engineering.propose'
    ? ['itemId', 'sourceBomId', 'safety', 'reason', 'effectiveOn', 'components', 'routing', 'yield', 'attachments', 'substitutes', 'dispositions', 'workTreatments']
    : type === 'engineering.acknowledge' ? ['changeId', 'version', 'bomId', 'note']
    : type === 'engineering.decline' ? ['changeId', 'version', 'reason'] : ['changeId', 'version']
  if (Object.keys(p).some(key => !allowed.includes(key))) fail('INPUT', 'Engineering classes, review facts and decision attribution are computed by the server.')
  if (type === 'engineering.propose') return propose(c, p)
  const change = get(c.s, 'engineeringChanges', p.changeId, 'engineering change')
  if (type === 'engineering.acknowledge') {
    allow(c, ['manager', 'production'])
    fresh(change, p.version)
    if (change.status !== 'approved') fail('STATE', 'Acknowledge an approved engineering change.')
    if (p.bomId !== undefined && p.bomId !== change.bomId) fail('STALE', 'Acknowledge the exact approved BOM revision.')
    const acknowledgment = { actorId: c.actor.id, at: c.now, note: text(p.note, 'acknowledgment note', 1000), bomId: change.bomId, approvedVersion: change.approvedVersion }
    return bump(change, { acknowledgments: [...change.acknowledgments, acknowledgment] })
  }
  approver(c, ['manager'], type === 'engineering.approve' ? change.createdBy : undefined)
  fresh(change, p.version)
  if (change.status !== 'proposed') fail('STATE', 'This engineering change has already been decided.')
  if (type === 'engineering.decline') return bump(change, { status: 'declined', declinedBy: c.actor.id, declinedAt: c.now, declineReason: text(p.reason, 'decline reason', 1000),
    decision: { classes: ['standard'], effect: 'declined', by: c.actor.id, actor: person(c), at: c.now, commandId: c.commandId,
      reviewedVersion: change.version, inputsDigest: change.classification?.inputsDigest ?? null, approvedRevision: null, physicalStockChanged: false, physicalDestruction: false } })
  if (change.stateVersion !== c.s.version) fail('STALE', 'Business records changed after this proposal. Prepare a new engineering change and review its impact.')
  if (activeBom(c.s, change.itemId, c.now.slice(0, 10))?.id !== change.sourceBomId) fail('STALE', 'The effective source BOM changed after this proposal. Review its current impact.')
  const computed = reviewedClassification(c, change)
  const saved = saveBom(c, change.revisionInput)
  for (const treatment of change.workTreatments) {
    const work = get(c.s, 'workOrders', treatment.workOrderId, 'work order')
    fresh(work, treatment.version)
    if (work.status !== 'draft') fail('STALE', 'An affected draft work order changed after review.')
    if (treatment.action === 'cancel') bump(work, { status: 'cancelled', cancelledBy: c.actor.id, cancelledAt: c.now, cancellationReason: treatment.reason, engineeringChangeId: change.id })
    else {
      const bomId = treatment.action === 'keep' ? change.sourceBomId : saved.id
      bump(work, { engineeringBomIds: { ...(work.engineeringBomIds ?? {}), [change.itemId]: bomId },
        ...(work.itemId === change.itemId ? { engineeringBomId: bomId } : {}), engineeringChangeId: change.id, engineeringTreatment: treatment.action })
    }
  }
  const decision = { classes: ['commitment'], effect: 'applied', by: c.actor.id, actor: person(c), at: c.now, commandId: c.commandId,
    reviewedVersion: change.version, approvedVersion: change.version + 1, ...computed, approvedRevision: revision(saved),
    physicalStockChanged: false, physicalDestruction: false }
  saved.engineeringDecision = structuredClone(decision)
  return bump(change, { decision, status: 'approved', bomId: saved.id, approvedBom: structuredClone(saved), approvedVersion: change.version + 1, approvedBy: c.actor.id, approvedAt: c.now })
}
