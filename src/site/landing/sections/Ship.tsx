import { CheckDot, Mid, Story } from '../parts'

const orders = [
  { order: 'SO-1184', customer: 'Hearth & Table', lines: '240 boards · 240 tins', materials: 'In stock', status: 'Shipped · 21 cartons', tone: 'ink-soft', current: true },
  { order: 'Shopify #10482', customer: 'Web order', lines: '1 board · 1 tin', materials: 'In stock', status: 'Shipped · UPS 1Z…4471', tone: 'ink' },
  { order: 'Shopify #10483', customer: 'Web order', lines: '2 boards', materials: 'In stock', status: 'Packed', tone: 'grey' },
  { order: 'Amazon FBA', customer: 'FBA shipment', lines: '36 boards', materials: 'In stock', status: 'Booked · arrives Nov 12', tone: 'grey' },
  { order: 'SO-1191', customer: 'Saluda Mercantile', lines: '48 boards', materials: <>Gift boxes · <span className="nowrap">PO-5530 Nov 9</span></>, status: 'In production · ships Nov 13', tone: 'outline' },
]
const syncs = [
  [<b key="s">ShipStation</b>, ' · 23 labels · tracking live'],
  [<b key="s">Shopify</b>, ' · stock updated 3:41 PM'],
  [<b key="s">Amazon</b>, ' · FBA shipment booked'],
  [<b key="s">QuickBooks</b>, ' · Invoice 3317 · $25,010.00 · synced'],
]

/** 10 · One sales-order list with live material and production status, and the four connections beside it. */
export function Ship() {
  return <Story id="ship" className="copy-right" eyebrow={<>Ship<Mid />Fri Nov 6</>} title="Every channel, one shipping list."
    line="Wholesale, Shopify and Amazon orders ship from one list. Labels, tracking and invoices sync as they go.">
    <article className="card orders-card" aria-label="Sales orders, Fri Nov 6">
      <h3>Sales orders · Fri Nov 6</h3>
      <div className="scroll-x"><table className="orders">
        <thead><tr><th scope="col">Order</th><th scope="col">Customer</th><th scope="col">Lines</th><th scope="col">Materials</th><th scope="col">Status</th></tr></thead>
        <tbody>{orders.map(o => <tr key={o.order} className={o.current ? 'current' : undefined}>
          <th scope="row">{o.order}</th><td>{o.customer}</td><td>{o.lines}</td><td className={o.materials === 'In stock' ? undefined : 'expected'}>{o.materials}</td>
          <td><span className={`status ${o.tone}`}>{o.status}</span></td>
        </tr>)}</tbody>
      </table></div>
    </article>
    <ul className="syncs" aria-label="Connections">{syncs.map(([name, rest], i) => <li key={i}><CheckDot /><span>{name}{rest}</span></li>)}</ul>
  </Story>
}
