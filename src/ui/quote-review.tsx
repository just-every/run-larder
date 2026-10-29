import { Card, Field, Form, Choose, Table, Details, text } from './controls'
import { can, itemName, type Rec } from './api'
import type { Larder } from './app'
import { day, money, qty } from './format'

export function QuoteReview({ larder, order }: { larder: Larder; order: Rec }) {
  const s = larder.state!, review = order.quoteReview
  if (!can(s, ['manager', 'sales'])) return null
  const scope = (s.actor as { scope?: { locations: string[] | null; costs: boolean } }).scope
  const scoped = scope?.locations !== null && scope?.locations !== undefined || scope?.costs
  if (scoped) return null
  if (order.customerTerms) return <AcceptedQuote larder={larder} order={order} />
  if (order.status !== 'quote') return null
  const stale = review && review.inputVersion !== s.version
  return <Card title="Costed quote preparation">
    <p>Compare customer terms, full delivery, partial delivery and assumed overtime before making a commitment. This review books no supply or capacity and sends nothing.</p>
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
      <p>Declared quote tariffs: labor USD {review.estimate.quoteTariffs.laborCostRate ?? 'Unknown'}, machine USD {review.estimate.quoteTariffs.machineCostRate ?? 'Unknown'}, overhead USD {review.estimate.quoteTariffs.overheadCostRate ?? 'Unknown'} per hour. Additional overtime tariff: USD {review.overtimePremiumRate ?? 'Unknown'} per hour outside original joint calendars.</p>
      <Table head={['Alternative', 'Delivery quantities and dates', 'Estimated cost and margin', 'Material and capacity evidence']}>{review.options.map((option: any) => <tr key={option.id} aria-label={option.name}>
        <td>{option.name}<p>{option.kind === 'overtime' ? 'Assumption only; separate overtime authorization required.' : option.basis}</p></td>
        <td>{(option.deliveries ?? option.work.map((work: any, i: number) => ({ ...work, workOrderId: String(i), leg: 'full', shipDate: option.shipDate }))).map((delivery: any) => <p key={delivery.workOrderId}>{itemName(s, delivery.itemId)} · {qty(delivery.quantity)} · {delivery.leg} · {day(delivery.shipDate)}</p>)}<p>Complete by {day(option.shipDate)}</p></td>
        <td><p>Cost: {option.estimate?.totalCost == null ? 'Unknown' : `USD ${money(option.estimate?.totalCost)}`}</p><p>Margin: {option.marginUsdAmount == null ? 'Unknown' : `${review.currency} ${money(option.marginAmount)} · USD ${money(option.marginUsdAmount)} · ${qty(option.marginPercent)}%`}</p>{option.estimate && <Details label="Option cost sources" value={option.estimate} s={s} />}</td>
        <td>{option.operations.map((op: any) => <div key={op.key}><p>{op.name} · {op.machine} · {op.person}</p>{op.intervals.map((span: any) => <p key={span.startsAt}>{span.startsAt} to {span.endsAt}</p>)}</div>)}{option.material.map((effect: any) => effect.items?.map((part: any) => <div key={`${effect.workOrderId}-${part.itemId}`}><p>{itemName(s, part.itemId)} · required {qty(part.required)}</p>{part.supplies.map((supply: any, i: number) => <p key={i}>{supply.reference} · {supply.kind} · {qty(supply.quantity)} · {supply.date ? day(supply.date) : 'Current physical stock'}</p>)}</div>))}<Details label="Material sources" value={option.material} s={s} />{option.overtime?.map((window: any, i: number) => <p key={i}>Assumed {window.kind}: {window.name} · {window.startsAt} to {window.endsAt} · {window.reason}</p>)}</td>
      </tr>)}</Table>
      <details><summary>Unavailable comparisons</summary>{review.rejected?.map((item: any, i: number) => <p key={i}>{item.kind} · {item.reason}</p>)}</details>
      <p>{review.rounding}</p>
      {review.options.length === 0 ? <p>Acceptance, overtime authorization and invoicing are not available for an unsupported comparison. Confirmation stays closed while it is attached.</p> : <>
        <p>Preparation grants no overtime or customer-commitment authority. The owner may accept one exact option with recorded customer approval; overtime requires its own explicit consent below.</p>
        {s.actor.role === 'owner' && <Form title="Accept reviewed commitment" submit="Accept selected option" busy={larder.busy || stale} onSubmit={d => {
          const option = review.options.find((option: any) => option.id === text(d, 'optionId'))
          return larder.run('so.reviewAccept', { orderId: order.id, version: order.version, optionId: option.id, optionDigest: option.digest, reason: text(d, 'acceptReason'), authorizeOvertime: d.get('authorizeOvertime') === 'on', ...(text(d, 'marginOverride') ? { override: { reason: text(d, 'marginOverride'), accountableId: s.actor.id } } : {}), customerApproval: { name: text(d, 'customerApprover'), reference: text(d, 'customerApprovalReference'), approvedOn: text(d, 'customerApprovedOn') } })
        }}>
          <Choose label="Reviewed delivery option" name="optionId" options={review.options.map((option: any) => ({ value: option.id, label: `${option.name} · ${day(option.shipDate)}` }))} />
          <Field label="Customer acceptance name" name="customerApprover" />
          <Field label="Customer acceptance reference" name="customerApprovalReference" />
          <Field label="Customer acceptance date" name="customerApprovedOn" type="date" defaultValue={review.preparedAt.slice(0, 10)} />
          <Field label="Reason to accept commitment" name="acceptReason" />
          <Field label="Owner margin override reason" name="marginOverride" required={false} hint="Only when the configured margin policy requires it. You remain the accountable owner." />
          <label className="field wide"><span><input type="checkbox" name="authorizeOvertime" /> Authorize the selected option's exact overtime windows</span></label>
        </Form>}
      </>}
      <Form submit="Discard preparation" quiet busy={larder.busy} onSubmit={d => larder.run('so.reviewClear', { orderId: order.id, version: order.version, reason: text(d, 'discardReason') })}><Field label="Reason to discard preparation" name="discardReason" hint="Returns to the original USD quote; reviewed prices and dates are not applied." /></Form>
    </section>}
    <Form key={order.version} title={review ? 'Refresh preparation' : 'Customer terms and estimates'} submit="Prepare costed options" busy={larder.busy} onSubmit={d => larder.run('so.review', { orderId: order.id, version: order.version, currency: text(d, 'currency'), usdRate: text(d, 'usdRate'), rateDate: text(d, 'rateDate'), rateReference: text(d, 'rateReference'), validUntil: text(d, 'validUntil'), paymentTerms: text(d, 'paymentTerms'), discountPercent: text(d, 'discountPercent'), freight: text(d, 'freight'), laborCostRate: text(d, 'laborCostRate'), machineCostRate: text(d, 'machineCostRate'), overheadCostRate: text(d, 'overheadCostRate'),
      ...(text(d, 'planningStart') ? { asOf: text(d, 'planningStart') + ':00.000Z' } : {}),
      ...(order.lines.some((line: any) => text(d, `partial.${line.id}`)) ? { partialLines: order.lines.map((line: any) => ({ lineId: line.id, quantity: text(d, `partial.${line.id}`) || '0' })), remainderStart: text(d, 'remainderStart') } : {}),
      ...(text(d, 'overtimeMachine') || text(d, 'overtimeLabor') ? { overtime: [{ kind: 'machine', id: text(d, 'overtimeMachine') }, { kind: 'labor', id: text(d, 'overtimeLabor') }].filter(window => window.id).map(window => ({ ...window, startsAt: text(d, 'overtimeStart') + ':00.000Z', endsAt: text(d, 'overtimeEnd') + ':00.000Z', reason: text(d, 'overtimeReason') })), overtimePremiumRate: text(d, 'overtimePremiumRate') } : {}), lines: order.lines.map((line: any) => ({ lineId: line.id, unitPrice: text(d, `price.${line.id}`) })) })}>
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
      <fieldset className="wide"><legend>Delivery assumptions</legend>
        <p>Optional comparisons use a separate copy of the current plan. These inputs authorize no overtime or customer commitment. All times below are UTC.</p>
        <Field label="Planning start UTC" name="planningStart" type="datetime-local" required={false} defaultValue={review?.asOf?.slice(0, 16)} hint="Blank starts at the current server time." />
        {order.lines.map((line: any, i: number) => <Field key={line.id} label={`Line ${i + 1} first delivery quantity`} name={`partial.${line.id}`} required={false} inputMode="decimal" defaultValue={review?.partialLines?.find((part: any) => part.lineId === line.id)?.quantity} />)}
        <Field label="Remainder starts no earlier than" name="remainderStart" type="date" required={false} defaultValue={review?.remainderStart ?? ''} />
        <Choose label="Assumed overtime machine" name="overtimeMachine" required={false} defaultValue={review?.overtime?.find((window: any) => window.kind === 'machine')?.id ?? ''} options={s.machineCalendars.map((calendar: Rec) => ({ value: calendar.id, label: calendar.name }))} />
        <Choose label="Assumed overtime person calendar" name="overtimeLabor" required={false} defaultValue={review?.overtime?.find((window: any) => window.kind === 'labor')?.id ?? ''} options={s.laborCalendars.map((calendar: Rec) => ({ value: calendar.id, label: calendar.name }))} />
        <Field label="Assumed overtime start UTC" name="overtimeStart" type="datetime-local" required={false} defaultValue={review?.overtime?.[0]?.startsAt?.slice(0, 16)} />
        <Field label="Assumed overtime end UTC" name="overtimeEnd" type="datetime-local" required={false} defaultValue={review?.overtime?.[0]?.endsAt?.slice(0, 16)} />
        <Field label="Additional overtime tariff USD per hour" name="overtimePremiumRate" required={false} inputMode="decimal" defaultValue={review?.overtimePremiumRate ?? ''} />
        <Field label="Overtime assumption reason" name="overtimeReason" required={false} defaultValue={review?.overtime?.[0]?.reason ?? ''} />
      </fieldset>
      {order.lines.map((line: any, i: number) => <Field key={line.id} label={`Line ${i + 1} customer currency unit price`} name={`price.${line.id}`} defaultValue={review?.lines.find((quoted: any) => quoted.lineId === line.id)?.unitPrice ?? line.unitPrice} inputMode="decimal" />)}
    </Form>
  </Card>
}

function AcceptedQuote({ larder, order }: { larder: Larder; order: Rec }) {
  const terms = order.customerTerms, accepted = order.quoteAcceptance
  return <Card title="Accepted costed commitment">
    <section aria-label="Accepted quote terms">
      <p><strong>{terms.currency} {money(terms.totalAmount)}</strong> · USD {money(terms.totalUsdAmount)}</p>
      <p>USD {terms.usdRate} per {terms.currency} · {day(terms.rateDate)} · {terms.rateReference} · {terms.paymentTerms}</p>
      <p>Estimated cost: USD {money(terms.estimate.totalCost)} · Estimated margin: {terms.currency} {money(terms.marginAmount)} · USD {money(terms.marginUsdAmount)}</p>
      <p>{accepted.option.name} · {accepted.customerApproval.name} · {accepted.customerApproval.reference}</p>
      <Table head={['Product', 'Quantity', 'Customer amount', 'USD value']} numeric={[1, 2, 3]}>{terms.lines.map((line: any) => <tr key={line.lineId}><td>{itemName(larder.state!, line.itemId)}</td><td>{qty(line.quantity)}</td><td>{terms.currency} {money(line.amount)}</td><td>USD {money(line.usdAmount)}</td></tr>)}</Table>
      <p>Freight: {terms.currency} {money(terms.freightAmount)} · USD {money(terms.freightUsdAmount)}</p>
      <p>Booked delivery work:</p><ul>{accepted.option.deliveries.map((delivery: any) => <li key={delivery.workOrderId}><a href={`#make/wo/${delivery.workOrderId}`}>{itemName(larder.state!, delivery.itemId)} · {qty(delivery.quantity)} · {day(delivery.shipDate)}</a></li>)}</ul>
      {accepted.option.operations.map((operation: any) => <p key={operation.key}>{operation.machine} · {operation.person} · {operation.startsAt} to {operation.endsAt}</p>)}
      <p>Supply and capacity are committed once. Actual receipt, qualified execution and shipping remain separate recorded actions.</p>
      <Details label="Accepted supply and capacity" value={accepted} s={larder.state!} />
      {(order.invoices ?? []).map((invoice: any) => <section key={invoice.id} aria-label="Customer invoice"><h3>{invoice.reference}</h3><p>{invoice.currency} {money(invoice.totalAmount)} · USD {money(invoice.totalUsdAmount)}</p><p>USD {invoice.usdRate} per {invoice.currency} · {invoice.rateReference} · {invoice.paymentTerms}</p><p>Estimated margin: {invoice.currency} {money(invoice.marginAmount)} · USD {money(invoice.marginUsdAmount)}</p><p>{invoice.basis}</p><Details label="Invoice terms" value={invoice} s={larder.state!} /></section>)}
      {!order.invoices?.length && larder.state!.actor.role === 'owner' && <Form submit="Issue customer invoice" busy={larder.busy} onSubmit={d => larder.run('so.invoice', { orderId: order.id, version: order.version, reason: text(d, 'invoiceReason') })}><Field label="Reason to issue invoice" name="invoiceReason" /></Form>}
    </section>
  </Card>
}
