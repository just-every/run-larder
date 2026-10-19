import { useState } from 'react'
import { can, itemName, personName, rows } from './api'
import type { Larder } from './app'
import { Card, Choose, Empty, Field, Form, Table, text } from './controls'
import { qty, when, words } from './format'

export function DowntimeNotices({ larder }: { larder: Larder }) {
  const s = larder.state!
  if (!can(s, ['manager'])) return null
  const notices = (s.lostTimeReport ?? []).filter((d: any) => !d.acknowledgedAt && (s.actor.role === 'owner' || d.escalationOwnerId === s.actor.id))
  if (!notices.length) return null
  return <Card title="Downtime escalations recorded in app">{notices.map((d: any) => <article className="proposal" key={d.id}><h3><a href={`#make/wo/${d.workOrderId}`}>{d.workOrderReference} · {d.operationName}</a></h3><p>{words(d.reason)}: {d.note} · supervisor {personName(s, d.escalationOwnerId)}</p><p>Started {when(d.startedAt)} · {d.stoppedAt ? `stopped ${when(d.stoppedAt)}` : `estimated resume ${when(d.anticipatedResumeAt)}`}</p>
    <Form submit={`Acknowledge ${d.workOrderReference} downtime`} busy={larder.busy} onSubmit={data => larder.run('wo.operation.escalationAck', { workOrderId: d.workOrderId, version: d.version, sequence: d.sequence, downtimeId: d.id, note: text(data, 'note') })}><Field label={`${d.workOrderReference} supervisor note`} name="note" /></Form>
  </article>)}</Card>
}

export function DowntimeReport({ larder }: { larder: Larder }) {
  const s = larder.state!, [reason, setReason] = useState('all'), [job, setJob] = useState('all')
  const all: any[] = s.lostTimeReport ?? [], report = all.filter(d => (reason === 'all' || d.reason === reason) && (job === 'all' || d.workOrderId === job))
  if (!all.length) return null
  const total = report.reduce((n, r) => n + Number(r.elapsedMinutes), 0)
  return <Card title="Lost-time report"><p>Recorded intervals only · {qty(total)} lost minutes across {report.length} intervals · as of {when(all[0].asOf)}. Open intervals include elapsed time through this read.</p>
    <Choose label="Lost-time reason" name="lostReason" value={reason} onChange={(e: any) => setReason(e.target.value)} options={[{ value: 'all', label: 'All reasons' }, ...[...new Set(all.map(d => d.reason))].map(value => ({ value, label: words(value) }))]} />
    <Choose label="Lost-time work order" name="lostJob" value={job} onChange={(e: any) => setJob(e.target.value)} options={[{ value: 'all', label: 'All work orders' }, ...rows(s, 'workOrders').filter(w => all.some(d => d.workOrderId === w.id)).map(w => ({ value: w.id, label: w.reference }))]} />
    {!report.length ? <Empty>No intervals match these filters.</Empty> : <Table head={['Job / operation', 'Reason', 'Start / stop', 'Lost minutes', 'Operator / supervisor', 'Notice']} numeric={[3]}>{report.map(d => <tr key={d.id}><td><a href={`#make/wo/${d.workOrderId}`}>{d.workOrderReference}</a><small>{itemName(s, d.itemId)} · {d.operationName} · {d.workCentre}</small></td><td>{words(d.reason)}<small>{d.note}</small></td><td>{when(d.startedAt)}<small>{d.stoppedAt ? when(d.stoppedAt) : 'Still open'}</small></td><td>{qty(d.elapsedMinutes)}</td><td>{personName(s, d.operatorId)}<small>{personName(s, d.escalationOwnerId)}</small></td><td>{d.acknowledgedAt ? `Acknowledged ${when(d.acknowledgedAt)}` : 'Awaiting acknowledgment'}<small>Recorded in app</small></td></tr>)}</Table>}
  </Card>
}
