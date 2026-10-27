import { useEffect, useState } from 'react'
import type { Larder } from './app'
import { rows } from './api'
import { collections } from '../larder/model'
import { Card, Choose, Empty, Field, Form, Table, text } from './controls'
import { words } from './format'

export function RetentionSettings({ larder }: { larder: Larder }) {
  const s = larder.state!, [review, setReview] = useState<any>(null), [error, setError] = useState('')
  useEffect(() => { setReview(null) }, [s.version])
  if (s.actor.role !== 'owner') return null
  const holds = rows(s, 'retentionHolds'), policies = rows(s, 'retentionPolicies')
  const subjects = [...rows(s, 'parties').filter(p => !p.contactErasedAt).map(p => ({ value: 'contact:' + p.id, label: 'Contact: ' + p.name })), ...rows(s, 'operators').filter(o => o.status === 'inactive' && o.name !== '[erased]').map(o => ({ value: 'operator:' + o.id, label: 'Former operator: ' + o.name }))]
  const records = collections.filter(k => !['retentionHolds', 'contactErasures', 'retentionPolicies', 'auditErasures'].includes(k)).flatMap(kind => rows(s, kind).map(r => ({ value: kind + ':' + r.id, label: `${words(kind)}: ${r.reference || r.name || r.code || r.id}` })))
  async function loadReview(d: FormData) {
    setError(''); setReview(null)
    const [kind, id] = text(d, 'subject').split(':')
    const response = await fetch(`/api/larder/retention/${kind}?${kind === 'contact' ? 'partyId' : 'operatorId'}=${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store' })
    const body: any = await response.json()
    if (!response.ok) { setError(body.error?.message || 'Review could not load.'); return false }
    setReview({ ...body, kind, label: subjects.find(x => x.value === kind + ':' + id)?.label }); return true
  }
  return <>
    <Card title="Retention settings">
      <p>US minimum preservation periods are owner decisions, not legal advice. Production and financial trace records and all documents remain preserved indefinitely. Nothing expires, purges or sends a request automatically.</p>
      {policies.length > 0 && <Table head={['Category', 'Minimum period', 'Preservation']}>{policies.map(p => <tr key={p.id}><td>{p.category}</td><td>{p.minimumDays} days</td><td>{p.indefinitePreservation ? 'Indefinite; no automatic expiry' : 'Owner review after minimum period'}</td></tr>)}</Table>}
      <Form submit="Save retention period" busy={larder.busy} onSubmit={d => { const category = text(d, 'category'); return larder.run('retention.configure', { category, minimumDays: Number(text(d, 'minimumDays')), version: policies.find(p => p.category === category)?.version, reason: text(d, 'reason') }) }}>
        <Choose label="Retention category" name="category" options={['contacts', 'production and financial trace', 'documents'].map(value => ({ value, label: words(value) }))} />
        <Field label="Minimum retention days" name="minimumDays" type="number" min="0" max="36500" step="1" /><Field label="Retention reason" name="reason" />
      </Form>
    </Card>
    <Card title="Legal holds">
      <p>A hold preserves the exact record without automatic expiry. Releasing one hold changes no other hold and erases nothing.</p>
      <Form submit="Place legal hold" busy={larder.busy} onSubmit={d => { const [kind, recordId] = text(d, 'record').split(':'); return larder.run('retention.hold', { kind, recordId, reason: text(d, 'reason') }) }}><Choose label="Record to preserve" name="record" options={records} /><Field label="Hold reason" name="reason" /></Form>
      {!holds.length ? <Empty>No legal holds recorded.</Empty> : holds.map(h => <div key={h.id}><h3>{words(h.kind)} · {h.recordId}</h3><p>{h.reason} · {h.active ? 'Active; no expiry' : 'Released: ' + h.releaseReason}</p>{h.active && <Form submit="Release this hold" busy={larder.busy} onSubmit={d => larder.run('retention.release', { holdId: h.id, version: h.version, reason: text(d, 'reason') })}><Field label="Release reason" name="reason" /></Form>}</div>)}
    </Card>
    <Card title="Erasure review">
      <p>Review the current subject and retained records before consenting. Contact erasure replaces name and email only. Former operators must be inactive; any active legal hold blocks their anonymization. Documents, messages, model context and immutable movement text remain retained.</p>
      <Form submit="Review erasure" busy={larder.busy} onSubmit={loadReview}><Choose label="Erasure subject" name="subject" options={subjects} /></Form>
      {error && <p role="alert">{error}</p>}
      {review && <div><h3>{review.label}</h3><p>Reviewed business version {review.version}. Eligible fields: {review.eligibleFields.join(', ')}.</p>
        {review.eligibleAt && <p>Minimum retention ends {review.eligibleAt}.</p>}
        <h3>Retained categories and reasons</h3><ul>{review.retained.map((r: any, i: number) => <li key={i}>{typeof r === 'string' ? r : `${r.category}: ${r.reason}`}</li>)}</ul>
        <h3>Controlled copy outcomes</h3><dl>{Object.entries(review.outcomes).map(([kind, result]) => <div key={kind}><dt>{words(kind)}</dt><dd>{String(result)}</dd></div>)}</dl>
        {review.blocked || review.periodBlocked ? <p role="status">Erasure is blocked by preservation requirements. Review and resolve them explicitly first.</p> : <Form submit="Erase reviewed fields" busy={larder.busy || review.version !== s.version} onSubmit={d => larder.run(review.kind === 'contact' ? 'erasure.contact' : 'erasure.operator', { partyId: review.partyId, operatorId: review.operatorId, operatorVersion: review.operatorVersion, reviewedVersion: review.version, consent: d.has('consent'), reason: text(d, 'reason') })}>
          <label className="check wide"><input type="checkbox" name="consent" required />I authorize only these exact reviewed fields and outcomes. This sends no outbound request.</label><Field label="Erasure reason" name="reason" />
        </Form>}
      </div>}
      {rows(s, 'contactErasures').map(e => <p key={e.id}>Completed {e.scope} for subject {e.subjectId} at {e.createdAt}; owner {e.createdBy}; reviewed version {e.reviewedVersion}. {e.reason}</p>)}
    </Card>
  </>
}
