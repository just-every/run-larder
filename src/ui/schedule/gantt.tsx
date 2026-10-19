// The finite-capacity chart: one row per work center, its load in booked shift hours, and each operation as a
// bar from start to finish. A planner's proposed moves show as dashed ghosts under the bars they would move.
import { useLayoutEffect, useRef, useState } from 'react'
import { clock, dayName } from '../format'
import { addDays, at, daysBetween, fromDate, load, SHIFT, startOfDay, weekend, type Op, type Plan } from './plan'
import { lines, PAD, place, textWidth, type Item, type Placed } from './layout'
import type { Mode } from '../shell'

// Each day column spans the centers' working shift; weekends, which hold no work, are narrower in the week view.
const DAY_HOURS = SHIFT.end - SHIFT.start
const ticks = { week: [SHIFT.start, (SHIFT.start + SHIFT.end) / 2, SHIFT.end], day: Array.from({ length: DAY_HOURS / 2 + 1 }, (_, i) => SHIFT.start + i * 2) }
const hourLabel = (h: number) => { const whole = Math.floor(h); return `${whole % 12 || 12}${h % 1 ? ':30' : ''} ${whole < 12 ? 'AM' : 'PM'}` }

export function axis(from: Date, mode: Mode) {
  const cols = Array.from({ length: mode === 'week' ? 7 : 1 }, (_, i) => { const d = addDays(from, i); return { d, w: mode === 'week' && weekend(d) ? .4 : 1, off: mode === 'week' && weekend(d) } })
  const total = cols.reduce((n, c) => n + c.w, 0)
  const edge = (i: number) => cols.slice(0, i).reduce((n, c) => n + c.w, 0) / total * 100
  // A working time's place on the chart. An end past the visible days, or on a weekend (which holds no work and
  // only its own narrow grey column), lands at the end of the last shift in view before it.
  const x = (t: Date) => {
    let i = daysBetween(from, t), f = Math.min(1, Math.max(0, (t.getHours() + t.getMinutes() / 60 - SHIFT.start) / DAY_HOURS))
    if (i < 0) return 0
    if (i >= cols.length) { i = cols.length - 1; f = 1 }
    while (cols[i]!.off) { if (i === 0) return 0; i--; f = 1 }
    return edge(i) + cols[i]!.w * f / total * 100
  }
  // The greyed spans, in per cent of the chart.
  const closed = cols.flatMap((c, i) => c.off ? [[edge(i), edge(i + 1)] as [number, number]] : [])
  return { cols, total, x, closed }
}

// The parts of a step in [from, to): one per run of consecutive working days, each ending at its last shift's end
// (or the step's), with the working day it continues on when the step runs on past it.
function parts(op: Op, from: Date, to: Date) {
  const out: { start: Date; end: Date; continues?: Date }[] = []
  for (let d = startOfDay(op.start > from ? op.start : from); d < to && d < op.end; d = addDays(d, 1)) {
    if (weekend(d)) continue
    const a = new Date(Math.max(op.start.getTime(), at(d, SHIFT.start).getTime())), b = new Date(Math.min(op.end.getTime(), at(d, SHIFT.end).getTime()))
    if (b <= a) continue
    const last = out[out.length - 1]
    if (last && daysBetween(last.end, a) === 1) last.end = b
    else out.push({ start: a, end: b })
  }
  for (const p of out) if (p.end < op.end) { let d = addDays(startOfDay(p.end), 1); while (weekend(d)) d = addDays(d, 1); p.continues = d }
  return out
}

// due: when open supply covers each short job's missing materials (supply.ts).
const flagOf = (op: Op, due: Map<string, Date>) => op.provisional ? 'Provisional · maintenance release required' : op.short ? (due.has(op.workOrder.id) ? `Short until ${dayName(due.get(op.workOrder.id)!)}` : 'Short of materials') : op.late ? `Late · needed ${dayName(fromDate(op.workOrder.requiredBy))}` : ''

function Bar({ p, top, moveTo, due, moving, selected, onSelect }: { p: Placed; top: number; moveTo: string; due: Map<string, Date>; moving?: boolean; selected?: boolean; onSelect: (id: string) => void }) {
  const { op, ghost, tag, continues } = p, flag = flagOf(op, due), text = lines(op, ghost, flag, moveTo, continues ? weekday(continues) : '', !!tag)
  const tone = ghost ? 'ghost' : op.late || op.short ? 'exception' : op.workOrder.status === 'draft' ? 'draft' : ''
  const ends = `${continues ? 'continues' : ''} ${p.start > op.start ? 'resumes' : ''} ${p.twoLine ? '' : 'oneline'}`
  const title = `${op.reference} · Op ${op.sequence} ${op.step} · ${op.quantity.toLocaleString('en-US')} ${op.item} · ${op.workCenter} · ${dayName(op.start)} ${clock(op.start)} to ${dayName(op.end)} ${clock(op.end)}${ghost ? ' (proposed)' : moveTo ? ` (moves to ${moveTo})` : ''}`
  const note = text.note && (continues ? <small className="cont">{text.note}</small> : flag && !moveTo ? <em>{text.note}</em> : <small>{text.note}</small>)
  const label = <><strong>{text.id}</strong><span>{text.step}</span>{note}</>
  return <button type="button" className={`bar ${tone} ${ends} ${moving ? 'moving' : ''} ${selected ? 'selected' : ''} ${tag ? 'narrow' : ''}`} style={{ left: p.left + 1, width: Math.max(4, p.width - 2), top }} title={title} aria-pressed={selected} onClick={() => onSelect(op.workOrder.id)}>
    {tag ? <span className={`tag ${tag.side}`} style={{ width: tag.width }}>{label}</span> : label}
  </button>
}

// What a bar's label needs, in the bar's own type: inside, its job and step lines whole after the bar's padding
// (a third line may end in an ellipsis); beside, its widest line. A ghost on one line needs its parts side by side.
function needs(op: Op, ghost: boolean, flag: string, moveTo: string, continues: string, family: string): Pick<Item, 'need' | 'tall'> {
  const w = (t: { id: string; step: string; note: string }) => [textWidth(t.id, `700 13px ${family}`), textWidth(t.step, `400 12.5px ${family}`), t.note ? textWidth(t.note, `${t.note === `${op.quantity.toLocaleString('en-US')} ${op.item}` ? 400 : 600} 12px ${family}`) : 0]
  const inner = w(lines(op, ghost, flag, moveTo, continues, false)), outer = w(lines(op, ghost, flag, moveTo, continues, true))
  const pad = (ghost ? PAD.ghost : op.late || op.short ? PAD.exception : PAD.plain) + (continues ? PAD.continues : 0)
  const tall = { inside: Math.ceil(Math.max(inner[0]!, inner[1]!) + pad + 1), beside: Math.ceil(Math.max(...outer) + 1) }
  if (!ghost) return { need: tall }
  const line = (x: number[]) => x.filter(Boolean).reduce((n, v) => n + v + GHOST_GAP, -GHOST_GAP)
  return { need: { inside: Math.ceil(line(inner) + pad + 1), beside: Math.ceil(line(outer) + 1) }, tall }
}
const GHOST_GAP = 5, weekday = (d: Date) => dayName(d).slice(0, 3)

export function Gantt({ plan, ghosts, moving, due, from, mode, now, selected, onSelect }: { plan: Plan; ghosts: Op[]; moving: Set<string>; due: Map<string, Date>; from: Date; mode: Mode; now: Date; selected?: string; onSelect: (id: string) => void }) {
  const { cols, x, closed } = axis(from, mode), to = addDays(from, cols.length)
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
  const span = (i: Item): [number, number] => [x(i.start) / 100 * width, x(i.end) / 100 * width]
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
          .flatMap(({ op, ghost }) => parts(op, from, to).map((part, i): Item => ({ op, ghost, part: i, ...part, ...needs(op, ghost, flagOf(op, due), moveTo(op, ghost), part.continues ? weekday(part.continues) : '', family) })))
        const lanes = width ? place(items, span, width, closed.map(([a, b]) => [a / 100 * width, b / 100 * width])) : undefined
        return <div key={center} className="g-row">
          <div className="g-name"><strong>{center}</strong></div>
          <div className="g-load"><strong className="num">{l.percent}%</strong><small className="num">{l.hours} / {l.capacity} hrs</small></div>
          <div className="g-lane" style={{ height: lanes?.height }}>
            {lanes?.placed.map(p => <Bar key={`${p.ghost ? 'ghost:' : ''}${p.op.key}:${p.part}`} p={p} top={p.top} moveTo={moveTo(p.op, p.ghost)} due={due} moving={!p.ghost && moving.has(p.op.workOrder.id)} selected={selected === p.op.workOrder.id} onSelect={onSelect} />)}
          </div>
        </div>
      })}
    </div>
  </div>
}

// On a phone the same operations read as a list per work center.
export function Agenda({ plan, ghosts, due, from, mode, selected, onSelect }: { plan: Plan; ghosts: Op[]; due: Map<string, Date>; from: Date; mode: Mode; selected?: string; onSelect: (id: string) => void }) {
  const to = addDays(from, mode === 'week' ? 7 : 1), inView = (o: Op) => o.end > from && o.start < to
  return <div className="agenda">{plan.centers.map(center => {
    const l = load(plan, center, from, to), ops = [...plan.ops, ...ghosts.map(g => ({ ...g, ghost: true }))].filter(o => o.workCenter === center && inView(o)).sort((a, b) => a.start.getTime() - b.start.getTime())
    return <section key={center} className="agenda-center">
      <header><h3>{center}</h3><p className="num">{l.percent}% · {l.hours} / {l.capacity} hrs</p></header>
      {ops.length === 0 ? <p className="muted">Nothing booked in this span.</p> : <ul>{ops.map(o => {
        const ghost = 'ghost' in o, flag = o.provisional ? 'Provisional · maintenance release required' : o.short ? flagOf(o, due) : o.late ? 'Late' : ''
        return <li key={(ghost ? 'ghost:' : '') + o.key}><button type="button" className={`agenda-op ${ghost ? 'ghost' : flag ? 'exception' : ''} ${selected === o.workOrder.id ? 'selected' : ''}`} aria-pressed={selected === o.workOrder.id} onClick={() => onSelect(o.workOrder.id)}>
          <span className="when num">{dayName(o.start)}, {clock(o.start)} – {o.end.toDateString() === o.start.toDateString() ? clock(o.end) : `${dayName(o.end)}, ${clock(o.end)}`}</span>
          <strong>{o.reference} · Op {o.sequence} {o.step}{ghost && ' (proposed)'}</strong>
          <span className="what">{o.quantity.toLocaleString('en-US')} {o.item}{flag && !ghost && <em> · {flag}</em>}</span>
        </button></li>
      })}</ul>}
    </section>
  })}</div>
}
