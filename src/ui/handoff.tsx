import { byId, can, personName, rows, type Rec } from './api'
import type { Larder } from './app'
import { Card, Chip, Empty, Field, Form, Table, text } from './controls'
import { day, localDay, money, qty, when, words } from './format'

const tone = (status: string) => status === 'acknowledged' ? 'good' : status === 'mismatch' ? 'bad' : 'warn'

// Accepts the accountant's reply: one line per entry, "line,ledger reference,amount".
function parseAck(raw: string) {
  return raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean).filter(l => !/^line\b/i.test(l)).map(l => { const [lineId, ledgerId, amount, ...note] = l.split(',').map(x => x.trim()); return { lineId, ledgerId, amount, note: note.join(', ') } })
}

export function Handoff({ larder, id }: { larder: Larder; id?: string }) {
  const s = larder.state!, batch = id ? byId(s, 'handoffs', id) : undefined
  const access = can(s, ['manager', 'accounts'])
  return <div className="page">
    <header className="page-head"><p className="eyebrow">Handoff</p><h1>{batch ? batch.reference : 'Accountant handoff'}</h1>
      <p className="meta">Larder prepares operational costs, receipts and invoice lines for your accountant's ledger. It posts no journals; the ledger stays the authority.</p></header>
    {batch ? <Batch larder={larder} h={batch} /> : <>
      <Card title="Ready to hand off" aside={<Chip tone={s.pendingHandoff ? 'info' : 'good'}>{s.pendingHandoff} movements</Chip>}>
        {access ? <Form submit="Prepare handoff batch" busy={larder.busy} onSubmit={async d => { const r = await larder.run('handoff.prepare', { note: text(d, 'note') }); if (r) window.location.hash = `handoff/${r.id}`; return r }}><Field label="Note for the accountant" name="note" required={false} /></Form> : <Empty>Ask a manager or your accounts person to prepare the handoff.</Empty>}
      </Card>
      <Card title="Batches">{rows(s, 'handoffs').length === 0 ? <Empty picture="papers">No batches yet.</Empty> :
        <Table head={['Batch', 'Prepared', 'Lines', 'Net amount', 'Status']} numeric={[2, 3]}>{[...rows(s, 'handoffs')].reverse().map(h => <tr key={h.id}><td><a href={`#handoff/${h.id}`}>{h.reference}</a></td><td>{when(h.createdAt)} by {personName(s, h.createdBy)}</td><td className="num">{qty(String(h.lines.length))}</td><td className="num">{money(h.total)}</td><td><Chip tone={tone(h.status)}>{words(h.status)}</Chip></td></tr>)}</Table>}</Card>
    </>}
  </div>
}

function Batch({ larder, h }: { larder: Larder; h: Rec }) {
  const s = larder.state!, state = new Map<string, any>((h.reconciliation ?? []).map((r: any) => [r.lineId, r]))
  return <>
    <Card title="Lines" aside={<><Chip tone={tone(h.status)}>{words(h.status)}</Chip> <a className="button" href={`/api/larder/handoffs/${h.id}.csv`} download>Download CSV</a></>}>
      <Table head={['Date', 'Type', 'Document', 'Party', 'Item', 'Qty', 'Amount', 'Ledger']} numeric={[5, 6]}>{h.lines.map((l: any) => { const r = state.get(l.id); const moved = s.movements.find((m: any) => m.id === l.movementIds[0]); return <tr key={l.id}><td>{moved ? localDay(moved.createdAt) : day(l.date)}</td><td>{l.type}{l.corrects && <small>corrects {l.corrects.reference}</small>}</td><td>{l.document}</td><td>{l.party}{l.partyReference && <small>{l.partyReference}</small>}</td><td>{l.itemName}</td><td className="num">{qty(l.quantity)}</td><td className="num">{money(l.amountCents)}</td><td>{r ? <><Chip tone={r.state === 'matched' ? 'good' : 'bad'}>{r.state === 'matched' ? r.ledgerId : `${r.ledgerId}: ${money(r.amount)}`}</Chip></> : <Chip>Waiting</Chip>}</td></tr> })}</Table>
    </Card>
    {can(s, ['manager', 'accounts']) && <Card title="Record the accountant's acknowledgement"><Form submit="Reconcile" busy={larder.busy} note="Paste one line per entry: line, ledger reference, amount. Amounts that differ are flagged as mismatches; a later entry for the same line records a correction." onSubmit={d => larder.run('handoff.acknowledge', { handoffId: h.id, version: h.version, entries: parseAck(text(d, 'entries')) })}>
      <label className="field wide"><span>Acknowledged lines</span><textarea name="entries" rows={6} required placeholder="line from the CSV,INV-1043,178.00" /></label></Form></Card>}
    <p><a href="#handoff">All batches</a></p>
  </>
}
