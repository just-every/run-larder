import { SourceHistory } from './source-history'
import { useState } from 'react'
import { can, personName, rows, type Rec } from './api'
import type { Larder } from './app'
import { Card, Chip, Choose, Empty, Field, Form, Table, text } from './controls'
import { qty, when, words } from './format'
import { Valuation } from './valuation'

export function MoveIn({ larder }: { larder: Larder }) {
  const s = larder.state!, batches = [...rows(s, 'imports')].reverse()
  const [selected, setSelected] = useState<string | undefined>(batches[0]?.id)
  const batch = batches.find(b => b.id === selected)
  return <>
    <SourceHistory larder={larder} />
    {can(s, ['manager', 'agent']) && <Card title="Preview an Odoo export">
      <p className="muted">Export each model from Odoo with “I want to update data (import-compatible export)” ticked, as CSV, and name each file after its model (res.partner.csv, uom.uom.csv, product.product.csv, stock.location.csv, mrp.bom.csv, stock.quant.csv, sale.order.csv, purchase.order.csv). The preview changes nothing.</p>
      <Form submit="Preview move-in" busy={larder.busy} onSubmit={async d => {
        const files = await Promise.all((d.getAll('files') as File[]).filter(f => f.size).map(async f => ({ name: f.name, content: await f.text() })))
        const r = await larder.run('import.preview', { label: text(d, 'label'), files, opening: text(d, 'countedOn') ? { countedOn: text(d, 'countedOn'), valuationBasis: text(d, 'valuationBasis'), countedBy: text(d, 'countedBy') } : undefined, currency: text(d, 'currency') && text(d, 'currency').toUpperCase() !== 'USD' ? { code: text(d, 'currency').toUpperCase(), rateToUsd: text(d, 'rate'), recordedOn: text(d, 'rateDate'), source: text(d, 'rateSource') } : undefined })
        if (r) setSelected(r.id)
        return r
      }}>
        <Field label="Label" name="label" placeholder="October cutover" />
        <label className="field wide"><span>Odoo CSV files</span><input type="file" name="files" multiple accept=".csv,text/csv" required /></label>
        <Field label="Opening count date" name="countedOn" type="date" required={false} hint="Needed when stock.quant.csv is included" />
        <Field label="Counted by" name="countedBy" required={false} />
        <Field label="Source currency" name="currency" required={false} placeholder="USD" hint="Three letters. Anything but USD needs the rate below." />
        <Field label="Rate to USD" name="rate" required={false} inputMode="decimal" /><Field label="Rate date" name="rateDate" type="date" required={false} /><Field label="Rate source" name="rateSource" required={false} />
        <Choose label="Valuation basis" name="valuationBasis" required={false} options={[{ value: 'standard-cost', label: 'Odoo standard cost' }, { value: 'last-purchase', label: 'Last purchase price' }, { value: 'supplier-invoice', label: 'Supplier invoices' }, { value: 'owner-estimate', label: 'Owner estimate' }]} />
      </Form></Card>}
    {batches.length > 0 && <Card title="Move-in batches"><Table head={['Batch', 'Prepared', 'Status', '']}>{batches.map(b => <tr key={b.id} className={b.id === selected ? 'selected' : undefined}><td>{b.label}</td><td>{when(b.createdAt)} by {personName(s, b.preparedBy)}</td><td><Chip tone={b.status === 'committed' ? 'good' : b.status === 'undone' ? 'neutral' : 'info'}>{words(b.status)}</Chip></td><td><button className="link" onClick={() => setSelected(b.id)}>Review</button></td></tr>)}</Table></Card>}
    {batch ? <Review larder={larder} b={batch} /> : <Empty>No move-in yet.</Empty>}
  </>
}

// Odoo external ids (__export__.uom_uom_32_bb02) may break only after a dot or an underscore.
const breakable = (id: string) => id.split(/(?<=[._])/).flatMap((part, i) => i ? [<wbr key={i} />, part] : [part])

function Review({ larder, b }: { larder: Larder; b: Rec }) {
  const s = larder.state!, busy = larder.busy, manager = can(s, ['manager'])
  const labels: Record<string, string> = { contacts: 'Contacts', products: 'Products', locations: 'Locations', boms: 'Bills of materials', openingLines: 'Opening count lines', salesOrders: 'Open sales orders', purchaseOrders: 'Open purchase orders' }
  return <Card title={<>{b.label} <Chip tone="info">{words(b.status)}</Chip></>}>
    <dl className="facts counts">{Object.entries(b.counts).map(([k, v]) => <div key={k}><dt>{labels[k] ?? k}</dt><dd>{qty(String(v))}</dd></div>)}<div><dt>Rejected rows</dt><dd className={b.rejected.length ? 'bad' : undefined}>{b.rejected.length}</dd></div></dl>
    <Valuation v={b.valuation} />
    <h3>Files</h3><ul>{b.files.map((f: any) => <li key={f.name}>{f.name} · {qty(String(f.rows))} rows</li>)}</ul>
    {b.rejected.length > 0 && <><h3>Rejected rows (stay out of Larder)</h3><Table head={['File', 'Line', 'External ID', 'Why']}>{b.rejected.map((r: any, i: number) => <tr key={i}><td>{r.file}</td><td>{r.line}</td><td className="mono">{r.sourceId ? breakable(r.sourceId) : '—'}</td><td>{r.reason}</td></tr>)}</Table></>}
    {b.skipped.length > 0 && <details className="skipped"><summary>{b.skipped.length} rows skipped on purpose</summary><ul>{b.skipped.map((r: any, i: number) => <li key={i}>{r.file} line {r.line}: {r.reason}</li>)}</ul></details>}
    {b.unsupported.length > 0 && <p className="muted">Columns not read: {b.unsupported.map((u: any) => `${u.file} (${u.columns.join(', ')})`).join('; ')}</p>}
    {manager && b.status === 'previewed' && <Form submit={b.rejected.length ? `Commit, leaving ${b.rejected.length} rejected rows out` : 'Commit move-in'} busy={busy} onSubmit={() => larder.run('import.commit', { importId: b.id, version: b.version, acceptRejected: b.rejected.length })}><span /></Form>}
    {manager && b.status === 'committed' && <Form submit="Undo move-in" quiet busy={busy} note="Removes everything this batch created. Refused once orders, stock or documents depend on it; then correct with reversals and counts." onSubmit={d => larder.run('import.undo', { importId: b.id, version: b.version, reason: text(d, 'reason') })}><Field label="Reason" name="reason" /></Form>}
  </Card>
}
