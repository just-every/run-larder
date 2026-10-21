import { useState } from 'react'
import type { Larder } from './app'
import { Card, Empty, Form } from './controls'

export function Archive({ larder }: { larder: Larder }) {
  const s = larder.state!, [result, setResult] = useState('')
  const empty = s.version === 0
  async function download() {
    const res = await fetch('/api/larder/archive', { credentials: 'same-origin' })
    if (!res.ok) { setResult('The archive could not be prepared.'); return }
    const blob = new Blob([await res.text()], { type: 'application/json' }), a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = `larder-archive-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href)
    setResult('Archive downloaded. It holds every record, movement, approval, attachment and recorded action, with a checksum.')
  }
  async function restore(d: FormData) {
    const file = d.get('archive') as File
    const res = await fetch('/api/larder/archive/restore', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: await file.text() })
    const body: any = await res.json()
    setResult(body.ok ? `Restored ${body.result.movements} movements and ${body.result.positions} stock positions; every position matched the archive.` : body.error.message)
    await larder.refresh()
    return body.ok
  }
  return <div className="split">
    {['owner', 'manager'].includes(s.actor.role) ? <Card title="Export"><p>Download the complete business archive: records, the full movement ledger, reservations, approvals, attachments and every recorded action.</p><button className="button primary" onClick={() => void download()}>Download archive</button> <a className="button" href="/api/larder/archive.csv">Download archive CSV</a></Card> : <Empty>Only the owner or a manager can export the archive.</Empty>}
    {s.actor.role === 'owner' && <Card title="Restore">{empty ? <Form submit="Restore archive" busy={larder.busy} note="Restores into this empty installation in one step. If any stock position does not match the archive, nothing is written." onSubmit={restore}><label className="field wide"><span>Archive file</span><input type="file" name="archive" accept=".json,application/json" required /></label></Form> : <Empty>Restore only works on an empty installation. This one already has records.</Empty>}</Card>}
    {result && <p role="status" className="notice wide">{result}</p>}
  </div>
}
