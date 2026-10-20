import { byId, can, itemName, locationName, partyName, rows, type Rec } from './api'
import type { Larder } from './app'
import { Area, Card, Chip, Choose, Field, Form, Table, fileBase64, options, text } from './controls'
import { money, minus, qty, when } from './format'
import { InspectForm, InspectionResults, HoldRelease } from './quality'
const evidence = <label className="field"><span>Evidence file</span><input type="file" name="evidence" required /></label>
const upload = async (d: FormData) => { const f = d.get('evidence') as File; return { name: f.name, contentType: f.type || 'application/octet-stream', base64: await fileBase64(f) } }
export function Subcontract({ larder }: { larder: Larder }) {
  const s = larder.state!, run = larder.run, busy = larder.busy, buyer = can(s, ['manager', 'buyer']), receiver = can(s, ['manager', 'buyer', 'warehouse'])
  const locations = options(rows(s, 'locations'), l => l.name), lots = options(rows(s, 'lots'), l => `${l.code} · ${itemName(s, l.itemId)}${l.ownerId ? ' · customer property' : ''}`)
  return <>
    {rows(s, 'subcontractCustody').length > 0 && <Card title="Customer property custody ledger"><Table head={['Customer / lot', 'Location', 'Event', 'Quantity', 'Owned value']} numeric={[3, 4]}>{rows(s, 'subcontractCustody').map(e => <tr key={e.id}><td>{partyName(s, e.ownerId)} · {byId(s, 'lots', e.lotId)?.code}</td><td>{locationName(s, e.locationId)}</td><td>{e.kind} · {when(e.createdAt)}</td><td>{e.quantity}</td><td>{money(e.ownedValue)}</td></tr>)}</Table></Card>}
    {rows(s, 'subcontractOrders').map(o => <Card key={o.id} title={`${o.reference} · ${o.operation}`}>
      <Chip>{o.status}</Chip><p>{partyName(s, o.supplierId)} · custody at {locationName(s, o.vendorLocationId)} · due {o.expectedDate}</p>
      <p>{qty(o.quantity)} {itemName(s, o.itemId)} · service {money(o.serviceRate)} per good or scrapped unit · {o.approval ? 'approved exposure' : 'service exposure'} {money(o.exposure)}</p>
      <p>{o.customerId ? `Customer property: ${partyName(s, o.customerId)} · zero owned inventory value` : 'Owned free-issue materials'}</p>
      <p>Good {qty(o.good)} · scrap {qty(o.scrap)} · yield ratio {o.yield ?? '—'} · accrued service {money(o.serviceAccrued)}</p>
      {o.status === 'draft' && buyer && <button className="button" disabled={busy} onClick={() => run('subcontract.approve', { orderId: o.id, version: o.version })}>Approve service order</button>}
      <Table head={['Material lot', 'Dispatched', 'Consumed', 'Returned', 'Remaining at vendor']} numeric={[1, 2, 3, 4]}>{o.issued.map((i: Rec) => <tr key={i.id}><td>{byId(s, 'lots', i.lotId)?.code} · {itemName(s, i.itemId)}</td><td>{qty(i.quantity)}</td><td>{qty(i.consumed)}</td><td>{qty(i.returned)}</td><td>{qty(minus(minus(i.quantity, i.consumed), i.returned))}</td></tr>)}</Table>
      {o.receipts.map((r: Rec) => <article key={r.id} aria-label={`Receipt ${byId(s, 'lots', r.lotId)?.code ?? 'scrap'}`}><h3>Finished lot {byId(s, 'lots', r.lotId)?.code ?? 'Scrap only'}</h3><p>{when(r.at)} · good {r.good} · scrap {r.scrap} · material {money(r.material)} + service {money(r.service)} · output {money(r.outputValue)} + scrap value {money(r.scrapValue)}</p><p>{r.reason} · {r.inputs.map((i: Rec) => `${byId(s, 'lots', i.lotId)?.code}: ${i.quantity}`).join('; ')}</p><a href={`/api/larder/attachments/${r.evidence.id}`}>Receipt evidence</a>
        <InspectionResults s={s} subjectId={r.lotId} title="Subcontract receipt" />
        {rows(s, 'inspectionPlans').filter(p => p.itemId === o.itemId && p.stage === 'receipt' && p.status === 'approved' && !o.customerId).map(p => <InspectForm key={p.id} larder={larder} plan={p} lots={rows(s, 'lots').filter(l => l.id === r.lotId)} />)}
        {rows(s, 'qualityHolds').filter(h => h.subjectId === r.lotId && h.status === 'open').map(h => <HoldRelease key={h.id} larder={larder} hold={h} />)}
      </article>)}
      {o.bill && <p>Bill {o.bill.reference}: {money(o.bill.amount)} · expected {money(o.bill.expected)} · difference {money(o.bill.difference)} · {o.bill.status} (local record)</p>}
      {o.status !== 'draft' && <>
        {receiver && o.status !== 'received' && <Form title="Dispatch material" submit="Record dispatch" busy={busy} onSubmit={d => run('subcontract.dispatch', { orderId: o.id, version: o.version, lines: [{ lotId: text(d, 'lotId'), locationId: text(d, 'locationId'), quantity: text(d, 'quantity') }] })}><Choose label="Material lot" name="lotId" options={lots} /><Choose label="From location" name="locationId" options={locations} /><Field label="Dispatch quantity" name="quantity" /></Form>}
        {receiver && o.issued.length > 0 && o.status !== 'received' && <Form title="Receive finished work" submit="Record subcontract receipt" busy={busy} onSubmit={async d => run('subcontract.receive', { orderId: o.id, version: o.version, good: text(d, 'good'), scrap: text(d, 'scrap'), lot: text(d, 'lot'), locationId: text(d, 'locationId'), reason: text(d, 'reason'), evidence: await upload(d), inputs: o.issued.filter((i: Rec) => text(d, i.id)).map((i: Rec) => ({ issuedId: i.id, quantity: text(d, i.id) })) })}>
          <Field label="Good quantity" name="good" defaultValue="0" /><Field label="Scrap quantity" name="scrap" defaultValue="0" /><Field label="Finished lot" name="lot" required={false} /><Choose label="Into location" name="locationId" options={locations} /><Area label="Receipt and yield note" name="reason" />{evidence}
          {o.issued.map((i: Rec) => <Field key={i.id} label={`Consumed ${byId(s, 'lots', i.lotId)?.code}`} name={i.id} required={false} />)}
        </Form>}
        {receiver && o.issued.length > 0 && <Form title="Return unused material" submit="Return custody stock" busy={busy} onSubmit={d => run('subcontract.return', { orderId: o.id, version: o.version, issuedId: text(d, 'issuedId'), quantity: text(d, 'quantity'), locationId: text(d, 'locationId'), reason: text(d, 'reason') })}><Choose label="Issued lot" name="issuedId" options={options(o.issued, i => byId(s, 'lots', i.lotId)?.code ?? '')} /><Field label="Return quantity" name="quantity" /><Choose label="Return location" name="locationId" options={locations} /><Field label="Return reason" name="reason" /></Form>}
        {can(s, ['manager', 'accounts']) && <Form title="Reconcile service bill" submit="Record bill reconciliation" busy={busy} note="Records supplier evidence and compares accrued service; does not verify a provider ledger." onSubmit={async d => run('subcontract.bill', { orderId: o.id, version: o.version, reference: text(d, 'reference'), amount: text(d, 'amount'), evidence: await upload(d) })}><Field label="Bill reference" name="reference" /><Field label="Bill amount" name="amount" />{evidence}</Form>}
      </>}
    </Card>)}
    {can(s, ['manager', 'buyer', 'agent']) && <Card title="New subcontract service order"><Form submit="Save service draft" busy={busy} onSubmit={d => run('subcontract.draft', Object.fromEntries(d))}>
      <Choose label="Subcontract supplier" name="supplierId" options={options(rows(s, 'parties').filter(p => p.kind !== 'customer'), p => p.name)} /><Choose label="Vendor custody location" name="vendorLocationId" options={locations} /><Choose label="Finished item" name="itemId" options={options(rows(s, 'items'), i => i.name)} /><Choose label="Customer owner (blank for owned stock)" name="customerId" required={false} options={options(rows(s, 'parties').filter(p => p.kind !== 'supplier'), p => p.name)} /><Field label="Ordered output quantity" name="quantity" /><Field label="Service rate" name="serviceRate" /><Field label="Expected date" name="expectedDate" type="date" /><Area label="Outside operation" name="operation" />
    </Form></Card>}
    {receiver && <Card title="Receive customer property"><Form submit="Record customer custody" busy={busy} note="Separate custody only: excluded from owned stock, valuation and availability." onSubmit={async d => run('customerStock.receive', { ...Object.fromEntries(d), evidence: await upload(d) })}>
      <Choose label="Customer" name="customerId" options={options(rows(s, 'parties').filter(p => p.kind !== 'supplier'), p => p.name)} /><Choose label="Customer material" name="itemId" options={options(rows(s, 'items'), i => i.name)} /><Choose label="Custody location" name="locationId" options={locations} /><Field label="Customer lot" name="lot" /><Field label="Customer quantity" name="quantity" />{evidence}
    </Form></Card>}
  </>
}
