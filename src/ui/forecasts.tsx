import { MpsPolicyReview, MpsRelease } from './mps-policy-review'
import { ForecastHistory } from './forecast-history'
import { useState } from 'react'
import { byId, can, itemName, rows } from './api'
import type { Larder } from './app'
import { Card, Choose, Empty, Field, Form, Table, text } from './controls'
import { day, qty, when } from './format'

export function Forecasts({ larder }: { larder: Larder }) {
  const s = larder.state!, run = larder.run, busy = larder.busy
  const prepare = can(s, ['manager', 'buyer', 'production', 'agent']), maintain = can(s, ['manager', 'production'])
  const [inspected, setInspected] = useState('')
  const inspectedRow = s.masterSchedule.find((r: any) => `${r.itemId}:${r.week}` === inspected)
  const [shownItem, setShownItem] = useState('all')
  const [shownWeek, setShownWeek] = useState('all')
  const [selected, setSelected] = useState('')
  const selectedForecast = rows(s, 'forecasts').find(f => f.id === selected) ?? rows(s, 'forecasts')[0]
  const plans = [...rows(s, 'productionPlans')].reverse()
  return <>
    {prepare && <Card title="Import weekly forecast">
      <Form submit="Import forecast CSV" busy={busy} note="Columns: sku,week,quantity,seasonality. Weeks start Monday in UTC; quantities use each SKU’s base unit. Blank seasonality means 1. Import replaces only matching SKU/weeks and retains the original file and history." onSubmit={async d => {
        const file = d.get('file') as File
        return run('forecast.import', { stateVersion: s.version, file: { name: file.name, content: await file.text() }, reason: text(d, 'reason') })
      }}>
        <Field label="Forecast CSV" name="file" type="file" accept=".csv,text/csv" /><Field label="Import reason" name="reason" />
      </Form>
    </Card>}
    <Card title="Forecast and master production schedule">
      <p className="muted">Actual orders consume forecast in their delivery week. Net demand includes outstanding unreserved orders plus unused forecast. Error is actual orders minus adjusted forecast. Supply arriving within the week is pooled; these quantities do not promise machine or labor capacity.</p>
      {s.masterSchedule.some((r: any) => r.undatedShipped !== '0') && <p className="warn-text">Historical shipped demand is missing issued delivery dates. Reconcile its source documents before an MPS can be released.</p>}
      {s.masterSchedule.length > 0 && <Choose label="Schedule item" name="scheduleItem" value={shownItem} onChange={(e: any) => setShownItem(e.target.value)} options={[{ value: 'all', label: 'All items' }, ...rows(s, 'items').filter(i => s.masterSchedule.some((r: any) => r.itemId === i.id)).map(i => ({ value: i.id, label: `${i.name} · ${i.sku}` }))]} />}
      {s.masterSchedule.length > 0 && <Choose label="Schedule week" name="scheduleWeek" value={shownWeek} onChange={(e: any) => setShownWeek(e.target.value)} options={[{ value: 'all', label: 'All weeks' }, ...[...new Set<string>(s.masterSchedule.map((r: any) => r.week))].map(week => ({ value: week, label: `Week of ${day(week)}` }))]} />}
      {!s.masterSchedule.length ? <Empty>No forecast yet.</Empty> : <Table head={['Item / week', 'Forecast', 'Actual orders', 'Outstanding / reserved', 'Unused forecast', 'Net demand', 'Error', 'Available supply', 'Suggested supply', 'Closing stock', 'Sources']}>
        {s.masterSchedule.filter((r: any) => (shownWeek === 'all' || r.week === shownWeek) && (shownItem === 'all' || r.itemId === shownItem)).map((r: any) => <tr key={`${r.itemId}:${r.week}`}><td>{itemName(s, r.itemId)}<small>Week of {day(r.week)}</small></td><td>{qty(r.forecast)}<small>Base {qty(r.baseline)} × {qty(r.seasonality)}{r.overrideQuantity !== null && `; override ${qty(r.overrideQuantity)}`}</small></td><td>{qty(r.actual)}</td><td>{qty(r.outstanding)} / {qty(r.reserved)}</td><td>{qty(r.residualForecast)}</td><td>{qty(r.netDemand)}</td><td>{qty(r.error)}</td><td>{qty(r.available)}</td><td>{qty(r.proposed)}</td><td>{qty(r.closing)}</td><td><button type="button" className="link" aria-expanded={inspected === `${r.itemId}:${r.week}`} onClick={() => setInspected(inspected === `${r.itemId}:${r.week}` ? '' : `${r.itemId}:${r.week}`)}>Demand and supply sources</button></td></tr>)}
      </Table>}
      {inspectedRow && <section aria-label="Demand and supply sources"><h3>{itemName(s, inspectedRow.itemId)} · week of {day(inspectedRow.week)}</h3>
        <p>Forecast basis {qty(inspectedRow.baseline)} × {qty(inspectedRow.seasonality)}{inspectedRow.overrideQuantity !== null && `; override ${qty(inspectedRow.overrideQuantity)}`}. Free stock and arriving supply: {qty(inspectedRow.available)}.</p>
        {inspectedRow.sources.map((source: any, i: number) => <p key={i}><a href={`#orders/${source.orderId}`}>{source.reference}</a> · {qty(source.quantity)} for {day(source.date)} · {qty(source.outstanding)} outstanding, {qty(source.reserved)} reserved{source.shipmentReference && ` · shipped on ${source.shipmentReference}`}</p>)}
        {inspectedRow.supply.map((source: any) => <p key={source.documentId}><a href={`#make/${rows(s, 'workOrders').some(w => w.id === source.documentId) ? 'wo' : 'po'}/${source.documentId}`}>{source.reference}</a> · {qty(source.quantity)} expected {day(source.date)}</p>)}
        {inspectedRow.undatedSources.map((source: any, i: number) => <p key={i}>{source.reference} · {source.shipmentReference} · {qty(source.quantity)} without issued delivery-date evidence</p>)}
      </section>}
      {prepare && s.masterSchedule.length > 0 && <Form submit="Preview MPS" busy={busy} onSubmit={d => run('mps.preview', { reason: text(d, 'reason') })}><Field label="Schedule reason" name="reason" /></Form>}
    </Card>
    {maintain && rows(s, 'forecasts').length > 0 && <Card title="Adjust a forecast"><Choose label="Forecast week" name="forecast" value={selectedForecast?.id ?? ''} onChange={(e: any) => setSelected(e.target.value)} options={rows(s, 'forecasts').map(f => ({ value: f.id, label: `${itemName(s, f.itemId)} · ${f.week}` }))} /></Card>}
    {maintain && [selectedForecast].filter(Boolean).map(f => <Card key={f.id} title={`${itemName(s, f.itemId)} · week of ${day(f.week)}`}>
      <Form submit="Record forecast adjustment" busy={busy} onSubmit={d => run('forecast.adjust', { forecastId: f.id, version: f.version, seasonality: text(d, 'seasonality'), overrideQuantity: text(d, 'override') || null, reason: text(d, 'reason') })}>
        <Field label="Seasonality factor" name="seasonality" defaultValue={f.seasonality} inputMode="decimal" />
        <Field label="Override quantity" name="override" defaultValue={f.overrideQuantity ?? ''} required={false} inputMode="decimal" hint="Blank uses baseline × seasonality; zero explicitly forecasts none." /><Field label="Adjustment reason" name="reason" />
      </Form>
      <ForecastHistory s={s} forecast={f} />
      {f.history.at(-1)?.before && f.history.at(-1)?.kind !== 'undo' && <Form submit="Undo latest forecast change" quiet busy={busy} onSubmit={d => run('forecast.undo', { forecastId: f.id, version: f.version, historyId: f.history.at(-1).id, reason: text(d, 'reason') })}><Field label="Undo reason" name="reason" /></Form>}
    </Card>)}
    {plans.map(p => <Card key={p.id} title={`MPS · ${p.status} · ${when(p.createdAt)}`}>
      <p>{p.reason}</p><MpsPolicyReview s={s} plan={p} /><p className="muted">Approved release creates linked draft work or purchases. Releasing work and approving spend remain separate actions.</p>
      <section aria-label="MPS quantity suggestions"><Table head={['Item', 'Week', 'Forecast / actual', 'Net demand', 'Suggested supply']}>{p.rows.map((r: any) => <tr key={`${r.itemId}:${r.week}`}><td>{itemName(s, r.itemId)}</td><td>{day(r.week)}</td><td>{qty(r.forecast)} / {qty(r.actual)}</td><td>{qty(r.netDemand)}</td><td>{qty(r.proposed)}</td></tr>)}</Table></section>
      {p.status === 'preview' && maintain && <MpsRelease larder={larder} plan={p} disabled={busy || p.stateVersion !== s.version || (p.preparedBy === s.actor.id && s.actor.role !== 'owner')} />}
      {p.status === 'preview' && p.stateVersion !== s.version && <p className="warn-text">Records changed. Prepare a fresh MPS before approval.</p>}
      {p.status === 'preview' && p.preparedBy === s.actor.id && s.actor.role !== 'owner' && <p>A different authorized person must approve this MPS.</p>}
      {p.status === 'released' && <ul>{p.documents.map((d: any) => <li key={d.id}><a href={`#make/${d.kind === 'workOrders' ? 'wo' : 'po'}/${d.id}`}>{d.reference}</a> · {itemName(s, d.itemId)} · {qty(d.quantity)} · week of {day(d.week)} · {byId(s, d.kind, d.id)?.status}</li>)}</ul>}
    </Card>)}
  </>
}
