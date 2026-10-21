import { activeMaintenance } from '../larder/maintenance-availability'
import { can, personName, rows, type Rec } from './api'
import type { Larder } from './app'
import { Choose, Field, Form, text } from './controls'
import { qty, when, words } from './format'
const reasonOptions = [ ['breakdown', 'Breakdown'], ['waiting-material', 'Waiting material'], ['changeover', 'Changeover'], ['quality', 'Quality'], ['other', 'Other lost time'] ].map(([value, label]) => ({ value, label }))
const localTime = () => { const d = new Date(Date.now() + 3600000); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }

export function WorkDowntime({ larder, w, task, sequence }: { larder: Larder; w: Rec; task: any; sequence: number }) {
  const s = larder.state!, active = ['running', 'paused'].includes(task.status), supervisor = can(s, ['manager'])
  const report = active && can(s, ['manager', 'production', 'operator']) && (supervisor || task.startedBy === s.actor.id)
  const maintenance = activeMaintenance({ maintenance: rows(s, 'maintenance') }, task.workCentre, new Date().toISOString())
  const payload = { workOrderId: w.id, version: w.version, sequence }
  return <section aria-label={`Step ${sequence} progress and downtime`}>
    {task.progress && <p>Reported operation progress: {qty(task.progress.completedQuantity)} of {qty(w.quantity)} · {qty(task.progress.remainingMinutes)} job minutes remaining · {personName(s, task.progress.by)} {when(task.progress.at)}. This report does not post finished stock.</p>}
    {(task.downtime ?? []).map((d: any) => <div className="proposal" key={d.id}><p><strong>{words(d.reason)}</strong>: {d.note}</p><p>Started {when(d.startedAt)}{d.stoppedAt ? ` · stopped ${when(d.stoppedAt)}` : ` · estimated resume ${when(d.anticipatedResumeAt)}`}</p>
      <p>Escalation to {personName(s, d.escalationOwnerId)} · recorded in app{d.acknowledgedAt ? ` · acknowledged by ${personName(s, d.acknowledgedBy)} ${when(d.acknowledgedAt)}: ${d.acknowledgedNote}` : ' · awaiting acknowledgment'}</p>
      {!d.acknowledgedAt && supervisor && (s.actor.role === 'owner' || d.escalationOwnerId === s.actor.id) && <Form submit={`Acknowledge step ${sequence} downtime notice`} busy={larder.busy} onSubmit={data => larder.run('wo.operation.escalationAck', { ...payload, downtimeId: d.id, note: text(data, 'note') })}><Field label={`Step ${sequence} supervisor acknowledgment`} name="note" /></Form>}
    </div>)}
    {report && task.status === 'running' && <Form title={`Step ${sequence} lost time`} submit={`Pause step ${sequence}`} busy={larder.busy} onSubmit={data => larder.run('wo.operation.pause', { ...payload, reason: text(data, 'reason'), note: text(data, 'note'), escalationOwnerId: text(data, 'supervisor'), anticipatedResumeAt: new Date(text(data, 'resume')).toISOString() })}>
      <Choose label={`Step ${sequence} downtime reason`} name="reason" options={reasonOptions} /><Field label={`Step ${sequence} downtime note`} name="note" />
      <Choose label={`Step ${sequence} escalation owner`} name="supervisor" options={rows(s, 'people').filter(p => ['owner', 'manager'].includes(p.role)).map(p => ({ value: p.id, label: p.name }))} />
      <Field label={`Step ${sequence} estimated resume (local time)`} name="resume" type="datetime-local" defaultValue={localTime()} />
    </Form>}
    {report && task.status === 'paused' && <Form submit={`Resume step ${sequence}`} busy={larder.busy || maintenance.length > 0} onSubmit={data => larder.run('wo.operation.resume', { ...payload, reason: text(data, 'reason') })}><Field label={`Step ${sequence} resume reason`} name="reason" /></Form>}
    {report && <Form title={`Step ${sequence} progress report`} submit={`Record step ${sequence} progress`} busy={larder.busy} note="Completed operation units and remaining effort are reports, separate from good output or shipment. Zero remaining effort does not complete the task." onSubmit={data => larder.run('wo.operation.progress', { ...payload, completedQuantity: text(data, 'completed'), remainingMinutes: Number(text(data, 'remaining')), note: text(data, 'note'), reason: text(data, 'note') })}>
      <Field label={`Step ${sequence} reported completed quantity`} name="completed" inputMode="decimal" defaultValue={task.progress?.completedQuantity ?? '0'} />
      <Field label={`Step ${sequence} remaining job minutes`} name="remaining" type="number" min="0" max="1000000" step="any" defaultValue={task.progress?.remainingMinutes ?? ''} />
      <Field label={`Step ${sequence} progress reason`} name="note" />
    </Form>}
    {task.progressReports?.length > 0 && <details><summary>Step {sequence} progress history</summary><ul className="history">{task.progressReports.map((p: any, i: number) => <li key={i}>{when(p.at)} · {personName(s, p.by)}: {qty(p.completedQuantity)} completed operation units, {qty(p.remainingMinutes)} job minutes remaining · {p.note}</li>)}</ul></details>}
  </section>
}
