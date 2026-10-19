import { useState } from 'react'
import { can, itemName, rows, type Rec } from './api'
import type { Larder } from './app'
import { Area, Card, Choose, Details, Field, Form, Table, fileBase64, options, text } from './controls'
import { day, minus, money, positive, qty, when } from './format'

const active = (line: any) => minus(line.quantity, line.cancelled ?? '0')
const outstanding = (line: any) => minus(active(line), line.shipped ?? '0')
const scheduleText = (line: any, date: string) => (line.schedules?.length ? line.schedules : positive(outstanding(line)) ? [{ quantity: outstanding(line), date }] : []).map((delivery: any) => `${delivery.quantity}, ${delivery.date}`).join('\n')
const deliveries = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean).map(line => { const [quantity, date] = line.split(',').map(cell => cell.trim()); return { quantity, date } })

export function OrderChanges({ larder, order }: { larder: Larder; order: Rec }) {
  const s = larder.state!, allowed = can(s, ['manager', 'sales']), open = ['confirmed', 'part shipped'].includes(order.status)
  const changes = rows(s, 'orderChanges').filter(change => change.orderId === order.id).reverse()
  const preview = changes.find(change => change.status === 'preview')
  return <Card title="Customer-approved order revisions">
    <p>Record the customer’s approval, review the affected commitments, then apply the exact revision.</p>
    {allowed && open && <ChangeEditor key={`${order.id}:${order.version}`} larder={larder} order={order} />}
    {preview && <section aria-label="Order revision preview"><h3>Revision preview</h3>
      <p>{preview.reason}</p>
      <Details label="Current commercial terms" value={preview.before} s={s} />
      <Details label="Proposed commercial terms" value={preview.after} s={s} />
      <ChangeImpact larder={larder} impact={preview.impact} />
      <p>Approved work and purchases remain committed. Use their own authorized workflows for any follow-up changes.</p>
      {preview.stateVersion !== s.version && <p className="warn-text">Business records changed. Create a new preview before approval.</p>}
      {allowed && <button className="button primary" disabled={larder.busy || preview.stateVersion !== s.version} onClick={() => larder.run('so.changeApprove', { previewId: preview.id, version: preview.version })}>Apply customer-approved revision</button>}
    </section>}
    {order.changeHistory?.filter((change: any) => change.kind === 'line cancellation').map((change: any, index: number) => <Details key={index} label={`Customer-approved cancellation ${index + 1}`} value={change} s={s} />)}
    {changes.some(change => change.status === 'approved') && <section aria-label="Order revision history"><h3>Revision history</h3>
      {changes.filter(change => change.status === 'approved').map(change => <article key={change.id}><p><strong>{change.reason}</strong> · {when(change.approvedAt)}</p>
        <p>Recorded customer approval: {change.customerApproval?.name} · {change.customerApproval?.reference} · {day(change.customerApproval?.approvedOn)}</p>
        {change.customerApproval?.evidence && <a href={`/api/larder/attachments/${change.customerApproval.evidence.id}`}>Customer approval evidence</a>}
        <Details label="Prior terms" value={change.before} s={s} /><Details label="Approved terms" value={change.after} s={s} /><Details label="Retained impact" value={change.impact} s={s} />
      </article>)}
    </section>}
  </Card>
}

function ChangeEditor({ larder, order }: { larder: Larder; order: Rec }) {
  const s = larder.state!, [newRows, setNewRows] = useState(0)
  return <Form title="Prepare an order revision" submit="Preview order revision" busy={larder.busy} note="Quantity is the total still agreed, including units already shipped. Revised prices apply to unshipped units; issued shipment terms stay fixed. Delivery rows cover only units still open, as quantity, YYYY-MM-DD. Customer approval is a local record of the evidence you received." onSubmit={async data => {
    const lines = order.lines.map((line: any, index: number) => ({ lineId: line.id, itemId: line.itemId, quantity: text(data, `q.${index}`), unitPrice: text(data, `price.${index}`), schedules: deliveries(text(data, `dates.${index}`)) }))
    for (let index = 0; index < newRows; index++) {
      const itemId = text(data, `new.${index}.itemId`)
      if (itemId) lines.push({ lineId: undefined, itemId, quantity: text(data, `new.${index}.quantity`), unitPrice: text(data, `new.${index}.price`), schedules: deliveries(text(data, `new.${index}.dates`)) })
    }
    const file = data.get('approvalFile')
    return larder.run('so.changePreview', { orderId: order.id, version: order.version, reason: text(data, 'reason'), billingAddress: text(data, 'billingAddress'), shippingAddress: text(data, 'shippingAddress'), lines,
      customerApproval: { name: text(data, 'approvalName'), reference: text(data, 'approvalReference'), approvedOn: text(data, 'approvedOn'), ...(file instanceof File && file.size ? { evidence: { name: file.name, contentType: file.type, base64: await fileBase64(file) } } : {}) } })
  }}>
    <Area label="Revised billing address" name="billingAddress" defaultValue={order.billingAddress ?? ''} required={false} />
    <Area label="Revised shipping address" name="shippingAddress" defaultValue={order.shippingAddress ?? ''} required={false} />
    {order.lines.map((line: any, index: number) => <fieldset className="lines wide" key={line.id}><legend>{itemName(s, line.itemId)}</legend>
      <p>Shipped {qty(line.shipped)} · previously cancelled {qty(line.cancelled)}</p><div className="form-grid">
        <Field label={`Line ${index + 1} agreed quantity`} name={`q.${index}`} defaultValue={active(line)} inputMode="decimal" />
        <Field label={`Line ${index + 1} revised unit price`} name={`price.${index}`} defaultValue={line.unitPrice} inputMode="decimal" />
        <Area label={`Line ${index + 1} open delivery quantities and dates`} name={`dates.${index}`} defaultValue={scheduleText(line, order.promiseDate)} required={false} />
      </div></fieldset>)}
    {Array.from({ length: newRows }, (_, index) => <fieldset className="lines wide" key={index}><legend>Additional line {index + 1}</legend><div className="form-grid">
      <Choose label={`Additional item ${index + 1}`} name={`new.${index}.itemId`} options={options(rows(s, 'items').filter(item => !item.archived), item => `${item.name} · ${item.sku}`)} />
      <Field label={`Additional quantity ${index + 1}`} name={`new.${index}.quantity`} inputMode="decimal" />
      <Field label={`Additional unit price ${index + 1}`} name={`new.${index}.price`} inputMode="decimal" />
      <Area label={`Additional delivery quantities and dates ${index + 1}`} name={`new.${index}.dates`} />
    </div></fieldset>)}
    <div className="wide"><button type="button" className="button" onClick={() => setNewRows(count => count + 1)}>Add order line</button></div>
    <Field label="Customer approver" name="approvalName" />
    <Field label="Customer approval reference" name="approvalReference" />
    <Field label="Customer approval date" name="approvedOn" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
    <Field label="Customer approval evidence" name="approvalFile" type="file" required={false} />
    <Field label="Reason for revision" name="reason" />
  </Form>
}


function ChangeImpact({ larder, impact }: { larder: Larder; impact: any }) {
  const s = larder.state!
  return <section aria-label="Order revision impact"><h3>Commitments and incurred costs</h3>
    {impact?.lineBalances?.length > 0 && <Table head={['Line', 'Already shipped', 'Picked', 'Open after revision']} numeric={[1, 2, 3]}>{impact.lineBalances.map((line: any) => <tr key={line.lineId}><td>{itemName(s, line.itemId)}</td><td className="num">{qty(line.shipped)}</td><td className="num">{qty(line.picked)}</td><td className="num">{qty(line.openAfter)}</td></tr>)}</Table>}
    {impact?.reservations?.length > 0 && <Details label="Reservation changes" value={impact.reservations} s={s} />}
    {impact?.work?.length > 0 && <Table head={['Manufacturing commitment', 'Produced / ordered', 'Material cost', 'Treatment']} numeric={[1, 2]}>{impact.work.map((work: any) => <tr key={work.id}><td><a href={`#make/wo/${work.id}`}>{work.reference}</a><small>{work.relation}</small></td><td className="num">{qty(work.output)} / {qty(work.quantity)}</td><td className="num">{money(work.incurredMaterialCost)}</td><td>{work.treatment}</td></tr>)}</Table>}
    {impact?.procurement?.length > 0 && <Table head={['Purchase commitment', 'Outstanding exposure', 'Treatment']} numeric={[1]}>{impact.procurement.map((po: any) => <tr key={po.id}><td><a href={`#make/po/${po.id}`}>{po.reference}</a><small>{po.relation}</small></td><td className="num">{money(po.outstandingExposure)}</td><td>{po.treatment}</td></tr>)}</Table>}
    <Details label="Shipment and supply allocation details" value={{ shipments: impact?.shipments, allocations: impact?.allocations }} s={s} />
  </section>
}
