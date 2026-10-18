import { Mid, Story } from '../parts'

// Ten working days, Mon Oct 26 – Fri Nov 6, with the weekend as a hatched gap after Fri 30. A bar runs from a day
// (0–9) plus a fraction of it to another; Today is Tue 27 at 10 AM (a 7 AM–5 PM shift, so .3 of the day).
const days = ['Mon 26', 'Tue 27', 'Wed 28', 'Thu 29', 'Fri 30', 'Mon 2', 'Tue 3', 'Wed 4', 'Thu 5', 'Fri 6']
type Bar = { from: number; to: number; label: string; short?: string; fit?: number; tone: 'ink' | 'grey' | 'outline' | 'lime' }
const rows: { centre: string; note?: string; bars: Bar[]; next?: string }[] = [
  { centre: 'Panel saw', bars: [{ from: 0, to: 1, label: 'MO-2207 · Hearth & Table', short: 'MO-2207', tone: 'ink' }] },
  { centre: 'Glue bench', bars: [{ from: 1, to: 2, label: 'MO-2207 · Hearth & Table', short: 'MO-2207', tone: 'ink' }] },
  { centre: 'CNC Router 1', bars: [{ from: 0, to: 3, label: 'MO-2216 · Saluda Mercantile', short: 'MO-2216 · Saluda', tone: 'outline' }] },
  { centre: 'CNC Router 2', note: '3 jobs this week', bars: [
    { from: 0, to: 2.1, label: 'MO-2210 · Shopify', tone: 'grey' }, { from: 2.1, to: 3, label: 'MO-2207', tone: 'ink' },
    { from: 3, to: 5, label: 'MO-2212 · Amazon FBA 36', short: 'MO-2212 · Amazon', fit: 180, tone: 'grey' }] },
  { centre: 'Sanding · Luis R.', bars: [{ from: 1, to: 6, label: 'MO-2207 · Hearth & Table', tone: 'ink' }, { from: 6, to: 8, label: 'MO-2210 · Shopify', tone: 'grey' }] },
  { centre: 'Finish & pack · Ana P.', bars: [{ from: 6, to: 9, label: 'MO-2207 · Hearth & Table', tone: 'ink' }], next: 'MO-2207 Tue 3' },
  { centre: 'Batch kettle', bars: [{ from: 6, to: 8, label: 'MO-2215 · Board butter 480', short: 'MO-2215 · Butter 480', tone: 'lime' }], next: 'MO-2215 Tue 3' },
]
const TODAY = 1.3
// Grid columns: ten days with the weekend gap after the fifth; a position in days becomes a percent of the track.
const GAP = .4, span = days.length + GAP
const pos = (d: number) => ((d + (d >= 5 ? GAP : 0)) / span) * 100
// A bar that ends at the close of Fri 30 stops before the weekend gap.
const end = (d: number) => ((d + (d > 5 ? GAP : 0)) / span) * 100
// Each bar shows its short label (a CSS container query) below the width its full label needs: about 7 px a character
// in the 13.5 px bar face, rounded up to 5 px; `fit` names it for a label of mostly capitals and digits.
const fit = (bar: Bar) => `w${Math.ceil((bar.fit ?? bar.label.length * 6.97 + 1) / 5) * 5}`

/** 06 · A finite-capacity Gantt over two working weeks, seven work centres and named people, with Today and the ship line. */
export function Schedule() {
  return <Story id="schedule" className="wide schedule" eyebrow={<>Schedule<Mid />Oct 26 – Nov 6</>} title="A schedule that fits the shop."
    line="Every job lands on a real machine and a real person, inside real shift hours.">
    <article className="card gantt-card" aria-label="Production schedule, Oct 26 to Nov 6">
      <div className="gantt-nav"><button type="button" className="chev" data-gantt="prev" aria-label="Earlier days" hidden>‹</button><b>Mon 26 – Wed 28</b><button type="button" className="chev" data-gantt="next" aria-label="Later days" hidden>›</button><span className="ship-pill">SO-1184 ships Nov 6</span></div>
      <div className="gantt-scroll" tabIndex={0} aria-label="Schedule, scroll for later days">
        <div className="gantt" style={{ ['--today' as string]: pos(TODAY) / 100 }}>
          <div className="gantt-head"><span className="corner" />{days.map((d, i) => <span key={d} className={`day${i === 5 ? ' after-gap' : ''}`}>{d}</span>)}</div>
          <div className="gantt-grid" aria-hidden="true">
            {days.map((d, i) => <span key={d} className="col" style={{ left: `${pos(i)}%` }} />)}
            <span className="weekend" style={{ left: `${pos(5) - (GAP / span) * 100}%`, width: `${(GAP / span) * 100}%` }} />
            <span className="today-line"><span>Today</span></span>
            <span className="ship-line"><span>SO-1184 ships Nov 6</span></span>
          </div>
          {rows.map(row => <div key={row.centre} className="gantt-row">
            <p className="centre"><b>{row.centre}</b>{row.note && <small>{row.note}</small>}</p>
            <div className="track">{row.bars.map(bar => <span key={bar.label + bar.from} className={`bar ${bar.tone}${bar.short ? ` has-short ${fit(bar)}` : ''}`} style={{ left: `${pos(bar.from)}%`, width: `calc(${end(bar.to) - pos(bar.from)}% - 4px)` }} title={bar.label}>
              <span className="full">{bar.label}</span>{bar.short && <span className="short">{bar.short}</span>}
            </span>)}{row.next && <span className="next">Next: {row.next}</span>}</div>
          </div>)}
        </div>
      </div>
      <p className="gantt-hint">Swipe for Thu 29 – Fri 6</p>
      <dl className="gantt-stats"><div><dt>Unscheduled jobs</dt><dd>0</dd></div><div><dt>Late jobs</dt><dd>0</dd></div><div><dt>Bottleneck</dt><dd>Sanding</dd></div></dl>
    </article>
  </Story>
}
