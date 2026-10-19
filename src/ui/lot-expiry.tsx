// TRACE-003 lot dates, FEFO proposals and the documented expiry disposition.
import { can, itemName, locationName, personName, rows, type LarderState, type Rec } from './api'
import type { Larder } from './app'
import { Card, Chip, Choose, Field, Form, Table, fileBase64, options, text } from './controls'
import { day, qty } from './format'

// Manufacture, expiry, retest, supplier shelf life and storage for one new lot.
export function LotDateFields({ prefix, manufactured = true }: { prefix: string; manufactured?: boolean }) {
  return <>
    {manufactured && <Field label="Manufactured" name={`${prefix}manufacturedOn`} type="date" required={false} />}
    <Field label="Expires" name={`${prefix}expiresOn`} type="date" required={false} />
    <Field label="Retest by" name={`${prefix}retestOn`} type="date" required={false} />
    {manufactured && <Field label="Supplier shelf life (days)" name={`${prefix}supplierShelfLifeDays`} type="number" min="0" required={false} hint="Sets the expiry from the manufacture date when no expiry is given" />}
    <Field label="Storage conditions" name={`${prefix}storage`} required={false} />
  </>
}

export function readLotDates(d: FormData, prefix: string) {
  const out = Object.fromEntries(['manufacturedOn', 'expiresOn', 'retestOn', 'supplierShelfLifeDays', 'storage'].map(k => [k, text(d, `${prefix}${k}`)]).filter(([, v]) => v))
  return Object.keys(out).length ? out : undefined
}

const tone = (state: string) => state === 'current' ? 'good' : state === 'expiring' ? 'warn' : 'bad'
const remaining = (l: Rec) => l.remainingDays === null ? 'no expiry' : l.remainingDays < 0 ? `${-l.remainingDays} days past` : `${l.remainingDays} days`

export function LotExpiry({ larder }: { larder: Larder }) {
  const s = larder.state!, statuses: Rec[] = s.lotStatuses ?? [], manager = can(s, ['manager'])
  if (!statuses.length) return null
  const blocked = statuses.filter(l => ['expired', 'retest due'].includes(l.state) && l.onHand !== '0')
  return <Card title="Lot dates and expiry">
    <p className="meta">Dates are UTC days; a lot is usable through its expiry and retest dates. Expired and retest-due lots stay on hand but cannot be reserved, picked, issued or transferred until an owner or manager records a documented disposition.</p>
    <Table head={['Lot', 'Item', 'Manufactured', 'Expires', 'Retest by', 'Storage', 'Shelf life left', 'State', 'On hand']} numeric={[8]}>{statuses.map(l => <tr key={l.lotId}>
      <td><strong>{l.code}</strong></td><td>{itemName(s, l.itemId)}</td><td>{l.manufacturedOn ? day(l.manufacturedOn) : '—'}</td><td>{l.expiresOn ? day(l.expiresOn) : '—'}</td><td>{l.retestOn ? day(l.retestOn) : '—'}</td>
      <td>{l.storage || '—'}</td><td>{remaining(l)}</td><td><Chip tone={tone(l.state)}>{l.state === 'current' ? 'Current' : l.reason || 'Expiring soon'}</Chip></td><td className="num">{qty(l.onHand)}</td></tr>)}</Table>
    {rows(s, 'lots').filter(l => (l.dispositions ?? []).length).map(l => <section key={l.id} aria-label={`Lot ${l.code} dispositions`}><h3>Lot {l.code} dispositions</h3>
      <ul>{l.dispositions.map((x: any, i: number) => <li key={i}>{x.decision === 'extend' ? `Extended after retest: expiry ${x.after.expiresOn ? day(x.after.expiresOn) : '—'}, retest ${x.after.retestOn ? day(x.after.retestOn) : '—'}` : `Scrapped ${qty(x.quantity)} at ${locationName(s, x.locationId)}`} · was {x.blocked} · {x.reason} · {personName(s, x.by)} · evidence {x.evidence.map((e: any) => e.name).join(', ')}</li>)}</ul></section>)}
    {manager && blocked.map(l => <Form key={l.lotId} title={`Decide lot ${l.code} (${l.reason})`} submit="Record disposition" busy={larder.busy} note="Extend only on a documented retest; scrap writes the lot's available stock off at one location." onSubmit={async d => {
      const file = d.get('evidence') as File | null, lot = rows(s, 'lots').find(x => x.id === l.lotId)!
      return larder.run('lot.dispose', { lotId: l.lotId, version: lot.version, decision: text(d, 'decision'), expiresOn: text(d, 'expiresOn') || undefined, retestOn: text(d, 'retestOn') || undefined, locationId: text(d, 'locationId') || undefined, reason: text(d, 'reason'),
        evidence: file && file.size ? [{ name: file.name, contentType: file.type || 'application/octet-stream', base64: await fileBase64(file) }] : [] })
    }}>
      <Choose label="Decision" name="decision" options={[{ value: 'extend', label: 'Extend after a passed retest' }, { value: 'scrap', label: 'Scrap the expired stock' }]} />
      <Field label="New expiry" name="expiresOn" type="date" required={false} /><Field label="New retest date" name="retestOn" type="date" required={false} />
      <Choose label="Scrap at" name="locationId" required={false} options={options(rows(s, 'locations'), r => r.name)} /><Field label="Reason" name="reason" />
      <label className="field wide"><span>Retest or disposal record</span><input type="file" name="evidence" required accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,.xlsx" /></label>
    </Form>)}
  </Card>
}

// The FEFO proposal for one reservation and the lot chooser the pick sends.
export function FefoPick({ s, orderId, reservation }: { s: LarderState; orderId: string; reservation: Rec }) {
  const plan = (s.fefoPlans ?? []).find((p: Rec) => p.orderId === orderId && p.lineId === reservation.lineId && p.locationId === reservation.locationId)
  if (!plan) return null
  return <div className="wide fefo-proposal" aria-label={`FEFO for ${itemName(s, reservation.itemId)}`}>
    <p className="muted">First expiry first out for shipping {day(plan.on)}{plan.minShelfLifeDays !== null && `; the customer needs ${plan.minShelfLifeDays} days of shelf life`}.</p>
    <Table head={['Lot', 'Expires', 'Shelf life left', 'Available', 'Eligible']} numeric={[3]}>{plan.lots.map((x: Rec) => <tr key={x.lotId || 'unlotted'}><td>{x.code || 'Unlotted'}</td><td>{x.expiresOn ? day(x.expiresOn) : '—'}</td><td>{x.remainingDays === null ? 'no expiry' : `${x.remainingDays} days`}</td><td className="num">{qty(x.quantity)}</td><td>{x.eligible ? <Chip tone="good">Eligible</Chip> : <Chip tone="bad">{x.reason}</Chip>}</td></tr>)}</Table>
    <Choose label={`Lot for ${itemName(s, reservation.itemId)}`} name={`lot.${reservation.id}`} required={false} options={[{ value: 'fefo', label: 'First eligible to expire (FEFO)' }, ...plan.lots.filter((x: Rec) => x.eligible && x.lotId).map((x: Rec) => ({ value: x.lotId, label: `Lot ${x.code}` }))]} defaultValue="fefo" />
  </div>
}
