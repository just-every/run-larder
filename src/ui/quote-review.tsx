import { Card, Field, Form, Choose, Table, Details, text } from './controls'
import { can, itemName, type Rec } from './api'
import type { Larder } from './app'
import { day, money, qty } from './format'

export function QuoteReview({ larder, order }: { larder: Larder; order: Rec }) {
  const s = larder.state!, review = order.quoteReview
  if (order.status !== 'quote' || !can(s, ['manager', 'sales'])) return null
  const scope = (s.actor as { scope?: { locations: string[] | null; costs: boolean } }).scope
  const scoped = scope?.locations !== null && scope?.locations !== undefined || scope?.costs
  if (scoped) return null
  const stale = review && review.inputVersion !== s.version
  return <Card title="Costed quote preparation">
    <p>Compare customer terms and full-batch dates before making a commitment. This review books no supply or capacity and sends nothing.</p>
    {review && <section aria-label="Costed quote review">
      {stale && <p role="status">Business records changed. Prepare fresh options before relying on these dates.</p>}
      <p><strong>{review.currency} {money(review.totalAmount)}</strong> · USD {money(review.totalUsdAmount)}</p>
      <p>USD {review.usdRate} per {review.currency} · rate recorded {day(review.rateDate)} · {review.rateReference}</p>
      <p>Valid through {day(review.validUntil)} · {review.paymentTerms}</p>
      <Table head={['Product', 'Quantity', 'Customer unit price', 'Discount', 'Line amount', 'USD value']} numeric={[1, 2, 3, 4, 5]}>{review.lines.map((line: any) => <tr key={line.lineId}><td>{itemName(s, line.itemId)}</td><td>{qty(line.quantity)}</td><td>{review.currency} {qty(line.unitPrice)}</td><td>{review.currency} {money(line.discountAmount)}</td><td>{review.currency} {money(line.amount)}</td><td>USD {money(line.usdAmount)}</td></tr>)}</Table>
      <p>Freight: {review.currency} {money(review.freightAmount)} · USD {money(review.freightUsdAmount)}</p>
      <p>Estimated cost: {review.estimate.totalCost === null ? 'Unknown' : `USD ${money(review.estimate.totalCost)}`} · Estimated margin: {review.marginUsdAmount === null ? 'Unknown' : `${review.currency} ${money(review.marginAmount)} · USD ${money(review.marginUsdAmount)} · ${qty(review.marginPercent)}%`}</p>
      <Details label="Estimate sources" value={review.estimate} s={s} />
      <p>{review.reason}</p>
      <Table head={['Alternative', 'Ship date', 'Material and capacity evidence']}>{review.options.map((option: any) => <tr key={option.id}><td>{option.name}</td><td>{day(option.shipDate)}</td><td>{option.operations.map((op: any) => <p key={op.key}>{op.name} · {op.machine} · {op.person} · {op.startsAt} to {op.endsAt}</p>)}<Details label="Material sources" value={option.material} s={s} /></td></tr>)}</Table>
      <p>{review.rounding}</p>
      <p>Acceptance, partial delivery, overtime authorization and invoicing are not available from this review. Confirmation stays closed while it is attached.</p>
      <Form submit="Discard preparation" quiet busy={larder.busy} onSubmit={d => larder.run('so.reviewClear', { orderId: order.id, version: order.version, reason: text(d, 'discardReason') })}><Field label="Reason to discard preparation" name="discardReason" hint="Returns to the original USD quote; reviewed prices and dates are not applied." /></Form>
    </section>}
    <Form key={order.version} title={review ? 'Refresh preparation' : 'Customer terms and estimates'} submit="Prepare costed options" busy={larder.busy} onSubmit={d => larder.run('so.review', { orderId: order.id, version: order.version, currency: text(d, 'currency'), usdRate: text(d, 'usdRate'), rateDate: text(d, 'rateDate'), rateReference: text(d, 'rateReference'), validUntil: text(d, 'validUntil'), paymentTerms: text(d, 'paymentTerms'), discountPercent: text(d, 'discountPercent'), freight: text(d, 'freight'), laborCostRate: text(d, 'laborCostRate'), machineCostRate: text(d, 'machineCostRate'), overheadCostRate: text(d, 'overheadCostRate'), lines: order.lines.map((line: any) => ({ lineId: line.id, unitPrice: text(d, `price.${line.id}`) })) })}>
      <Choose label="Customer quote currency" name="currency" defaultValue={review?.currency ?? 'USD'} options={[{ value: 'USD', label: 'USD' }, { value: 'CAD', label: 'CAD' }]} />
      <Field label="USD per customer currency unit" name="usdRate" defaultValue={review?.usdRate ?? '1'} inputMode="decimal" />
      <Field label="Exchange rate date" name="rateDate" type="date" required={false} defaultValue={review?.rateDate} />
      <Field label="Exchange rate reference" name="rateReference" required={false} defaultValue={review?.rateReference} hint="Required for CAD. Name the source of the recorded rate." />
      <Field label="Quote valid through" name="validUntil" type="date" defaultValue={review?.validUntil ?? order.promiseDate} />
      <Field label="Payment terms" name="paymentTerms" defaultValue={review?.paymentTerms ?? 'Net 30'} />
      <Field label="Discount percent" name="discountPercent" defaultValue={review?.discountPercent ?? '0'} inputMode="decimal" />
      <Field label="Customer currency freight" name="freight" defaultValue={review?.freightAmount ?? '0'} inputMode="decimal" />
      <Field label="Estimated labor tariff USD per hour" name="laborCostRate" defaultValue={review?.estimate.quoteTariffs?.laborCostRate ?? ''} required={false} inputMode="decimal" hint="Quote estimate only. Blank means unknown." />
      <Field label="Estimated machine tariff USD per hour" name="machineCostRate" defaultValue={review?.estimate.quoteTariffs?.machineCostRate ?? ''} required={false} inputMode="decimal" />
      <Field label="Estimated overhead tariff USD per hour" name="overheadCostRate" defaultValue={review?.estimate.quoteTariffs?.overheadCostRate ?? ''} required={false} inputMode="decimal" />
      {order.lines.map((line: any, i: number) => <Field key={line.id} label={`Line ${i + 1} customer currency unit price`} name={`price.${line.id}`} defaultValue={review?.lines.find((quoted: any) => quoted.lineId === line.id)?.unitPrice ?? line.unitPrice} inputMode="decimal" />)}
    </Form>
  </Card>
}
