import { Card, Field, Form, Choose, Table, Details, text } from './controls'
import { can, itemName, type Rec } from './api'
import type { Larder } from './app'
import { day, money, qty, plus, minus } from './format'

export function QuoteReview({ larder, order }: { larder: Larder; order: Rec }) {
  const s = larder.state!, review = order.quoteReview
  if (order.status !== 'quote' || !can(s, ['manager', 'sales'])) return null
  const scope = (s.actor as { scope?: { locations: string[] | null; costs: boolean } }).scope
  const scoped = scope?.locations !== null && scope?.locations !== undefined || scope?.costs
  if (scoped) return null
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
      <p>Preparation grants no commitment or overtime authority. Only the owner can accept one exact current option below; unavailable comparisons cannot be accepted.</p>
      {s.actor.role === 'owner' && review.options.length > 0 && <Form submit="Accept exact option" busy={larder.busy} onSubmit={d => { const option = review.options.find((o: any) => o.id === text(d, 'optionId')); return larder.run('so.acceptOption', { orderId: order.id, version: order.version, reviewVersion: review.inputVersion, optionId: option?.id, optionDigest: option?.digest, reason: text(d, 'acceptReason'), ...(text(d, 'marginOverride') ? { override: { reason: text(d, 'marginOverride'), accountableId: s.actor.id } } : {}), authorizeOvertime: d.has('authorizeOvertime'), customerApproval: { name: text(d, 'customerApprover'), reference: text(d, 'approvalReference'), approvedOn: text(d, 'approvedOn') } }) }}>
        <Choose label="Option to accept" name="optionId" options={review.options.map((o: any) => ({ value: o.id, label: `${o.name} · ${day(o.shipDate)}` }))} />
        <Field label="Acceptance reason" name="acceptReason" />
        <Field label="Margin policy override reason" name="marginOverride" required={false} hint="Only when the margin policy requires an owner override. The owner remains accountable." />
        <Field label="Customer approver" name="customerApprover" />
        <Field label="Customer approval reference" name="approvalReference" />
        <Field label="Customer approved on" name="approvedOn" type="date" />
        <label className="check wide"><input type="checkbox" name="authorizeOvertime" /> Authorize this option's exact machine and person overtime windows</label>
        <p>Acceptance confirms these customer terms, releases the identified work, reserves currently available components and books the displayed joint intervals. Expected receipts remain conditional and require manual allocation; nothing is sent externally.</p>
      </Form>}
      <Form submit="Discard preparation" quiet busy={larder.busy} onSubmit={d => larder.run('so.reviewClear', { orderId: order.id, version: order.version, reason: text(d, 'discardReason') })}><Field label="Reason to discard preparation" name="discardReason" hint="Returns to the original USD quote; reviewed prices and dates are not applied." /></Form>
    </section>}
    <Form key={order.version} title={review ? 'Refresh preparation' : 'Customer terms and estimates'} submit="Prepare costed options" busy={larder.busy} onSubmit={d => larder.run('so.review', { orderId: order.id, version: order.version, currency: text(d, 'currency'), usdRate: text(d, 'usdRate'), rateDate: text(d, 'rateDate'), rateReference: text(d, 'rateReference'), validUntil: text(d, 'validUntil'), paymentTerms: text(d, 'paymentTerms'), discountPercent: text(d, 'discountPercent'), freight: text(d, 'freight'), laborCostRate: text(d, 'laborCostRate'), machineCostRate: text(d, 'machineCostRate'), overheadCostRate: text(d, 'overheadCostRate'), reason: text(d, 'refreshReason'),
      ...(text(d, 'planningStart') ? { asOf: text(d, 'planningStart') + ':00.000Z' } : {}),
      ...(order.lines.some((line: any) => text(d, `partial.${line.id}`)) ? { partialLines: order.lines.map((line: any) => ({ lineId: line.id, quantity: text(d, `partial.${line.id}`) || '0' })), remainderStart: text(d, 'remainderStart') } : {}),
      ...(text(d, 'overtimeMachine') || text(d, 'overtimeLabor') ? { overtime: [{ kind: 'machine', id: text(d, 'overtimeMachine') }, { kind: 'labor', id: text(d, 'overtimeLabor') }].filter(window => window.id).map(window => ({ ...window, startsAt: text(d, 'overtimeStart') + ':00.000Z', endsAt: text(d, 'overtimeEnd') + ':00.000Z', reason: text(d, 'overtimeReason') })), overtimePremiumRate: text(d, 'overtimePremiumRate') } : {}), lines: order.lines.map((line: any) => ({ lineId: line.id, unitPrice: text(d, `price.${line.id}`) })) })}>
      {review && <Field label="Reason to replace preparation" name="refreshReason" />}
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

export function QuoteCommitment({ larder, order }: { larder: Larder; order: Rec }) {
  const s = larder.state!, terms = order.customerTerms, accepted = order.quoteAcceptance
  if (!terms || !accepted || (s.actor as any).scope?.costs) return null
  const packed = s.shipments.filter((sh: Rec) => sh.orderId === order.id && ['packed', 'shipped'].includes(sh.status)).flatMap((sh: Rec) => sh.lines)
  const invoiceReady = terms.lines.every((line: any) => minus(plus(...packed.filter((p: any) => p.lineId === line.lineId).map((p: any) => p.quantity)), line.quantity) === '0')
  return <Card title="Accepted customer terms">
    <section aria-label="Accepted quote commitment">
      <p><strong>{terms.currency} {money(terms.totalAmount)}</strong> · USD {money(terms.totalUsdAmount)}</p>
      <p>USD {terms.usdRate} per {terms.currency} · {day(terms.rateDate)} · {terms.rateReference}</p>
      <p>{terms.paymentTerms} · {accepted.option.name} · complete by {day(order.promiseDate)}</p>
      <p>Estimated margin: {terms.currency} {money(terms.marginAmount)} · USD {money(terms.marginUsdAmount)} · {qty(terms.marginPercent)}%</p>
      <p>Booked cost: USD {money(terms.estimatedCostUsd)}. Receipt, quality release and execution remain separate actions.</p>
      <Table head={['Product', 'Customer price', 'Net amount', 'USD value']} numeric={[1, 2, 3]}>{terms.lines.map((line: any) => <tr key={line.lineId}><td>{itemName(s, line.itemId)}</td><td>{terms.currency} {qty(line.unitPrice)}</td><td>{terms.currency} {money(line.amount)}</td><td>USD {money(line.usdAmount)}</td></tr>)}</Table>
      <p>Freight: {terms.currency} {money(terms.freightAmount)} · USD {money(terms.freightUsdAmount)}</p>
      <p>Customer approval: {accepted.customerApproval.name} · {accepted.customerApproval.reference}</p>
      {accepted.workOrderIds.map((id: string) => <p key={id}><a href={`#make/wo/${id}`}>Open {s.workOrders.find((w: Rec) => w.id === id)?.reference ?? 'booked work'}</a></p>)}
      <Details label="Accepted supply and capacity" value={accepted.option} s={s} />
      <p>Accepted costed terms are fixed. Customer-currency amendments require a separate exact review.</p>
      {order.invoice ? <section aria-label="Customer invoice"><h3>{order.invoice.reference}</h3><p>Issued locally · {terms.currency} {money(order.invoice.terms.totalAmount)} · USD {money(order.invoice.terms.totalUsdAmount)}</p><p>{order.invoice.semantics}</p></section> : s.actor.role === 'owner' && (invoiceReady ? <Form submit="Issue local customer invoice" busy={larder.busy} onSubmit={d => larder.run('so.invoice', { orderId: order.id, version: order.version, reason: text(d, 'invoiceReason') })}><Field label="Invoice reason" name="invoiceReason" /><p>Issue the accepted amount once for the linked packed or shipped quantities. No tax determination, email, payment or ledger posting.</p></Form> : <p>Pack or ship every quoted quantity before issuing this complete-order invoice. Partial and bulk invoices require their separate qualification.</p>)}
    </section>
  </Card>
}
