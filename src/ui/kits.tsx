// ENG-006: sellable kits. A revision's policy (assemble, or pick the components) is approved by a second person; a
// channel sale names its own event id, so a repeated event returns the first outcome and moves nothing twice.
import { can, itemName, locationName, rows } from './api'
import type { Larder } from './app'
import { Card, Chip, Choose, Empty, Field, Form, Lines, Table, options, readLines, text } from './controls'
import { money, qty, words } from './format'

const policies = [{ value: 'assemble', label: 'Assemble the kit when it sells' }, { value: 'pick', label: 'Pick the components when it sells' }]

export function Kits({ larder }: { larder: Larder }) {
  const s = larder.state!, made = rows(s, 'items').filter(i => i.kind === 'make' && !i.archived), kits = [...rows(s, 'kits')].reverse(), active = kits.filter(k => k.status === 'active')
  const available = (s.kitAvailability ?? {}) as Record<string, { total: string; places: { locationId: string; buildable: string }[] }>
  return <>
    <Card title="Kits">{kits.length === 0 ? <Empty>No kits yet. Prepare a kit definition below; a second person approves its policy.</Empty> :
      <Table head={['Kit', 'Revision', 'Policy', 'Components', 'Can sell now', 'Status']} numeric={[4]}>{kits.map(k => <tr key={k.id}>
        <td>{itemName(s, k.itemId)}</td><td>Rev {k.revision}{k.note && <small>{k.note}</small>}</td><td>{words(k.mode)}</td>
        <td>{k.components.map((l: any) => `${qty(l.quantity)} ${itemName(s, l.itemId)}`).join(', ')}</td>
        <td className="num">{k.status === 'active' ? <>{qty(available[k.itemId]?.total ?? '0')}<small>{(available[k.itemId]?.places ?? []).map(p => `${qty(p.buildable)} at ${locationName(s, p.locationId)}`).join(', ')}</small></> : '—'}</td>
        <td><Chip tone={k.status === 'active' ? 'good' : k.status === 'draft' ? 'warn' : 'neutral'}>{words(k.status)}</Chip>{k.status === 'draft' && can(s, ['manager', 'production']) && <button type="button" className="link" disabled={larder.busy} onClick={() => larder.run('kit.approve', { kitId: k.id, version: k.version })}>Approve policy</button>}</td></tr>)}</Table>}</Card>
    <div className="split">
      {can(s, ['manager', 'production', 'engineer', 'agent']) && made.length > 0 && <Card title="Prepare a kit"><Form submit="Save for approval" busy={larder.busy} note="A different person approves the policy before the kit can sell. Each revision keeps the components it was approved with."
        onSubmit={d => larder.run('kit.save', { itemId: text(d, 'itemId'), mode: text(d, 'mode'), note: text(d, 'note'), components: readLines(d).map(l => ({ itemId: l.itemId, quantity: l.quantity })) })}>
        <Choose label="Kit item" name="itemId" options={options(made, r => `${r.name} · ${r.sku}`)} />
        <Choose label="Policy" name="mode" options={policies} />
        <Field label="Change note" name="note" required={false} />
        <Lines items={rows(s, 'items').filter(i => !i.archived)} price={false} />
      </Form></Card>}
      {can(s, ['manager', 'sales']) && active.length > 0 && <Card title="Record a channel sale"><Form submit="Record sale" busy={larder.busy} note="The channel's own event id identifies the sale: sending the same event again returns the first outcome and moves no stock."
        onSubmit={d => larder.run('kit.sell', { itemId: text(d, 'itemId'), channel: text(d, 'channel'), eventId: text(d, 'eventId'), quantity: text(d, 'quantity'), locationId: text(d, 'locationId') })}>
        <Choose label="Kit sold" name="itemId" options={active.map(k => ({ value: k.itemId, label: itemName(s, k.itemId) }))} />
        <Field label="Channel" name="channel" defaultValue="shopify" />
        <Field label="Channel event id" name="eventId" />
        <Field label="Quantity" name="quantity" inputMode="decimal" defaultValue="1" />
        <Choose label="From" name="locationId" options={options(rows(s, 'locations').filter(l => !l.archived), r => r.name)} />
      </Form></Card>}
    </div>
    <Card title="Kit sales">{rows(s, 'kitSales').length === 0 ? <Empty>No kit sales yet.</Empty> :
      <Table head={['Sale', 'Channel event', 'Kit', 'Quantity', 'Components cost']} numeric={[3, 4]}>{[...rows(s, 'kitSales')].reverse().map(k => <tr key={k.id}><td>{k.reference}<small>Rev {k.kitRevision} · {words(k.mode)}</small></td><td>{k.channel} {k.eventId}</td><td>{itemName(s, k.itemId)}</td><td className="num">{qty(k.quantity)}</td><td className="num">{money(k.cost)}</td></tr>)}</Table>}</Card>
  </>
}
