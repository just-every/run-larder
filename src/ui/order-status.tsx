import { useState, type ChangeEvent } from 'react'
import { byId, can, itemName, type LarderState, type Rec } from './api'
import type { Larder } from './app'
import { Chip, Choose, Field, Form, text } from './controls'
import { day, qty, words } from './format'

type Kind = 'sales' | 'work'
type Supply = { kind: 'stock' | 'reservation' | 'purchase' | 'work'; documentId: string; reference: string; date: string; quantity: string }
type StatusLine = { id: string; itemId: string; ingredientStatus: string; productionStatus: string; required: string; available: string; missing: string; supplies: Supply[]; ingredients?: StatusLine[]; supplyingWork?: { documentId: string; quantity: string; lines: StatusLine[] }[] }
type OrderStatus = { id: string; rank: number; ingredientStatus: string; productionStatus: string; lines: StatusLine[] }
const materials = ['In stock', 'Expected', 'Not available', 'No BOM']
const production = ['not started', 'blocked', 'in progress', 'done', 'ready to ship']
const suppliesOf = (line: StatusLine): Supply[] => [...line.supplies, ...(line.ingredients ?? []).flatMap(suppliesOf), ...(line.supplyingWork ?? []).flatMap(work => work.lines.flatMap(suppliesOf))]

export function useOrderStatusList(s: LarderState, kind: Kind) {
  const [sort, setSort] = useState('rank'), [material, setMaterial] = useState('all'), [product, setProduct] = useState('all'), [maxRank, setMaxRank] = useState('')
  const statuses: OrderStatus[] = Array.isArray(s.orderStatuses?.[kind]) ? s.orderStatuses[kind] : []
  const status = (id: string) => statuses.find(x => x.id === id)
  const list = (records: Rec[]) => records.filter(record => {
    const current = status(record.id)
    return (material === 'all' || current?.ingredientStatus === material) && (product === 'all' || current?.productionStatus === product) && (!maxRank || current !== undefined && current.rank <= Number(maxRank))
  }).sort((a, b) => {
    const left = status(a.id), right = status(b.id)
    if (!left || !right) return left ? -1 : right ? 1 : a.id.localeCompare(b.id)
    const compared = sort === 'material' ? materials.indexOf(left.ingredientStatus) - materials.indexOf(right.ingredientStatus) : sort === 'production' ? production.indexOf(left.productionStatus) - production.indexOf(right.productionStatus) : 0
    return compared || left.rank - right.rank || a.id.localeCompare(b.id)
  })
  const prefix = kind === 'sales' ? 'SO' : 'MO'
  const controls = <div className="form-grid" role="group" aria-label={`${prefix} list controls`}>
    <Choose label={`${prefix} sort`} name={`${kind}-sort`} value={sort} onChange={(e: ChangeEvent<HTMLSelectElement>) => setSort(e.target.value)} options={[{ value: 'rank', label: 'Rank (lower first)' }, { value: 'material', label: 'Ingredient status' }, { value: 'production', label: 'Production status' }]} />
    <Field label={`${prefix} maximum rank`} name={`${kind}-max-rank`} type="number" min="1" step="1" required={false} value={maxRank} onChange={(e: ChangeEvent<HTMLInputElement>) => setMaxRank(e.target.value)} />
    <Choose label={`${prefix} ingredient status`} name={`${kind}-material`} value={material} onChange={(e: ChangeEvent<HTMLSelectElement>) => setMaterial(e.target.value)} options={[{ value: 'all', label: 'All ingredient statuses' }, ...materials.map(value => ({ value, label: value }))]} />
    <Choose label={`${prefix} production status`} name={`${kind}-production`} value={product} onChange={(e: ChangeEvent<HTMLSelectElement>) => setProduct(e.target.value)} options={[{ value: 'all', label: 'All production statuses' }, ...production.map(value => ({ value, label: words(value) }))]} />
  </div>
  return { status, list, controls }
}

function SupplyReferences({ supplies }: { supplies: Supply[] }) {
  const expected = supplies.filter(supply => ['purchase', 'work'].includes(supply.kind))
  const unique = expected.filter((supply, index) => expected.findIndex(other => other.kind === supply.kind && other.documentId === supply.documentId && other.date === supply.date) === index)
  return <>{unique.map(supply => <small key={`${supply.kind}:${supply.documentId}:${supply.date}`}><a href={`#make/${supply.kind === 'purchase' ? 'po' : 'wo'}/${supply.documentId}`}>{supply.reference}</a> · {supply.date ? day(supply.date) : 'Date not recorded'}</small>)}</>
}

function StatusSummary({ material, production: product, supplies }: { material: string; production: string; supplies: Supply[] }) {
  return <><Chip tone={material === 'In stock' ? 'good' : material === 'Expected' ? 'info' : 'warn'}>{material}</Chip> <Chip>{words(product)}</Chip>{material === 'Expected' && <SupplyReferences supplies={supplies} />}</>
}

function LineStatus({ line, s }: { line: StatusLine; s: LarderState }) {
  return <div>
    <strong>{itemName(s, line.itemId)}</strong><br />
    <StatusSummary material={line.ingredientStatus} production={line.productionStatus} supplies={suppliesOf(line)} />
    <small>Required {qty(line.required)} · Available {qty(line.available)} · Missing {qty(line.missing)}</small>
    {(line.ingredients ?? []).map((ingredient, index) => <LineStatus key={`${ingredient.id}:${index}`} line={ingredient} s={s} />)}
    {(line.supplyingWork ?? []).map(work => {
      const supply = line.supplies.find(source => source.kind === 'work' && source.documentId === work.documentId)
      return <section key={work.documentId} aria-label="Supplying work component coverage">
        <p className="muted">Supplying work component coverage · <a href={`#make/wo/${work.documentId}`}>{supply?.reference ?? byId(s, 'workOrders', work.documentId)?.reference ?? 'Work order'}</a> · {qty(work.quantity)} {itemName(s, line.itemId)}</p>
        {work.lines.map(component => <LineStatus key={component.id} line={component} s={s} />)}
      </section>
    })}
  </div>
}

export function OrderStatusDisplay({ status, s }: { status?: OrderStatus; s: LarderState }) {
  if (!status) return <span className="muted">Status not available.</span>
  return <div>
    <StatusSummary material={status.ingredientStatus} production={status.productionStatus} supplies={status.lines.flatMap(suppliesOf)} />
    {status.lines.map(line => <LineStatus key={line.id} line={line} s={s} />)}
  </div>
}

export function OrderRank({ status }: { status?: OrderStatus }) {
  return <small>{status ? `Rank ${status.rank}` : 'Rank not available'}</small>
}

export function OrderStatusActions({ larder, order, kind, status }: { larder: Larder; order: Rec; kind: Kind; status?: OrderStatus }) {
  const s = larder.state!
  const open = kind === 'sales' ? ['quote', 'confirmed', 'part shipped'].includes(order.status) : ['draft', 'released'].includes(order.status)
  if (!can(s, ['manager', 'production']) || !open) return null
  return <details>
    <summary>Update {order.reference}</summary>
    <p className="muted">Lower ranks receive available supply first. Changing rank preserves existing reservations and customer promises.</p>
    <Form submit="Save rank" busy={larder.busy} onSubmit={d => larder.run('order.rank', { kind, orderId: order.id, version: order.version, rank: Number(text(d, 'rank')) })}>
      <Field key={status?.rank} label={`${order.reference} rank`} name="rank" type="number" min="1" max="1000000" step="1" defaultValue={status?.rank} />
    </Form>
    {kind === 'work' && <Form submit="Save expected completion" busy={larder.busy} onSubmit={d => larder.run('work.expected', { workOrderId: order.id, version: order.version, expectedOn: text(d, 'expectedOn') })}>
      <Field key={order.expectedOn ?? order.requiredBy} label={`${order.reference} expected completion`} name="expectedOn" type="date" defaultValue={order.expectedOn ?? order.requiredBy} />
    </Form>}
  </details>
}
