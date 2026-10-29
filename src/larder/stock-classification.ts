// Native physical consequences come from the command's real snapshot and
// postings. This receipt is history, never permission to execute an action.
import { toBase } from './catalogue'
import { decimal, format, max } from './decimal'
import { balance } from './stock'
import { fail } from './problem'
import { get, row, type Context, type Movement, type Row, type State } from './model'

const doors = new Set(['so.reserve', 'wo.reserve', 'receipt.create', 'transfer.create', 'movement.reverse', 'lot.dispose', 'quarantine.decide', 'quality.release'])
const supplied = new Set(['classification', 'classes', 'riskClass', 'riskClasses', 'actionClassification', 'stockClassification', 'accessClassification'])

export function rejectStockClassification(type: string, payload: unknown) {
  if (!doors.has(type) && type !== 'member.scope') return
  const visit = (v: unknown): boolean => !!v && typeof v === 'object' && Object.entries(v).some(([key, value]) => supplied.has(key) || visit(value))
  if (visit(payload)) fail('CLASSIFICATION', 'Action classes are computed by the server; do not supply them.')
}

const fact = (s: State, itemId: string, lotId: string | null, quantity: bigint) => ({ itemId, lotId, unit: get(s, 'items', itemId).baseUnit, quantity: format(quantity) })

// Count a paired transfer or disposition once, while retaining both exact legs.
// Each item and lot keeps its own base unit; there is no cross-item total.
function quantities(s: State, movements: Movement[]) {
  const groups = new Map<string, { itemId: string; lotId: string; incoming: bigint; outgoing: bigint }>()
  for (const m of movements) {
    const key = JSON.stringify([m.itemId, m.lotId]), g = groups.get(key) ?? { itemId: m.itemId, lotId: m.lotId, incoming: 0n, outgoing: 0n }
    if (m.quantity > 0n) g.incoming += m.quantity
    else g.outgoing -= m.quantity
    groups.set(key, g)
  }
  return [...groups.values()].map(g => fact(s, g.itemId, g.lotId, max(g.incoming, g.outgoing)))
}

function proposed(before: State, type: string, p: any) {
  if (type === 'lot.dispose') {
    const lot = get(before, 'lots', p.lotId)
    const places = p.decision === 'scrap' ? [get(before, 'locations', p.locationId).id] : [...new Set(before.movements.filter(m => m.lotId === lot.id).map(m => m.locationId))]
    return places.flatMap(locationId => {
      const quantity = balance(before, lot.itemId, locationId, 'available', lot.id)
      return quantity > 0n ? [{ ...fact(before, lot.itemId, lot.id, quantity), locationId }] : []
    })
  }
  if (type === 'quarantine.decide') {
    const item = get(before, 'items', p.itemId)
    return [{ ...fact(before, item.id, p.lotId ?? '', toBase(item, p.quantity, p.unit)), locationId: p.locationId }]
  }
  if (type === 'quality.release') {
    const hold = get(before, 'qualityHolds', p.holdId)
    return hold.held.flatMap((x: any) => {
      const lot = get(before, 'lots', x.lotId), still = balance(before, lot.itemId, x.locationId, 'quarantine', lot.id)
      const quantity = still < decimal(x.quantity) ? still : decimal(x.quantity)
      return quantity > 0n ? [{ ...fact(before, lot.itemId, lot.id, quantity), locationId: x.locationId }] : []
    })
  }
  if (type === 'so.reserve' || type === 'wo.reserve') {
    const order = get(before, type === 'so.reserve' ? 'salesOrders' : 'workOrders', p.orderId ?? p.workOrderId)
    const lines = type === 'so.reserve' ? order.lines : order.components
    return lines.map((l: any) => {
      const held = before.reservations.filter(r => r.demandId === order.id && r.lineId === l.id).reduce((n, r) => n + r.quantity, 0n)
      const wanted = decimal(type === 'so.reserve' ? l.quantity : l.required) - decimal(type === 'so.reserve' ? l.shipped : l.issued) - decimal(l.cancelled ?? '0')
      return { ...fact(before, l.itemId, null, max(0n, wanted - held)), demandId: order.id, lineId: l.id, locationId: p.locationId ?? null }
    })
  }
  return null
}

export function recordStockClassification(c: Context, before: State, type: string, p: any, result: Row) {
  if (!doors.has(type)) return
  const posted = c.s.movements.slice(before.movements.length)
  const pending = c.s.approvalSignatures.some(x => x.id === result.id && x.remainingAtSigning > 0)
  const destructive = (type === 'lot.dispose' && p.decision === 'scrap') || (type === 'quarantine.decide' && p.decision === 'reject')
  const commitment = type === 'quality.release' || (type === 'quarantine.decide' && p.decision === 'release') || (type === 'lot.dispose' && p.decision === 'extend')
  const reservations = c.s.reservations.flatMap(r => {
    const old = before.reservations.find(o => o.id === r.id)?.quantity ?? 0n, delta = r.quantity - old
    return delta ? [{ ...fact(c.s, r.itemId, null, delta), reservationId: r.id, demandKind: r.demandKind, demandId: r.demandId, lineId: r.lineId, locationId: r.locationId }] : []
  })
  for (const r of before.reservations.filter(r => !c.s.reservations.some(n => n.id === r.id))) reservations.push({ ...fact(c.s, r.itemId, null, -r.quantity), reservationId: r.id, demandKind: r.demandKind, demandId: r.demandId, lineId: r.lineId, locationId: r.locationId })
  const movements = posted.map(m => ({ ...fact(c.s, m.itemId, m.lotId, m.quantity), movementId: m.id, locationId: m.locationId, status: m.status, kind: m.kind, documentKind: m.documentKind, documentId: m.documentId, reversesId: m.reversesId }))
  const hold = type === 'quality.release' ? get(c.s, 'qualityHolds', p.holdId) : undefined
  const inspections = hold ? c.s.inspections.filter(i => i.planId === hold.planId && i.subjectId === hold.subjectId) : []
  c.actionClassification = row(c, 'stockActions', {
    commandId: c.commandId, commandType: type, inputVersion: before.version, recordedVersion: before.version + 1,
    actorId: c.actor.id, actorRole: c.actor.role, source: 'person', resultId: result.id,
    classes: ['standard', ...(destructive ? ['destructive'] : []), ...(commitment ? ['commitment'] : [])],
    effect: pending ? 'pending' : 'applied',
    proposed: proposed(before, type, p) ?? quantities(c.s, posted),
    applied: { quantities: quantities(c.s, posted), movements, reservations },
    evidence: c.attachments.map(a => ({ id: a.id, sha256: a.sha256, createdBy: a.createdBy })),
    inspectionIds: inspections.map(i => i.id), retestId: hold?.release?.retestId ?? null,
    approvalIds: c.s.approvals.filter(a => !before.approvals.some(o => o.id === a.id)).map(a => a.id),
    signatureIds: c.s.approvalSignatures.filter(a => !before.approvalSignatures.some(o => o.id === a.id) || a.consumedBy && !before.approvalSignatures.find(o => o.id === a.id)?.consumedBy).map(a => a.id),
  })
}
