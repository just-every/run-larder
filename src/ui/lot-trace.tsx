import { useEffect, useState } from 'react'
import { rows, type Rec } from './api'
import type { Larder } from './app'
import { Card, Choose, Table, options } from './controls'
import { when } from './format'

export function LotTrace({ larder }: { larder: Larder }) {
  const s = larder.state!, [lotId, setLotId] = useState(''), [direction, setDirection] = useState('upstream'), [trace, setTrace] = useState<any>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false)
  useEffect(() => {
    const controller = new AbortController(); setTrace(null); setError('')
    if (!lotId) { setLoading(false); return }
    setLoading(true)
    fetch(`/api/larder/lots/${lotId}/trace?direction=${direction}`, { signal: controller.signal, credentials: 'same-origin', cache: 'no-store' }).then(async r => { const b: any = await r.json(); if (!r.ok) throw Error(b.error?.message ?? 'Trace could not load.'); return b }).then(setTrace).catch(e => { if (e.name !== 'AbortError') setError(e.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [lotId, direction, s.version])
  const records = (kind: string) => (trace?.rows ?? []).filter((r: Rec) => r.recordType === kind)
  return <Card title="Lot genealogy">
    <div className="form-grid"><Choose label="Trace lot" name="traceLot" options={options(rows(s, 'lots'), l => `${l.code} · ${rows(s, 'items').find(i => i.id === l.itemId)?.name}${l.ownerId ? ' · customer property' : ''}`)} value={lotId} onChange={(e: any) => setLotId(e.target.value)} /><Choose label="Trace direction" name="traceDirection" options={[{ value: 'upstream', label: 'Upstream: inputs and suppliers' }, { value: 'downstream', label: 'Downstream: outputs and customers' }]} value={direction} onChange={(e: any) => setDirection(e.target.value)} /></div>
    {loading && <p role="status">Loading lot trace…</p>}{error && <p role="alert">{error}</p>}
    {trace && <div aria-label="Lot trace results">
      <p>Selected lot <strong>{trace.selectedLot}</strong> · {trace.direction}. <a className="button" href={`/api/larder/lots/${lotId}/trace.csv?direction=${direction}`} download>Download trace CSV</a></p>
      <p className="muted">Relationships show recorded ancestry. New production batches retain exact component-lot consumption. Legacy jobs are labelled when batch allocations were not recorded. WIP split/merge rows transfer responsibility without inventing lot allocations. Subcontract receipts and repair orders retain their recorded input/output links. Each physical movement or customer custody event appears once below. Reconcile signed quantities within each lot, location and status; relationship, report and WIP quantities are separate and may use different units.</p>
      <Table head={['From', 'To', 'Relationship', 'Quantity / unit', 'When', 'Document / party']}>
        {records('relation').map((r: Rec) => <tr key={r.id}><td>{r.fromLabel}</td><td>{r.toLabel}</td><td>{r.kind ?? r.basis}<small>{r.basis}</small></td><td>{r.quantity} {r.unit}{r.netQuantity !== undefined && <small>Net after reversal: {r.netQuantity}</small>}</td><td>{r.date ? when(r.date) : '—'}</td><td>{r.reference} {r.orderReference}<small>{r.party}</small></td></tr>)}
      </Table>
      <h3>Production and disposition reports</h3><Table head={['Event', 'Document', 'When', 'Good', 'Scrap', 'Basis']}>
        {records('event').map((r: Rec) => <tr key={r.id}><td>{r.kind}</td><td>{r.reference}</td><td>{when(r.date)}</td><td>{r.quantity} {r.unit}</td><td>{r.scrap ?? '—'} {r.scrap !== undefined ? r.unit : ''}{r.scrapValue && <small>Scrap value {r.scrapValue}</small>}</td><td>{r.basis}</td></tr>)}
      </Table>
      <h3>Physical ledger</h3><Table head={['Lot / item', 'Location / status', 'Change / unit', 'When', 'Document / order', 'Kind / basis']}>
        {[...records('movement'), ...records('custody')].map((r: Rec) => <tr key={r.id}><td>{r.lot || 'Unlotted'}<small>{r.item}</small></td><td>{r.location}<small>{r.status}</small></td><td>{r.quantity} {r.unit}</td><td>{when(r.date)}</td><td>{r.reference} {r.orderReference}<small>{r.party}</small></td><td>{r.kind}<small>{r.basis}{r.reversesId ? ' · compensates an earlier movement' : ''}</small></td></tr>)}
      </Table>
      <h3>Reconciled balances</h3><Table head={['Lot / item', 'Location', 'Status', 'Quantity / unit', 'Basis']}>
        {records('balance').map((r: Rec) => <tr key={r.id}><td>{r.lot || 'Unlotted'}<small>{r.item}</small></td><td>{r.location}</td><td>{r.status}</td><td>{r.quantity} {r.unit}</td><td>{r.basis}</td></tr>)}
      </Table>
    </div>}
  </Card>
}
