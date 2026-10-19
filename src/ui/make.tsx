import { byId, can, itemName, locationName, partyName, personName, rows, sku, unitOf, type LarderState, type Rec } from './api'
import type { Larder } from './app'
import { Card, Chip, Choose, Empty, Field, Form, Lines, Table, options, readLines, text } from './controls'
import { day, dayName, minus, money, positive, qty, when, words } from './format'
import { covers, firstStart, stories, timing } from './supply'
import { schedule } from './schedule/plan'
import { OrderRank, OrderStatusActions, OrderStatusDisplay, useOrderStatusList } from './order-status'

const tabs = [{ id: 'plan', title: 'Shortages' }, { id: 'po', title: 'Purchase orders' }, { id: 'wo', title: 'Work orders' }, { id: 'boms', title: 'Bills of materials' }]

export function MakeBuy({ larder, section = 'plan', id }: { larder: Larder; section?: string; id?: string }) {
  const s = larder.state!
  return <div className="page">
    <header className="page-head"><p className="eyebrow">Make &amp; buy</p><h1>{tabs.find(t => t.id === section)?.title ?? 'Shortages'}</h1>
      <nav className="tabs" aria-label="Make and buy">{tabs.map(t => <a key={t.id} href={`#make/${t.id}`} aria-current={section === t.id ? 'page' : undefined}>{t.title}</a>)}</nav></header>
    {section === 'plan' && <Shortages larder={larder} />}
    {section === 'po' && (id && byId(s, 'purchaseOrders', id) ? <Purchase larder={larder} po={byId(s, 'purchaseOrders', id)!} /> : <Purchases larder={larder} />)}
    {section === 'wo' && (id && byId(s, 'workOrders', id) ? <Work larder={larder} w={byId(s, 'workOrders', id)!} /> : <Works larder={larder} />)}
    {section === 'boms' && <Boms larder={larder} />}
  </div>
}

function Shortages({ larder }: { larder: Larder }) {
  const s = larder.state!, plan = schedule(s, new Date())
  // Released work still missing materials that open supply covers: what each waits on, against when it starts.
  const waiting = rows(s, 'workOrders').filter(w => w.status === 'released').flatMap(w => covers(s, w, plan).map(c => ({ w, c, start: firstStart(plan, w.id) })))
  return <><Card title="What is short, and why">{s.shortages.length === 0 ? <Empty>{waiting.length ? 'Open supply covers every confirmed order and released job. Some of it arrives after the work starts; see below.' : 'Confirmed orders and released work are covered by stock and open supply.'}</Empty> :
    <Table head={['Item', 'Short', 'Needed by', 'Because', '']} numeric={[1]}>{s.shortages.map((x: any) => <tr key={x.itemId}><td><strong>{itemName(s, x.itemId)}</strong><small>{words(x.kind === 'make' ? 'made' : 'bought')} · {qty(x.available)} free, {qty(x.expected)} expected</small></td><td className="num"><span className="short bad">{qty(x.shortage)}</span></td><td>{day(x.requiredBy)}</td><td>{x.reasons.map((r: any) => `${r.reference} needs ${qty(r.quantity)} by ${day(r.date)}`).join('; ')}</td>
      <td>{can(s, ['manager', 'buyer', 'production', 'agent']) && <button className="button" disabled={larder.busy} onClick={async () => { const r = await larder.run('plan.draft', { itemId: x.itemId }); if (r) window.location.hash = `make/${x.kind === 'make' ? 'wo' : 'po'}/${r.id}` }}>{x.kind === 'make' ? 'Draft work order' : x.supplierId ? `Draft PO to ${partyName(s, x.supplierId)}` : 'Draft purchase order'}</button>}</td></tr>)}</Table>}
  </Card>
  {waiting.length > 0 && <Card title="Released work waiting on supply">
    <Table head={['Work order', 'Material', 'Short', 'Waits on', 'Job starts']} numeric={[2]}>{waiting.map(({ w, c, start }) => <tr key={`${w.id}:${c.itemId}`}>
      <td><a href={`#make/wo/${w.id}`}>{w.reference}</a></td><td>{itemName(s, c.itemId)}</td><td className="num"><span className="short bad">{qty(c.short)}</span></td>
      <td className={c.arrives && start && c.arrives > start ? 'warn-text' : undefined}>{timing(c, start)}</td><td>{start ? dayName(start) : 'Not scheduled'}</td></tr>)}</Table>
  </Card>}</>
}

const poTone = (status: string) => status === 'draft' ? 'warn' : status === 'received' ? 'good' : 'info'
function Purchases({ larder }: { larder: Larder }) {
  const s = larder.state!, list = [...rows(s, 'purchaseOrders')].reverse()
  return <><Card title="Purchase orders">{list.length === 0 ? <Empty>No purchase orders yet.</Empty> :
    <Table head={['Order', 'Supplier', 'Expected', 'Status', 'Value']} numeric={[4]}>{list.map(p => <tr key={p.id}><td><a href={`#make/po/${p.id}`}>{p.reference}</a>{p.sourceReference && <small>Odoo {p.sourceReference}</small>}</td><td>{partyName(s, p.supplierId)}</td><td>{day(p.expectedDate)}</td><td><Chip tone={poTone(p.status)}>{words(p.status)}</Chip></td><td className="num">{money(p.exposure)}</td></tr>)}</Table>}</Card>
    {can(s, ['manager', 'buyer', 'agent']) && <Card title="New purchase order"><Form submit="Save draft" busy={larder.busy} onSubmit={d => larder.run('po.draft', { supplierId: text(d, 'supplierId'), expectedDate: text(d, 'expectedDate'), reason: text(d, 'reason'), lines: readLines(d) })}>
      <Choose label="Supplier" name="supplierId" options={options(rows(s, 'parties').filter(p => p.kind !== 'customer'), r => r.name)} /><Field label="Expected delivery" name="expectedDate" type="date" /><Field label="Reason" name="reason" /><Lines items={rows(s, 'items').filter(i => !i.archived)} /></Form></Card>}</>
}

function Purchase({ larder, po }: { larder: Larder; po: Rec }) {
  const s = larder.state!, run = larder.run, busy = larder.busy, buyer = can(s, ['manager', 'buyer'])
  const open = ['approved', 'confirmed', 'part received'].includes(po.status)
  const approval = rows(s, 'approvals').find(a => a.id === po.approvalId)
  return <div className="split">
    <Card title={<>{po.reference} <Chip tone={poTone(po.status)}>{words(po.status)}</Chip></>}>
      <p className="meta">{partyName(s, po.supplierId)} · expected {day(po.expectedDate)}{po.supplierReference && ` · their ref ${po.supplierReference}`}</p><p>{po.reason}</p>
      <Table head={['Item', 'Ordered', 'Received', 'Price']} numeric={[1, 2, 3]}>{po.lines.map((l: any) => <tr key={l.id}><td>{itemName(s, l.itemId)}<small>{sku(s, l.itemId)}</small></td><td className="num">{qty(l.quantity)} {unitOf(s, l.itemId)}</td><td className="num">{qty(l.received)}</td><td className="num">{money(l.unitPrice)}</td></tr>)}</Table>
      <p>Cash exposure <strong>{money(po.exposure)}</strong>{approval && <> · approved by {personName(s, approval.createdBy)} {when(approval.createdAt)}</>}</p>
      {po.history.length > 0 && <ul className="history">{po.history.map((h: any, i: number) => <li key={i}>{when(h.at)}: {h.change} {day(h.from)} → {day(h.to)} ({h.note})</li>)}</ul>}
      {po.status === 'draft' && buyer && <div className="actions"><button className="button primary" disabled={busy} onClick={() => run('po.approve', { poId: po.id, version: po.version })}>Approve purchase order</button></div>}
    </Card>
    <Card title="Supplier and delivery">
      {buyer && ['approved', 'confirmed'].includes(po.status) && <Form title="Record supplier confirmation" submit="Save confirmation" busy={busy} onSubmit={d => run('po.confirm', { poId: po.id, version: po.version, supplierReference: text(d, 'ref'), confirmedDate: text(d, 'date') })}><Field label="Supplier reference" name="ref" /><Field label="Confirmed delivery" name="date" type="date" /></Form>}
      {buyer && open && <Form title="Revise expected delivery" submit="Revise date" quiet busy={busy} onSubmit={d => run('po.revise', { poId: po.id, version: po.version, expectedDate: text(d, 'date'), note: text(d, 'note') })}><Field label="New expected date" name="date" type="date" /><Field label="Why" name="note" /></Form>}
      {open && can(s, ['manager', 'warehouse']) && <Form title="Receive delivery" submit="Receive" busy={busy} onSubmit={d => run('receipt.create', { poId: po.id, supplierReference: text(d, 'ref'), lines: po.lines.map((l: any) => ({ lineId: l.id, quantity: text(d, `q.${l.id}`), locationId: text(d, 'locationId'), lot: text(d, `lot.${l.id}`), inspection: text(d, 'inspection') })).filter((l: any) => l.quantity && positive(l.quantity)) })}>
        <Field label="Packing slip" name="ref" /><Choose label="Into location" name="locationId" options={options(rows(s, 'locations'), r => r.name)} />
        <Choose label="Inspection" name="inspection" options={[{ value: 'accept', label: 'Accept into stock' }, { value: 'quarantine', label: 'Hold in quarantine' }]} />
        {po.lines.filter((l: any) => positive(minus(l.quantity, l.received))).map((l: any) => <div className="line" key={l.id}><Field label={`${itemName(s, l.itemId)} (outstanding ${qty(minus(l.quantity, l.received))})`} name={`q.${l.id}`} inputMode="decimal" required={false} /><Field label="Supplier lot" name={`lot.${l.id}`} required={false} /></div>)}
      </Form>}
      {rows(s, 'receipts').filter(r => r.poId === po.id).map(r => <p key={r.id} className="muted">{r.reference} · {r.supplierReference} · {when(r.createdAt)} · {words(r.status)}</p>)}
      {!open && po.status !== 'draft' && <Empty>Fully received.</Empty>}
    </Card>
  </div>
}

const woTone = (status: string) => status === 'released' ? 'info' : status === 'closed' ? 'good' : 'warn'
function Works({ larder }: { larder: Larder }) {
  const s = larder.state!, statuses = useOrderStatusList(s, 'work'), list = statuses.list(rows(s, 'workOrders'))
  return <><Card title="Work orders">{statuses.controls}{list.length === 0 ? <Empty>{rows(s, 'workOrders').length ? 'No work orders match these filters.' : 'No work orders yet. Draft one from a shortage or below.'}</Empty> :
    <Table head={['Work order', 'Makes', 'Dates', 'BOM', 'Status', 'Materials / production', 'Done']} numeric={[6]}>{list.map(w => <tr key={w.id}><td><a href={`#make/wo/${w.id}`}>{w.reference}</a><OrderRank status={statuses.status(w.id)} /><OrderStatusActions larder={larder} kind="work" order={w} status={statuses.status(w.id)} /></td><td>{qty(w.quantity)} {itemName(s, w.itemId)}</td><td>Needed {day(w.requiredBy)}<small>Expected completion {day(w.expectedOn ?? w.requiredBy)}</small></td><td>{w.bomRevision ? `Rev ${w.bomRevision}` : '—'}</td><td><Chip tone={woTone(w.status)}>{words(w.status)}</Chip></td><td><OrderStatusDisplay s={s} status={statuses.status(w.id)} /></td><td className="num">{qty(w.output)}</td></tr>)}</Table>}</Card>
    {can(s, ['manager', 'production', 'agent']) && <Card title="New work order"><Form submit="Save draft" busy={larder.busy} onSubmit={d => larder.run('wo.draft', { itemId: text(d, 'itemId'), quantity: text(d, 'quantity'), requiredBy: text(d, 'requiredBy'), reason: text(d, 'reason') })}>
      <Choose label="Item to make" name="itemId" options={options(rows(s, 'items').filter(i => i.kind === 'make' && !i.archived), r => `${r.name} · ${r.sku}`)} /><Field label="Quantity" name="quantity" inputMode="decimal" /><Field label="Needed by" name="requiredBy" type="date" /><Field label="Reason" name="reason" /></Form></Card>}</>
}

function Work({ larder, w }: { larder: Larder; w: Rec }) {
  const s = larder.state!, run = larder.run, busy = larder.busy, prod = can(s, ['manager', 'production'])
  const reserved = (lineId: string) => rows(s, 'reservations').filter(r => r.demandId === w.id && r.lineId === lineId)
  return <div className="split">
    <Card title={<>{w.reference} <Chip tone={woTone(w.status)}>{words(w.status)}</Chip></>}>
      <p className="meta">Make {qty(w.quantity)} {itemName(s, w.itemId)} by {day(w.requiredBy)}{w.bomRevision && ` · pinned to BOM revision ${w.bomRevision}`}</p><p>{w.reason}</p>
      {w.status === 'draft' && prod && <div className="actions"><button className="button primary" disabled={busy} onClick={() => run('wo.release', { workOrderId: w.id, version: w.version })}>Release and reserve materials</button></div>}
      {w.components.length > 0 && <Table head={['Material', 'Required', 'Issued', 'Reserved']} numeric={[1, 2, 3]}>{w.components.map((l: any) => <tr key={l.id}><td>{itemName(s, l.itemId)}</td><td className="num">{qty(l.required)} {unitOf(s, l.itemId)}</td><td className="num">{qty(l.issued)}</td><td className="num">{reserved(l.id).map(r => `${qty(r.quantity)} at ${locationName(s, r.locationId)}`).join(', ') || '0'}</td></tr>)}</Table>}
      {w.routing.length > 0 && <ol className="routing">{w.routing.map((r: any) => <li key={r.sequence}>{r.name}{r.workCentre && ` · ${r.workCentre}`} · {r.minutes} min each</li>)}</ol>}
      <p>Output {qty(w.output)} · scrap {qty(w.scrap)} · standard cost {money(w.standardUnitCost)} each</p>
      {w.cost && <p>Materials used {money(w.cost.materials)} · variance {money(w.cost.variance)} · actual {money(w.cost.actualUnitCost)} each</p>}
      {(w.shortages ?? []).length > 0 && <p className="warn-text">Short: {stories(s, w, schedule(s, new Date())).join('; ')}. <button className="link" onClick={() => run('wo.reserve', { workOrderId: w.id })}>Try reserving again</button></p>}
    </Card>
    {w.status === 'released' && <Card title="Record the work">
      {can(s, ['manager', 'production', 'warehouse']) && <Form title="Issue materials" submit="Issue" busy={busy} onSubmit={d => run('wo.issue', { workOrderId: w.id, lines: w.components.map((l: any) => ({ itemId: l.itemId, locationId: text(d, 'locationId'), quantity: text(d, `q.${l.id}`) })).filter((l: any) => l.quantity && positive(l.quantity)) })}>
        <Choose label="From location" name="locationId" options={options(rows(s, 'locations'), r => r.name)} />
        {w.components.map((l: any) => <Field key={l.id} label={`${itemName(s, l.itemId)} actually used (${unitOf(s, l.itemId)})`} name={`q.${l.id}`} defaultValue={positive(minus(l.required, l.issued)) ? minus(l.required, l.issued) : ''} inputMode="decimal" required={false} />)}</Form>}
      {prod && <Form title="Record output" submit="Record output" busy={busy} onSubmit={d => run('wo.output', { workOrderId: w.id, version: w.version, locationId: text(d, 'locationId'), quantity: text(d, 'quantity') || '0', scrap: text(d, 'scrap') || '0', scrapReason: text(d, 'scrapReason'), lot: text(d, 'lot') })}>
        <Choose label="Into location" name="locationId" options={options(rows(s, 'locations'), r => r.name)} /><Field label="Good quantity" name="quantity" inputMode="decimal" required={false} /><Field label="Scrapped" name="scrap" inputMode="decimal" required={false} /><Field label="Scrap reason" name="scrapReason" required={false} /><Field label="Batch" name="lot" required={false} /></Form>}
      {prod && <Form submit="Close work order" quiet busy={busy} note="Releases leftover reservations and records the material cost and variance." onSubmit={() => run('wo.close', { workOrderId: w.id, version: w.version })}><span /></Form>}
    </Card>}
  </div>
}

function Boms({ larder }: { larder: Larder }) {
  const s = larder.state!, made = rows(s, 'items').filter(i => i.kind === 'make')
  return <><Card title="Bills of materials">{rows(s, 'boms').length === 0 ? <Empty>No bills of materials yet.</Empty> :
    <Table head={['Item', 'Revision', 'Components', 'Routing', 'Status']}>{[...rows(s, 'boms')].reverse().map(b => <tr key={b.id}><td>{itemName(s, b.itemId)}</td><td>Rev {b.revision}</td><td>{b.components.map((c: any) => `${qty(c.quantity)} ${unitOf(s, c.itemId)} ${itemName(s, c.itemId)}`).join(', ')}</td><td>{b.routing.map((r: any) => r.name).join(' → ') || '—'}</td><td><Chip tone={b.status === 'active' ? 'good' : 'neutral'}>{words(b.status)}</Chip></td></tr>)}</Table>}</Card>
    {can(s, ['manager', 'production']) && made.length > 0 && <Card title="New revision"><Form submit="Save new revision" busy={larder.busy} note="Saving creates the next revision. Released work keeps the revision it was released with." onSubmit={d => larder.run('bom.revise', { itemId: text(d, 'itemId'), note: text(d, 'note'), components: readLines(d).map(l => ({ itemId: l.itemId, quantity: l.quantity, unit: l.unitPrice })), routing: text(d, 'routing').split('\n').map(x => x.trim()).filter(Boolean).map(x => { const [name, workCentre = '', minutes = '0'] = x.split(',').map(y => y.trim()); return { name, workCentre, minutes: Number(minutes) } }) })}>
      <Choose label="Item" name="itemId" options={options(made, r => `${r.name} · ${r.sku}`)} /><Field label="Change note" name="note" required={false} />
      <BomLines s={s} /><label className="field wide"><span>Routing (one step per line: step, work center, minutes)</span><textarea name="routing" rows={3} required={false} placeholder={'Plane and cut, Bench, 20\nOil, Finishing, 5'} /></label></Form></Card>}</>
}
function BomLines({ s }: { s: LarderState }) {
  return <fieldset className="lines wide"><legend>Components per one finished unit</legend>{[0, 1, 2, 3].map(i => <div className="line" key={i}><Choose label={`Component ${i + 1}`} name={`lines.${i}.itemId`} options={options(rows(s, 'items'), r => `${r.name} · ${r.sku}`)} required={i === 0} /><Field label="Quantity" name={`lines.${i}.quantity`} inputMode="decimal" required={false} /><Field label="Unit" name={`lines.${i}.unitPrice`} required={false} hint="Blank uses the base unit" /></div>)}</fieldset>
}
