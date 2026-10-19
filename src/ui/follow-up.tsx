import { useState, type ChangeEvent } from 'react'
import { personName, type Rec } from './api'
import type { Larder } from './app'
import { Area, Choose, Chip, Field, Form, fileBase64, options, text } from './controls'
import { day, words } from './format'

type Props = { larder: Larder; entry: any; canAssign: boolean; canUpdate: boolean; assignees: Rec[]; supervisors: Rec[] }
type Related = { kind: string; id: string; reference: string }

function relatedHref(record: Related) {
  const id = encodeURIComponent(record.id)
  return ({ salesOrders: `#orders/${id}`, workOrders: `#make/wo/${id}`, purchaseOrders: `#make/po/${id}`, handoffs: `#handoff/${id}`,
    items: '#more/setup', lots: '#stock', locations: '#stock', counts: '#stock', imports: '#more/move-in', forecasts: '#make/forecast',
    proposals: '#today', inventoryPlans: '#make/plan', productionPlans: '#make/plan' } as Record<string, string>)[record.kind]
}

function EvidenceField({ disabled }: { disabled: boolean }) {
  return <Field label="Evidence files (optional, up to 5)" name="evidence" type="file" multiple required={false} disabled={disabled}
    onChange={(event: ChangeEvent<HTMLInputElement>) => event.currentTarget.setCustomValidity((event.currentTarget.files?.length ?? 0) > 5 ? 'Choose up to 5 evidence files.' : '')} />
}

// This component receives authority and eligible people from its caller. The
// case's current business condition, never a note, determines its closure.
export function CaseFollowUp({ larder, entry, canAssign, canUpdate, assignees, supervisors }: Props) {
  const [preparing, setPreparing] = useState(false), [error, setError] = useState('')
  const s = larder.state!, closed = entry.status === 'closed', assigned = !!entry.caseId
  const disabled = larder.busy || preparing || closed
  const payload = { key: entry.key, version: entry.version }
  const history = entry.history ?? []

  async function recordUpdate(type: 'exception.followUp' | 'exception.escalate', data: FormData) {
    if (disabled) return false
    setError(''); setPreparing(true)
    try {
      const files = data.getAll('evidence').filter((file): file is File => file instanceof File && file.size > 0)
      if (files.length > 5) { setError('Choose up to 5 evidence files.'); return false }
      const evidence = await Promise.all(files.map(async file => ({ name: file.name, contentType: file.type || 'application/octet-stream', base64: await fileBase64(file) })))
      return await larder.run(type, { ...payload, note: text(data, 'note'), evidence,
        ...(type === 'exception.followUp' ? { dueOn: text(data, 'dueOn'), nextAction: text(data, 'nextAction') } : {}) })
    } catch {
      setError('The evidence files could not be read. Choose the files again before saving.')
      return false
    } finally { setPreparing(false) }
  }

  return <div className="resolve" role="region" aria-label={`Follow-up ${entry.title}`}>
    <details>
      <summary><Chip tone={closed ? 'good' : entry.escalationDue ? 'bad' : 'warn'}>{words(entry.status)}</Chip> · {entry.ownerId ? personName(s, entry.ownerId) : 'Unassigned'}{entry.dueOn && <> · due {day(entry.dueOn)} UTC</>}</summary>
      <p><strong>Closure criterion:</strong> {entry.criteria}</p>
      <p><strong>Next action:</strong> {entry.nextAction || 'No action assigned yet.'}</p>
      <p><strong>Escalation owner:</strong> {entry.escalationOwnerId ? personName(s, entry.escalationOwnerId) : 'Not assigned'}</p>
      <p className="muted">Due dates are UTC calendar dates. Due escalation starts on the next UTC day after the due date and appears in this app.</p>
      {!closed && entry.escalationDue && <p className="notice" role="status">Follow-up is overdue. In-app escalation is due to {entry.escalationOwnerId ? personName(s, entry.escalationOwnerId) : 'the escalation owner'}.</p>}
      {(entry.related ?? []).length > 0 && <ul className="history" aria-label="Related records">{entry.related.map((record: Related, index: number) => {
        const href = relatedHref(record)
        return <li key={`${record.kind}:${record.id}:${index}`}>{href ? <a href={href}>{record.reference}</a> : record.reference}</li>
      })}</ul>}
      <details>
        <summary>Case history ({history.length})</summary>
        {history.length === 0 ? <p className="muted">No follow-up has been recorded.</p> : <div className="details-body"><ol className="history">{history.map((event: any, index: number) => <li key={index}>
          <strong>{words(event.type)}</strong> · <time dateTime={event.at}>{String(event.at).replace('T', ' ').replace('Z', ' UTC')}</time> · {personName(s, event.by)}
          {event.note && <p>{event.note}</p>}
          {event.ownerId && <p>Owner: {personName(s, event.ownerId)}</p>}
          {event.dueOn && <p>Due: {day(event.dueOn)} UTC</p>}
          {event.nextAction && <p>Next action: {event.nextAction}</p>}
          {(event.evidence ?? []).length > 0 && <ul>{event.evidence.map((file: any) => <li key={file.id}><a href={`/api/larder/attachments/${encodeURIComponent(file.id)}`} target="_blank" rel="noreferrer">{file.name}</a></li>)}</ul>}
        </li>)}</ol></div>}
      </details>
      {error && <p className="alert" role="alert">{error}</p>}
      {!closed && canAssign && <details>
        <summary>{assigned ? 'Reassign or revise follow-up' : 'Assign follow-up'}</summary>
        <Form key={`assign:${entry.version}`} submit={assigned ? 'Save assignment' : 'Assign case'} quiet busy={disabled} onSubmit={data => {
          if (disabled) return false
          return larder.run('exception.assign', { ...payload, ownerId: text(data, 'ownerId'), dueOn: text(data, 'dueOn'), nextAction: text(data, 'nextAction'), escalationOwnerId: text(data, 'escalationOwnerId'), note: text(data, 'note') })
        }}>
          <Choose label="Follow-up owner" name="ownerId" options={options(assignees, person => person.name)} defaultValue={entry.ownerId ?? ''} disabled={disabled} />
          <Field label="Due date (UTC)" name="dueOn" type="date" defaultValue={entry.dueOn} disabled={disabled} />
          <Area label="Next action" name="nextAction" defaultValue={entry.nextAction} disabled={disabled} />
          <Choose label="Escalation owner" name="escalationOwnerId" options={options(supervisors, person => person.name)} defaultValue={entry.escalationOwnerId ?? ''} disabled={disabled} />
          <Area label="Assignment note" name="note" disabled={disabled} />
        </Form>
      </details>}
      {!closed && assigned && canUpdate && <details>
        <summary>Record follow-up</summary>
        <Form key={`update:${entry.version}`} submit="Save follow-up" quiet busy={disabled} onSubmit={data => recordUpdate('exception.followUp', data)}>
          <Field label="Due date (UTC)" name="dueOn" type="date" defaultValue={entry.dueOn} disabled={disabled} />
          <Area label="Next action" name="nextAction" defaultValue={entry.nextAction} disabled={disabled} />
          <Area label="Follow-up note" name="note" disabled={disabled} />
          <EvidenceField disabled={disabled} />
        </Form>
      </details>}
      {!closed && assigned && canAssign && entry.escalationOwnerId && <details>
        <summary>Escalate to {personName(s, entry.escalationOwnerId)}</summary>
        <Form submit="Record escalation" quiet busy={disabled} note="Records an in-app escalation to the assigned escalation owner." onSubmit={data => recordUpdate('exception.escalate', data)}>
          <Area label="Escalation note" name="note" disabled={disabled} />
          <EvidenceField disabled={disabled} />
        </Form>
      </details>}
    </details>
  </div>
}
