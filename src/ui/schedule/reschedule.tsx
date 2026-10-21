import { useState } from 'react'
import { can, rows } from '../api'
import type { Larder } from '../app'
import { Area, Card, Choose, Field, Form, Table, text } from '../controls'

export function FiniteReschedule({ larder, plan }: { larder: Larder; plan: any }) {
  const s = larder.state!, [picked, setPicked] = useState('')
  const jobs = rows(s, 'workOrders').filter(w => ['draft', 'released'].includes(w.status) && !w.operationStates?.some((t: any) => ['running', 'paused'].includes(t.status)))
  const pending = [...rows(s, 'proposals')].reverse().find(p => p.status === 'awaiting approval' && p.context?.capacity && p.snapshotVersion + 1 === s.version)
  const approved = [...rows(s, 'proposals')].reverse().find(p => p.status === 'approved' && p.context?.capacity)
  const prepare = (id: string, priority: number, plannedStart: string, reason: string) => larder.run('proposal.prepare', { kind: 'reschedule', summary: reason, evidence: [reason], plan: { changes: [{ workOrderId: id, plannedStart, priority }], capacity: { asOf: plan.asOf, days: plan.horizonDays, reason } } })
  const allowed = can(s, ['manager', 'production', 'planner', 'agent'])
  return <Card title="Move work in finite capacity">
    <p>Drag a pending job onto another to preview it first, or use the date and priority controls with mouse or keyboard. Preview includes downstream jobs and promise risk. Running work keeps its place. Customer promises stay unchanged.</p>
    {allowed && <>
      <div className="actions" aria-label="Drag pending jobs to move before another">{jobs.map(w => <button type="button" className="button" draggable key={w.id} onDragStart={e => e.dataTransfer.setData('text/plain', w.id)} onDragOver={e => e.preventDefault()} onDrop={e => {
        e.preventDefault(); const id = e.dataTransfer.getData('text/plain')
        if (id !== w.id && jobs.some(j => j.id === id)) void prepare(id, Math.min(1000000, (w.priority ?? 0) + 1), w.plannedStart || plan.asOf.slice(0, 10), `Move ${jobs.find(j => j.id === id)!.reference} before ${w.reference}`)
      }}>{w.reference}</button>)}</div>
      <Form submit="Preview finite move" busy={larder.busy} onSubmit={d => prepare(text(d, 'job'), Number(text(d, 'priority')), text(d, 'start'), text(d, 'reason'))}>
        <Choose label="Move work order" name="job" options={jobs.map(w => ({ value: w.id, label: w.reference }))} value={picked} onChange={(e: any) => setPicked(e.target.value)} />
        <Field label="Move not before date" name="start" type="date" defaultValue={plan.asOf.slice(0, 10)} />
        <Field label="Move priority" name="priority" type="number" min="-1000000" max="1000000" defaultValue="1" />
        <Area label="Finite move reason" name="reason" />
      </Form>
    </>}
    {pending && <section aria-label="Finite reschedule review"><h3>{pending.summary}</h3>
      <p>Preview version {pending.version} · Planning state {pending.snapshotVersion} · Changed customer promises: {pending.context.capacity.changedPromiseCount}</p>
      <Table head={['Job', 'Before finish', 'After finish', 'Due and risk']}>
        {pending.context.capacity.effects.map((e: any) => <tr key={e.workOrderId}><td>{e.reference}</td><td>{e.before ?? 'Unscheduled'}</td><td>{e.after ?? 'Unscheduled'}</td><td>Due {e.dueAt.slice(0, 10)} · {e.unscheduledAfter ? 'Unscheduled' : e.lateAfter ? 'Late' : 'On time'}</td></tr>)}
      </Table>
      <p>Capacity conflicts: {pending.context.capacity.conflicts.length}. New unscheduled jobs: {pending.context.capacity.newUnscheduled.length}.</p>
      {pending.context.capacity.conflicts.map((c: any, i: number) => <p key={i}>{c.reference}: {c.reason}</p>)}
      <details><summary>Customer promise consequences</summary>{pending.context.capacity.promiseEffects.map((p: any, i: number) => <p key={i}>{p.reference} · retained promise {p.promiseDate} · {p.after.map((j: any) => `${j.reference}: ${j.endsAt ?? 'unscheduled'}${j.late ? ' (late)' : ''}`).join('; ') || 'No recorded finite work link'}</p>)}</details>
      {can(s, ['manager', 'production', 'planner']) && (pending.preparedBy !== s.actor.id || s.actor.role === 'owner') && <div className="actions"><button type="button" className="button primary" disabled={larder.busy || pending.context.capacity.conflicts.length > 0 || pending.context.capacity.newUnscheduled.length > 0} onClick={() => larder.run('proposal.approve', { proposalId: pending.id, version: pending.version, note: 'Reviewed finite intervals, displacement and unchanged customer promises' })}>Approve finite schedule</button><button type="button" className="button" disabled={larder.busy} onClick={() => larder.run('proposal.reject', { proposalId: pending.id, version: pending.version, note: 'Keep current finite sequence' })}>Keep current finite schedule</button></div>}
      <p>Any shop-floor, calendar or other state change makes this preview stale. A different authorized person approves, except the owner; agents never approve.</p>
    </section>}
    {approved && <details><summary>Approved finite schedule</summary><p>{approved.summary} · approval version {approved.version} · {approved.context.capacity.after.operations.length} reviewed named operations retained · customer promises unchanged.</p></details>}
  </Card>
}
