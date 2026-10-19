// CAP-009 uses the existing Schedule and form vocabulary.
import { can, personName, rows, type Rec } from './api'
import type { Larder } from './app'
import { Area, Card, Choose, Chip, Field, Form, Table, fileBase64, text } from './controls'
import { when, words } from './format'
import type { Plan } from './schedule/plan'

const localTime = (ms = Date.now()) => { const d = new Date(ms); return new Date(ms - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
const instant = (data: FormData, name: string) => new Date(text(data, name)).toISOString()
async function evidence(data: FormData) {
  const f = data.get('evidence') as File | null
  return f?.size ? { name: f.name, contentType: f.type || 'text/plain', base64: await fileBase64(f) } : undefined
}

function Record({ larder, m, plan }: { larder: Larder; m: Rec; plan: Plan }) {
  const s = larder.state!, manage = can(s, ['manager']), open = m.status === 'unreleased'
  const affected = plan.ops.filter(o => o.maintenanceIds.includes(m.id))
  const payload = { maintenanceId: m.id, version: m.version }
  return <article className="proposal" aria-label={`Maintenance ${m.reference}`}>
    <h3>{m.reference} · {m.workCentre} <Chip tone={open ? 'warn' : 'good'}>{open ? 'Release required' : 'Released'}</Chip></h3>
    <p>{words(m.kind)} · repair owner: {m.repairOwner}<br />Starts {when(m.startsAt)} · expected return {when(m.expectedReturnAt)}{m.cmmsId && <><br />CMMS record ID: {m.cmmsId}</>}</p>
    {open && <p>Equipment is unavailable from its start until an authorized release. Recovery dates below are provisional after the ETA; passing the ETA never releases equipment or changes a customer promise.</p>}
    {affected.length > 0 && <Table head={['Affected work', 'Operation', 'Provisional recovery']}>
      {affected.map(o => <tr key={o.key}><td><a href={`#make/wo/${o.workOrder.id}`}>{o.reference}</a></td><td>{o.step} · {o.workCenter}</td><td><span><time dateTime={o.start.toISOString()}>{when(o.start.toISOString())}</time> – <time dateTime={o.end.toISOString()}>{when(o.end.toISOString())}</time> · release required</span></td></tr>)}
    </Table>}
    {m.releasedAt && <p>Released {when(m.releasedAt)} by {personName(s, m.releasedBy)} · {m.repairNote}</p>}
    <ul>{m.evidence.map((f: any) => <li key={f.id}><a href={`/api/larder/attachments/${f.id}`} target="_blank" rel="noreferrer">Repair evidence: {f.name}</a></li>)}</ul>
    <details><summary>{m.reference} maintenance trail</summary><ul className="history">{m.history.map((h: any, i: number) => <li key={i}>{when(h.at)} · {personName(s, h.by)} · {h.type}: {h.note}{h.repairOwner && <> · {h.repairOwner}, ETA {when(h.expectedReturnAt)}</>}</li>)}</ul></details>
    {open && manage && <>
      <details><summary>Update {m.reference} repair</summary><Form submit={`Save ${m.reference} repair update`} busy={larder.busy} onSubmit={async data => larder.run('maintenance.update', { ...payload, repairOwner: text(data, 'repairOwner'), expectedReturnAt: instant(data, 'return'), cmmsId: text(data, 'cmmsId'), note: text(data, 'note'), evidence: await evidence(data) })}>
        <Field label={`${m.reference} repair owner`} name="repairOwner" defaultValue={m.repairOwner} />
        <Field label={`${m.reference} expected return (local time)`} name="return" type="datetime-local" defaultValue={localTime(Date.parse(m.expectedReturnAt))} />
        <Field label={`${m.reference} CMMS record ID`} name="cmmsId" defaultValue={m.cmmsId} required={false} />
        <Area label={`${m.reference} update note`} name="note" /><Field label={`${m.reference} additional evidence`} name="evidence" type="file" required={false} />
      </Form></details>
      <details><summary>Release {m.reference} equipment</summary><Form submit={`Release ${m.reference}`} busy={larder.busy} note="Record the completed repair and attach its evidence. Release makes equipment available; it does not complete a job." onSubmit={async data => larder.run('maintenance.release', { ...payload, note: text(data, 'note'), evidence: await evidence(data) })}>
        <Area label={`${m.reference} repair and release note`} name="note" /><Field label={`${m.reference} repair evidence file`} name="evidence" type="file" />
      </Form></details>
    </>}
  </article>
}

export function Maintenance({ larder, plan }: { larder: Larder; plan: Plan }) {
  const s = larder.state!, records = rows(s, 'maintenance')
  const centers = [...new Set(rows(s, 'boms').flatMap(b => b.routing ?? []).concat(rows(s, 'workOrders').flatMap(w => w.routing ?? [])).flatMap(r => [r.workCentre, ...(r.eligibleCentres ?? [])]).filter(Boolean))] as string[]
  return <Card title="Equipment maintenance">
    <p>Schedule preventive work or record a breakdown, assign repair responsibility, then release after recorded repair. Times are entered in your browser’s local time and retained in UTC.</p>
    {can(s, ['manager']) && <details><summary>Record equipment maintenance</summary><Form submit="Record maintenance" busy={larder.busy} onSubmit={async data => larder.run('maintenance.create', { workCentre: text(data, 'center'), kind: text(data, 'kind'), startsAt: instant(data, 'start'), expectedReturnAt: instant(data, 'return'), repairOwner: text(data, 'repairOwner'), cmmsId: text(data, 'cmmsId'), note: text(data, 'note'), evidence: await evidence(data) })}>
      <Choose label="Maintenance work center" name="center" options={centers.map(value => ({ value, label: value }))} />
      <Choose label="Maintenance kind" name="kind" options={[{ value: 'preventive', label: 'Preventive maintenance' }, { value: 'breakdown', label: 'Unplanned breakdown (starts now)' }]} />
      <Field label="Maintenance start (local time; preventive only)" name="start" type="datetime-local" defaultValue={localTime(Date.now() + 3600000)} />
      <Field label="Expected equipment return (local time)" name="return" type="datetime-local" defaultValue={localTime(Date.now() + 86400000)} />
      <Field label="Repair owner" name="repairOwner" hint="Named person or repair team; this records responsibility, not an access grant." />
      <Field label="CMMS record ID" name="cmmsId" required={false} /><Area label="Maintenance reason" name="note" />
      <Field label="Maintenance evidence file" name="evidence" type="file" required={false} />
    </Form></details>}
    {records.length ? records.map(m => <Record key={m.id} larder={larder} m={m} plan={plan} />) : <p className="empty">No maintenance recorded.</p>}
  </Card>
}
