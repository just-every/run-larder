// One exact bin-sequenced review becomes separate order picks atomically.
import { sales } from './sales'
import { allow } from './roles'
import { enforcePayload } from './scope'
import { fail } from './problem'
import { bump, fresh, get, list, nextReference, row, text, type Context, type Row } from './model'

export function wavePicking(c: Context, type: string, p: any): Row | undefined {
  if (!type.startsWith('wave.')) return
  allow(c, ['manager', 'warehouse'])
  const reason = text(p.reason, 'wave reason', 400)
  if (type === 'wave.prepare') {
    const orders = list(p.orders, 'wave orders', 30)
    if (orders.length < 2 || new Set(orders.map(o => o.orderId)).size !== orders.length) fail('WAVE', 'Choose at least two distinct reserved orders.')
    const shadow = { ...c, s: structuredClone(c.s) }
    const picks = orders.map(o => {
      const order = get(c.s, 'salesOrders', o.orderId)
      enforcePayload(c, order)
      for (const line of list(o.lines)) {
        const location = get(c.s, 'locations', line.locationId)
        if (!location.siteId || !location.binCode) fail('WAVE', 'Every pick needs a named site and bin.')
      }
      const shipment = sales(shadow, 'shipment.pick', o)!
      return { orderId: order.id, reference: order.reference, lines: shipment.lines.map((l: any) => ({ ...l, ...(l.serial ? { serials: [l.serial] } : {}) })) }
    })
    const lines = picks.flatMap(pick => pick.lines.map((l: any) => ({ ...l, orderId: pick.orderId, reference: pick.reference }))).sort((a, b) => {
      const x = get(c.s, 'locations', a.locationId), y = get(c.s, 'locations', b.locationId)
      return String(x.siteId).localeCompare(String(y.siteId)) || (x.binSequence ?? 0) - (y.binSequence ?? 0) || x.binCode.localeCompare(y.binCode) || a.reference.localeCompare(b.reference)
    })
    return row(c, 'pickWaves', { reference: nextReference(c.s.pickWaves, 'WV'), status: 'review', stateVersion: c.s.version + 1, reason, picks, lines })
  }
  if (type === 'wave.pick') {
    const wave = get(c.s, 'pickWaves', p.waveId); enforcePayload(c, wave); fresh(wave, p.version)
    if (wave.status !== 'review') fail('STATE', 'This wave was already picked.')
    if (wave.stateVersion !== c.s.version) fail('STALE', 'Reservations or business records changed; prepare a new wave.')
    const shipments = wave.picks.map((pick: any) => sales(c, 'shipment.pick', pick)!)
    return bump(wave, { status: 'picked', shipmentIds: shipments.map((s: Row) => s.id), pickedBy: c.actor.id, pickedAt: c.now, pickReason: reason })
  }
  fail('COMMAND', 'Unknown wave command.')
}
