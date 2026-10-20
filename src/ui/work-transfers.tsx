import type { Larder } from './app'
import { byId, can, rows, type Rec } from './api'
import { Card, Choose, Field, Form, text } from './controls'
import { money, plus, qty, when, words } from './format'

export function WorkTransfers({ larder, w }: { larder: Larder; w: Rec }) {
  const s = larder.state!, transfers = rows(s, 'workTransfers').filter(t => t.transfers.some((a: Rec) => a.sourceId === w.id || a.destinationId === w.id))
  const active = ['draft', 'released'].includes(w.status) && Number(w.quantity) > Number(w.output) + Number(w.scrap)
  const others = rows(s, 'workOrders').filter(x => x.id !== w.id && x.itemId === w.itemId && ['draft', 'released'].includes(x.status) && Number(x.quantity) > Number(x.output) + Number(x.scrap))
  return <Card title="Split and merge work">
    <p>Material cost attributed to this job: {money(s.workTransferCosts?.[w.id] ?? '0')}. Original movements and recorded operation time stay on their original job; transferred WIP is counted once.</p>
    {w.quantityAllocations && <p>Original quantity ranges: {w.quantityAllocations.map((a: Rec) => `${byId(s, 'workOrders', a.originId)?.reference}: ${a.start} + ${a.quantity}`).join('; ') || 'All remaining work transferred.'}</p>}
    {w.demandSources?.map((d: Rec, i: number) => <p key={`${d.workOrderId}:${i}`}>Original demand: <a href={`#make/wo/${d.workOrderId}`}>{byId(s, 'workOrders', d.workOrderId)?.reference}</a> · {d.documentKind === 'salesOrders' && d.documentId ? <a href={`#orders/${d.documentId}`}>{d.reference} · {qty(d.quantity)}</a> : d.reason}</p>)}
    {transfers.map(t => <section key={t.id} aria-label={`${words(t.kind)} history`}><h3>{words(t.kind)} · {when(t.createdAt)}</h3><p>{t.reason}</p>{t.transfers.map((a: Rec, i: number) => <p key={i}><a href={`#make/wo/${a.sourceId}`}>{byId(s, 'workOrders', a.sourceId)?.reference}</a> → <a href={`#make/wo/${a.destinationId}`}>{byId(s, 'workOrders', a.destinationId)?.reference}</a> · {qty(a.quantity)} units · issued material value {money(a.components.reduce((n: string, x: Rec) => plus(n, x.cost), '0'))}</p>)}</section>)}
    {active && can(s, ['manager', 'production']) && <>
      <Form title="Split remaining work" submit="Split work" busy={larder.busy} note="Completed quantities, lots and clocks stay here. Enter one or two remaining batches; existing material/WIP and reservations move with them. Active clocks and open quality holds must be resolved first." onSubmit={d => larder.run('wo.split', { workOrderId: w.id, version: w.version, reason: text(d, 'reason'), parts: [0, 1].filter(i => text(d, `quantity.${i}`)).map(i => ({ quantity: text(d, `quantity.${i}`), centres: Object.fromEntries(w.routing.filter((r: Rec) => text(d, `center.${i}.${r.sequence}`)).map((r: Rec) => [r.sequence, text(d, `center.${i}.${r.sequence}`)])) })) })}>
        {[0, 1].map(i => <fieldset className="lines wide" key={i}><legend>Remaining batch {i + 1}</legend><Field label={`Batch ${i + 1} quantity`} name={`quantity.${i}`} required={i === 0} />{w.routing.map((r: Rec) => <Choose key={r.sequence} label={`Batch ${i + 1} step ${r.sequence} center`} name={`center.${i}.${r.sequence}`} required={false} defaultValue={r.workCentre} options={(r.eligibleCentres?.length ? r.eligibleCentres : [r.workCentre]).filter(Boolean).map((value: string) => ({ value, label: value }))} />)}</fieldset>)}
        <Field label="Split reason" name="reason" />
      </Form>
      {others.length > 0 && <Form title="Merge compatible remaining work" submit="Merge work" busy={larder.busy} note="Only matching item/state/engineering/operation stage can merge. Jobs with shipped output, overlapping quantities, active clocks or open quality holds are refused." onSubmit={d => { const other = byId(s, 'workOrders', text(d, 'otherId'))!; return larder.run('wo.merge', { reason: text(d, 'reason'), sources: [{ workOrderId: w.id, version: w.version }, { workOrderId: other.id, version: other.version }] }) }}>
        <Choose label="Other job" name="otherId" options={others.map(x => ({ value: x.id, label: `${x.reference} · revision ${x.bomRevision ?? 'draft'}` }))} /><Field label="Merge reason" name="reason" />
      </Form>}
    </>}
  </Card>
}
