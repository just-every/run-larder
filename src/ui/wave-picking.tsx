import { minus, plus } from './format'
import type { Larder } from './app'
import { byId, can, itemName, locationName, rows, type Rec } from './api'
import { Card, Field, Form, Table, text } from './controls'

export function WavePicking({ larder }: { larder: Larder }) {
  const s = larder.state!
  if (!can(s, ['manager', 'warehouse'])) return null
  const reserved = rows(s, 'reservations').filter(r => r.demandKind === 'sales' && byId(s, 'locations', r.locationId)?.binCode)
  const orders = rows(s, 'salesOrders').filter(o => ['confirmed', 'part shipped'].includes(o.status) && reserved.some(r => r.demandId === o.id))
  return <Card title="Wave picking"><p>Review one bin-sequenced list, collect its exact quantities, then confirm the sort to each order. Reservations remain until shipment; a changed record requires a fresh wave.</p>
    <Form submit="Review pick wave" busy={larder.busy} onSubmit={d => larder.run('wave.prepare', { reason: text(d, 'reason'), orders: orders.filter(o => d.get(o.id) === 'on').map(o => ({ orderId: o.id, lines: reserved.filter(r => r.demandId === o.id).map(r => ({ lineId: r.lineId, locationId: r.locationId, quantity: text(d, `quantity.${r.id}`) })) })) })}>
      {orders.map(o => <label className="field" key={o.id}><span>Include {o.reference}</span><input type="checkbox" name={o.id} /></label>)}
      {reserved.map(r => <Field key={r.id} label={`Pick quantity ${byId(s, 'salesOrders', r.demandId)?.reference} ${locationName(s, r.locationId)}`} name={`quantity.${r.id}`} defaultValue={r.quantity} inputMode="decimal" />)}<Field label="Wave review reason" name="reason" />
    </Form>
    {rows(s, 'pickWaves').map(w => <section key={w.id} aria-label={`Wave ${w.reference}`}><h3>{w.reference} · {w.status}</h3>
      <Table head={['Bin', 'Item', 'Lot', 'Quantity', 'Sort to order']}>
        {w.lines.map((l: Rec, i: number) => <tr key={i}><td>{locationName(s, l.locationId)}<small>{byId(s, 'locations', l.locationId)?.binCode}</small></td><td>{itemName(s, l.itemId)}</td><td>{byId(s, 'lots', l.lotId)?.code ?? 'Unlotted'}</td><td>{l.quantity}</td><td>{l.reference}</td></tr>)}
      </Table>
      {w.status === 'review' && w.stateVersion !== s.version && <p>Review expired: prepare a new wave.</p>}
      {w.status === 'review' && w.stateVersion === s.version && <Form submit="Confirm picked and sorted wave" busy={larder.busy} onSubmit={d => larder.run('wave.pick', { waveId: w.id, version: w.version, reason: text(d, 'reason') })}><Field label={`Sort confirmation reason for ${w.reference}`} name="reason" /></Form>}
      {w.shipmentIds?.map((id: string) => { const shipment = byId(s, 'shipments', id); return <p key={id}><a href={`#orders/${shipment?.orderId}`}>{byId(s, 'salesOrders', shipment?.orderId)?.reference}</a> · picked {shipment?.lines.map((l: Rec) => `${l.quantity} ${itemName(s, l.itemId)}`).join('; ')} · reservation retained until shipment{shipment?.lines.map((l: Rec, i: number) => <span key={i}> · unpicked reserved {minus(plus(...rows(s, 'reservations').filter(r => r.demandId === shipment.orderId && r.lineId === l.lineId && r.locationId === l.locationId).map(r => r.quantity)), plus(...rows(s, 'shipments').filter(sh => sh.orderId === shipment.orderId && ['picked', 'packed'].includes(sh.status)).flatMap(sh => sh.lines.filter((p: Rec) => p.lineId === l.lineId && p.locationId === l.locationId).map((p: Rec) => p.quantity))))}</span>)}</p> })}
    </section>)}
  </Card>
}
