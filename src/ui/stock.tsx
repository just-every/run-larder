import { Certificates } from './certificates'
import { can, itemName, locationName, personName, rows, sku, type LarderState } from './api'
import type { Larder } from './app'
import { CountSessions } from './counts'
import { LotDateFields, LotExpiry, readLotDates } from './lot-expiry'
import { Card, Chip, Choose, Empty, Field, Form, Table, fileBase64, options, readLines, text } from './controls'
import { plus, qty, when, words } from './format'

const documents = (s: LarderState) => [
  ...rows(s, 'receipts').filter(r => r.status !== 'reversed').map(r => ({ kind: 'receipts', id: r.id, label: `${r.reference} receipt (${r.supplierReference})` })),
  ...rows(s, 'transfers').filter(r => r.status !== 'reversed').map(r => ({ kind: 'transfers', id: r.id, label: `${r.reference} transfer of ${itemName(s, r.itemId)}` })),
  ...rows(s, 'openings').filter(r => r.status !== 'reversed').map(r => ({ kind: 'openings', id: r.id, label: `${r.reference} opening count at ${locationName(s, r.locationId)}` })),
  ...rows(s, 'counts').filter(r => r.status === 'adjusted').map(r => ({ kind: 'counts', id: r.id, label: `${r.reference} count adjustment` })),
  ...rows(s, 'returns').filter(r => r.status !== 'reversed').map(r => ({ kind: 'returns', id: r.id, label: `${r.reference} return of ${itemName(s, r.itemId)}` })),
]

export function Stock({ larder }: { larder: Larder }) {
  const s = larder.state!, run = larder.run, busy = larder.busy, wh = can(s, ['manager', 'warehouse'])
  const locs = options(rows(s, 'locations').filter(l => !l.archived), r => r.name), items = options(rows(s, 'items').filter(i => !i.archived), r => `${r.name} · ${r.sku}`)
  const quarantine = s.positions.filter((p: any) => p.status === 'quarantine')
  const lot = (id: string) => rows(s, 'lots').find(l => l.id === id)?.code
  return <div className="page">
    <header className="page-head"><p className="eyebrow">Stock</p><h1>Stock on hand</h1><p className="meta">Every quantity is the sum of its recorded movements. Reserved stock cannot be moved or sold twice.</p></header>
    <CountSessions larder={larder} />
    <Certificates larder={larder} />
    <LotExpiry larder={larder} />
    <Card title="By item">{s.availability.length === 0 ? <Empty>No items yet. Add items under More → Items, contacts and locations, or move them in from Odoo.</Empty> :
      <Table head={['Item', 'On hand', 'Reserved', 'Expired', 'Available', 'Quarantine', 'Expected', 'To promise']} numeric={[1, 2, 3, 4, 5, 6, 7]}>{s.availability.map((a: any) => <tr key={a.itemId}><td><strong>{itemName(s, a.itemId)}</strong><small>{sku(s, a.itemId)}</small></td><td className="num">{qty(a.onHand)}</td><td className="num">{qty(a.reserved)}</td><td className="num">{qty(a.expired)}</td><td className="num">{qty(a.available)}</td><td className="num">{qty(a.quarantine)}</td><td className="num">{qty(plus(a.expectedPurchase, a.expectedProduction))}</td><td className="num"><strong>{qty(a.availableToPromise)}</strong></td></tr>)}</Table>}
    </Card>
    <Card title="By location">{s.positions.length === 0 ? <Empty>No stock recorded yet. Record an opening count below.</Empty> :
      <Table head={['Location', 'Item', 'Lot', 'Status', 'Quantity']} numeric={[4]}>{s.positions.map((p: any, i: number) => <tr key={i}><td>{locationName(s, p.locationId)}</td><td>{itemName(s, p.itemId)}</td><td>{lot(p.lotId) ?? '—'}</td><td><Chip tone={p.status === 'quarantine' ? 'warn' : 'good'}>{words(p.status)}</Chip></td><td className="num">{qty(p.quantity)}</td></tr>)}</Table>}
    </Card>
    {wh && quarantine.length > 0 && <Card title="Quality decisions">{quarantine.map((p: any, i: number) => <Form key={i} title={`${qty(p.quantity)} ${itemName(s, p.itemId)} at ${locationName(s, p.locationId)}${p.lotId ? `, lot ${lot(p.lotId)}` : ''}`} submit="Record decision" busy={busy} onSubmit={d => run('quarantine.decide', { itemId: p.itemId, locationId: p.locationId, lotId: p.lotId || undefined, quantity: text(d, 'quantity'), decision: text(d, 'decision'), reason: text(d, 'reason') })}>
      <Field label="Quantity" name="quantity" defaultValue={p.quantity} inputMode="decimal" /><Choose label="Decision" name="decision" options={[{ value: 'release', label: 'Release to stock' }, { value: 'reject', label: 'Reject (return or scrap)' }]} /><Field label="Reason" name="reason" /></Form>)}</Card>}
    {wh && <div className="split">
      <Card title="Opening stock"><Form submit="Record opening count" busy={busy} note="Use once per item and location, before other movements. Later differences are counts." onSubmit={async d => {
        const file = (d.get('evidence') as File | null)
        return run('opening.record', { locationId: text(d, 'locationId'), countedOn: text(d, 'countedOn'), valuationBasis: text(d, 'valuationBasis'), countedBy: text(d, 'countedBy'), evidence: file && file.size ? { name: file.name, contentType: file.type || 'application/octet-stream', base64: await fileBase64(file) } : undefined, lines: readLines(d).map((l, i) => ({ itemId: l.itemId, quantity: l.quantity, unitCost: l.unitPrice ?? '0', lot: l.lot, dates: readLotDates(d, `dates.${i}.`) })) })
      }}>
        <Choose label="Location" name="locationId" options={locs} /><Field label="Counted on" name="countedOn" type="date" /><Field label="Counted by" name="countedBy" />
        <Choose label="Valuation basis" name="valuationBasis" options={[{ value: 'supplier-invoice', label: 'Supplier invoices' }, { value: 'last-purchase', label: 'Last purchase price' }, { value: 'standard-cost', label: 'Standard cost' }, { value: 'owner-estimate', label: 'Owner estimate' }]} />
        <label className="field wide"><span>Count sheet or photo</span><input type="file" name="evidence" required accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,.xlsx" /></label>
        <OpeningLines items={items} />
      </Form></Card>
      <Card title="Stock movements">
        <Form title="Transfer" submit="Transfer" busy={busy} onSubmit={d => run('transfer.create', { itemId: text(d, 'itemId'), fromLocationId: text(d, 'from'), toLocationId: text(d, 'to'), quantity: text(d, 'quantity'), reason: text(d, 'reason') })}>
          <Choose label="Item" name="itemId" options={items} /><Choose label="From" name="from" options={locs} /><Choose label="To" name="to" options={locs} /><Field label="Quantity" name="quantity" inputMode="decimal" /><Field label="Reason" name="reason" /></Form>
        {can(s, ['manager', 'warehouse', 'production']) && documents(s).length > 0 && <Form title="Correct a recorded movement" submit="Reverse" quiet busy={busy} note="Posts the exact opposite movement and keeps the original. Refused while later work depends on the stock." onSubmit={d => { const [kind, id] = text(d, 'doc').split(':'); return run('movement.reverse', { documentKind: kind, documentId: id, reason: text(d, 'reason') }) }}>
          <Choose label="Document" name="doc" options={documents(s).map(x => ({ value: `${x.kind}:${x.id}`, label: x.label }))} /><Field label="Reason" name="reason" /></Form>}
      </Card>
    </div>}
    <Card title="Recent movements">{s.movements.length === 0 ? <Empty>No movements yet.</Empty> :
      <Table head={['When', 'Item', 'Location', 'Change', 'Why', 'By']} numeric={[3]}>{[...s.movements].reverse().slice(0, 40).map((m: any) => <tr key={m.id}><td>{when(m.createdAt)}</td><td>{itemName(s, m.itemId)}</td><td>{locationName(s, m.locationId)}{m.status === 'quarantine' && <small> quarantine</small>}</td><td className="num">{m.quantity.startsWith('-') ? '' : '+'}{qty(m.quantity)}</td><td>{words(m.kind)}: {m.reason}</td><td>{personName(s, m.actorId)}</td></tr>)}</Table>}
    </Card>
  </div>
}

function OpeningLines({ items }: { items: { value: string; label: string }[] }) {
  return <fieldset className="lines wide"><legend>Counted lines</legend>{[0, 1, 2].map(i => <div className="line" key={i}>
    <Choose label={`Item ${i + 1}`} name={`lines.${i}.itemId`} options={items} required={i === 0} /><Field label="Quantity" name={`lines.${i}.quantity`} inputMode="decimal" required={false} />
    <Field label="Unit cost" name={`lines.${i}.unitPrice`} inputMode="decimal" required={false} /><Field label="Lot" name={`lines.${i}.lot`} required={false} /><LotDateFields prefix={`dates.${i}.`} /></div>)}</fieldset>
}

