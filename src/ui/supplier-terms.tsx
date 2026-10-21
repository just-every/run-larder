import { useState } from 'react'
import { can, itemName, partyName, rows, type Rec } from './api'
import type { Larder } from './app'
import { Card, Choose, Details, Empty, Field, Form, Table, options, text } from './controls'
import { day, money, qty } from './format'

const today = () => new Date().toISOString().slice(0, 10)
const csv = (s: string) => s.split(',').map(v => v.trim()).filter(Boolean)
function TermForm({ larder, reference }: { larder: Larder; reference?: Rec }) {
  const s = larder.state!, t = reference?.supplierTerms
  return <Form key={`${reference?.id ?? 'new'}:${reference?.version ?? 0}`} title={reference ? 'Revise terms' : 'Add supplier terms'} submit="Save supplier terms" busy={larder.busy} onSubmit={d => larder.run('supplier.terms', {
    id: reference?.id, version: reference?.version, partyId: reference?.partyId ?? text(d, 'partyId'), itemId: reference?.itemId ?? text(d, 'itemId'),
    partyCode: text(d, 'partyCode'), preferred: d.get('preferred') === 'on', packQuantity: text(d, 'pack'), moq: text(d, 'moq'), leadDays: Number(text(d, 'leadDays')),
    price: text(d, 'price'), currency: text(d, 'currency'), usdRate: text(d, 'usdRate'), rateOn: text(d, 'rateOn'), rateSource: text(d, 'rateSource'),
    paymentTerms: text(d, 'paymentTerms'), freightTerms: text(d, 'freightTerms'), weekdays: csv(text(d, 'weekdays')).map(Number), closedDates: csv(text(d, 'closedDates')),
    breaks: csv(text(d, 'breaks')).map(b => { const [quantity, price] = b.split('='); return { quantity, price } }), note: text(d, 'note'),
  })} note="Quantities and prices use the item's base unit. Lead time counts supplier working days after today. Currency rates are recorded by your buyer.">
    {!reference && <><Choose label="Terms supplier" name="partyId" options={options(rows(s, 'parties').filter(p => p.kind !== 'customer'), p => p.name)} /><Choose label="Terms item" name="itemId" options={options(rows(s, 'items').filter(i => !i.archived), i => `${i.name} · ${i.baseUnit}`)} /></>}
    <Field label="Supplier item code" name="partyCode" defaultValue={reference?.partyCode} />
    <Field label="Pack quantity" name="pack" defaultValue={t?.packQuantity ?? '1'} inputMode="decimal" /><Field label="Minimum order quantity" name="moq" defaultValue={t?.moq ?? '1'} inputMode="decimal" />
    <Field label="Lead working days" name="leadDays" type="number" min="0" max="365" defaultValue={t?.leadDays ?? 0} />
    <Field label="Price per base unit" name="price" defaultValue={t?.price ?? '0'} inputMode="decimal" />
    <Field label="Price breaks" name="breaks" defaultValue={t?.breaks.map((b: any) => `${b.quantity}=${b.price}`).join(', ')} required={false} hint="Quantity=price, e.g. 24=8, 48=7.5" />
    <Field label="Currency" name="currency" defaultValue={t?.currency ?? 'USD'} maxLength={3} />
    <Field label="USD per currency unit" name="usdRate" defaultValue={t?.usdRate ?? '1'} inputMode="decimal" />
    <Field label="Rate date" name="rateOn" type="date" defaultValue={t?.rateOn ?? today()} /><Field label="Rate source" name="rateSource" defaultValue={t?.rateSource ?? 'USD, no conversion'} />
    <Field label="Payment terms" name="paymentTerms" defaultValue={t?.paymentTerms} /><Field label="Freight terms" name="freightTerms" defaultValue={t?.freightTerms} />
    <Field label="Working weekdays" name="weekdays" defaultValue={t?.weekdays.join(',') ?? '1,2,3,4,5'} hint="0 Sunday through 6 Saturday, comma separated" />
    <Field label="Closed dates" name="closedDates" defaultValue={t?.closedDates.join(', ')} required={false} hint="YYYY-MM-DD, comma separated" />
    <label className="check"><input name="preferred" type="checkbox" defaultChecked={reference?.preferred} /> Preferred supplier</label>
    <Field label="Terms note" name="note" required={false} defaultValue={t?.note} />
  </Form>
}

export function SupplierTerms({ larder }: { larder: Larder }) {
  const s = larder.state!, refs = rows(s, 'partyItems').filter(r => r.supplierTerms)
  const [comparison, setComparison] = useState<any>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const [schedule, setSchedule] = useState(''), [reason, setReason] = useState('')
  const manage = can(s, ['manager', 'buyer']), draft = can(s, ['manager', 'buyer', 'agent'])
  async function compare(d: FormData) {
    setLoading(true); setError(''); setComparison(null)
    try {
      const res = await fetch('/api/larder/purchasing/quotes?' + new URLSearchParams({ itemId: text(d, 'itemId'), quantity: text(d, 'quantity'), requiredBy: text(d, 'requiredBy') }))
      const body: any = await res.json()
      if (!res.ok) throw new Error(body.error?.message ?? 'Quotes could not load.')
      setComparison(body)
    } catch (e) { setError((e as Error).message) } finally { setLoading(false) }
    return false
  }
  async function select(q: any) {
    const deliveries = schedule.trim() ? csv(schedule).map(entry => { const [expectedDate, quantity] = entry.split('='); return { expectedDate, quantity } }) : undefined
    const po = await larder.run('po.selectQuote', { partyItemId: q.partyItemId, version: q.version, quantity: q.requested, requiredBy: q.requiredBy, reason, deliveries })
    if (po) window.location.hash = `make/po/${po.id}`
  }
  return <><Card title="Supplier terms">
    {!refs.length && <Empty>No structured supplier terms yet.</Empty>}
    {refs.map(r => <article key={r.id} aria-label={`Terms for ${partyName(s, r.partyId)}`}>
      <h3>{partyName(s, r.partyId)} · {itemName(s, r.itemId)}</h3><p>{r.partyCode} · {r.preferred ? 'Preferred' : 'Alternate'} · pack {qty(r.supplierTerms.packQuantity)} · minimum {qty(r.supplierTerms.moq)} · {r.supplierTerms.leadDays} working days</p>
      <p>{r.supplierTerms.currency} {r.supplierTerms.price} per base unit · {r.supplierTerms.paymentTerms} · {r.supplierTerms.freightTerms}</p>
      <Details label="Terms and revision history" value={supplierFacts(r.termHistory)} s={s} />
      {manage && <details><summary>Revise {partyName(s, r.partyId)} terms</summary><TermForm larder={larder} reference={r} /></details>}
    </article>)}
    {manage && <details><summary>Add supplier terms</summary><TermForm larder={larder} /></details>}
  </Card>
  <Card title="Compare supplier quotes">
    <Form submit="Compare quotes" onSubmit={compare} busy={loading}>
      <Choose label="Quote item" name="itemId" options={options(rows(s, 'items').filter(i => !i.archived), i => `${i.name} · ${i.baseUnit}`)} />
      <Field label="Required base quantity" name="quantity" inputMode="decimal" /><Field label="Material required by" name="requiredBy" type="date" />
    </Form>
    {error && <p role="alert">{error}</p>}
    {comparison && <><p>Compared on {day(comparison.asOf)}. All exposures are USD. A quote is feasible when its supplier calendar and lead time meet your required date.</p>
      {!comparison.quotes.length && <Empty>No structured quotes for this item.</Empty>}
      {draft && <><Field label="Purchase reason" name="quoteReason" value={reason} onChange={(e: any) => setReason(e.target.value)} /><Field label="Delivery schedule" name="quoteSchedule" value={schedule} onChange={(e: any) => setSchedule(e.target.value)} required={false} hint="Optional date=base quantity, comma separated. Blank uses the earliest delivery." /></>}
      <Table head={['Supplier', 'Quantity', 'Earliest delivery', 'Price', 'USD exposure', 'Decision']} numeric={[1, 4]}>{comparison.quotes.map((q: any) => <tr key={q.partyItemId}>
        <td>{partyName(s, q.supplierId)}<small>{q.preferred ? 'Preferred' : 'Alternate'} · {q.partyCode}</small></td><td>{qty(q.quantity)}</td><td>{day(q.earliestDate)}</td><td>{q.currency} {q.price}<small>Rate {q.terms.usdRate} USD · {day(q.terms.rateOn)} · {q.terms.rateSource}</small></td><td>{money(q.exposure)}</td>
        <td>{q.feasible ? 'Feasible' : 'Too late'}{draft && q.feasible && <button className="button" disabled={larder.busy || !reason.trim() || s.version !== comparison.version} onClick={() => void select(q)}>Select {partyName(s, q.supplierId)}</button>}</td>
      </tr>)}</Table>{s.version !== comparison.version && <p>Records changed. Compare quotes again before selecting.</p>}
    </>}
  </Card>
  <Card title="Supplier delivery performance"><p className="muted">Receipt observations compare arrival with the latest expected date at receipt. The original approved date is retained separately; quarantine is not acceptance. Reversed receipts show zero net units.</p>
    {(s.supplierPerformance ?? []).filter((p: any) => p.measuredDeliveries || refs.some(r => r.partyId === p.supplierId)).map((p: any) => <article key={p.supplierId}><h3>{partyName(s, p.supplierId)}</h3><p>{p.measuredDeliveries} measured deliveries · {p.lateDeliveries} late</p>
      {p.receipts.length > 0 && <Table head={['Receipt', 'Arrival', 'Expected / approved', 'Quantity', 'Inspection']}>{p.receipts.map((r: any, i: number) => <tr key={i}><td>{r.reference}</td><td>{day(r.arrivedOn)} · {r.late ? 'Late' : 'On time'}</td><td>{day(r.expectedDate)} / {day(r.approvedDate)}</td><td>{qty(r.quantity)}</td><td>{r.inspection}</td></tr>)}</Table>}
    </article>)}
  </Card></>
}


// Explicit currency labels prevent generic fact formatting from presenting a
// source-currency quotation with the installation's money symbol.
export function supplierFacts(value: any, inheritedCurrency = 'USD'): any {
  if (Array.isArray(value)) return value.map(v => supplierFacts(v, inheritedCurrency))
  if (!value || typeof value !== 'object') return value
  const currency = value.currency ?? inheritedCurrency
  return Object.fromEntries(Object.entries(value).map(([key, v]) => [key,
    ['price', 'sourceExposure'].includes(key) && typeof v === 'string' ? `${currency} ${v}` :
    ['unitPrice', 'exposure'].includes(key) && typeof v === 'string' ? `USD ${v}` : supplierFacts(v, currency)]))
}
