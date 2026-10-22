import { useEffect, useState } from 'react'
import { Card, Chip, Empty, Table } from './controls'
import { when, words } from './format'

const domains = ['stock', 'revisions', 'time', 'quality', 'schedules', 'roles', 'integrations', 'agent', 'commercial', 'records']
type Entry = { seq: number; at: string; actorName: string; source: string; domain: string; commandType: string; subjectKind: string; op: string; reason: string; before: Record<string, unknown>; after: Record<string, unknown> }

// GOV-004: the append-only audit as the owner or a manager reads it, with the exact before and after of each change.
export function AuditTrail() {
  const [domain, setDomain] = useState(''), [q, setQ] = useState(''), [data, setData] = useState<{ total: number; entries: Entry[] } | null>(null), [error, setError] = useState('')
  const query = new URLSearchParams({ ...(domain ? { domain } : {}), ...(q.trim() ? { q: q.trim() } : {}) }).toString()
  useEffect(() => {
    let live = true
    fetch(`/api/larder/audit?${query}&limit=200`, { credentials: 'same-origin', cache: 'no-store' }).then(async res => { const body: any = await res.json(); if (!res.ok) throw new Error(body?.error?.message ?? 'The audit could not load.'); if (live) { setData(body); setError('') } }).catch(e => live && setError(e.message))
    return () => { live = false }
  }, [query])
  const detail = (e: Entry) => Object.keys(e.after).length === 0 && Object.keys(e.before).length === 0 ? '—' : Object.keys(e.after).slice(0, 4).map(k => `${words(k)}: ${e.op === 'update' ? `${short(e.before[k])} → ${short(e.after[k])}` : short(e.after[k])}`).join('; ')
  return <Card title="Audit trail" aside={<span><a className="link" href={`/api/larder/audit.csv?${query}`}>Download CSV</a> · <a className="link" href={`/api/larder/audit.json?${query}`}>Download JSON</a></span>}>
    <p className="muted">Append-only: every change records who, when, what it was and what it became, with the reason and linked evidence. Passwords, keys and document bodies are never logged, and nobody can edit or delete an entry.</p>
    <div className="form-grid">
      <label className="field"><span>Area</span><select aria-label="Area" value={domain} onChange={e => setDomain(e.target.value)}><option value="">All areas</option>{domains.map(d => <option key={d} value={d}>{words(d)}</option>)}</select></label>
      <label className="field"><span>Search</span><input aria-label="Search the audit" value={q} onChange={e => setQ(e.target.value)} /></label>
    </div>
    {error ? <p role="alert" className="notice">{error}</p> : !data ? <Empty>Loading the audit…</Empty> : data.entries.length === 0 ? <Empty>No audit entries match.</Empty> :
      <Table head={['When', 'Who', 'Area', 'What changed', 'Reason']}>{data.entries.map(e => <tr key={e.seq}><td>{when(e.at)}</td><td>{e.actorName}{e.source === 'agent' && <> <Chip tone="info">Agent</Chip></>}</td><td>{words(e.domain)}</td><td><strong>{words(e.subjectKind)}</strong> {words(e.op)}<small>{detail(e)}</small></td><td>{e.reason || '—'}</td></tr>)}</Table>}
    {data && <p className="muted">{data.total} matching {data.total === 1 ? 'entry' : 'entries'}{data.total > data.entries.length ? `; showing the first ${data.entries.length}` : ''}. Retained for the life of the installation.</p>}
  </Card>
}
const short = (v: unknown) => { const t = typeof v === 'string' ? v : JSON.stringify(v ?? ''); return t.length > 60 ? t.slice(0, 57) + '…' : t }
