import { can, personName, rows } from './api'
import type { Larder } from './app'
import { Card, Chip, Choose, Empty, Field, Form, Table, text } from './controls'
import { money, when, words } from './format'

const metrics = ['stockValueUsd', 'stockUnits', 'reservedUnits', 'activeBoms', 'openWorkOrders', 'wipValueUsd', 'capacityMinutes', 'openSalesOrders', 'openSalesValueUsd', 'openPurchaseOrders', 'openPurchaseValueUsd']
const metricLabel = (m: string) => words(m.replace(/([A-Z])/g, ' $1').toLowerCase())
const channels = [{ value: 'sales-orders', label: 'Sales orders, reservations, shipments and returns' }, { value: 'purchase-orders', label: 'Purchase orders and receipts' }, { value: 'stock-ledger', label: 'Stock ledger (every stock movement)' }, { value: 'accounting-handoff', label: 'Accounting handoff to your ledger' }]

// MOVE-007: rehearse, compare a day, approve one cutover time and choose which system writes each channel.
export function Cutover({ larder }: { larder: Larder }) {
  const s = larder.state!, plan = [...rows(s, 'cutovers')].reverse().find(p => ['draft', 'approved'].includes(p.status)), reconciler = can(s, ['manager', 'accounts']), owner = s.actor.role === 'owner'
  const batches = rows(s, 'imports').filter(b => ['previewed', 'committed'].includes(b.status))
  if (!plan) return <Card title="Plan a cutover">{!can(s, ['manager', 'agent']) ? <Empty>No cutover is planned.</Empty> : <Form submit="Plan cutover" busy={larder.busy} onSubmit={d => larder.run('cutover.plan', { label: text(d, 'label'), importIds: [text(d, 'importId')] })}>
    <Field label="Label" name="label" placeholder="Odoo cutover" /><Choose label="Move-in" name="importId" options={batches.map(b => ({ value: b.id, label: `${b.label} (${words(b.status)})` }))} /></Form>}</Card>
  const live = plan.status === 'approved' && plan.cutoverAt <= new Date().toISOString(), at = { cutoverId: plan.id, version: plan.version }
  const imports = plan.importIds.map((id: string) => rows(s, 'imports').find(b => b.id === id)).filter(Boolean)
  const unmatched: string[] = plan.comparisons.at(-1)?.unmatched ?? []
  return <>
    <Card title={<>{plan.label} <Chip tone={live ? 'good' : 'info'}>{live ? 'Live' : plan.status === 'approved' ? `Cutover ${when(plan.cutoverAt)}` : 'Rehearsing'}</Chip></>}>
      <dl className="facts counts"><div><dt>Rehearsals</dt><dd>{plan.rehearsals.length}{plan.rehearsals.length > 1 ? (plan.rehearsals.at(-1).identical ? ' · last two identical' : ' · last two differ') : ''}</dd></div><div><dt>Days compared</dt><dd>{plan.comparisons.length}</dd></div>{plan.openingTotalUsd && <div><dt>Opening total approved</dt><dd>{money(plan.openingTotalUsd)} USD</dd></div>}</dl>
      <Table head={['Move-in', 'Status', 'Valuation']}>{imports.map((b: any) => { const r = plan.reconciliations.find((x: any) => x.importId === b.id && x.fingerprint === b.fingerprint); return <tr key={b.id}><td>{b.label}</td><td>{words(b.status)}</td><td>{!b.valuation ? 'No stock' : b.valuation.matched ? 'Matched to the cent' : r ? `Difference ${money(r.differenceUsd)} USD accepted` : `Difference ${money(b.valuation.differenceUsd)} USD · ${b.valuation.reviewCount} rows to review`}
        {reconciler && plan.status === 'draft' && b.valuation && !b.valuation.matched && !r && <Form submit="Accept this difference" quiet busy={larder.busy} onSubmit={d => larder.run('cutover.reconcile', { ...at, importId: b.id, differenceUsd: b.valuation.differenceUsd, note: text(d, 'note') })}><Field label="Why it is acceptable" name="note" /></Form>}</td></tr> })}</Table>
      {plan.status === 'draft' && can(s, ['manager', 'agent']) && <Form submit="Rehearse again (changes nothing)" quiet busy={larder.busy} onSubmit={() => larder.run('cutover.rehearse', at)}><span /></Form>}
    </Card>
    <Card title="Compare a day">
      {plan.comparisons.length > 0 && <Table head={['Day', 'Matched', 'Differences']}>{[...plan.comparisons].reverse().map((x: any) => <tr key={x.id}><td>{x.day}</td><td>{x.matched ? 'Yes' : 'No'}</td><td>{x.differences.filter((d: any) => d.difference !== '0').map((d: any) => `${metricLabel(d.metric)}: source ${d.source}, Larder ${d.larder}`).join('; ') || '—'}</td></tr>)}</Table>}
      {can(s, ['manager', 'accounts', 'agent']) && <Form submit="Record comparison" busy={larder.busy} note="Enter the source system's totals for the day; leave a total blank to skip it." onSubmit={d => larder.run('cutover.compare', { ...at, day: text(d, 'day'), source: Object.fromEntries(metrics.filter(m => text(d, m)).map(m => [m, text(d, m)])) })}>
        <Field label="Day" name="day" type="date" />{metrics.map(m => <Field key={m} label={metricLabel(m)} name={m} required={false} inputMode="decimal" />)}</Form>}
    </Card>
    {owner && plan.status === 'draft' && <Card title="Approve opening totals and one cutover time"><Form submit="Approve cutover" busy={larder.busy} onSubmit={d => larder.run('cutover.approve', { ...at, cutoverAt: new Date(text(d, 'cutoverAt')).toISOString(), openingTotalUsd: text(d, 'total'), reason: text(d, 'reason'), acceptDifferences: d.get('accept') ? unmatched : [] })}>
      <Field label="Opening total (USD)" name="total" inputMode="decimal" /><Field label="Cutover time" name="cutoverAt" type="datetime-local" /><Field label="Reason" name="reason" />
      {unmatched.length > 0 && <label className="check"><input name="accept" type="checkbox" /> Accept the last comparison's differences: {unmatched.map(metricLabel).join(', ')}</label>}</Form></Card>}
    <Card title="Which system writes each channel">
      <Table head={['Channel', 'Written in']}>{channels.map(ch => <tr key={ch.value}><td>{ch.label}</td><td>{plan.channels[ch.value] === 'larder' ? 'Larder' : 'Source system'}</td></tr>)}</Table>
      <p className="muted">From the cutover time Larder refuses any command that would write a channel routed to the source system, so live orders, stock and ledger entries exist in one place. {plan.history.length ? `Last change by ${personName(s, plan.history.at(-1).by)}: ${plan.history.at(-1).reason}.` : ''}</p>
      {owner && <Form submit="Route channel" busy={larder.busy} onSubmit={d => larder.run('cutover.route', { ...at, channel: text(d, 'channel'), authority: text(d, 'authority'), reason: text(d, 'reason') })}><Choose label="Channel" name="channel" options={channels} /><Choose label="Written in" name="authority" options={[{ value: 'larder', label: 'Larder' }, { value: 'source', label: 'Source system' }]} /><Field label="Reason" name="reason" /></Form>}
      {owner && !live && <Form submit="Cancel cutover" quiet busy={larder.busy} onSubmit={d => larder.run('cutover.cancel', { ...at, reason: text(d, 'cancelReason') })}><Field label="Why cancel" name="cancelReason" /></Form>}
    </Card>
  </>
}
