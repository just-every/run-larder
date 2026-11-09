// The native journal describes applied business transitions, never command
// attempts or predictions. Its projections intentionally omit personal labels,
// free text, prices, file names and document bodies.
import { format, decimal } from './decimal'
import { auditReader } from './audit-read'
import { Problem } from './problem'
import { lotBlock } from './lot-dates'
import { approvedCertificates } from './certificate-policy'
import { lotRecalls } from './recall-policy'
import { plansFor } from './quality-holds'
import { purchaseDate } from './supplier-terms'
import type { Actor, ChangeEvent, ChangeEventDetails, ChangeEventType, Collection, Context, Row, State } from './model'

export const changeEventTypes: readonly ChangeEventType[] = ['receipt.recorded', 'work.output-recorded', 'quality.held', 'quality.released', 'shipment.dispatched', 'supplier.date-recorded', 'material.usable']
const newRows = (c: Context, before: State, kind: Collection) => c.s[kind].filter(r => !before[kind].some(b => b.id === r.id))

export function changeEvents(c: Context, before: State, commandType: string): ChangeEvent[] {
  const out: ChangeEvent[] = []
  const posted = c.s.movements.slice(before.movements.length)
  const make = <T extends ChangeEventType>(type: T, kind: Collection, source: Row, details: ChangeEventDetails[T], related: [Collection, string][], evidenceSources: unknown[] = [source]) => {
    const movements = posted.filter(m => m.documentKind === kind && m.documentId === source.id)
    const physicalRefs = movements.flatMap((m): [Collection, string][] => [['items', m.itemId], ['locations', m.locationId], ['lots', m.lotId]])
    const records = [...new Map([[kind, source.id] as [Collection, string], ...related, ...physicalRefs].flatMap(([kind, id]) => {
      const r = c.s[kind].find(r => r.id === id)
      return r ? [[kind + ':' + id, { kind, id, version: r.version }] as const] : []
    })).values()]
    const evidence = new Map<string, { id: string; sha256: string; href: string }>()
    const files = (v: any): void => {
      if (!v || typeof v !== 'object') return
      if (typeof v.id === 'string' && typeof v.sha256 === 'string') evidence.set(v.id, { id: v.id, sha256: v.sha256, href: '/api/larder/attachments/' + v.id })
      if (Array.isArray(v)) v.forEach(files)
      else Object.values(v).forEach(files)
    }
    evidenceSources.forEach(files)
    out.push({
      id: c.commandId + ':' + type + ':' + out.length, type, commandId: c.commandId, commandType,
      at: c.now, stateVersion: before.version + 1, source: { kind, id: source.id, version: source.version },
      records, details, evidence: [...evidence.values()],
      movements: movements.map(m => ({ id: m.id, sequence: m.sequence, itemId: m.itemId, locationId: m.locationId, lotId: m.lotId, status: m.status, quantity: format(m.quantity) })),
    })
  }
  if (commandType === 'po.confirm' || commandType === 'po.revise') for (const po of c.s.purchaseOrders) {
    const old = before.purchaseOrders.find(b => b.id === po.id)
    if (!old || po.version === old.version) continue
    const entry = po.history.at(-1)
    if (po.history.length !== old.history.length + 1 || !['supplier confirmed', 'delivery revised'].includes(entry?.change)) continue
    // A first supplier confirmation is meaningful even when its date matches
    // the buyer's estimate. Repeating an unchanged date is not a new date fact.
    const lines = po.lines.flatMap((l: any) => {
      const was = old.lines.find((b: any) => b.id === l.id)
      if (!was || (purchaseDate(old, was) === purchaseDate(po, l) && (commandType !== 'po.confirm' || was.confirmedDate === l.confirmedDate))) return []
      return [{ lineId: l.id, itemId: l.itemId, quantity: format(decimal(l.quantity) - decimal(l.received)), unit: c.s.items.find(i => i.id === l.itemId)!.baseUnit, before: purchaseDate(old, was), after: purchaseDate(po, l), confirmedDate: l.confirmedDate || null }]
    })
    if (lines.length) make('supplier.date-recorded', 'purchaseOrders', po, {
      supplierId: po.supplierId, basis: commandType === 'po.confirm' ? 'supplier-confirmed' : 'buyer-revised', lines,
    }, [['parties', po.supplierId], ...lines.map((l: any): [Collection, string] => ['items', l.itemId])], [entry.evidence])
  }
  if (commandType === 'receipt.create') for (const r of newRows(c, before, 'receipts')) {
    const po = c.s.purchaseOrders.find(p => p.id === r.poId)!
    make('receipt.recorded', 'receipts', r, {
      lines: r.lines.map((l: any) => ({ lineId: l.lineId, itemId: l.itemId, locationId: l.locationId, lotId: l.lotId, quantity: l.quantity, unit: c.s.items.find(i => i.id === l.itemId)!.baseUnit, inspection: l.inspection, movementId: l.movementId })),
      partial: po.status === 'part received',
    }, [['purchaseOrders', r.poId], ...r.lines.map((l: any): [Collection, string] => ['lots', l.lotId])])
  }
  if (commandType === 'wo.output') for (const w of c.s.workOrders) {
    const was = before.workOrders.find(b => b.id === w.id)
    for (const b of (w.outputs ?? []).filter((b: any) => !(was?.outputs ?? []).some((old: any) => old.id === b.id))) {
      make('work.output-recorded', 'workOrders', w, {
        batchId: b.id, itemId: w.itemId, lotId: b.lotId, movementId: b.movementId,
        good: b.good, scrap: b.scrap, unit: c.s.items.find(i => i.id === w.itemId)!.baseUnit,
        allocations: (b.allocations ?? []).map((a: any) => ({ itemId: a.itemId, lotId: a.lotId, quantity: a.quantity, movementId: a.movementId })),
      }, [['lots', b.lotId], ...(b.allocations ?? []).map((a: any): [Collection, string] => ['lots', a.lotId])], [w.routing, b])
    }
  }
  if (commandType === 'quality.inspect' || commandType === 'quality.release') for (const h of c.s.qualityHolds) {
    const old = before.qualityHolds.find(b => b.id === h.id)
    const held = !old && h.status === 'open', released = old?.status === 'open' && h.status === 'released'
    if (!held && !released) continue
    const inspectionId = released ? h.release.retestId : h.inspectionId
    const inspection = c.s.inspections.find(i => i.id === inspectionId)!
    make(held ? 'quality.held' : 'quality.released', 'qualityHolds', h, {
      itemId: h.itemId, inspectionId, plan: { id: inspection.planId, version: inspection.planVersion }, status: h.status,
      quantities: (held ? h.held : h.release.released).map((l: any) => ({ itemId: h.itemId, lotId: l.lotId, locationId: l.locationId, quantity: l.quantity, unit: c.s.items.find(i => i.id === h.itemId)!.baseUnit })),
    }, [[h.subjectKind, h.subjectId], ['inspections', inspectionId], ['inspectionPlans', h.planId], ...h.lots.map((l: any): [Collection, string] => ['lots', l.lotId])], [inspection.evidence, h.release?.evidence])
  }
  if (commandType === 'quarantine.decide') for (const a of newRows(c, before, 'approvals').filter(a => a.decision === 'released')) {
    const m = posted.find(m => m.documentId === a.id && m.quantity > 0n)
    if (m) make('quality.released', 'approvals', a, {
      itemId: m.itemId, status: 'released',
      quantities: [{ itemId: m.itemId, lotId: m.lotId, locationId: m.locationId, quantity: format(m.quantity), unit: c.s.items.find(i => i.id === m.itemId)!.baseUnit }],
    }, [['lots', m.lotId]])
  }
  if (commandType === 'shipment.ship') for (const s of c.s.shipments) {
    if (s.status !== 'shipped' || before.shipments.find(b => b.id === s.id)?.status === 'shipped') continue
    const order = c.s.salesOrders.find(o => o.id === s.orderId)!
    make('shipment.dispatched', 'shipments', s, {
      partial: order.status === 'part shipped',
      lines: s.lines.map((l: any) => ({ lineId: l.lineId, itemId: l.itemId, locationId: l.locationId, quantity: l.quantity, unit: c.s.items.find(i => i.id === l.itemId)!.baseUnit, movementIds: l.movementIds })),
      remaining: order.lines.map((l: any) => ({ lineId: l.id, itemId: l.itemId, quantity: format(decimal(l.quantity) - decimal(l.shipped) - decimal(l.cancelled ?? '0')) })),
    }, [['salesOrders', order.id], ...posted.filter(m => m.documentId === s.id).map((m): [Collection, string] => ['lots', m.lotId])])
  }
  // An availability fact is a linked projection of one applied physical
  // transition, never a second receipt, a prediction or a free-stock promise.
  // Preserve the original event identities by appending these after producers.
  for (const transition of [...out]) {
    if (!['receipt.recorded', 'work.output-recorded', 'quality.released'].includes(transition.type)) continue
    const on = c.now.slice(0, 10)
    const related: [Collection, string][] = transition.records.map(r => [r.kind, r.id]), evidence: unknown[] = [...transition.evidence]
    const quantities = transition.movements.flatMap(m => {
      if (m.status !== 'available' || decimal(m.quantity, 'quantity', { signed: true }) <= 0n) return []
      const proof = materialEligibility(c.s, m.itemId, m.lotId, on)
      if (!proof) return []
      related.push(...proof.records); evidence.push(...proof.evidence)
      return [{ itemId: m.itemId, lotId: m.lotId, locationId: m.locationId, quantity: m.quantity,
        unit: c.s.items.find(i => i.id === m.itemId)!.baseUnit, movementId: m.id }]
    })
    if (!quantities.length) continue
    const source = c.s[transition.source.kind].find(r => r.id === transition.source.id)!
    make('material.usable', transition.source.kind, source, { transitionId: transition.id, on, quantities }, related, evidence)
  }
  return out
}

// The journal cannot turn an available-status movement into a blanket quality
// approval. Inspect the committed lot's date, holds, certificates and current
// required inspections; missing proof simply omits the usability projection.
function materialEligibility(s: State, itemId: string, lotId: string, on: string): { records: [Collection, string][]; evidence: unknown[] } | undefined {
  const lot = s.lots.find(l => l.id === lotId)
  if (lotBlock(lot, on) || lotRecalls(s, lotId).length || s.qualityHolds.some(h => h.status === 'open' && h.lots.some((l: any) => l.lotId === lotId))) return
  const records: [Collection, string][] = [], evidence: unknown[] = []
  let subjectKind = 'lots', subjectId = lotId, plans = plansFor(s, 'receipt', itemId, null)
  if (lot?.source === 'production') {
    const work = s.workOrders.find(w => w.id === lot.documentId)!
    subjectKind = 'workOrders'; subjectId = work.id
    plans = ['in-process', 'final'].flatMap(stage => plansFor(s, stage, itemId, work.bomRevision))
  }
  for (const p of plans.filter(p => p.required)) {
    const latest = s.inspections.filter(i => i.planId === p.id && i.subjectKind === subjectKind && i.subjectId === subjectId).at(-1)
    if (!latest?.passed || latest.planVersion !== p.version) return
    records.push(['inspectionPlans', p.id], ['inspections', latest.id]); evidence.push(latest.evidence)
  }
  try {
    for (const certificate of approvedCertificates(s, itemId, lotId, on)) {
      records.push(['certificates', certificate.id]); evidence.push(certificate.file)
    }
  } catch (error) { if (error instanceof Problem) return; throw error }
  records.push(...s.certificatePolicies.filter(p => p.itemId === itemId && p.customerId === '').map((p): [Collection, string] => ['certificatePolicies', p.id]))
  return { records, evidence }
}

export const changeEventInsert = 'INSERT INTO larder_change_events(id,command_id,type,data) VALUES(?,?,?,?)'
export const changeEventParams = (e: ChangeEvent) => [e.id, e.commandId, e.type, JSON.stringify(e)]
export const changeEventRestoreInsert = 'INSERT INTO larder_change_events(seq,id,command_id,type,data) VALUES(?,?,?,?,?)'
export const retainedChangeEvents = async (db: D1Database) => (await db.prepare('SELECT seq,data FROM larder_change_events ORDER BY seq').all<{ seq: number; data: string }>()).results.map(r => ({ seq: r.seq, ...JSON.parse(r.data) }))

export async function changeEventQuery(db: D1Database, actor: Actor, params: URLSearchParams) {
  auditReader(actor)
  const integer = (key: string, fallback: number) => {
    const v = params.get(key)
    if (v === null) return fallback
    if (!/^\d+$/.test(v) || !Number.isSafeInteger(Number(v))) throw new Problem('INPUT', 'Use nonnegative integer journal cursors and a positive page limit.', null, 400)
    return Number(v)
  }
  const after = integer('after', 0), limit = Math.min(200, integer('limit', 100))
  if (limit < 1) throw new Problem('INPUT', 'Use a positive page limit.', null, 400)
  const max = (await db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM larder_change_events').first<{ seq: number }>())!.seq
  const until = integer('until', max)
  if (until > max || after > until) throw new Problem('INPUT', 'The journal cursor is outside the retained history.', null, 400)
  const where = ['seq>?', 'seq<=?'], bind: unknown[] = [after, until]
  const type = params.get('type'), commandId = params.get('commandId')
  if (type) {
    if (!changeEventTypes.includes(type as ChangeEventType)) throw new Problem('INPUT', 'Choose a supported manufacturing event type.', null, 400)
    where.push('type=?'); bind.push(type)
  }
  if (commandId) { where.push('command_id=?'); bind.push(commandId) }
  const rows = (await db.prepare('SELECT seq,data FROM larder_change_events WHERE ' + where.join(' AND ') + ' ORDER BY seq LIMIT ?').bind(...bind, limit + 1).all<{ seq: number; data: string }>()).results
  const events = rows.slice(0, limit).map(r => ({ seq: r.seq, ...JSON.parse(r.data) }))
  return { events, until, next: rows.length > limit ? events.at(-1)!.seq : null }
}
