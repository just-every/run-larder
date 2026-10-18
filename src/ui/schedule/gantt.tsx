// The finite-capacity chart: one row per work center, its load in booked shift hours, and each operation as a
// bar from start to finish. A planner's proposed moves show as dashed ghosts under the bars they would move.
import { useLayoutEffect, useRef, useState } from 'react'
import { clock, dayName } from '../format'
import { addDays, daysBetween, fromDate, load, SHIFT, weekend, type Op, type Plan } from './plan'
import { lines, place, textWidth, type Placed } from './layout'
import type { Mode } from '../shell'

// Each day column spans the centers' working shift; weekends, which hold no work, are narrower in the week view.
const DAY_HOURS = SHIFT.end - SHIFT.start
const ticks = { week: [SHIFT.start, (SHIFT.start + SHIFT.end) / 2, SHIFT.end], day: Array.from({ length: DAY_HOURS / 2 + 1 }, (_, i) => SHIFT.start + i * 2) }
const hourLabel = (h: number) => { const whole = Math.floor(h); return `${whole % 12 || 12}${h % 1 ? ':30' : ''} ${whole < 12 ? 'AM' : 'PM'}` }

export function axis(from: Date, mode: Mode) {
  const cols = Array.from({ length: mode === 'week' ? 7 : 1 }, (_, i) => { const d = addDays(from, i); return { d, w: mode === 'week' && weekend(d) ? .4 : 1 } })
  const total = cols.reduce((n, c) => n + c.w, 0)
  const x = (t: Date) => {
    const i = daysBetween(from, t)
    if (i < 0) return 0
    if (i >= cols.length) return 100
    const before = cols.slice(0, i).reduce((n, c) => n + c.w, 0), f = Math.min(1, Math.max(0, (t.getHours() + t.getMinutes() / 60 - SHIFT.start) / DAY_HOURS))
    return ((before + cols[i]!.w * f) / total) * 100
  }
  return { cols, total, x }
}

const flagOf = (op: Op) => op.short ? 'Short of materials' : op.late ? `Late · needed ${dayName(fromDate(op.workOrder.requiredBy))}` : ''

function Bar({ p, top, moveTo, moving, selected, onSelect }: { p: Placed; top: number; moveTo: string; moving?: boolean; selected?: boolean; onSelect: (id: string) => void }) {
  const { op, ghost, tag } = p, flag = flagOf(op), text = lines(op, ghost, flag, moveTo)
  const tone = ghost ? 'ghost' : op.late || op.short ? 'exception' : op.workOrder.status === 'draft' ? 'draft' : ''
  const title = `${op.reference} · Op ${op.sequence} ${op.step} · ${op.quantity.toLocaleString('en-US')} ${op.item} · ${op.workCenter} · ${dayName(op.start)} ${clock(op.start)} to ${dayName(op.end)} ${clock(op.end)}${ghost ? ' (proposed)' : moveTo ? ` (moves to ${moveTo})` : ''}`
  const label = <><strong>{text.id}</strong><span>{text.step}</span>{text.note && (flag && !moveTo ? <em>{text.note}</em> : <small>{text.note}</small>)}</>
  return <button type="button" className={`bar ${tone} ${moving ? 'moving' : ''} ${selected ? 'selected' : ''} ${tag ? 'narrow' : ''}`} style={{ left: p.left, width: p.width, top }} title={title} aria-pressed={selected} onClick={() => onSelect(op.workOrder.id)}>
    {tag ? <span className={`tag ${tag.side}`} style={{ width: tag.width }}>{label}</span> : label}
  </button>
}

// The label's widest line, in the bar's own type.
function labelWidth(op: Op, ghost: boolean, moveTo: string, family: string) {
  const t = lines(op, ghost, flagOf(op), moveTo)
  return Math.max(textWidth(t.id, `700 13px ${family}`), textWidth(t.step, `400 12.5px ${family}`), textWidth(t.note, `600 12px ${family}`))
}

export function Gantt({ plan, ghosts, moving, from, mode, now, selected, onSelect }: { plan: Plan; ghosts: Op[]; moving: Set<string>; from: Date; mode: Mode; now: Date; selected?: string; onSelect: (id: string) => void }) {
  const { cols, x } = axis(from, mode), to = addDays(from, cols.length)
  const inView = (o: Op) => o.end > from && o.start < to
  const showNow = now >= from && now < to
  const days = useRef<HTMLDivElement>(null), [width, setWidth] = useState(0), [family, setFamily] = useState('sans-serif')
  useLayoutEffect(() => {
    const el = days.current!
    setFamily(getComputedStyle(el).fontFamily)
    const measure = () => setWidth(el.getBoundingClientRect().width)
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  const span = (o: Op): [number, number] => [x(o.start) / 100 * width, x(o.end) / 100 * width]
  const ghostAt = new Map(ghosts.map(g => [g.key, g.start]))
  // Where a displaced original moves to, read on its bar.
  const moveTo = (op: Op, ghost: boolean) => { const t = !ghost && moving.has(op.workOrder.id) ? ghostAt.get(op.key) : undefined; return t ? `${dayName(t)} ${clock(t)}` : '' }
  return <div className="gantt" role="region" aria-label="Schedule by work center">
    <div className="g-head">
      <div className="g-name">Work center</div><div className="g-load">Load</div>
      <div className="g-days" ref={days}>{cols.map(c => <div key={c.d.toISOString()} className={`g-day ${mode === 'week' && weekend(c.d) ? 'weekend' : ''}`} style={{ flexGrow: c.w }}>
        <span>{dayName(c.d).slice(0, 3)} </span><span>{dayName(c.d).slice(4)}</span>
        {!(mode === 'week' && weekend(c.d)) && <div className="g-ticks">{ticks[mode].map(h => <i key={h} style={{ left: `${((h - SHIFT.start) / DAY_HOURS) * 100}%` }}>{hourLabel(h)}</i>)}</div>}
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
        const l = load(plan, center, from, to)
        const items = [...plan.ops.filter(o => o.workCenter === center && inView(o)).map(op => ({ op, ghost: false })), ...ghosts.filter(g => g.workCenter === center && inView(g)).map(op => ({ op, ghost: true }))]
        const lanes = width ? place(items, span, width, i => labelWidth(i.op, i.ghost, moveTo(i.op, i.ghost), family)) : undefined
        return <div key={center} className="g-row">
          <div className="g-name"><strong>{center}</strong></div>
          <div className="g-load"><strong className="num">{l.percent}%</strong><small className="num">{l.hours} / {l.capacity} hrs</small></div>
          <div className="g-lane" style={{ height: lanes?.height }}>
            {lanes?.placed.map(p => <Bar key={`${p.ghost ? 'ghost:' : ''}${p.op.key}`} p={p} top={lanes.tops[p.lane]!} moveTo={moveTo(p.op, p.ghost)} moving={!p.ghost && moving.has(p.op.workOrder.id)} selected={selected === p.op.workOrder.id} onSelect={onSelect} />)}
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
