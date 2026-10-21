// Schedule: where the shop starts each shift. The chart and the selected job's panel share one plan, computed
// from the records on every load; a planner's reschedule proposal is drawn as ghosts until a person decides.
import { Capacity } from './capacity'
import { Maintenance } from '../maintenance'
import { useState } from 'react'
import { rows } from '../api'
import type { Larder } from '../app'
import type { Mode } from '../shell'
import { Card } from '../controls'
import { Icon } from '../icons'
import { clock, dayName } from '../format'
import { Agenda, Gantt } from './gantt'
import { JobPanel, Worklog } from './panel'
import { addDays, openWork, schedule, SHIFT, startOfDay } from './plan'
import { coveredBy } from '../supply'

export function Schedule({ larder, mode }: { larder: Larder; mode: Mode }) {
  const s = larder.state!, now = new Date()
  const [offset, setOffset] = useState(0), [picked, setPicked] = useState<string>()
  const span = mode === 'week' ? 7 : 1, from = addDays(startOfDay(now), offset), last = addDays(from, span - 1)
  const plan = schedule(s, now)
  const proposal = rows(s, 'proposals').find(p => p.status === 'awaiting approval' && p.kind === 'reschedule')
  const changes = Object.fromEntries((proposal?.plan.changes ?? []).map((ch: any) => [ch.workOrderId, { plannedStart: ch.plannedStart, ...(Number.isSafeInteger(ch.priority) ? { priority: ch.priority } : {}) }]))
  const proposed = proposal ? schedule(s, now, changes) : undefined
  const ghosts = proposed ? proposed.ops.filter(o => o.workOrder.id in changes) : []
  const moving = new Set(Object.keys(changes))
  const due = new Map(openWork(s).flatMap(w => { const d = coveredBy(s, w, plan); return d ? [[w.id, d] as const] : [] }))
  const fallback = Object.keys(changes)[0] ?? (plan.ops.find(o => o.late || o.short) ?? plan.ops[0])?.workOrder.id
  const selected = plan.ops.some(o => o.workOrder.id === picked) ? picked : fallback
  const job = plan.ops.find(o => o.workOrder.id === selected)?.workOrder
  const to = addDays(from, span), inSpan = plan.ops.some(o => o.end > from && o.start < to), next = plan.ops.filter(o => o.start >= to).sort((a, b) => a.start.getTime() - b.start.getTime())[0]
  const hours = (h: number) => clock(new Date(2026, 0, 1, h)).replace(':00', '')
  return <div className="page schedule">
    <header className="page-head schedule-head">
      <h1>Schedule</h1>
      <div className="range">
        <p className="num">{mode === 'week' ? `${dayName(from)} – ${dayName(last)}, ${last.getFullYear()}` : `${dayName(from)}, ${from.getFullYear()}`}</p>
        <div className="paired"><button type="button" className="button icon-only" aria-label={`Previous ${mode}`} onClick={() => setOffset(offset - span)}><Icon name="back" /></button><button type="button" className="button icon-only" aria-label={`Next ${mode}`} onClick={() => setOffset(offset + span)}><Icon name="chevron" /></button></div>
        <button type="button" className="button" disabled={offset === 0} onClick={() => setOffset(0)}>Today</button>
      </div>
    </header>
    <p className="schedule-note">The routing estimate below uses the original weekday shift. The finite capacity plan uses your saved machine and labor calendars.</p>
    {plan.centers.length === 0 ? <Card title="Nothing scheduled yet" className="schedule-empty">
      <p>The schedule lays out draft and released work orders by work center, from the routing on each item's bill of materials: one line per step with its work center and minutes for each unit.</p>
      <div className="actions"><a className="button primary" href="#make/boms">Add a routing</a><a className="button" href="#make/wo">Draft a work order</a></div>
    </Card> : <div className={`schedule-grid ${job && job.id in changes ? 'deciding' : ''}`}>
      <div className="schedule-main">
        {!inSpan && <p className="schedule-quiet" role="status"><strong>Nothing planned {mode === 'week' ? `${dayName(from)} – ${dayName(last)}` : `on ${dayName(from)}`}.</strong> {plan.ops.length === 0 ? 'No work order is open.' : next ? `The next step starts ${dayName(next.start)}.` : ''} <a href="#make/wo">Work orders</a></p>}
        <Gantt plan={plan} ghosts={ghosts} moving={moving} due={due} from={from} mode={mode} now={now} selected={selected} onSelect={setPicked} />
        <Agenda plan={plan} ghosts={ghosts} due={due} from={from} mode={mode} selected={selected} onSelect={setPicked} />
        <p className="schedule-note">Each work center runs one weekday shift, {hours(SHIFT.start)} to {hours(SHIFT.end)}; steps run in priority order, one job at a time.</p>
        {openWork(s).some(w => w.operationStates?.some((t: any) => t.progress || t.downtime?.length)) && <p className="schedule-note">Reported job minutes and estimated resume times update this plan. A paused operation remains paused until an explicit resume; progress reports never post output or change customer promises.</p>}
      </div>
      <div className="schedule-side">
        {job && <JobPanel larder={larder} w={job} plan={plan} proposed={proposed} proposal={proposal} now={now} />}
        <Worklog s={s} />
      </div>
    </div>}
    <Capacity larder={larder} />
    <Maintenance larder={larder} plan={plan} />
  </div>
}
