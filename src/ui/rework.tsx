import { byId, can, itemName, personName, rows, type Rec } from './api'
import type { Larder } from './app'
import { Area, Card, Chip, Choose, Field, Form, Table, fileBase64, options, text } from './controls'
import { money, qty, when, words } from './format'
import { InspectForm, InspectionResults, HoldRelease } from './quality'

const upload = async (d: FormData) => { const f = d.get('evidence') as File; return f?.size ? [{ name: f.name, contentType: f.type || 'application/octet-stream', base64: await fileBase64(f) }] : [] }
const evidence = <label className="field wide"><span>Evidence file</span><input type="file" name="evidence" required /></label>

export function ReworkOrders({ larder, jobId }: { larder: Larder; jobId?: string }) {
  const s = larder.state!, run = larder.run, busy = larder.busy, production = can(s, ['manager', 'production']), manager = can(s, ['manager'])
  const lots = rows(s, 'lots').filter(l => l.source === 'production' && (!jobId || l.documentId === jobId)), locs = options(rows(s, 'locations'), r => r.name), items = options(rows(s, 'items'), r => `${r.name} · ${r.sku}`)
  const orders = rows(s, 'reworkOrders').filter(w => !jobId || w.sourceJobId === jobId)
  return <>
    {orders.map(w => <Card key={w.id} title={`${w.reference} · ${words(w.kind)}`}>
      <Chip tone={w.status === 'released' ? 'good' : 'warn'}>{words(w.status)}</Chip>
      <p>Original lot <strong>{byId(s, 'lots', w.sourceLotId)?.code}</strong> · <a href={`#make/wo/${w.sourceJobId}`}>{byId(s, 'workOrders', w.sourceJobId)?.reference}</a> · pinned revision {w.bomRevision} · {qty(w.quantity)} {w.executedAt ? 'consumed from' : 'planned from'} {w.sourceStatus}</p>
      <p>{w.disposition}</p><p>Instructions: {w.instructions}</p>
      <p>Evidence {w.evidence.map((f: Rec) => <a key={f.id} href={`/api/larder/attachments/${f.id}`}>{f.name} </a>)}{w.approval && ` · instructions approved by ${personName(s, w.approval.by)} ${when(w.approval.at)}`}</p>
      <Table head={['Output', 'Quantity', 'Allocated value', 'Lot']} numeric={[1, 2]}>{w.outputs.map((o: Rec) => <tr key={o.itemId}><td>{itemName(s, o.itemId)}</td><td>{qty(o.quantity)}</td><td>{money(o.value)}</td><td>{o.lot}</td></tr>)}</Table>
      {w.materials.map((m: Rec, i: number) => <p key={i}>Extra material: {qty(m.quantity)} {itemName(s, m.itemId)}</p>)}
      {w.labor.map((l: Rec, i: number) => <p key={i}>Labor: {l.person} · {l.hours} hours × {money(l.rate)}/hour · {l.note}</p>)}
      {w.cost && <p>Source {money(w.cost.source)} + extra material {money(w.cost.extraMaterials)} + labor {money(w.cost.labor)} = total {money(w.cost.total)} · outputs {money(w.cost.outputs)} · scrap {money(w.cost.scrap)}</p>}
      {w.status === 'draft' && manager && <Form submit="Approve instructions" busy={busy} onSubmit={d => run('rework.approve', { orderId: w.id, version: w.version, reason: text(d, 'reason') })}><Field label="Approval reason" name="reason" /></Form>}
      {w.status === 'approved' && production && <button className="button" disabled={busy} onClick={() => run('rework.execute', { orderId: w.id, version: w.version })}>Execute approved order</button>}
      <InspectionResults s={s} subjectId={w.id} title={w.reference} />
      {rows(s, 'qualityHolds').filter(h => h.subjectId === w.id && h.status === 'open').map(h => <HoldRelease key={h.id} larder={larder} hold={h} />)}
      {w.status === 'quarantine' && production && rows(s, 'inspectionPlans').filter(p => p.status === 'approved' && w.outputLots.some((o: Rec) => o.itemId === p.itemId) && (p.revision === null || p.revision === w.bomRevision)).map(p => <InspectForm key={p.id} larder={larder} plan={p} reworkOrderId={w.id} />)}
      {w.status === 'quarantine' && manager && <Form submit="Approve repair and recovery release" busy={busy} note="Confirm passing units with evidence. Existing inspection and certificate requirements still apply." onSubmit={async d => run('rework.release', { orderId: w.id, version: w.version, reason: text(d, 'reason'), evidence: await upload(d) })}><Field label="Release reason" name="reason" />{evidence}</Form>}
      {w.release && <p>Approved release by {personName(s, w.release.by)} {when(w.release.at)}: {w.release.reason} · {w.release.evidence.map((f: Rec) => f.name).join(', ')}</p>}
    </Card>)}
    {production && lots.length > 0 && <Card title="New repair or unbuild order"><Form submit="Save repair draft" busy={busy} note="Quantities use each item's base unit. Enter actual extra materials and labor; allocate source plus extra cost exactly between recovered/repaired outputs and scrap. Outputs remain quarantined until approved release." onSubmit={async d => {
      const lot = byId(s, 'lots', text(d, 'sourceLotId'))!
      return run('rework.draft', { sourceLotId: lot.id, sourceJobId: lot.documentId, kind: text(d, 'kind'), quantity: text(d, 'quantity'), locationId: text(d, 'locationId'), sourceStatus: text(d, 'sourceStatus'), disposition: text(d, 'disposition'), instructions: text(d, 'instructions'), evidence: await upload(d), scrapValue: text(d, 'scrapValue') || '0', outputs: [0, 1, 2].filter(i => text(d, `out.${i}.itemId`)).map(i => ({ itemId: text(d, `out.${i}.itemId`), quantity: text(d, `out.${i}.quantity`), lot: text(d, `out.${i}.lot`), value: text(d, `out.${i}.value`) })), materials: text(d, 'materialId') ? [{ itemId: text(d, 'materialId'), locationId: text(d, 'materialLocation'), quantity: text(d, 'materialQuantity') }] : [], labor: text(d, 'person') ? [{ person: text(d, 'person'), hours: text(d, 'hours'), rate: text(d, 'rate'), note: text(d, 'laborNote') }] : [] })
    }}>
      <Choose label="Original production lot" name="sourceLotId" options={options(lots, l => `${l.code} · ${byId(s, 'workOrders', l.documentId)?.reference}`)} /><Choose label="Order kind" name="kind" options={[{ value: 'rework', label: 'Repair / rework' }, { value: 'unbuild', label: 'Unbuild components' }]} />
      <Choose label="Source location" name="locationId" options={locs} /><Choose label="Source stock status" name="sourceStatus" options={[{ value: 'quarantine', label: 'Quarantine' }, { value: 'available', label: 'Available free stock' }]} /><Field label="Source quantity" name="quantity" inputMode="decimal" /><Area label="Disposition" name="disposition" /><Area label="Authorized instructions" name="instructions" />{evidence}
      {[0, 1, 2].map(i => <fieldset className="lines wide" key={i}><legend>Output {i + 1}</legend><Choose label={`Output ${i + 1} item`} name={`out.${i}.itemId`} options={items} required={i === 0} /><Field label={`Output ${i + 1} quantity`} name={`out.${i}.quantity`} required={false} /><Field label={`Output ${i + 1} lot`} name={`out.${i}.lot`} required={false} /><Field label={`Output ${i + 1} value`} name={`out.${i}.value`} required={false} /></fieldset>)}
      <Field label="Scrap value" name="scrapValue" defaultValue="0" /><Choose label="Extra material" name="materialId" options={items} required={false} /><Choose label="Material location" name="materialLocation" options={locs} required={false} /><Field label="Material quantity" name="materialQuantity" required={false} />
      <Field label="Labor person" name="person" required={false} /><Field label="Labor hours" name="hours" required={false} /><Field label="Hourly rate" name="rate" required={false} /><Field label="Labor description" name="laborNote" required={false} />
    </Form></Card>}
  </>
}
