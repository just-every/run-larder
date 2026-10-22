import { ShipmentCertificates } from './certificates'
import { useState } from 'react'
import { byId, can, itemName, locationName, partyName, rows, sku, unitOf, type LarderState, type Rec } from './api'
import type { Larder } from './app'
import { Card, Chip, Choose, Details, Empty, Field, Form, Lines, Table, options, readLines, text } from './controls'
import { day, isZero, minus, money, negative, perUnit, plus, positive, qty, timesMoney, unitLabel, words } from './format'
import { NeedsList } from './needs'
import { ConfigurationNote, ConfigureQuote } from './configure'
import { FefoPick } from './lot-expiry'
import { OrderChanges } from './order-changes'
import { commercialValue } from './order-value'
import { OrderRank, OrderStatusActions, OrderStatusDisplay, useOrderStatusList } from './order-status'

const reservedFor = (s: LarderState, orderId: string, lineId: string) => plus(...rows(s, 'reservations').filter(r => r.demandId === orderId && r.lineId === lineId).map(r => r.quantity))
const openOf = (l: any) => minus(minus(l.quantity, l.shipped), l.cancelled)
const statusTone = (status: string) => status === 'confirmed' || status === 'shipped' ? 'good' : status === 'part shipped' ? 'warn' : status === 'cancelled' ? 'bad' : 'neutral'

export function Orders({ larder, id }: { larder: Larder; id?: string }) {
  const s = larder.state!
  const statuses = useOrderStatusList(s, 'sales')
  const order = id ? byId(s, 'salesOrders', id) : undefined
  if (order) return <OrderWorkspace larder={larder} order={order} />
  const list = statuses.list(rows(s, 'salesOrders'))
  return <div className="page">
    <header className="page-head"><p className="eyebrow">Orders</p><h1>Sales orders</h1></header>
    <Card title="Open and recent orders">{statuses.controls}{list.length === 0 ? <Empty>{rows(s, 'salesOrders').length ? 'No orders match these filters.' : 'No orders yet. Enter a quote below, or move open orders in from Odoo.'}</Empty> :
      <Table head={['Order', 'Customer', 'Promised', 'Status', 'Materials / production', 'Value']} numeric={[5]}>{list.map(o => <tr key={o.id}><td><a href={`#orders/${o.id}`}>{o.reference}</a>{o.sourceReference && <small>Odoo {o.sourceReference}</small>}<OrderRank status={statuses.status(o.id)} /><OrderStatusActions larder={larder} kind="sales" order={o} status={statuses.status(o.id)} /></td><td>{partyName(s, o.customerId)}</td><td>{day(o.promiseDate)}</td><td><Chip tone={statusTone(o.status)}>{words(o.status)}</Chip></td><td><OrderStatusDisplay s={s} status={statuses.status(o.id)} /></td><td className="num">{commercialValue(s, o)}</td></tr>)}</Table>}
    </Card>
    {can(s, ['manager', 'sales']) && <Card title="New quote"><Form submit="Save quote" busy={larder.busy} onSubmit={async d => { const r = await larder.run('so.quote', { customerId: text(d, 'customerId'), promiseDate: text(d, 'promiseDate'), customerReference: text(d, 'customerReference'), lines: readLines(d) }); if (r) window.location.hash = `orders/${r.id}`; return r }}>
      <Choose label="Customer" name="customerId" options={options(rows(s, 'parties').filter(p => p.kind !== 'supplier'), r => r.name)} />
      <Field label="Promise date" name="promiseDate" type="date" />
      <Field label="Customer reference" name="customerReference" required={false} />
      <Lines items={rows(s, 'items').filter(i => !i.archived)} />
    </Form></Card>}
    <ConfigureQuote larder={larder} />
  </div>
}


function Availability({ s, itemId, larder, order }: { s: LarderState; itemId: string; larder: Larder; order: Rec }) {
  const a = s.availability.find((x: any) => x.itemId === itemId), item = byId(s, 'items', itemId)
  const pos = rows(s, 'purchaseOrders').filter(p => ['approved', 'confirmed', 'part received'].includes(p.status) && p.lines.some((l: any) => l.itemId === itemId))
  const wos = rows(s, 'workOrders').filter(w => w.status === 'released' && w.itemId === itemId)
  const short = s.shortages.find((x: any) => x.itemId === itemId)
  const reservedHere = plus(...rows(s, 'reservations').filter(r => r.itemId === itemId && r.demandId === order.id).map(r => r.quantity))
  const open = ['confirmed', 'part shipped'].includes(order.status)
  return <Card title="Selected line availability" className="availability">
    <p className="item-title"><span><strong>{itemName(s, itemId)}</strong><span className="muted">{item?.sku} · {unitLabel(item?.baseUnit)}</span></span></p>
    {a?.restricted ? <p className="muted">{a.restricted}</p> : <dl className="facts">
      <div><dt>On hand</dt><dd>{qty(a?.onHand)}</dd></div>
      <div><dt>Reserved for this order</dt><dd>{qty(reservedHere)}</dd></div>
      <div><dt>Reserved for others</dt><dd>{qty(minus(a?.reserved, reservedHere))}</dd></div>
      {!isZero(a?.quarantine) && <div><dt>In quarantine</dt><dd>{qty(a?.quarantine)}</dd></div>}
      <div><dt>Expected from purchase<small>{pos.map(p => `${p.reference} · due ${day(p.expectedDate)}`).join(', ') || 'None open'}</small></dt><dd>{qty(a?.expectedPurchase)}</dd></div>
      <div><dt>Expected from work orders<small>{wos.map(w => `${w.reference} · BOM rev ${w.bomRevision}`).join(', ') || 'None released'}</small></dt><dd>{qty(a?.expectedProduction)}</dd></div>
      <div className="atp"><dt>Available to promise</dt><dd className={negative(a?.availableToPromise) ? 'red' : ''}>{qty(a?.availableToPromise)}</dd></div>
    </dl>}
    {open && <div className="stack">
      {can(s, ['manager', 'sales', 'warehouse']) && <button className="button primary" disabled={larder.busy} onClick={() => larder.run('so.reserve', { orderId: order.id })}>Reserve stock</button>}
      {short && can(s, ['manager', 'buyer', 'production', 'planner', 'agent']) && <button className="button" disabled={larder.busy} onClick={async () => { const r = await larder.run('plan.draft', { itemId }); if (r) window.location.hash = `make/${item?.kind === 'make' ? 'wo' : 'po'}/${r.id}` }}>{item?.kind === 'make' ? 'Draft work order' : 'Draft purchase order'} for {qty(short.shortage)} short</button>}
      <a className="button" href="#pick">Pick and pack</a>
    </div>}
  </Card>
}

function OrderWorkspace({ larder, order }: { larder: Larder; order: Rec }) {
  const s = larder.state!, run = larder.run, busy = larder.busy
  const [selected, setSelected] = useState<string>(order.lines[0]?.itemId)
  const shipments = rows(s, 'shipments').filter(x => x.orderId === order.id)
  const units = order.lines.reduce((n: string, l: any) => plus(n, minus(l.quantity, l.cancelled ?? '0')), '0')
  const open = ['confirmed', 'part shipped'].includes(order.status), warehouse = can(s, ['manager', 'warehouse'])
  const reservations = rows(s, 'reservations').filter(r => r.demandId === order.id)
  return <div className="page workspace">
    <header className="page-head"><p className="eyebrow"><a href="#orders">Orders</a></p><h1>{order.reference}</h1>
      <p className="subtitle"><span className="customer">{partyName(s, order.customerId)}</span><Chip tone={statusTone(order.status)}>{words(order.status)}</Chip></p>
      <p className="meta">Promised {day(order.promiseDate)} · {order.lines.length} {order.lines.length === 1 ? 'item' : 'items'} · {qty(units)} {units === '1' ? 'unit' : 'units'}{order.customerReference && ` · Their ref ${order.customerReference}`}{order.sourceReference && ` · Odoo ${order.sourceReference}`}</p></header>
    <div className="workspace-grid">
      <Card title="Order lines" className="lines-card">
        <Table head={['Product', 'Ordered', 'Reserved', 'Shipped', 'Short']} numeric={[1, 2, 3, 4]} stack={false}>{order.lines.map((l: any) => {
          const reserved = reservedFor(s, order.id, l.id), short = order.status === 'quote' ? '0' : minus(openOf(l), reserved)
          return <tr key={l.id} className={selected === l.itemId ? 'selected' : undefined} onClick={() => setSelected(l.itemId)}>
            <td><button type="button" className="row-button" aria-pressed={selected === l.itemId} onClick={() => setSelected(l.itemId)}><span><strong>{itemName(s, l.itemId)}</strong><small>{sku(s, l.itemId)} · {positive(openOf(l)) || order.status === 'quote' ? <>Unshipped: {money(l.unitPrice)} {perUnit(unitOf(s, l.itemId))}</> : 'Prices retained on shipments'}</small>{l.schedules?.map((d: any, i: number) => <small key={i}>{qty(d.quantity)} due {day(d.date)}</small>)}</span></button></td>
            <td className="num">{qty(minus(l.quantity, l.cancelled))}{positive(l.cancelled) && <small>{qty(l.cancelled)} cancelled</small>}</td><td className="num">{qty(reserved)}</td><td className="num">{qty(l.shipped)}</td>
            <td className="num"><span className={`short ${positive(short) ? 'bad' : 'ok'}`}>{qty(short)}</span></td></tr>
        })}</Table>
        {order.lines.filter((l: any) => l.configuration).map((l: any) => <div key={`cfg-${l.id}`}><ConfigurationNote s={s} c={l.configuration} />{open && can(s, ['manager', 'production', 'planner']) && <button type="button" className="button" disabled={busy} onClick={() => run('wo.draft', { itemId: l.itemId, quantity: openOf(l), requiredBy: order.promiseDate, reason: `Configured line of ${order.reference}`, orderId: order.id, lineId: l.id })}>Draft work to this configuration</button>}</div>)}
        {order.status === 'quote' && can(s, ['manager', 'sales']) && <div className="actions"><button className="button primary" disabled={busy} onClick={() => run('so.confirm', { orderId: order.id, version: order.version })}>Confirm order and reserve stock</button></div>}
      </Card>
      {selected && <Availability s={s} itemId={selected} larder={larder} order={order} />}
      {open && reservations.length > 0 && <footer className="action-bar"><div><strong>{order.reference}</strong><p><span>{partyName(s, order.customerId)}</span><small>Promised {day(order.promiseDate)} · {qty(plus(...reservations.map(r => r.quantity)))} reserved</small></p></div><a className="button primary" href="#pick">Continue to pick &amp; pack →</a></footer>}
      <NeedsList larder={larder} compact />
    </div>
    <OrderChanges larder={larder} order={order} />
    <div className="split">
      <Card title="Pick, pack and ship" className="pick"><span id="pick" />
        {shipments.length === 0 && <Empty>Nothing picked yet.</Empty>}
        {shipments.map(x => <article key={x.id} className="shipment"><h3>{x.reference} <Chip tone={x.status === 'shipped' ? 'good' : ['reversed', 'cancelled'].includes(x.status) ? 'bad' : 'info'}>{words(x.status)}</Chip></h3>
          <ul>{x.lines.map((l: any, i: number) => <li key={i}>{qty(l.quantity)} {itemName(s, l.itemId)} from {locationName(s, l.locationId)}{l.lotId && `, lot ${rows(s, 'lots').find(x => x.id === l.lotId)?.code ?? ''}`}</li>)}</ul>
          {x.commercialTerms && <Details label="Shipment commercial terms" value={x.commercialTerms} s={s} />}{x.status === 'shipped' && <p className="muted">{x.carrier}{x.tracking && ` · ${x.tracking}`}</p>}
          <ShipmentCertificates shipment={x} />
          {warehouse && x.status === 'picked' && <Form submit="Mark packed" busy={busy} onSubmit={d => run('shipment.pack', { shipmentId: x.id, version: x.version, packages: Number(text(d, 'packages')), weightKg: text(d, 'weightKg') || '0' })}><Field label="Packages" name="packages" type="number" min="1" defaultValue="1" /><Field label="Weight (kg)" name="weightKg" inputMode="decimal" required={false} /></Form>}
          {warehouse && ['picked', 'packed'].includes(x.status) && <Form title={`Undo ${x.reference} pick`} submit="Undo pick" quiet busy={busy} note="Use before dispatch. Stock and reservations stay with the order; record a separate cancellation to release them." onSubmit={d => run('shipment.unpick', { shipmentId: x.id, version: x.version, reason: text(d, 'reason') })}><Field label="Reason for undoing pick" name="reason" /></Form>}
          {warehouse && x.status === 'packed' && <Form submit="Ship" busy={busy} onSubmit={d => run('shipment.ship', { shipmentId: x.id, version: x.version, carrier: text(d, 'carrier'), tracking: text(d, 'tracking') })}><Field label="Carrier" name="carrier" /><Field label="Tracking" name="tracking" required={false} /></Form>}
        </article>)}
        {open && warehouse && reservations.length > 0 && <Form title="Pick reserved stock" submit="Pick" busy={busy} onSubmit={d => run('shipment.pick', { orderId: order.id, lines: reservations.map(r => ({ lineId: r.lineId, locationId: r.locationId, quantity: text(d, r.id), lotId: ['', 'fefo'].includes(text(d, `lot.${r.id}`)) ? undefined : text(d, `lot.${r.id}`) })).filter(l => l.quantity && !isZero(l.quantity)) })}>
          {reservations.map(r => <Field key={`${r.id}:${r.quantity}`} label={`${itemName(s, r.itemId)} at ${locationName(s, r.locationId)} (reserved ${qty(r.quantity)})`} name={r.id} defaultValue={r.quantity} inputMode="decimal" required={false} />)}
          {reservations.map(r => <FefoPick key={`fefo:${r.id}`} s={s} orderId={order.id} reservation={r} />)}
        </Form>}
        {open && reservations.length === 0 && <Empty>Reserve stock before picking.</Empty>}
      </Card>
      <Card title="Changes and returns">
        {warehouse && order.lines.some((l: any) => positive(minus(l.shipped, l.returned))) && <Form title="Receive a return" submit="Receive return" busy={busy} onSubmit={d => run('return.receive', { orderId: order.id, lineId: text(d, 'lineId'), quantity: text(d, 'quantity'), locationId: text(d, 'locationId'), disposition: text(d, 'disposition'), reason: text(d, 'reason') })}>
          <Choose label="Line" name="lineId" options={order.lines.filter((l: any) => positive(minus(l.shipped, l.returned))).map((l: any) => ({ value: l.id, label: `${itemName(s, l.itemId)} (shipped ${qty(l.shipped)})` }))} />
          <Field label="Quantity" name="quantity" inputMode="decimal" /><Choose label="Into" name="locationId" options={options(rows(s, 'locations'), r => r.name)} />
          <Choose label="Condition" name="disposition" options={[{ value: 'quarantine', label: 'Hold in quarantine for inspection' }, { value: 'restock', label: 'Good: back to stock' }]} /><Field label="Reason" name="reason" /></Form>}
        {warehouse && shipments.filter(x => x.status === 'shipped').map(x => <Form key={x.id} title={`Correct ${x.reference}`} submit="Reverse shipment" quiet busy={busy} note="Use only when the parcel never left. Stock and the reservation come back; the original record stays." onSubmit={d => run('movement.reverse', { documentKind: 'shipments', documentId: x.id, reason: text(d, 'reason') })}><Field label="Reason" name="reason" /></Form>)}
        {!open && order.status !== 'quote' && <Empty>This order is {words(order.status).toLowerCase()}.</Empty>}
      </Card>
    </div>
  </div>
}
