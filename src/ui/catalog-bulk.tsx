import { can, itemName, locationName, rows } from './api'
import type { Larder } from './app'
import { Card, Empty, Field, Form, Table, text } from './controls'
import { when } from './format'
const labels: Record<string, string> = { salePrice: 'Sales price', standardCost: 'Standard cost', baseUnit: 'Base unit', priceList: 'Price list', reorderPoint: 'Reorder point', safetyStock: 'Safety stock', minStock: 'Minimum stock', maxStock: 'Maximum stock', defaultBin: 'Default bin', leadDays: 'Lead time', preferred_supplier_id: 'Default supplier', supplier_code: 'Supplier code', purchase_price: 'Purchase price', purchase_unit: 'Purchase unit', supplier_lead_days: 'Supplier lead time' }
const value = (v: unknown) => v === undefined || v === null || v === '' ? 'Empty' : typeof v === 'object' ? JSON.stringify(v) : String(v)

export function CatalogBulk({ larder }: { larder: Larder }) {
  const s = larder.state!, allowed = can(s, ['manager', 'buyer', 'production'])
  if (!allowed) return null
  const fieldValue = (field: string, v: unknown) => field === 'preferred_supplier_id' && v ? rows(s, 'parties').find(p => p.id === v)?.name ?? `Unknown supplier: ${v}` : field === 'defaultBin' && v ? rows(s, 'locations').find(l => l.id === v)?.name ?? `Unknown bin: ${v}` : value(v)
  const previews = [...rows(s, 'catalogChanges')].reverse()
  return <>
    <Card title="Catalog CSV">
      <p><a className="button" href="/api/larder/catalog.csv">Download active catalog CSV</a></p>
      <p className="muted">Each item has one row per location. Keep Larder IDs to edit; a blank ID creates an item, grouped by SKU. Empty cells keep existing values; #CLEAR clears an optional value. Prefix a literal #CLEAR or backslash with a backslash. Exported text may have a protective apostrophe; preserve it when editing.</p>
      <p className="muted">Prices and supplier terms apply to future documents. Existing orders, stock, reservations and issued documents keep their values. Location settings configure future planning policies; this edit does not reallocate stock. Serial policy configuration is shown separately from serial execution.</p>
      {rows(s, 'items').some(i => i.tracking === 'serial') && <ul>{rows(s, 'items').filter(i => i.tracking === 'serial').map(i => <li key={i.id}>{itemName(s, i.id)} · serial policy configured; serial execution not yet available</li>)}</ul>}
      <Form submit="Preview catalog changes" busy={larder.busy} onSubmit={async d => {
        const file = d.get('file') as File
        return larder.run('catalog.bulkPreview', { file: { name: file.name, content: await file.text() } })
      }}><Field label="Edited catalog CSV" name="file" type="file" accept=".csv,text/csv" /></Form>
    </Card>
    {previews.length === 0 && <Card title="Catalog change history"><Empty>No catalog edits yet.</Empty></Card>}
    {previews.map(p => <Card key={p.id} title={`${p.file} · ${p.status}`}>
      <p>{p.groups.length} accepted item groups · {p.errors.length} row errors · {when(p.createdAt)}</p>
      {p.errors.length > 0 && <Table head={['File', 'Row', 'Column', 'Reason']}>{p.errors.map((e: any, i: number) => <tr key={i}><td>{e.file}</td><td>{e.row}</td><td>{e.column}</td><td>{e.reason}</td></tr>)}</Table>}
      {p.impact.map((impact: any) => <div key={impact.itemId ?? impact.sku}>
        <h3>{impact.itemId ? itemName(s, impact.itemId) : impact.sku}{!impact.accepted && ' · rejected; unchanged'}</h3>
        <Table head={['Field / location', 'Before', 'After']}>{impact.changes.map((change: any, i: number) => <tr key={i}><td>{labels[change.field] ?? change.field}{change.locationId && <small>{rows(s, 'locations').find(l => l.id === change.locationId)?.name}</small>}</td><td>{fieldValue(change.field, change.before)}</td><td>{fieldValue(change.field, change.after)}{change.field === 'tracking' && change.after === 'serial' && <small>serial policy configured; serial execution not yet available</small>}</td></tr>)}</Table>
        <p className="muted">{impact.treatment}</p><details><summary>Affected records for {impact.sku}</summary>
          {[['Quotes', impact.quotes, 'orders'], ['Orders', impact.orders, 'orders'], ['Purchase orders', impact.purchases, 'make/po'], ['Work orders', impact.planning.work, 'make/wo']].map(([label, records, path]: any) => <div key={label}><h4>{label}</h4>{records.length ? records.map((record: any) => <p key={record.id}><a href={`#${path}/${record.id}`}>{record.reference}</a> · {record.status}</p>) : <p>None</p>}</div>)}
          <h4>Planning forecasts</h4>{impact.planning.forecasts.length ? impact.planning.forecasts.map((f: any) => <p key={f.id}>Week {f.week} · {f.quantity}</p>) : <p>None</p>}
          <h4>Tracked stock</h4>{impact.stock.length ? impact.stock.map((stock: any, i: number) => <p key={i}>{stock.quantity} at {locationName(s, stock.locationId)} · {stock.status}{stock.lotId && ` · ${rows(s, 'lots').find(l => l.id === stock.lotId)?.code}`}</p>) : <p>None</p>}
        </details>
      </div>)}
      {p.status === 'preview' && p.stateVersion !== s.version && <p className="warn-text">Records changed. Upload and review a fresh catalog preview.</p>}
      {p.status === 'preview' && p.preparedBy === s.actor.id && s.actor.role !== 'owner' && <p>A different authorized person must approve this catalog edit.</p>}
      {p.status === 'preview' && p.groups.length > 0 && <Form submit="Approve catalog changes" busy={larder.busy || p.stateVersion !== s.version || (p.createdBy === s.actor.id && s.actor.role !== 'owner')} onSubmit={d => larder.run('catalog.bulkApprove', { previewId: p.id, version: p.version, ...(d.get('acceptRejected') === 'on' ? { acceptRejected: p.errors.length } : {}) })}>
        {p.errors.length > 0 && <label className="check"><input name="acceptRejected" type="checkbox" required /> Leave rejected item groups unchanged ({p.errors.length} row errors)</label>}
        {p.stateVersion !== s.version && <span>Approval requires a fresh preview.</span>}
      </Form>}
    </Card>)}
  </>
}
