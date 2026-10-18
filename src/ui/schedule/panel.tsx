// The selected job beside the chart: its state and facts, the planner's resequence against keeping the
// current plan (both computed from the records), and the latest recorded actions.
import { byId, can, personName, rows, type LarderState, type Rec } from '../api'
import type { Larder } from '../app'
import { actions } from '../activity'
import { Chip } from '../controls'
import { Icon } from '../icons'
import { clock, dayName, qty, unitLabel, when, words } from '../format'
import { addDays, daysBetween, fromDate, load, SHIFT, startOfDay, type Plan } from './plan'

const due = (w: Rec) => { const d = fromDate(w.requiredBy); d.setHours(SHIFT.end); return d }
const firstStart = (plan: Plan, id: string) => plan.ops.filter(o => o.workOrder.id === id).map(o => o.start).sort((a, b) => a.getTime() - b.getTime())[0]

function Facts({ s, w, plan }: { s: LarderState; w: Rec; plan: Plan }) {
  const short = (w.shortages ?? []).length > 0, item = byId(s, 'items', w.itemId), end = plan.finish.get(w.id)
  const bom = w.bomRevision ?? rows(s, 'boms').find(b => b.itemId === w.itemId && b.status === 'active')?.revision
  return <dl className="metrics">
    <div><dt>Finishes</dt><dd className="num">{end ? <>{dayName(end)}<small>{clock(end)}</small></> : 'Not scheduled'}</dd></div>
    <div><dt>Materials</dt><dd>{w.status === 'draft' ? 'Not released' : short ? <span className="red">Short</span> : 'Reserved'}</dd></div>
    <div><dt>BOM</dt><dd>{bom ? `Rev ${bom}` : 'None yet'}{item && <small>{item.sku}</small>}</dd></div>
  </dl>
}

function Recovery({ larder, proposal, plan, proposed, now }: { larder: Larder; proposal: Rec; plan: Plan; proposed: Plan; now: Date }) {
  const s = larder.state!, busy = larder.busy
  const changed = proposal.plan.changes.map((ch: any) => ({ ch, w: byId(s, 'workOrders', ch.workOrderId) })).filter((x: any) => x.w)
  const from = startOfDay(now), to = addDays(from, 7)
  const centers = [...new Set(proposed.ops.filter(o => changed.some((x: any) => x.w.id === o.workOrder.id)).map(o => o.workCenter))]
    .map(c => ({ c, before: load(plan, c, from, to).percent, after: load(proposed, c, from, to).percent })).filter(x => x.before !== x.after)
  const approve = can(s, ['manager', 'production']) && s.actor.role !== 'agent' && (proposal.preparedBy !== s.actor.id || s.actor.role === 'owner')
  return <section className="recovery-options" aria-label="Recovery options">
    <h3>Recovery options</h3>
    <article className="plan-option chosen">
      <h4><Icon name="check" /><span>Plan A</span> Planner's resequence</h4>
      <p>{proposal.summary}{proposal.assumptions && <small> {proposal.assumptions}</small>}</p>
      <dl>
        {changed.map(({ w }: any) => { const a = firstStart(plan, w.id), b = firstStart(proposed, w.id); return <div key={`start:${w.id}`}><dt>{w.reference} starts</dt><dd className="num">{a ? dayName(a) : '—'} → {b ? dayName(b) : '—'}</dd><dd /></div> })}
        {centers.map(x => <div key={`load:${x.c}`}><dt>{x.c} load</dt><dd className="num">{x.before}% → {x.after}%</dd><dd /></div>)}
        {changed.map(({ w }: any) => { const end = proposed.finish.get(w.id), ok = !!end && end <= due(w); return <div key={`end:${w.id}`}><dt>{w.reference} finishes</dt><dd className="num">{end ? dayName(end) : '—'}</dd><dd className={ok ? 'still-on' : 'red'}>{ok ? '(still on)' : '(late)'}</dd></div> })}
      </dl>
      {approve && <button type="button" className="button primary wide" disabled={busy} onClick={() => larder.run('proposal.approve', { proposalId: proposal.id, version: proposal.version })}>Approve plan A</button>}
      <p className="byline">Prepared by {personName(s, proposal.preparedBy)}, {when(proposal.createdAt)}</p>
    </article>
    <article className="plan-option">
      <h4><span className="radio" aria-hidden="true" /><span>Plan B</span> Keep as is</h4>
      <p>Keep the current sequence and priorities.</p>
      <dl>{changed.map(({ w }: any) => { const end = plan.finish.get(w.id), slip = end && end > due(w) ? daysBetween(due(w), end) : 0; return <div key={w.id} className="pair">
        <div><dt>{w.reference} finishes</dt><dd className={slip ? 'red num' : 'num'}>{end ? dayName(end) : '—'}</dd></div>
        <div><dt>Needed by</dt><dd className="num">{dayName(fromDate(w.requiredBy))}{slip ? <strong className="red"> · {slip} {slip === 1 ? 'day' : 'days'} late</strong> : ' · on time'}</dd></div>
      </div> })}</dl>
    </article>
    <div className="plan-actions">
      <a className="button" href={`#make/wo/${changed[0]?.w.id ?? ''}`}>Edit…</a>
      {approve && <button type="button" className="button" disabled={busy} onClick={() => larder.run('proposal.reject', { proposalId: proposal.id, version: proposal.version, note: 'Kept the current plan' })}>Keep as is</button>}
    </div>
  </section>
}

function Operations({ plan, w }: { plan: Plan; w: Rec }) {
  const ops = plan.ops.filter(o => o.workOrder.id === w.id)
  return <section className="operations"><h3>Operations</h3>
    {ops.length === 0 ? <p className="muted">No routing steps with minutes on this item's bill of materials.</p> : <ol>{ops.map(o => <li key={o.key}><strong>Op {o.sequence} {o.step}</strong><span>{o.workCenter}</span><span className="num">{dayName(o.start)}, {clock(o.start)} – {o.end.toDateString() === o.start.toDateString() ? clock(o.end) : `${dayName(o.end)}, ${clock(o.end)}`}</span></li>)}</ol>}
    <a className="button wide" href={`#make/wo/${w.id}`}>Open work order</a>
  </section>
}

export function JobPanel({ larder, w, plan, proposed, proposal, now }: { larder: Larder; w: Rec; plan: Plan; proposed?: Plan; proposal?: Rec; now: Date }) {
  const s = larder.state!, item = byId(s, 'items', w.itemId), ops = plan.ops.filter(o => o.workOrder.id === w.id)
  const late = ops.some(o => o.late), short = ops.some(o => o.short)
  const involved = proposal && proposed && proposal.plan.changes.some((ch: any) => ch.workOrderId === w.id)
  return <aside className="job-panel card">
    <header className="job-head"><h2>{w.reference}</h2><Chip tone={short || late ? 'bad' : w.status === 'draft' ? 'neutral' : 'go'}>{short ? 'Short' : late ? 'Late' : w.status === 'draft' ? 'Draft' : 'On track'}</Chip></header>
    <p className="job-item">{item?.name ?? 'Removed item'}</p>
    <p className="job-meta"><span className="num">{qty(w.quantity)} {unitLabel(item?.baseUnit)}</span><b aria-hidden="true">•</b><span>needed {dayName(fromDate(w.requiredBy))}</span><b aria-hidden="true">•</b><span>{words(w.status)}</span></p>
    <Facts s={s} w={w} plan={plan} />
    {involved ? <Recovery larder={larder} proposal={proposal!} plan={plan} proposed={proposed!} now={now} /> : <Operations plan={plan} w={w} />}
  </aside>
}

export function Worklog({ s }: { s: LarderState }) {
  const list = rows(s, 'commands').slice(0, 4), today = new Date().toDateString()
  return <section className="worklog card" aria-label="Recent activity">
    <header className="card-head"><h2><Icon name="clock" />Recent activity</h2><a href="#more/activity">View all activity <Icon name="arrow" /></a></header>
    {list.length === 0 ? <p className="empty">No actions recorded yet.</p> : <ul>{list.map(c => { const d = new Date(c.createdAt); return <li key={c.id}><time className="num">{d.toDateString() === today ? clock(d) : dayName(d)}</time><span>{actions[c.type] ?? words(String(c.type).replace('.', ' '))}</span><span className="muted">{personName(s, c.actorId)}</span></li> })}</ul>}
  </section>
}
