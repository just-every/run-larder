import { useState } from 'react'
import { can, itemName, personName, rows, unitOf, type Rec } from './api'
import type { Larder } from './app'
import { Card, Chip, Choose, Empty, Table } from './controls'
import { day, qty, words } from './format'
import { operationReadiness, WorkOperations } from './work-operations'

// FLOOR-001: the queue uses released snapshots and live task state. Material
// coverage is context; it does not claim an operation-level quality interlock.
export function Dispatch({ larder, onSignOut }: { larder: Larder; onSignOut: () => void | Promise<void> }) {
  const s = larder.state!, supervisor = can(s, ['manager'])
  const [scope, setScope] = useState('mine'), [filter, setFilter] = useState('all')
  const all = rows(s, 'workOrders').filter(w => w.status === 'released').flatMap(w => (w.routing ?? []).map((step: any) => {
    const task = w.operationStates?.find((t: any) => t.sequence === step.sequence) ?? { status: 'pending' }
    const readiness = operationReadiness(s, w, step)
    const rank = s.orderStatuses?.work?.find((r: any) => r.id === w.id)?.rank
    return { w, step, task, readiness, rank }
  })).sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || String(a.w.requiredBy).localeCompare(String(b.w.requiredBy)) || a.w.id.localeCompare(b.w.id) || a.step.sequence - b.step.sequence)
  const selected = all.filter(({ task }) => scope === 'all' && supervisor || task.assignment?.operatorId === s.actor.id)
  const list = selected.filter(({ task, readiness }) => filter === 'all' || filter === 'ready' && task.status === 'pending' && readiness.reasons.length === 0 || filter === 'blocked' && task.status === 'pending' && readiness.reasons.length > 0 || filter === task.status)
  return <div className="dispatch page">
    <header className="page-head"><p className="eyebrow">Shop floor</p><h1>Dispatch</h1><p className="subtitle">{s.actor.name} · {words(s.actor.role)}</p><p className="meta">Assigned operations in priority order. Read the pinned instructions and check the physical station before starting.</p></header>
    <Card title="Shared station" aside={<button className="button" type="button" disabled={larder.busy} onClick={() => void onSignOut()}>Sign out shared station</button>}>
      <p>Working as <strong>{s.actor.name}</strong>. Sign out when handing this station to another person; the next operator signs in with their own account.</p>
      <div className="actions"><button className="button" type="button" disabled={larder.busy} onClick={() => void larder.refresh().catch(() => larder.setNotice('Records could not refresh. Reload before working.'))}>Refresh dispatch</button></div>
      <p className="muted">{larder.loadedAt ? `Loaded ${larder.loadedAt.toLocaleTimeString()}. Refresh to see another operator’s latest work.` : 'Loading current work.'}</p>
    </Card>
    <Card title="Operation queue">
      <div className="form-grid">
        {supervisor && <Choose label="Dispatch assignments" name="dispatchScope" value={scope} onChange={(e: any) => setScope(e.target.value)} options={[{ value: 'mine', label: 'Assigned to me' }, { value: 'all', label: 'All operations' }]} />}
        <Choose label="Dispatch status" name="dispatchStatus" value={filter} onChange={(e: any) => setFilter(e.target.value)} options={[{ value: 'all', label: 'All statuses' }, { value: 'ready', label: 'Ready to start' }, { value: 'blocked', label: 'Blocked' }, { value: 'running', label: 'Running' }, { value: 'paused', label: 'Paused' }, { value: 'done', label: 'Done' }]} />
      </div>
      <p className="meta">{selected.filter(t => t.task.status === 'pending' && !t.readiness.reasons.length).length} ready · {selected.filter(t => t.task.status === 'pending' && t.readiness.reasons.length).length} blocked · {selected.filter(t => ['running', 'paused'].includes(t.task.status)).length} active</p>
      {!list.length && <Empty>{selected.length ? 'No assigned operations match this status.' : supervisor && scope === 'mine' ? 'No operations are assigned to you. Choose All operations to dispatch work to a named person.' : 'No operations are assigned to you. Ask a manager to assign released work.'}</Empty>}
    </Card>
    {list.map(({ w, step, task, readiness, rank }) => <Card key={`${w.id}:${step.sequence}`} title={<><a href={`#make/wo/${w.id}`}>{w.reference}</a> · {step.name}</>} aside={<Chip tone={task.status === 'done' ? 'good' : readiness.reasons.length && task.status === 'pending' ? 'warn' : 'info'}>{task.status === 'pending' ? readiness.reasons.length ? 'Blocked' : 'Ready' : words(task.status)}</Chip>}>
      <p className="meta">Priority {rank ?? 'unranked'} · needed {day(w.requiredBy)} · BOM revision {w.bomRevision}</p>
      <p><strong>{itemName(s, w.itemId)}</strong> · job quantity {qty(w.quantity)} {unitOf(s, w.itemId)} · good output {qty(w.output)} · scrap {qty(w.scrap)}</p>
      <p>Assigned operator: {task.assignment ? personName(s, task.assignment.operatorId) : 'Unassigned'}</p>
      <DispatchMaterials larder={larder} w={w} />
      <WorkOperations larder={larder} w={w} sequence={step.sequence} />
    </Card>)}
  </div>
}

function DispatchMaterials({ larder, w }: { larder: Larder; w: Rec }) {
  const s = larder.state!, coverage = s.orderStatuses?.work?.find((r: any) => r.id === w.id)
  return <details><summary>Materials and quality context · {coverage?.ingredientStatus ?? 'Coverage not available'}</summary>
    <Table head={['Material', 'Required', 'Issued', 'Reserved']} numeric={[1, 2, 3]}>{(w.components ?? []).map((line: any) => <tr key={line.id}><td>{itemName(s, line.itemId)}</td><td className="num">{qty(line.required)} {unitOf(s, line.itemId)}</td><td className="num">{qty(line.issued)}</td><td className="num">{rows(s, 'reservations').filter(r => r.demandId === w.id && r.lineId === line.id).map(r => qty(r.quantity)).join(' + ') || '0'}</td></tr>)}</Table>
    <p className="muted">Material availability and issue quantities are shown for review. Operation-specific material and quality release checks are not configured.</p>
    {rows(s, 'certificatePolicies').filter(p => p.itemId === w.itemId && !p.customerId && p.types.length).map(p => <p key={p.id}>Finished-output documents required: {p.types.map(words).join(', ')}. Output enters quarantine until the required lot documents are approved and a person releases it.</p>)}
  </details>
}
