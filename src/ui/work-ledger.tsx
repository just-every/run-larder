// FLOOR-003: WIP quantities and costs by operation, scoped holds and dated backorders.
import { can, personName, rows, unitOf, type Rec } from './api'
import type { Larder } from './app'
import { Choose, Field, Form, Table, text } from './controls'
import { day, money, qty, when, words } from './format'

const buckets = [['upstream', 'Upstream'], ['waiting', 'Waiting'], ['running', 'Running'], ['completed', 'Completed'], ['movedOn', 'Handed on'], ['held', 'Held'], ['scrapped', 'Scrapped'], ['backordered', 'Backordered']] as const

export function WorkLedger({ larder, w }: { larder: Larder; w: Rec }) {
  const s = larder.state!, ledger = s.operationLedgers?.[w.id], supervisor = can(s, ['manager'])
  if (!ledger) return null
  return <section aria-label={`${w.reference} operation ledger`}>
    <h3>Operation ledger</h3>
    <p className="muted">{ledger.costBasis} Quantities are in {unitOf(s, w.itemId)}; every unit is in exactly one column.</p>
    <Table head={['Units and material cost', ...ledger.steps.map((step: any) => `Step ${step.sequence}: ${step.name}`)]} numeric={ledger.steps.map((_: any, i: number) => i + 1)} stack>
      <tr><td>Status</td>{ledger.steps.map((step: any) => <td className="num" key={step.sequence}>{words(step.status)}</td>)}</tr>
      {buckets.map(([key, label]) => <tr key={key}><td>{label}</td>{ledger.steps.map((step: any) => <td className="num" key={step.sequence}>{key === 'upstream' ? qty(step.quantities[key]) : `${qty(step.quantities[key])} · ${money(step.costs[key])}`}</td>)}</tr>)}
    </Table>
    {ledger.backorders.length > 0 && <section aria-label={`${w.reference} manufacturing backorders`}>
      <h4>Manufacturing backorders</h4>
      {ledger.backorders.map((b: any) => <div className="proposal" key={b.id}>
        <p><strong>{qty(b.quantity)} {unitOf(s, w.itemId)} at step {b.sequence}</strong> · due {day(b.dueOn)} · job required by {day(b.requiredBy)}{b.late ? ' · after the required date' : ''} · {words(b.status)}</p>
        <p>{b.reason} · {personName(s, b.by)} {when(b.at)} · cost carried {money(b.cost)}</p>
        <p>Material commitments: {b.materials.map((m: any) => `${qty(m.needed)} needed, ${qty(m.reserved)} reserved, ${qty(m.issued)} issued`).join('; ') || 'none'}. Capacity commitments: {b.capacity.map((c: any) => `step ${c.sequence} ${c.workCentre || 'unassigned'} ${qty(c.minutes)} min`).join('; ')}.</p>
        {b.status === 'resumed' && <p>Resumed by {personName(s, b.resumedBy)} {when(b.resumedAt)}: {b.resumeReason}</p>}
        {b.status === 'open' && supervisor && <Form submit={`Resume backorder at step ${b.sequence}`} busy={larder.busy} onSubmit={data => larder.run('wo.operation.backorderResume', { workOrderId: w.id, version: w.version, sequence: b.sequence, backorderId: b.id, reason: text(data, 'reason') })}>
          <Field label={`Step ${b.sequence} backorder resume reason`} name="reason" />
        </Form>}
      </div>)}
    </section>}
  </section>
}

export function WorkLedgerControls({ larder, w, task, sequence }: { larder: Larder; w: Rec; task: any; sequence: number }) {
  const s = larder.state!, ledger = s.operationLedgers?.[w.id]?.steps.find((x: any) => x.sequence === sequence), supervisor = can(s, ['manager'])
  if (!ledger || !can(s, ['manager', 'production', 'operator'])) return null
  const mine = supervisor || task.startedBy === s.actor.id && task.assignment?.operatorId === s.actor.id
  const payload = { workOrderId: w.id, version: w.version, sequence }, unit = unitOf(s, w.itemId)
  const openHolds = (task.holds ?? []).filter((h: any) => h.status === 'open')
  return <section aria-label={`Step ${sequence} quantity ledger`}>
    <h4>Quantities and holds</h4>
    {(task.reports ?? []).length > 0 && <details><summary>Step {sequence} quantity reports</summary><ul className="history">{task.reports.map((r: any) => <li key={r.id}>{qty(r.good)} good · {qty(r.scrap)} scrap{r.scrapReason ? ` (${r.scrapReason})` : ''} · {personName(s, r.by)} · {when(r.at)} · {r.reason}</li>)}</ul></details>}
    {(task.holds ?? []).length > 0 && <ul className="history">{task.holds.map((h: any) => <li key={h.id}>Hold {qty(h.quantity)} {unit} · {words(h.status)}{h.disposition ? ` (${h.disposition})` : ''} · {personName(s, h.by)} {when(h.at)}: {h.reason}{h.releasedAt ? ` · released by ${personName(s, h.releasedBy)} ${when(h.releasedAt)}: ${h.releaseReason}` : ''}</li>)}</ul>}
    {task.status === 'running' && mine && <Form title={`Step ${sequence} actual quantities`} submit={`Record step ${sequence} quantities`} busy={larder.busy} note="Actual completed and scrapped units. These never post finished output or stock." onSubmit={data => larder.run('wo.operation.report', { ...payload, good: text(data, 'good') || '0', scrap: text(data, 'scrap') || '0', scrapReason: text(data, 'scrapReason'), reason: text(data, 'reason') })}>
      <Field label={`Step ${sequence} good units completed`} name="good" required={false} inputMode="decimal" hint={`Additional units in ${unit}.`} />
      <Field label={`Step ${sequence} scrap units`} name="scrap" required={false} inputMode="decimal" />
      <Field label={`Step ${sequence} scrap reason`} name="scrapReason" required={false} />
      <Field label={`Step ${sequence} quantity reason`} name="reason" />
    </Form>}
    {['running', 'done'].includes(task.status) && mine && <Form title={`Step ${sequence} hold`} submit={`Hold step ${sequence} units`} busy={larder.busy} onSubmit={data => larder.run('wo.operation.hold', { ...payload, quantity: text(data, 'quantity'), reason: text(data, 'reason') })}>
      <Field label={`Step ${sequence} hold quantity`} name="quantity" inputMode="decimal" />
      <Field label={`Step ${sequence} hold reason`} name="reason" />
    </Form>}
    {supervisor && openHolds.length > 0 && <Form title={`Step ${sequence} release hold`} submit={`Release step ${sequence} hold`} busy={larder.busy} onSubmit={data => larder.run('wo.operation.holdRelease', { ...payload, holdId: text(data, 'holdId'), disposition: text(data, 'disposition'), reason: text(data, 'reason') })}>
      <Choose label={`Step ${sequence} hold to release`} name="holdId" options={openHolds.map((h: any) => ({ value: h.id, label: `${qty(h.quantity)} ${unit}: ${h.reason}` }))} />
      <Choose label={`Step ${sequence} hold disposition`} name="disposition" options={[{ value: 'continue', label: 'Continue to the next operation' }, { value: 'scrap', label: 'Scrap the units' }]} />
      <Field label={`Step ${sequence} hold release reason`} name="reason" />
    </Form>}
    {supervisor && task.status !== 'done' && w.status === 'released' && <Form title={`Step ${sequence} manufacturing backorder`} submit={`Backorder step ${sequence} units`} busy={larder.busy} note="Defers uncompleted units to a dated backorder; material reservations stay and capacity commitments are listed in the ledger." onSubmit={data => larder.run('wo.operation.backorder', { ...payload, quantity: text(data, 'quantity'), dueOn: text(data, 'dueOn'), reason: text(data, 'reason') })}>
      <Field label={`Step ${sequence} backorder quantity`} name="quantity" inputMode="decimal" />
      <Field label={`Step ${sequence} backorder date`} name="dueOn" type="date" />
      <Field label={`Step ${sequence} backorder reason`} name="reason" />
    </Form>}
  </section>
}
