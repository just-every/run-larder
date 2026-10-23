import { useEffect, useState } from 'react'
import { can, rows, type LarderState, type Rec } from './api'
import type { Larder } from './app'
import { Card, Chip, Choose, Empty, Field, Form, Table, text } from './controls'
import { day, when, words } from './format'

// TRACE-002: a serial-tracked item names one serial per unit at every stock door.
export const serialTracked = (s: LarderState, itemId: string) => rows(s, 'items').some(i => i.id === itemId && i.tracking === 'serial')
export const serialHint = 'One serial per unit, separated by commas'

export function SerialNumbers({ larder }: { larder: Larder }) {
  const s = larder.state!, [q, setQ] = useState(''), [found, setFound] = useState<Rec[] | null>(null), [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController(); setError('')
    if (!q) { setFound(null); return }
    fetch(`/api/larder/serials?q=${encodeURIComponent(q)}`, { signal: controller.signal, credentials: 'same-origin', cache: 'no-store' }).then(async r => { const b: any = await r.json(); if (!r.ok) throw Error(b.error?.message ?? 'Serials could not load.'); return b }).then(setFound).catch(e => { if (e.name !== 'AbortError') setError(e.message) })
    return () => controller.abort()
  }, [q, s.version])
  if (!rows(s, 'items').some(i => i.tracking === 'serial')) return null
  return <Card title="Serial numbers">
    <Form submit="Find serial" quiet onSubmit={d => { setQ(text(d, 'serial')) }}><Field label="Find a serial" name="serial" hint="Whole or part of a serial number" /></Form>
    {error && <p role="alert">{error}</p>}
    {found && found.length === 0 && <Empty>No serial matches {q}.</Empty>}
    {found?.map(x => <SerialHistory key={x.lotId} larder={larder} x={x} />)}
  </Card>
}

function SerialHistory({ larder, x }: { larder: Larder; x: Rec }) {
  const s = larder.state!, place = x.place
  const where = place.state === 'shipped' ? `with ${place.customer} (${place.reference})` : place.state === 'assembled' ? `in ${place.reference}` : place.location ? `at ${place.location}` : ''
  return <article className="serial" aria-label={`Serial ${x.serial}`}>
    <h3>{x.serial} <small>{x.item} · {x.sku}</small></h3>
    <p><Chip tone={place.state === 'in stock' ? 'good' : place.state === 'shipped' ? 'info' : 'warn'}>{words(place.state)}</Chip> {where}</p>
    <Table head={['Record', 'Detail', 'When']}>
      <tr><td>{x.origin.kind === 'output' ? 'Made on' : x.origin.kind === 'receipt' ? 'Received on' : 'Recorded by'}</td><td>{x.origin.reference ?? words(x.origin.kind)}{x.origin.supplier && <small>{x.origin.supplier}</small>}</td><td>{when(x.origin.at)}</td></tr>
      {x.components.map((c: Rec) => <tr key={c.lotId}><td>Component</td><td>{c.serial || c.lot || 'Unlotted'}<small>{c.item} · {c.quantity}</small></td><td>—</td></tr>)}
      {x.into.map((p: Rec) => <tr key={p.lotId}><td>Assembled into</td><td>{p.serial}<small>{p.item} · {p.reference}</small></td><td>{when(p.at)}</td></tr>)}
      {x.customers.map((c: Rec) => <tr key={c.shipmentId}><td>Shipped to</td><td>{c.customer}<small>{c.shipment} · {c.order}{c.tracking ? ` · ${c.carrier} ${c.tracking}` : ''}{c.reversed ? ' · reversed' : ''}</small></td><td>{when(c.shippedAt)}</td></tr>)}
      {x.returns.map((r: Rec) => <tr key={r.returnId}><td>Returned</td><td>{r.reference}<small>{words(r.disposition)} · {r.reason}</small></td><td>{when(r.at)}</td></tr>)}
      {x.service.map((e: Rec) => <tr key={e.id}><td>{words(e.kind)}</td><td>{e.note}<small>{e.customer ? `At ${e.customer}` : words(e.state)}</small></td><td>{day(e.on)}</td></tr>)}
    </Table>
    {can(s, ['manager', 'quality']) && <Form title={`Record service on ${x.serial}`} submit="Record service" quiet busy={larder.busy} onSubmit={d => larder.run('serial.service', { itemId: x.itemId, serial: x.serial, kind: text(d, 'kind'), on: text(d, 'on'), note: text(d, 'note') })}>
      <Choose label="Service kind" name="kind" options={['service', 'warranty repair', 'inspection'].map(v => ({ value: v, label: words(v) }))} /><Field label="Service date" name="on" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /><Field label="What was done" name="note" />
    </Form>}
  </article>
}
