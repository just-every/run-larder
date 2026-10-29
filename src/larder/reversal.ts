import { purchaseNextDate } from './supplier-terms'
// Corrections by compensating movements. A reversal never edits or deletes the
// original; it posts the exact opposite and links back. If later work already
// used the stock, the reversal is refused until that work is reversed first.
import { decimal, format } from './decimal'
import { fail, Problem } from './problem'
import { allow } from './roles'
import { move, reserve } from './stock'
import { deliveries, refreshPromise } from './sales-schedules'
import { bump, get, list, oneOf, row, text, type Context, type Movement, type Row } from './model'

const kinds = ['receipts', 'shipments', 'transfers', 'counts', 'openings', 'returns', 'workOrders'] as const

function effects(c: Context, kind: string, doc: Row, m: Movement) {
  const q = m.quantity < 0n ? -m.quantity : m.quantity
  if (kind === 'receipts') {
    const po = get(c.s, 'purchaseOrders', doc.poId), line = doc.lines.find((l: any) => l.movementId === m.id) ?? doc.lines.find((l: any) => l.itemId === m.itemId && l.locationId === m.locationId && (l.lotId ?? '') === m.lotId)
    const poLine = po.lines.find((l: any) => l.id === line?.lineId)
    if (poLine) poLine.received = format(decimal(poLine.received) - q)
    if (m.lotId) bump(get(c.s, 'lots', m.lotId), { status: 'reversed' })
    po.status = po.lines.some((l: any) => decimal(l.received) > 0n) ? 'part received' : po.supplierReference ? 'confirmed' : 'approved'
    bump(po, { expectedDate: purchaseNextDate(po) })
  }
  if (kind === 'shipments') {
    const order = get(c.s, 'salesOrders', doc.orderId), line = doc.lines.find((l: any) => l.movementIds?.includes(m.id)) ?? doc.lines.find((l: any) => l.itemId === m.itemId && l.locationId === m.locationId)
    const orderLine = order.lines.find((l: any) => l.id === line?.lineId)
    if (orderLine) {
      // Goods that came back are counted by the return; reverse it first, or they come back twice.
      if (decimal(orderLine.shipped) - q < decimal(orderLine.returned ?? '0')) {
        const back = c.s.returns.find(r => r.orderId === order.id && r.lineId === orderLine.id && r.status !== 'reversed')
        fail('DEPENDENCY', `${back?.reference ?? 'A return'} brought back goods from this shipment. Reverse the return first, then the shipment.`, { blockedBy: back?.reference })
      }
      const schedules = deliveries(order, orderLine)
      // The reversal restores demand; the issued shipment's delivery snapshot stays immutable.
      const issued = line?.deliveryMovements?.find((delivery: any) => delivery.movementId === m.id)?.schedules
      schedules.push(...(issued ? structuredClone(issued) : [{ quantity: format(q), date: order.promiseDate }]))
      orderLine.schedules = schedules.sort((a, b) => a.date.localeCompare(b.date))
      orderLine.shipped = format(decimal(orderLine.shipped) - q)
      refreshPromise(order)
      reserve(c, { demandKind: 'sales', demandId: order.id, lineId: orderLine.id, itemId: m.itemId }, q, m.locationId)
    }
    order.status = order.lines.some((l: any) => decimal(l.shipped) > 0n) ? 'part shipped' : 'confirmed'
    bump(order, {})
  }
  if (kind === 'returns') {
    const order = get(c.s, 'salesOrders', doc.orderId), orderLine = order.lines.find((l: any) => l.id === doc.lineId)
    if (orderLine) orderLine.returned = format(decimal(orderLine.returned) - q)
    bump(order, {})
  }
  if (kind === 'workOrders') {
    if (doc.status !== 'released') fail('STATE', 'Reverse work-order postings while the work order is still released.')
    if (m.kind === 'issue') { const l = doc.components.find((x: any) => x.itemId === m.itemId); if (l) l.issued = format(decimal(l.issued) - q) }
    if (m.kind === 'output') doc.output = format(decimal(doc.output) - q)
  }
}

export function reversal(c: Context, type: string, p: any): Row | undefined {
  if (type !== 'movement.reverse') return
  allow(c, ['manager', 'warehouse', 'production'])
  const kind = oneOf(p.documentKind, kinds, 'document kind'), doc = get(c.s, kind, p.documentId, 'document')
  if (kind === 'transfers' && doc.logistics && doc.status === 'in transit') fail('STATE', 'Receive this transit before reversing it.')
  const reversed = new Set(c.s.movements.filter(m => m.reversesId).map(m => m.reversesId))
  let targets = c.s.movements.filter(m => m.documentKind === kind && m.documentId === doc.id && !reversed.has(m.id))
  if (p.movementIds !== undefined) { const ids = new Set(list<string>(p.movementIds, 'movements')); targets = targets.filter(m => ids.has(m.id)) }
  if (kind === 'transfers' && doc.logistics && p.movementIds !== undefined && targets.length !== c.s.movements.filter(m => m.documentKind === kind && m.documentId === doc.id && !reversed.has(m.id)).length) fail('STATE', 'Reverse the complete warehouse transfer so its stock stays conserved.')
  if (kind === 'workOrders' && c.s.workTransfers.some(t => t.transfers.some((a: any) => a.sourceId === doc.id))) fail('DEPENDENCY', 'Split/merge successors depend on this job’s original issues and lots.')
  if (c.s.nonconformances.some(n => targets.some(m => n.sourceMovementIds.includes(m.id)))) fail('DEPENDENCY', 'Nonconformance containment depends on this original stock; retain its genealogy.')
  if (c.s.reworkOrders.some(w => ['quarantine', 'released'].includes(w.status) && targets.some(m => w.sourceMovementIds.includes(m.id)))) fail('DEPENDENCY', 'Repair/unbuild consumed this original stock. Its genealogy must be retained.')
  if (c.s.subcontractOrders.some(w => w.issued.some((i: any) => targets.some(m => m.lotId === i.lotId)))) fail('DEPENDENCY', 'Subcontract custody depends on this source lot; retain its genealogy.')
  if (c.s.workOrders.some(w => (w.outputs ?? []).some((b: any) => b.allocations && (targets.some(m => m.id === b.movementId) || b.allocations.some((a: any) => targets.some(m => m.id === a.movementId)))))) fail('DEPENDENCY', 'An exact output-batch allocation depends on these postings; retain its component-lot genealogy.')
  if (!targets.length) fail('NOTHING_TO_REVERSE', 'Those movements are already reversed or do not exist.')
  const r = row(c, 'reversals', { targetKind: kind, targetId: doc.id, targetReference: doc.reference ?? '', reason: text(p.reason, 'reason', 400), movements: [] })
  for (const m of [...targets].sort((a, b) => b.sequence - a.sequence)) {
    try {
      const out = move(c, { itemId: m.itemId, locationId: m.locationId, status: m.status, lotId: m.lotId, quantity: -m.quantity, unitCost: m.unitCost, kind: `${m.kind}-reversal`, documentKind: 'reversals', documentId: r.id, reversesId: m.id, reason: r.reason })
      r.movements.push({ reverses: m.id, movement: out.id })
    } catch (error) {
      if (error instanceof Problem && ['INSUFFICIENT_STOCK', 'RESERVED_STOCK'].includes(error.code))
        fail('DEPENDENCY', 'Later work already uses this stock. Reverse that work first (newest first), then try again.', { blockedBy: error.details, movementId: m.id })
      throw error
    }
    effects(c, kind, doc, m)
  }
  const remaining = c.s.movements.some(m => m.documentKind === kind && m.documentId === doc.id && !c.s.movements.some(x => x.reversesId === m.id))
  if (!remaining && kind !== 'workOrders') doc.status = 'reversed'
  bump(doc, {})
  return r
}
