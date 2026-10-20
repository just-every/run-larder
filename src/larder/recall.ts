// TRACE-006 containment slice. No notice delivery or final reconciliation claim.
import { attach } from './attachments'
import { format } from './decimal'
import { bump, fresh, get, list, nextReference, row, text, type Context, type Row, type State } from './model'
import { fail } from './problem'
import { allow } from './roles'
import { balance, move, positions, reservedAt } from './stock'
import { lotTrace } from './trace'

function contain(c: Context, r: Row) {
  const trace = lotTrace(c.s, r.sourceLotId, 'downstream')
  const lots = trace.nodes.flatMap(n => n.lotId ? [n.lotId] : [])
  if (lots.some(id => get(c.s, 'lots', id).ownerId)) fail('OWNERSHIP', 'Customer-property containment needs its custody workflow; nothing was held.')
  r.lotIds = [...new Set([...r.lotIds, ...lots])]
  // Conservative WIP gate: issued exposure is not an invented output allocation.
  r.workOrderIds = [...new Set([...r.workOrderIds, ...c.s.movements.filter(m => m.kind === 'issue' && r.lotIds.includes(m.lotId) && m.documentKind === 'workOrders' && m.quantity + c.s.movements.filter(x => x.reversesId === m.id).reduce((n, x) => n + x.quantity, 0n) < 0n).map(m => m.documentId)])]
  r.expansions.push({ by: c.actor.id, at: c.now, lotIds: [...r.lotIds], workOrderIds: [...r.workOrderIds], trace })
  for (const lotId of r.lotIds) {
    const lot = get(c.s, 'lots', lotId)
    for (const location of c.s.locations) {
      const quantity = balance(c.s, lot.itemId, location.id, 'available', lot.id)
      if (quantity <= 0n) continue
      let excess = reservedAt(c.s, lot.itemId, location.id) - (balance(c.s, lot.itemId, location.id) - quantity)
      for (const reservation of [...c.s.reservations].reverse()) {
        if (excess <= 0n) break
        if (reservation.itemId !== lot.itemId || reservation.locationId !== location.id) continue
        const take = reservation.quantity < excess ? reservation.quantity : excess
        reservation.quantity -= take; excess -= take
        if (reservation.quantity === 0n) c.s.reservations.splice(c.s.reservations.indexOf(reservation), 1)
        r.unreserved.push({ demandKind: reservation.demandKind, demandId: reservation.demandId, lineId: reservation.lineId, locationId: location.id, quantity: format(take) })
      }
      const out = move(c, { itemId: lot.itemId, locationId: location.id, lotId, status: 'available', quantity: -quantity, kind: 'recall-hold', documentKind: 'recalls', documentId: r.id, reason: r.reason })
      move(c, { ...out, status: 'quarantine', quantity })
      r.held.push({ lotId, locationId: location.id, quantity: format(quantity), unitCost: format(out.unitCost) })
    }
    if (lot.status !== 'recall hold') bump(lot, { status: 'recall hold' })
  }
}

export function recall(c: Context, type: string, p: any): Row | undefined {
  if (!type.startsWith('recall.')) return
  allow(c, ['manager'])
  if (type === 'recall.open') {
    const source = get(c.s, 'lots', p.lotId, 'source lot')
    const r = row(c, 'recalls', { reference: nextReference(c.s.recalls, 'RC'), sourceLotId: source.id, ownerId: c.actor.id, reason: text(p.reason, 'recall reason'), evidence: list(p.evidence, 'evidence', 5).map(f => attach(c, f)), status: 'open', lotIds: [], workOrderIds: [], held: [], unreserved: [], expansions: [] })
    contain(c, r)
    return r
  }
  if (type === 'recall.expand') {
    const r = get(c.s, 'recalls', p.recallId, 'recall'); fresh(r, p.version)
    contain(c, r)
    return bump(r, {})
  }
  fail('COMMAND', 'Unknown recall command; notices and disposition are not yet available.')
}

export function recallPack(s: State, id: string) {
  const recall = get(s, 'recalls', id, 'recall')
  const shipments = s.shipments.flatMap(sh => {
    const movements = s.movements.filter(m => m.documentKind === 'shipments' && m.documentId === sh.id && m.kind === 'shipment' && recall.lotIds.includes(m.lotId))
    if (!movements.length) return []
    const order = get(s, 'salesOrders', sh.orderId), customer = get(s, 'parties', order.customerId)
    return [{ shipmentId: sh.id, reference: sh.reference, orderId: order.id, orderReference: order.reference, customerId: customer.id, customerName: customer.name, shippedAt: sh.shippedAt, lines: movements.map(m => ({ movementId: m.id, lotId: m.lotId, itemId: m.itemId, unit: get(s, 'items', m.itemId).baseUnit, quantity: format(-m.quantity), netShipped: format(-(m.quantity + s.movements.filter(x => x.reversesId === m.id).reduce((n, x) => n + x.quantity, 0n))), returns: s.returns.flatMap(r => (r.sources ?? []).filter((x: any) => x.shipmentMovementId === m.id).map((x: any) => ({ returnId: r.id, status: r.status, quantity: x.quantity, movementId: x.returnMovementId }))) })) }]
  })
  return { format: 'larder-recall-containment-v1', complete: false, asOfVersion: s.version, recall, positions: positions(s).filter(p => recall.lotIds.includes(p.lotId)).map(p => ({ ...p, unit: get(s, 'items', p.itemId).baseUnit })), shipments, gaps: ['Approved notices, real delivery and acknowledgment tracking are not implemented.', 'Returned/destroyed/unrecovered/cleared disposition reconciliation and final compliance pack are not implemented.', 'Unlotted legacy genealogy and customer-property/vendor custody need separate reconciliation; no proportional quantities are invented.'] }
}
