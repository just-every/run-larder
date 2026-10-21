// The selected job beside the chart: its state and facts, the planner's resequence against keeping the
// current plan (both computed from the records), and the latest recorded actions.
import { byId, can, personName, rows, type LarderState, type Rec } from '../api'
import type { Larder } from '../app'
import { actions } from '../activity'
import { Chip } from '../controls'
import { Icon } from '../icons'
import { clock, dayName, qty, unitLabel, when, words } from '../format'
import { addDays, daysBetween, fromDate, load, SHIFT, startOfDay, type Plan } from './plan'
import { coveredBy, firstStart, stories } from '../supply'

// A job is on time when it finishes by the end of the shift on its needed-by day, as the scheduler counts it.
const due = (w: Rec) => { const d = fromDate(w.requiredBy); d.setHours(SHIFT.end); return d }

function Facts({ s, w, plan }: { s: LarderState; w: Rec; plan: Plan }) {
  const short = (w.shortages ?? []).length > 0, item = byId(s, 'items', w.itemId), end = plan.finish.get(w.id), until = short ? coveredBy(s, w, plan) : undefined
  const bom = w.bomRevision ?? rows(s, 'boms').find(b => w.engineeringBomId ? b.id === w.engineeringBomId : b.itemId === w.itemId && b.status === 'active')?.revision
  return <dl className="metrics">
    <div><dt>Finishes</dt><dd className="num">{end ? <>{dayName(end)}<small>{clock(end)}</small></> : 'Not scheduled'}</dd></div>
    <div><dt>Materials</dt><dd>{w.status === 'draft' ? 'Not released' : short ? <><span className="red">Short</span>{until && <small>until {dayName(until)}</small>}</> : 'Reserved'}</dd></div>
    <div><dt>BOM</dt><dd>{bom ? `Rev ${bom}` : 'None yet'}{item && <small>{item.sku}</small>}</dd></div>
  </dl>
}

// Every job whose finish the proposal changes, moved or pushed: its finish now and under the proposal, against
// its needed-by date. Both plans are the scheduler's own layout of the same records.
function consequences(s: LarderState, plan: Plan, proposed: Plan, moved: Set<string>) {
  const ids = [...new Set([...plan.finish.keys(), ...proposed.finish.keys()])]
  return ids.map(id => {
    const w = byId(s, 'workOrders', id)!, before = plan.finish.get(id), after = proposed.finish.get(id), by = due(w)
    const lateBy = (end?: Date) => end && end > by ? Math.max(1, daysBetween(by, end)) : 0
    return { w, before, after, by, was: lateBy(before), will: lateBy(after) }
  }).filter(x => moved.has(x.w.id) || x.before?.getTime() !== x.after?.getTime())
    .sort((a, b) => Number(moved.has(b.w.id)) - Number(moved.has(a.w.id)) || a.w.reference.localeCompare(b.w.reference))
}
const daysLate = (n: number) => `late, ${n} ${n === 1 ? 'day' : 'days'}`
const stamp = (d?: Date) => d ? `${dayName(d)} ${clock(d)}` : 'Not scheduled'

function Recovery({ larder, proposal, plan, proposed, now }: { larder: Larder; proposal: Rec; plan: Plan; proposed: Plan; now: Date }) {
  const s = larder.state!, busy = larder.busy
  const changed = proposal.plan.changes.map((ch: any) => ({ ch, w: byId(s, 'workOrders', ch.workOrderId) })).filter((x: any) => x.w)
  const from = startOfDay(now), to = addDays(from, 7)
  const centers = plan.centers.map(c => ({ c, before: load(plan, c, from, to).percent, after: load(proposed, c, from, to).percent })).filter(x => x.before !== x.after)
  const effects = consequences(s, plan, proposed, new Set(changed.map((x: any) => x.w.id)))
  const turnsLate = effects.filter(e => e.will && !e.was), recovers = effects.filter(e => e.was && !e.will)
  const approve = can(s, ['manager', 'production', 'planner']) && s.actor.role !== 'agent' && (proposal.preparedBy !== s.actor.id || s.actor.role === 'owner')
  return <section className="recovery-options" aria-label="Recovery options">
    <h3>Recovery options</h3>
    <article className="plan-option chosen" data-plan="A">
      <h4><Icon name="check" /><span>Plan A</span> Planner's resequence</h4>
      <p>{proposal.summary}{proposal.assumptions && <small> Planner's assumption: {proposal.assumptions}</small>}</p>
      <dl>
        {changed.map(({ w }: any) => { const a = firstStart(plan, w.id), b = firstStart(proposed, w.id); return <div key={`start:${w.id}`}><dt>{w.reference} starts</dt><dd className="num">{a ? dayName(a) : '—'} → {b ? dayName(b) : '—'}</dd><dd /></div> })}
        {centers.map(x => <div key={`load:${x.c}`}><dt>{x.c} load</dt><dd className="num">{x.before}% → {x.after}%</dd><dd /></div>)}
      </dl>
      <dl className="finishes">{effects.map(e => <div key={`end:${e.w.id}`} className="finish" data-wo={e.w.reference} data-before={e.before?.toISOString() ?? ''} data-after={e.after?.toISOString() ?? ''}>
        <dt>{e.w.reference} finishes<small>needed {dayName(e.by)}</small></dt>
        <dd className="num" title={`${stamp(e.before)} → ${stamp(e.after)}`}>{e.before ? dayName(e.before) : '—'} → <span className={e.will ? 'red' : ''}>{e.after ? dayName(e.after) : '—'}</span></dd>
        <dd className={e.will ? 'red' : 'still-on'}>{e.will ? `(${daysLate(e.will)})` : '(still on)'}</dd>
      </div>)}</dl>
      {(turnsLate.length > 0 || recovers.length > 0) && <p className={`verdict ${turnsLate.length ? 'cost' : ''}`}>
        {recovers.length > 0 && <>Brings {recovers.map(e => e.w.reference).join(' and ')} back on time. </>}
        {turnsLate.length > 0 && <strong>Makes {turnsLate.map(e => `${e.w.reference} late (needed ${dayName(e.by)})`).join(' and ')}.</strong>}
      </p>}
      {approve && <button type="button" className="button primary wide" disabled={busy} onClick={() => larder.run('proposal.approve', { proposalId: proposal.id, version: proposal.version })}>Approve plan A</button>}
      <p className="byline">Prepared by {personName(s, proposal.preparedBy)}, {when(proposal.createdAt)}</p>
    </article>
    <article className="plan-option" data-plan="B">
      <h4><span className="radio" aria-hidden="true" /><span>Plan B</span> Keep as is</h4>
      <p>Keep the current sequence and priorities.</p>
      <dl className="keep"><div className="pair-head" aria-hidden="true"><span>Finishes</span><span>Needed by</span></div>
        {effects.map(e => <div key={e.w.id} className="pair" data-wo={e.w.reference} data-after={e.before?.toISOString() ?? ''}>
          <div><dt>{e.w.reference}<span className="sr-only"> finishes</span></dt><dd className={e.was ? 'red num' : 'num'} title={stamp(e.before)}>{e.before ? dayName(e.before) : '—'}</dd></div>
          <div><dt className="sr-only">Needed by</dt><dd className="num">{dayName(e.by)}{e.was ? <strong className="red"> · {e.was} {e.was === 1 ? 'day' : 'days'} late</strong> : ' · on time'}</dd></div>
        </div>)}</dl>
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
    {ops.length === 0 ? <p className="muted">No routing steps with minutes on this item's bill of materials.</p> : <ol>{ops.map(o => <li key={o.key}><strong>Op {o.sequence} {o.step}</strong><span>{w.operationStates?.find((t: any) => t.sequence === o.sequence)?.status ?? 'pending'} · {qty(o.minutes)} job minutes remaining</span><span>{o.workCenter}{o.provisional && ' · Provisional: maintenance release required'}</span><span className="num"><time dateTime={o.start.toISOString()}>{dayName(o.start)}, {clock(o.start)}</time> – <time dateTime={o.end.toISOString()}>{o.end.toDateString() === o.start.toDateString() ? clock(o.end) : `${dayName(o.end)}, ${clock(o.end)}`}</time></span></li>)}</ol>}
    <a className="button wide" href={`#make/wo/${w.id}`}>Open work order</a>
  </section>
}

export function JobPanel({ larder, w, plan, proposed, proposal, now }: { larder: Larder; w: Rec; plan: Plan; proposed?: Plan; proposal?: Rec; now: Date }) {
  const s = larder.state!, item = byId(s, 'items', w.itemId), ops = plan.ops.filter(o => o.workOrder.id === w.id)
  const provisional = ops.some(o => o.provisional), late = ops.some(o => o.late), short = ops.some(o => o.short)
  const involved = proposal && proposed && proposal.plan.changes.some((ch: any) => ch.workOrderId === w.id)
  return <aside className="job-panel card">
    <header className="job-head"><h2>{w.reference}</h2><Chip tone={short || late ? 'bad' : w.status === 'draft' ? 'neutral' : 'go'}>{provisional ? 'Release required' : short ? 'Short' : late ? 'Late' : w.status === 'draft' ? 'Draft' : 'On track'}</Chip></header>
    <p className="job-item">{item?.name ?? 'Removed item'}</p>
    <p className="job-meta"><span className="num">{qty(w.quantity)} {unitLabel(item?.baseUnit)}</span><b aria-hidden="true">•</b><span>needed {dayName(fromDate(w.requiredBy))}</span><b aria-hidden="true">•</b><span>{words(w.status)}</span></p>
    {provisional && <p>Provisional recovery after maintenance ETA; authorized equipment release is still required.</p>}
    <Facts s={s} w={w} plan={plan} />
    {w.status === 'released' && (w.shortages ?? []).length > 0 && <p className="job-short">Short: {stories(s, w, plan).join('; ')}.</p>}
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
