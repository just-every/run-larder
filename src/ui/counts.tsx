import { useState, type ChangeEvent } from 'react'
import { can, itemName, locationName, personName, rows, sku, unitOf, type LarderState, type Rec } from './api'
import type { Larder } from './app'
import { Area, Card, Chip, Choose, Details, Empty, Field, Form, Table, options, text } from './controls'
import { day, money, qty, when, words } from './format'

const lotName = (s: LarderState, id: string) => rows(s, 'lots').find(l => l.id === id)?.code ?? '—'

export function BlindCounts({ larder }: { larder: Larder }) {
  const s = larder.state!, sessions = rows(s, 'countSessions')
  return <div className="page">
    <header className="page-head"><p className="eyebrow">Stock</p><h1>Blind counts</h1><p className="meta">Count the physical stock in your assigned bin. Movements can continue during counting; a changed position needs a fresh count before approval.</p></header>
    {sessions.length === 0 && <Card title="Assigned counts"><Empty>No count sessions assigned to you.</Empty></Card>}
    {sessions.map(session => <Card key={session.id} title={session.reference} aside={<Chip>{words(session.status)}</Chip>}>
      <p className="muted">{locationName(s, session.locationId)} · {day(session.scheduledOn)}</p>
      {session.lines.map((line: Rec) => <div key={line.id}>
        <h3>{itemName(s, line.itemId)}</h3><p className="muted">{sku(s, line.itemId)} · {unitOf(s, line.itemId)} · Lot {lotName(s, line.lotId)} · {words(line.status)}</p>
        {['pending', 'recount required'].includes(line.status) && <Form submit={line.status === 'recount required' ? 'Submit fresh count' : 'Submit count'} busy={larder.busy} onSubmit={d => {
          const serials = text(d, 'serials').split(/[\n,]+/).map(v => v.trim()).filter(Boolean)
          return larder.run('count.submit', { sessionId: session.id, lineId: line.id, version: session.version, counted: text(d, 'counted'), note: text(d, 'note'), ...(serials.length ? { serials } : {}) })
        }}>
          <Field label="Counted quantity" name="counted" inputMode="decimal" autoComplete="off" />
          <Field label="Count note" name="note" required={false} />
          <Area label="Serial IDs (one per line or separated by commas)" name="serials" required={false} />
        </Form>}
      </div>)}
    </Card>)}
  </div>
}

export function CountSessions({ larder }: { larder: Larder }) {
  const s = larder.state!, [basis, setBasis] = useState('bin')
  if (!can(s, ['manager'])) return null
  const sessions = rows(s, 'countSessions')
  const counters = options(rows(s, 'people').filter(p => p.role === 'warehouse'), p => p.name)
  return <Card title="Cycle counts and stocktake">
    <p className="muted">Reconcile mode: stock movements remain permitted. A stale count must be recounted. Variances above tolerance need a second blind count, and every session adjustment needs approval by someone other than its counter.</p>
    <Form title="Schedule a blind count" submit="Schedule count" busy={larder.busy} note="Leave Item blank to include all matching positions in the location. Risk sets the priority of the selected items." onSubmit={d => larder.run('count.schedule', {
      locationId: text(d, 'locationId'), scheduledOn: text(d, 'scheduledOn'), basis: text(d, 'basis'), counterId: text(d, 'counterId'), recountTolerance: text(d, 'recountTolerance'),
      ...(text(d, 'itemId') ? { itemId: text(d, 'itemId') } : {}),
      ...(basis === 'value' ? { minimumValue: text(d, 'minimumValue') } : {}),
      ...(basis === 'risk' ? { risk: text(d, 'risk') } : {}),
    })}>
      <Choose label="Count location" name="locationId" options={options(rows(s, 'locations').filter(l => !l.archived), l => l.name)} />
      <Field label="Scheduled on" name="scheduledOn" type="date" />
      <Choose label="Counting basis" name="basis" value={basis} onChange={(e: ChangeEvent<HTMLSelectElement>) => setBasis(e.target.value)} options={[{ value: 'bin', label: 'Bin' }, { value: 'value', label: 'Value' }, { value: 'risk', label: 'Risk' }]} />
      <Choose label="Assigned counter" name="counterId" options={counters} />
      <Choose label="Item (optional)" name="itemId" required={false} options={options(rows(s, 'items').filter(i => !i.archived), i => `${i.name} · ${i.sku}`)} />
      <Field label="Recount tolerance (quantity)" name="recountTolerance" defaultValue="0" inputMode="decimal" />
      {basis === 'value' && <Field label="Minimum position value" name="minimumValue" defaultValue="0" inputMode="decimal" />}
      {basis === 'risk' && <Choose label="Item risk" name="risk" defaultValue="high" options={['high', 'medium', 'low'].map(value => ({ value, label: words(value) }))} />}
    </Form>
    {counters.length === 0 && <Empty>Add a warehouse team member before assigning a blind count.</Empty>}
    {sessions.length === 0 ? <Empty>No count sessions scheduled yet.</Empty> : sessions.map(session => <Session key={session.id} session={session} larder={larder} />)}
  </Card>
}

function Session({ session, larder }: { session: Rec; larder: Larder }) {
  const s = larder.state!
  return <section>
    <h3>{session.reference} <Chip>{words(session.status)}</Chip></h3>
    <p className="muted">{locationName(s, session.locationId)} · {day(session.scheduledOn)} · {words(session.basis)} basis · Counter: {personName(s, session.counterId)} · Recount tolerance: {qty(session.recountTolerance)}</p>
    <Table head={['Item / lot', 'Risk', 'System', 'Counted', 'Quantity variance', 'Value variance', 'Status']} numeric={[2, 3, 4, 5]}>
      {session.lines.map((line: Rec) => {
        const count = rows(s, 'counts').find(c => c.id === line.countId)
        return <tr key={line.id}><td><strong>{itemName(s, line.itemId)}</strong><small>{lotName(s, line.lotId)}</small></td><td>{words(line.risk)}</td><td className="num">{qty(count ? count.system : line.system)}</td><td className="num">{count ? qty(count.counted) : '—'}</td><td className="num">{count ? qty(count.variance) : '—'}</td><td className="num">{count ? money(count.valueVariance) : '—'}</td><td><Chip tone={line.status === 'approved' ? 'good' : 'warn'}>{words(line.status)}</Chip></td></tr>
      })}
    </Table>
    {session.lines.map((line: Rec) => <Reconciliation key={line.id} line={line} session={session} larder={larder} />)}
  </section>
}

function Reconciliation({ line, session, larder }: { line: Rec; session: Rec; larder: Larder }) {
  const s = larder.state!, counts = rows(s, 'counts')
  const current = counts.find(c => c.id === line.countId)
  const history = line.attempts.map((id: string) => counts.find(c => c.id === id)).filter(Boolean) as Rec[]
  const awaiting = line.status === 'awaiting approval' && current?.status === 'awaiting approval'
  return <div>
    <h4>{itemName(s, line.itemId)} · Lot {lotName(s, line.lotId)}</h4>
    <p className="muted">Scheduled position: {qty(line.system)} · Unit cost: {money(line.unitCost)} · Position value: {money(line.value)}</p>
    {history.length > 0 && <Details label={`Count history (${history.length})`} s={s} value={history.map(c => ({ reference: c.reference, countedAt: when(c.createdAt), counter: personName(s, c.createdBy), system: c.system, counted: c.counted, quantityVariance: c.variance, unitCost: c.unitCost, valueVariance: c.valueVariance, status: c.status, note: c.note, serials: c.serials }))} />}
    {awaiting && current && current.createdBy !== s.actor.id && <Form submit="Approve adjustment" busy={larder.busy} onSubmit={d => larder.run('count.approve', { countId: current.id, version: current.version, note: text(d, 'note') })}>
      <Field label="Approval note" name="note" required={false} />
    </Form>}
    {awaiting && current && current.createdBy === s.actor.id && <p className="muted">Another manager must approve this count.</p>}
    {awaiting && current && <Form submit="Reject count" quiet busy={larder.busy} onSubmit={d => larder.run('count.reject', { countId: current.id, version: current.version, note: text(d, 'note') })}>
      <Field label="Rejection reason" name="note" />
    </Form>}
    {current && line.status !== 'approved' && <Form submit="Request fresh count" quiet busy={larder.busy} note="Use after a stale result or when the physical count needs checking again." onSubmit={d => larder.run('count.recount', { sessionId: session.id, lineId: line.id, version: session.version, note: text(d, 'note') })}>
      <Field label="Recount reason" name="note" />
    </Form>}
  </div>
}
