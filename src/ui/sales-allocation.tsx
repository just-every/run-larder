import { useState } from 'react'
import { itemName, locationName, rows, type Rec } from './api'
import type { Larder } from './app'
import { Choose, Field, Form, Table, text } from './controls'
import { day, money, plus, qty } from './format'

export function SalesAllocation({ larder, receipt }: { larder: Larder; receipt: Rec }) {
  const s = larder.state!
  const sources = [...new Map<string, any>(receipt.lines.filter((l: any) => l.inspection === 'accept').map((l: any) => [`${l.itemId}|${l.locationId}`, l])).entries()]
  const [source, setSource] = useState(sources[0]?.[0] ?? '')
  if (s.actor.role !== 'owner' || !sources.length) return null
  const [itemId, locationId] = source.split('|')
  const lines = rows(s, 'salesOrders').filter(o => ['confirmed', 'part shipped'].includes(o.status)).flatMap(o => o.lines.filter((l: any) => l.itemId === itemId).map((l: any) => ({ value: `${o.id}|${l.id}`, label: `${o.reference} · ${itemName(s, itemId)} · promised ${day(o.promiseDate)}` })))
  const reviews = rows(s, 'approvals').filter(a => a.category === 'sales-allocation' && a.receiptId === receipt.id).reverse()
  const preview = reviews[0]?.status === 'preview' ? reviews[0] : undefined, approved = reviews.filter(a => a.status === 'approved')
  const stale = preview && (preview.stateVersion !== s.version || preview.day !== new Date().toISOString().slice(0, 10))
  return <section aria-label={`Sales receipt split ${receipt.reference}`}>
    <h3>Split accepted stock between sales orders</h3>
    <p>{receipt.reference} · Owner review and approval. Other hard reservations and picked quantities stay protected.</p>
    <Form submit="Preview reservation split" busy={larder.busy} onSubmit={data => larder.run('so.allocationPreview', {
      receiptId: receipt.id, itemId, locationId, reason: text(data, 'reason'), allocations: [1, 2].map(n => {
        const [orderId, lineId] = text(data, `line${n}`).split('|')
        return { orderId, lineId, quantity: text(data, `quantity${n}`) }
      }),
    })}>
      <Choose label="Accepted receipt stock" name="source" value={source} onChange={(e: any) => setSource(e.target.value)} options={sources.map(([value, l]) => ({ value, label: `${itemName(s, l.itemId)} at ${locationName(s, l.locationId)} · accepted ${qty(plus(...receipt.lines.filter((x: any) => x.inspection === 'accept' && x.itemId === l.itemId && x.locationId === l.locationId).map((x: any) => x.quantity)))}` }))} />
      {[1, 2].map(n => <div className="line" key={n}><Choose label={`Destination sales line ${n}`} name={`line${n}`} options={lines} /><Field label={`Target reservation ${n}`} name={`quantity${n}`} inputMode="decimal" hint="Total reserved here after approval; zero releases it" /></div>)}
      <Field label="Split reason" name="reason" />
    </Form>
    {preview && <section aria-label="Reservation split preview">
      <h3>Review the exact split</h3><p>{receipt.reference} · {itemName(s, preview.itemId)} at {locationName(s, preview.locationId)}</p><p>{preview.reason}</p><p>Usable accepted receipt stock: {qty(preview.acceptedQuantity)} · Reservation total before: {qty(preview.totalBefore)} · Reservation total after: {qty(preview.totalAfter)}</p>
      <p>Changed customer promises: {preview.changedPromiseCount}</p><p>{preview.semantics}</p>
      <SplitEffects effects={preview.effects} />
      {stale && <p role="status">Business records or the UTC day changed. Prepare and review the split again.</p>}
      <Form submit="Approve exact reservation split" busy={larder.busy || stale} onSubmit={data => larder.run('so.allocationApprove', { previewId: preview.id, version: preview.version, reason: text(data, 'approvalReason') })}>
        <Field label="Split approval reason" name="approvalReason" />
      </Form>
    </section>}
    {approved.length > 0 && <section aria-label="Approved reservation splits"><h3>Approved splits</h3>{approved.map(a => <article key={a.id}><p>{a.reason} · Approval: {a.approvalReason}</p><p>Reserved total: {qty(a.totalAfter)} · Changed customer promises: {a.changedPromiseCount}</p><SplitEffects effects={a.effects} /></article>)}</section>}
  </section>
}

function SplitEffects({ effects }: { effects: any[] }) {
  return <Table head={['Sales line', 'Unchanged promises', 'Reserved before', 'Reserved after', 'Displaced', 'Estimated margin before', 'Estimated margin after']} numeric={[2, 3, 4, 5, 6]}>{effects.map(e => <tr key={e.lineId}><td><a href={`#orders/${e.orderId}`}>{e.reference}</a></td><td>{day(e.promiseDate)}{e.deliveries.map((d: any, i: number) => <small key={i}>{qty(d.quantity)} on {day(d.date)}</small>)}</td><td className="num">{qty(e.before)}</td><td className="num">{qty(e.after)}</td><td className="num">{qty(e.displaced)}</td><td className="num">{e.estimatedMarginBefore === null ? 'Unknown' : money(e.estimatedMarginBefore)}</td><td className="num">{e.estimatedMarginAfter === null ? 'Unknown' : money(e.estimatedMarginAfter)}</td></tr>)}</Table>
}
