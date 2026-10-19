import { CatalogBulk } from './catalog-bulk'
import { can, itemName, partyName, rows } from './api'
import type { Larder } from './app'
import { Card, Choose, Empty, Field, Form, Table, options, text } from './controls'
import { isZero, money, words } from './format'

const conversions = (raw: string) => raw.split(',').map(x => x.trim()).filter(Boolean).map(x => { const [unit, factor] = x.split('=').map(y => y.trim()); return { unit, factor } })
const attributes = (raw: string) => Object.fromEntries(raw.split(',').map(x => x.trim()).filter(Boolean).map(x => { const at = x.indexOf(':'); return [x.slice(0, at).trim(), x.slice(at + 1).trim()] }))

export function Setup({ larder }: { larder: Larder }) {
  const s = larder.state!, run = larder.run, busy = larder.busy
  return <>
    <CatalogBulk larder={larder} />
    <Card title="Items">{rows(s, 'items').length === 0 ? <Empty>No items yet.</Empty> :
      <Table head={['Item', 'Made or bought', 'Unit', 'Other units', 'Variant', 'List price']} numeric={[5]}>{rows(s, 'items').map(i => <tr key={i.id}><td><strong>{i.name}</strong><small>{i.sku}{i.archived && ' · archived'}{i.sourceId && ' · from Odoo'}</small></td><td>{i.kind === 'make' ? 'Made' : 'Bought'}</td><td>{i.baseUnit}</td><td>{i.conversions.map((c: any) => `${c.unit} = ${c.factor} ${i.baseUnit}`).join(', ') || '—'}</td><td>{i.template ? `${i.template}: ${Object.entries(i.attributes).map(([k, v]) => `${k} ${v}`).join(', ')}` : '—'}</td><td className="num">{isZero(i.salePrice) ? '—' : money(i.salePrice)}</td></tr>)}</Table>}
      {can(s, ['manager', 'buyer']) && <Form title="Add an item" submit="Add item" busy={busy} onSubmit={d => run('item.save', { sku: text(d, 'sku'), name: text(d, 'name'), kind: text(d, 'kind'), baseUnit: text(d, 'baseUnit'), conversions: conversions(text(d, 'conversions')), template: text(d, 'template'), attributes: attributes(text(d, 'attributes')), standardCost: text(d, 'standardCost') || '0', salePrice: text(d, 'salePrice') || '0' })}>
        <Field label="SKU" name="sku" /><Field label="Name" name="name" /><Choose label="Made or bought" name="kind" options={[{ value: 'make', label: 'Made here' }, { value: 'buy', label: 'Bought in' }]} /><Field label="Base unit" name="baseUnit" placeholder="each, lb, gal" />
        <Field label="Other units" name="conversions" required={false} placeholder="box = 12, bundle = 10" hint="Each must convert exactly to the base unit" />
        <Field label="Variant of" name="template" required={false} placeholder="Serving board" /><Field label="Variant attributes" name="attributes" required={false} placeholder="Wood: Walnut, Size: Large" />
        <Field label="Standard cost" name="standardCost" inputMode="decimal" required={false} /><Field label="List price" name="salePrice" inputMode="decimal" required={false} />
      </Form>}
    </Card>
    <div className="split">
      <Card title="Customers and suppliers">{rows(s, 'parties').length === 0 ? <Empty>No contacts yet.</Empty> :
        <Table head={['Name', 'Kind', 'EIN', 'Email']}>{rows(s, 'parties').map(p => <tr key={p.id}><td>{p.name}</td><td>{words(p.kind)}</td><td>{p.abn || '—'}</td><td>{p.email || '—'}</td></tr>)}</Table>}
        {can(s, ['manager', 'buyer', 'sales']) && <Form title="Add a contact" submit="Add contact" busy={busy} onSubmit={d => run('party.save', { name: text(d, 'name'), kind: text(d, 'kind'), email: text(d, 'email'), abn: text(d, 'abn') })}>
          <Field label="Name" name="name" /><Choose label="Kind" name="kind" options={[{ value: 'customer', label: 'Customer' }, { value: 'supplier', label: 'Supplier' }, { value: 'both', label: 'Both' }]} /><Field label="Email" name="email" type="email" required={false} /><Field label="EIN" name="abn" required={false} /></Form>}
      </Card>
      <Card title="Their codes for your items">{rows(s, 'partyItems').length === 0 ? <Empty>No supplier or customer codes yet.</Empty> :
        <Table head={['Contact', 'Their code', 'Item', 'Price', 'Lead time']} numeric={[3]}>{rows(s, 'partyItems').map(r => <tr key={r.id}><td>{partyName(s, r.partyId)}{r.preferred && <small>preferred</small>}</td><td>{r.partyCode}</td><td>{itemName(s, r.itemId)}</td><td className="num">{money(r.price)} / {r.unit}</td><td>{r.leadDays} days</td></tr>)}</Table>}
        {can(s, ['manager', 'buyer', 'sales']) && <Form title="Add a code" submit="Add code" busy={busy} onSubmit={d => run('partyItem.save', { partyId: text(d, 'partyId'), itemId: text(d, 'itemId'), partyCode: text(d, 'partyCode'), price: text(d, 'price') || '0', unit: text(d, 'unit') || undefined, leadDays: Number(text(d, 'leadDays') || 0), preferred: d.get('preferred') === 'on' })}>
          <Choose label="Contact" name="partyId" options={options(rows(s, 'parties'), r => r.name)} /><Choose label="Item" name="itemId" options={options(rows(s, 'items'), r => `${r.name} · ${r.sku}`)} /><Field label="Their code" name="partyCode" /><Field label="Price" name="price" inputMode="decimal" required={false} /><Field label="Unit" name="unit" required={false} /><Field label="Lead time (days)" name="leadDays" type="number" min="0" required={false} />
          <label className="check"><input type="checkbox" name="preferred" /> Preferred supplier</label></Form>}
      </Card>
    </div>
    <Card title="Locations">{rows(s, 'locations').length === 0 ? <Empty>No locations yet.</Empty> : <ul className="pills">{rows(s, 'locations').map(l => <li key={l.id}>{l.name}</li>)}</ul>}
      {can(s, ['manager', 'warehouse']) && <Form title="Add a location" submit="Add location" busy={busy} onSubmit={d => run('location.save', { name: text(d, 'name'), note: text(d, 'note') })}><Field label="Name" name="name" placeholder="Shop floor, Shipping shelf" /><Field label="Note" name="note" required={false} /></Form>}
    </Card>
  </>
}
