import { useState } from 'react'
import type { Larder } from './app'
import { can, rows } from './api'
import { Card, Chip, Empty, Field, Form, Table, fileBase64 } from './controls'

export function SourceHistory({ larder }: { larder: Larder }) {
  const s = larder.state!, [query, setQuery] = useState('')
  const records = rows(s, 'sourceHistory').filter(r => [r.source, r.kind, r.originalId, r.reference, r.summary, ...r.references, ...r.attachments.map((f: any) => f.name)].some(v => String(v).toLowerCase().includes(query.toLowerCase())))
  return <>
    {can(s, ['manager', 'agent']) && <Card title="Import source history">
      <p>Keep closed jobs, shipments, bills, quality records and lots as source history with their original references, dates, currency and files. These records do not post stock, send documents or reconnect providers. Use the JSON format in <a href="/docs/move-in">Move-in documentation</a>.</p>
      <Form submit="Preview source history" busy={larder.busy} onSubmit={async d => {
        const file = d.get('history') as File
        const attachments = await Promise.all((d.getAll('attachments') as File[]).filter(f => f.size).map(async f => ({ name: f.name, contentType: f.type || 'text/plain', base64: await fileBase64(f) })))
        return larder.run('history.preview', { file: { name: file.name, content: await file.text() }, ...(attachments.length ? { attachments } : {}) })
      }}>
        <label className="field wide"><span>Source history JSON</span><input type="file" name="history" accept=".json,application/json" required /></label>
        <label className="field wide"><span>Original history attachments</span><input type="file" name="attachments" multiple /></label>
      </Form>
    </Card>}
    {rows(s, 'historyImports').filter(b => b.status === 'previewed').map(b => <Card key={b.id} title={`Review source history: ${b.source}`}>
      <p>{b.records.length} records · <a href={`/api/larder/attachments/${b.original.id}`}>Original {b.original.name}</a></p>
      <Table head={['Kind', 'Original reference', 'Original time', 'Currency', 'Quantity / amount']}>{b.records.map((r: any, i: number) => <tr key={i}><td>{r.kind}</td><td>{r.reference} · {r.originalId}</td><td>{r.occurredAt}</td><td>{r.currency}</td><td>{r.quantity ?? '—'} {r.unit} / {r.amount ?? '—'}</td></tr>)}</Table>
      {can(s, ['manager']) && <Form submit={`Commit source history from ${b.source}`} busy={larder.busy} onSubmit={() => larder.run('history.commit', { importId: b.id, version: b.version })}><span>Approve these records as retained source evidence.</span></Form>}
    </Card>)}
    <Card title="Search source history">
      <Field label="Search source references or files" name="history-search" type="search" required={false} value={query} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)} />
      {!records.length && <Empty>No source history matches.</Empty>}
      {records.map(r => <article key={r.id} id={`history-${r.id}`}>
        <h3>{r.reference} <Chip>Source history</Chip></h3>
        <dl className="facts"><div><dt>Source / kind</dt><dd>{r.source} / {r.kind}</dd></div><div><dt>Original ID / status</dt><dd>{r.originalId} / {r.sourceStatus}</dd></div><div><dt>Original time</dt><dd>{r.occurredAt}</dd></div><div><dt>Original amount</dt><dd>{r.currency} {r.amount ?? 'Not recorded'}</dd></div><div><dt>Quantity</dt><dd>{r.quantity ?? 'Not recorded'} {r.unit}</dd></div></dl>
        <p>{r.summary}</p><p>References: {r.references.join(', ') || 'None'}</p>
        <ul>{[r.original, ...r.attachments].map((f: any) => <li key={f.id}><a href={`/api/larder/attachments/${f.id}`}>{f.name}</a> · <span className="mono">{f.sha256}</span></li>)}</ul>
      </article>)}
    </Card>
  </>
}
