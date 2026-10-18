// The finite-capacity chart: one row per work center, its load in booked shift hours, and each operation as a
// bar from start to finish. A planner's proposed moves show as dashed ghosts under the bars they would move.
import { clock, dayName } from '../format'
import { addDays, daysBetween, fromDate, load, weekend, type Op, type Plan } from './plan'
import type { Mode } from '../shell'

// Each day column spans 6 AM to 6 PM; weekends are narrower in the week view.
const DAY_START = 6, DAY_HOURS = 12
const ticks = { week: [6, 12, 18], day: [6, 8, 10, 12, 14, 16, 18] }
const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`

export function axis(from: Date, mode: Mode) {
  const cols = Array.from({ length: mode === 'week' ? 7 : 1 }, (_, i) => { const d = addDays(from, i); return { d, w: mode === 'week' && weekend(d) ? .5 : 1 } })
  const total = cols.reduce((n, c) => n + c.w, 0)
  const x = (t: Date) => {
    const i = daysBetween(from, t)
    if (i < 0) return 0
    if (i >= cols.length) return 100
    const before = cols.slice(0, i).reduce((n, c) => n + c.w, 0), f = Math.min(1, Math.max(0, (t.getHours() + t.getMinutes() / 60 - DAY_START) / DAY_HOURS))
    return ((before + cols[i]!.w * f) / total) * 100
  }
  return { cols, total, x }
}

function Bar({ op, x, ghost, moving, selected, onSelect, lane }: { op: Op; x: (t: Date) => number; ghost?: boolean; moving?: boolean; selected?: boolean; onSelect: (id: string) => void; lane: number }) {
  const left = x(op.start), width = Math.max(1.2, x(op.end) - left)
  const flag = op.short ? 'Short of materials' : op.late ? `Late · needed ${dayName(fromDate(op.workOrder.requiredBy))}` : ''
  const tone = ghost ? 'ghost' : op.late || op.short ? 'exception' : op.workOrder.status === 'draft' ? 'draft' : ''
  const title = `${op.reference} · Op ${op.sequence} ${op.step} · ${op.workCenter} · ${dayName(op.start)} ${clock(op.start)} to ${dayName(op.end)} ${clock(op.end)}${ghost ? ' (proposed)' : ''}`
  return <button type="button" className={`bar ${tone} ${moving ? 'moving' : ''} ${selected ? 'selected' : ''}`} style={{ left: `${left}%`, width: `${width}%`, top: lane ? 'var(--lane-ghost)' : undefined }} title={title} aria-pressed={selected} onClick={() => onSelect(op.workOrder.id)}>
    <strong>{op.reference}</strong>
    <span>{ghost ? `Proposed · Op ${op.sequence}` : `Op ${op.sequence} ${op.step}`}</span>
    {flag && !ghost ? <em>{flag}</em> : <small>{ghost ? `${dayName(op.start)}, ${clock(op.start)}` : `${op.quantity.toLocaleString('en-US')} ${op.item}`}</small>}
  </button>
}

export function Gantt({ plan, ghosts, moving, from, mode, now, selected, onSelect }: { plan: Plan; ghosts: Op[]; moving: Set<string>; from: Date; mode: Mode; now: Date; selected?: string; onSelect: (id: string) => void }) {
  const { cols, x } = axis(from, mode), to = addDays(from, cols.length)
  const inView = (o: Op) => o.end > from && o.start < to
  const showNow = now >= from && now < to
  return <div className="gantt" role="region" aria-label="Schedule by work center">
    <div className="g-head">
      <div className="g-name">Work center</div><div className="g-load">Load</div>
      <div className="g-days">{cols.map(c => <div key={c.d.toISOString()} className={`g-day ${mode === 'week' && weekend(c.d) ? 'weekend' : ''}`} style={{ flexGrow: c.w }}>
        <span>{dayName(c.d).slice(0, 3)} </span><span>{dayName(c.d).slice(4)}</span>
        {!(mode === 'week' && weekend(c.d)) && <div className="g-ticks">{ticks[mode].map(h => <i key={h} style={{ left: `${((h - DAY_START) / DAY_HOURS) * 100}%` }}>{hourLabel(h)}</i>)}</div>}
      </div>)}
        {showNow && <b className={`now-label ${x(now) < 6 ? 'start' : x(now) > 94 ? 'end' : ''}`} style={{ left: `${x(now)}%` }}>{clock(now)}</b>}
      </div>
    </div>
    <div className="g-body">
      <div className="g-grid" aria-hidden="true">
        {cols.map((c, i) => <div key={i} className={`g-col ${mode === 'week' && weekend(c.d) ? 'weekend' : ''}`} style={{ flexGrow: c.w }}>{mode === 'week' && weekend(c.d) && <span className="weekend-label">Weekend</span>}</div>)}
        {showNow && <span className="now-line" style={{ left: `${x(now)}%` }} />}
      </div>
      {plan.centers.map(center => {
        const l = load(plan, center, from, to), rowGhosts = ghosts.filter(g => g.workCenter === center && inView(g))
        return <div key={center} className={`g-row ${rowGhosts.length ? 'has-ghosts' : ''}`}>
          <div className="g-name"><strong>{center}</strong></div>
          <div className="g-load"><strong className="num">{l.percent}%</strong><small className="num">{l.hours} / {l.capacity} hrs</small></div>
          <div className="g-lane">
            {plan.ops.filter(o => o.workCenter === center && inView(o)).map(o => <Bar key={o.key} op={o} x={x} lane={0} moving={moving.has(o.workOrder.id)} selected={selected === o.workOrder.id} onSelect={onSelect} />)}
            {rowGhosts.map(o => <Bar key={`ghost:${o.key}`} op={o} x={x} lane={1} ghost selected={selected === o.workOrder.id} onSelect={onSelect} />)}
          </div>
        </div>
      })}
    </div>
  </div>
}

// On a phone the same operations read as a list per work center.
export function Agenda({ plan, ghosts, from, mode, selected, onSelect }: { plan: Plan; ghosts: Op[]; from: Date; mode: Mode; selected?: string; onSelect: (id: string) => void }) {
  const to = addDays(from, mode === 'week' ? 7 : 1), inView = (o: Op) => o.end > from && o.start < to
  return <div className="agenda">{plan.centers.map(center => {
    const l = load(plan, center, from, to), ops = [...plan.ops, ...ghosts.map(g => ({ ...g, ghost: true }))].filter(o => o.workCenter === center && inView(o)).sort((a, b) => a.start.getTime() - b.start.getTime())
    return <section key={center} className="agenda-center">
      <header><h3>{center}</h3><p className="num">{l.percent}% · {l.hours} / {l.capacity} hrs</p></header>
      {ops.length === 0 ? <p className="muted">Nothing booked in this span.</p> : <ul>{ops.map(o => {
        const ghost = 'ghost' in o, flag = o.short ? 'Short of materials' : o.late ? 'Late' : ''
        return <li key={(ghost ? 'ghost:' : '') + o.key}><button type="button" className={`agenda-op ${ghost ? 'ghost' : flag ? 'exception' : ''} ${selected === o.workOrder.id ? 'selected' : ''}`} aria-pressed={selected === o.workOrder.id} onClick={() => onSelect(o.workOrder.id)}>
          <span className="when num">{dayName(o.start)}, {clock(o.start)} – {o.end.toDateString() === o.start.toDateString() ? clock(o.end) : `${dayName(o.end)}, ${clock(o.end)}`}</span>
          <strong>{o.reference} · Op {o.sequence} {o.step}{ghost && ' (proposed)'}</strong>
          <span className="what">{o.quantity.toLocaleString('en-US')} {o.item}{flag && !ghost && <em> · {flag}</em>}</span>
        </button></li>
      })}</ul>}
    </section>
  })}</div>
}
