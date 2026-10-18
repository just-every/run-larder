import { Avatar, Mid, Painting, Story, Tick } from '../parts'

const moved = ['MO-2207 Op 3 · 74 boards', 'MO-2210 Op 3 · 60 boards', 'MO-2212 Op 3 · 36 boards']
const timeline = [
  { at: '1:40 PM', what: <>Spindle fault · <br />logged by Marcus K.</>, tone: 'red' },
  { at: '1:42 PM', what: '2 options ready' },
  { at: '1:46 PM', what: 'Option A approved' },
  { at: '3:40 PM', what: <>Router 2 repaired · <br />released by Marcus K.</> },
  { at: '6:24 PM', what: <>MO-2207 Op 3 · <br /><span className="nowrap">240 / 240</span></>, tone: 'lime' },
]

/** 08 · The charcoal moment: Router 2 stops at 1:40 PM, the planning agent lays out two fixes, Dana picks A and Nov 6 holds. */
export function MachineDown() {
  return <Story id="machine-down" className="dark" eyebrow={<>Machine down<Mid />Wed Oct 28<Mid />1:40 PM</>} title={<>Router 2 stops. <span className="nowrap">Nov 6 holds.</span></>}
    line="The planning agent lays out two fixes. Dana picks one and the shop keeps cutting.">
    <Painting className="router-art" name="router" widths={[440, 880]} sizes="(max-width: 760px) 100vw, 880px" width={880} height={400} />
    <div className="options">
      <article className="card option-a" aria-label="Option A, approved">
        <h3>Option A · move 3 jobs to Router 1</h3>
        <ul className="moved">{moved.map(m => <li key={m}>{m}</li>)}<li className="displaced">MO-2216 Saluda → Thu 29<Mid />Nov 13 holds</li></ul>
        <p className="overtime">Router 1 runs to 6:30 PM<Mid />+$84 overtime</p>
        <p className="pill-lime big">Nov 6 holds <Tick /></p>
        <p className="approved-chip"><Avatar initials="DW" tone="dark" />Approved by Dana W.<Mid /><span className="muted">1:46 PM</span></p>
      </article>
      <article className="card option-b" aria-label="Option B">
        <h3>Option B · wait for repair</h3>
        <p><span className="nowrap">Repair est. Thu 29, noon</span><Mid /><span className="nowrap">SO-1184 ships Mon Nov 9</span><Mid /><span className="nowrap">1 working day late</span></p>
      </article>
    </div>
    <div className="timeline">
      <ol>{timeline.map(t => <li key={t.at} className={t.tone}><span className="node" aria-hidden="true" /><b>{t.at}</b><span>{t.what}</span></li>)}</ol>
      <p className="changed">Customer dates changed: 0</p>
    </div>
  </Story>
}
