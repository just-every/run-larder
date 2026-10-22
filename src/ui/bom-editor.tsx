import { EngineeringChanges } from './engineering'
import { can, itemName, rows, unitOf, type LarderState } from './api'
import type { Larder } from './app'
import { Card, Chip, Choose, Empty, Field, Form, Table, options, readLines, text } from './controls'
import { day, qty, words } from './format'
import { RoutingEditor, routingFromForm } from './routing-editor'
import { ConfigModels } from './configure'

export function Boms({ larder }: { larder: Larder }) {
  const s = larder.state!, made = rows(s, 'items').filter(i => i.kind === 'make')
  return <><Card title="Bills of materials">{rows(s, 'boms').length === 0 ? <Empty>No bills of materials yet.</Empty> :
    <Table head={['Item', 'Revision', 'Components', 'Routing', 'Status']}>{[...rows(s, 'boms')].reverse().map(b => <tr key={b.id}><td>{itemName(s, b.itemId)}</td><td>Rev {b.revision}<small>Effective {b.effectiveOn ? day(b.effectiveOn) : 'immediately'} · yield {qty(b.yield ?? '1')}</small></td><td>{b.components.map((c: any) => `${qty(c.quantity)} ${unitOf(s, c.itemId)} ${itemName(s, c.itemId)} (${c.supply ?? rows(s, 'items').find(i => i.id === c.itemId)?.kind ?? 'buy'})`).join(', ')}</td><td>{b.routing.map((r: any) => r.name).join(' → ') || '—'}</td><td><Chip tone={b.status === 'active' ? 'good' : 'neutral'}>{words(b.status)}</Chip></td></tr>)}</Table>}</Card>
    {can(s, ['manager', 'production', 'engineer']) && made.length > 0 && <Card title="New revision"><Form submit="Save new revision" busy={larder.busy} note="Saving creates the next revision. Released work keeps the revision it was released with." onSubmit={async d => larder.run('bom.revise', { itemId: text(d, 'itemId'), note: text(d, 'note'), yield: text(d, 'yield'), effectiveOn: text(d, 'effectiveOn'), components: readLines(d).map(l => ({ itemId: l.itemId, quantity: l.quantity, unit: l.unitPrice, supply: l.supply || undefined })), routing: await routingFromForm(d) })}>
      <Choose label="Item" name="itemId" options={options(made, r => `${r.name} · ${r.sku}`)} /><Field label="Change note" name="note" required={false} />
      <Field label="Yield fraction" name="yield" defaultValue="1" inputMode="decimal" hint="More than 0, at most 1; requirements round upward to six places." /><Field label="Effective on (UTC)" name="effectiveOn" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /><BomLines s={s} /><RoutingEditor /></Form></Card>}<ConfigModels larder={larder} /><EngineeringChanges larder={larder} /></>
}
function BomLines({ s }: { s: LarderState }) {
  return <fieldset className="lines wide"><legend>Components per one finished unit</legend>{[0, 1, 2, 3].map(i => <div className="line" key={i}><Choose label={`Component ${i + 1}`} name={`lines.${i}.itemId`} options={options(rows(s, 'items'), r => `${r.name} · ${r.sku}`)} required={i === 0} /><Field label="Quantity" name={`lines.${i}.quantity`} inputMode="decimal" required={false} /><Field label="Unit" name={`lines.${i}.unitPrice`} required={false} hint="Blank uses the base unit" /><Choose label={`Supply ${i + 1}`} name={`lines.${i}.supply`} required={false} options={[{ value: "", label: "Item make/buy default" }, { value: "make", label: "Make" }, { value: "buy", label: "Buy" }, { value: "phantom", label: "Phantom (explode directly)" }]} /></div>)}</fieldset>
}
