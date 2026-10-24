// ENG-003: configure a made item on the quote (sizes, finishes, dimensions, options), compare the resolved BOM and cost
// line by line, and keep the configuration rules as saved revisions.
import { useState } from 'react'
import { can, itemName, rows, type LarderState, type Rec } from './api'
import type { Larder } from './app'
import { Area, Card, Chip, Choose, Empty, Field, Form, Table, options, text } from './controls'
import { day, money, qty } from './format'

type Choice = { attributes: Record<string, string>; dimensions: Record<string, string>; options: Record<string, boolean> }
type Resolved = { itemId: string; revision: number; selection: Choice; components: any[]; routing: any[]; cost: { materials: string; extra: string; unit: string; extras: any[] }; explanation: string }
type Line = { itemId: string; quantity: string; unitPrice: string; selection: Choice; resolved: Resolved }
const empty: Choice = { attributes: {}, dimensions: {}, options: {} }

async function resolve(itemId: string, selection: Choice): Promise<Resolved> {
  const res = await fetch(`/api/larder/configurations/resolve?itemId=${encodeURIComponent(itemId)}&selection=${encodeURIComponent(JSON.stringify(selection))}`, { credentials: 'same-origin', cache: 'no-store' })
  const body: any = await res.json()
  if (!res.ok) throw new Error(body?.error?.message ?? 'This configuration could not be resolved.')
  return body
}

// What one configuration makes, with the rule and arithmetic behind each figure.
export function Resolution({ s, r }: { s: LarderState; r: Resolved }) {
  return <div className="resolution">
    <p><strong>{r.explanation}</strong><small> Rules revision {r.revision} · {money(r.cost.unit)} each</small></p>
    <Table head={['Component', 'Per unit', 'Cost', 'Because']} numeric={[1, 2]}>{r.components.map(l => <tr key={l.itemId}><td>{itemName(s, l.itemId)}</td><td className="num">{qty(l.quantity)}</td><td className="num">{money(l.cost)}</td><td>{l.because.map((b: any) => `${b.rule}: ${b.formula}`).join('; ')}</td></tr>)}</Table>
    {r.routing.length > 0 && <Table head={['Step', 'Work center', 'Minutes', 'Because']} numeric={[2]}>{r.routing.map(x => <tr key={x.sequence}><td>{x.name}</td><td>{x.workCentre}</td><td className="num">{qty(String(x.runMinutes))}</td><td>{x.because?.rule}: {x.because?.run}</td></tr>)}</Table>}
    {r.cost.extras.length > 0 && <p className="muted">Added cost: {r.cost.extras.map((x: any) => `${x.rule} ${money(x.amount)} (${x.formula})`).join('; ')}</p>}
  </div>
}

export function ConfigureQuote({ larder }: { larder: Larder }) {
  const s = larder.state!, models = rows(s, 'configModels').filter(m => m.status === 'active')
  const [itemId, setItemId] = useState(''), [choice, setChoice] = useState<Choice>(empty), [quantity, setQuantity] = useState('1'), [price, setPrice] = useState('')
  const [lines, setLines] = useState<Line[]>([]), [problem, setProblem] = useState(''), [checked, setChecked] = useState<Resolved | null>(null)
  const [adding, setAdding] = useState(false)
  const model = models.find(m => m.itemId === itemId)
  if (!can(s, ['manager', 'sales']) || models.length === 0) return null
  const pick = (id: string) => { setItemId(id); setChoice(empty); setChecked(null); setProblem('') }
  const set = (kind: keyof Choice, name: string, value: string | boolean) => { setChoice({ ...choice, [kind]: { ...choice[kind], [name]: value } }); setChecked(null); setProblem('') }
  async function check() {
    try { setChecked(await resolve(itemId, choice)); setProblem('') } catch (e) { setChecked(null); setProblem((e as Error).message) }
  }
  async function add() {
    setAdding(true)
    try { const resolved = await resolve(itemId, choice); setLines(current => [...current, { itemId, quantity, unitPrice: price, selection: choice, resolved }]); setChecked(null); setProblem('') } catch (e) { setProblem((e as Error).message) }
    finally { setAdding(false) }
  }
  const complete = !!model && model.attributes.every((a: any) => choice.attributes[a.name]) && model.dimensions.every((d: any) => choice.dimensions[d.name])
  return <Card title="Configured quote">
    <Form submit="Save configured quote" busy={larder.busy || adding} note="Choose sizes, finishes and options, compare what each configuration makes and costs, then save them as one quote. The resolved configuration is pinned on each line."
      onSubmit={async d => { if (!lines.length) { setProblem('Add at least one configured line.'); return false } const r = await larder.run('so.quote', { customerId: text(d, 'customerId'), promiseDate: text(d, 'promiseDate'), lines: lines.map(l => ({ itemId: l.itemId, quantity: l.quantity, ...(l.unitPrice ? { unitPrice: l.unitPrice } : {}), configuration: { selection: l.selection } })) }); if (r) { setLines([]); window.location.hash = `orders/${r.id}` } return r }}>
      <Choose label="Customer" name="customerId" options={options(rows(s, 'parties').filter(p => p.kind !== 'supplier'), r => r.name)} />
      <Field label="Promise date" name="promiseDate" type="date" />
      <fieldset className="lines wide"><legend>Configure a line</legend>
        <Choose label="Configurable item" name="cfgItem" value={itemId} onChange={(e: any) => pick(e.target.value)} options={models.map(m => ({ value: m.itemId, label: itemName(s, m.itemId) }))} />
        {model && <>
          {model.attributes.map((a: any) => <Choose key={a.name} label={a.name} name={`cfg.${a.name}`} value={choice.attributes[a.name] ?? ''} onChange={(e: any) => set('attributes', a.name, e.target.value)} options={a.values.map((v: string) => ({ value: v, label: v }))} />)}
          {model.dimensions.map((d: any) => <Field key={d.name} label={`${d.name} (${d.unit}, ${d.min} to ${d.max})`} name={`cfg.${d.name}`} inputMode="decimal" value={choice.dimensions[d.name] ?? ''} onChange={(e: any) => set('dimensions', d.name, e.target.value)} />)}
          {model.options.map((o: any) => <label key={o.name} className="field"><span>{o.name}</span><input type="checkbox" aria-label={o.name} checked={choice.options[o.name] ?? false} onChange={e => set('options', o.name, e.target.checked)} /></label>)}
          <Field label="Quantity" name="cfgQuantity" inputMode="decimal" value={quantity} onChange={(e: any) => setQuantity(e.target.value)} />
          <Field label="Unit price" name="cfgPrice" inputMode="decimal" required={false} hint="Blank uses the list price" value={price} onChange={(e: any) => setPrice(e.target.value)} />
          <div className="actions"><button type="button" className="button" disabled={!complete || larder.busy || adding} onClick={() => void check()}>Check this configuration</button><button type="button" className="button" disabled={!complete || larder.busy || adding} onClick={() => void add()}>Add to quote</button></div>
        </>}
      </fieldset>
      {problem && <p role="status" className="notice">{problem}</p>}
      {checked && <div className="wide"><Resolution s={s} r={checked} /></div>}
      {lines.length > 0 && <div className="wide"><h3>Lines compared</h3>
        <div className="compare">{lines.map((l, i) => <section key={i} className="card" aria-label={`Configured line ${i + 1}`}><p><strong>{qty(l.quantity)} × {itemName(s, l.itemId)}</strong> <button type="button" className="link" onClick={() => setLines(current => current.filter((_, j) => j !== i))}>Remove</button></p><Resolution s={s} r={l.resolved} /></section>)}</div></div>}
    </Form>
  </Card>
}

// The pinned configuration of an order line or work order, in words.
export function ConfigurationNote({ s, c }: { s: LarderState; c: Resolved & { modelId: string } }) {
  return <p className="muted">Configured: {c.explanation} · rules revision {c.revision} · {money(c.cost.unit)} each · {c.components.map(l => `${qty(l.quantity)} ${itemName(s, l.itemId)}`).join(', ')}</p>
}

// Engineers keep the rules as data: each save is the next revision; quotes and work keep the revision they pinned.
export function ConfigModels({ larder }: { larder: Larder }) {
  const s = larder.state!, made = rows(s, 'items').filter(i => i.kind === 'make' && !i.archived), [itemId, setItemId] = useState('')
  if (!can(s, ['manager', 'production', 'engineer']) || made.length === 0) return null
  const current = rows(s, 'configModels').filter(m => m.status === 'active')
  const template = (id: string) => { const m = current.find(x => x.itemId === id); return JSON.stringify(m ? { attributes: m.attributes, dimensions: m.dimensions, options: m.options, rules: m.rules.map(({ id: _id, ...r }: Rec) => r), invalid: m.invalid.map(({ id: _id, ...r }: Rec) => r) } : { attributes: [{ name: 'Size', values: ['Small', 'Large'] }], dimensions: [{ name: 'length', unit: 'mm', min: '100', max: '600' }], options: [], rules: [{ name: 'Blank', components: [{ itemId: '<component item id>', quantity: 'length / 100' }] }], invalid: [] }, null, 2) }
  return <>
    <Card title="Configuration rules">{current.length === 0 ? <Empty>No configurable items yet.</Empty> :
      <Table head={['Item', 'Revision', 'Choices', 'Rules']}>{current.map(m => <tr key={m.id}><td>{itemName(s, m.itemId)}</td><td>Rev {m.revision}<small>{day(m.approvedAt)}</small></td><td>{[...m.attributes.map((a: any) => `${a.name}: ${a.values.join('/')}`), ...m.dimensions.map((d: any) => `${d.name} ${d.min}-${d.max} ${d.unit}`), ...m.options.map((o: any) => o.name)].join('; ')}</td><td>{m.rules.length} rules{m.invalid.length > 0 && <> · <Chip tone="warn">{m.invalid.length} refused combinations</Chip></>}</td></tr>)}</Table>}</Card>
    <Card title="Save configuration rules"><Form submit="Save as the next revision" busy={larder.busy} note="Formulas use dimension and option names with + - * / and parentheses. A saved revision never changes; quotes and released work keep the revision they pinned."
      onSubmit={d => { let definition: object; try { definition = JSON.parse(text(d, 'definition')) } catch { return larder.run('config.save', { invalid: 'definition' }) } return larder.run('config.save', { itemId: text(d, 'itemId'), note: text(d, 'note'), ...definition }) }}>
      <Choose label="Made item" name="itemId" value={itemId} onChange={(e: any) => setItemId(e.target.value)} options={options(made, r => `${r.name} · ${r.sku}`)} />
      <Field label="Change note" name="note" required={false} />
      <Area label="Definition" name="definition" key={itemId} defaultValue={template(itemId)} />
    </Form></Card>
  </>
}
