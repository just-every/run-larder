import { Avatar, Mid, Story, Tick } from '../parts'

const plan = ['Cut 166 boards Mon Oct 19 from 860 bd ft on hand', 'Cut the other 74 boards Mon Oct 26', 'Router 2 runs the second batch Wed Oct 28', 'Slack before Fri Nov 6: 1 day']

/** 04 · Laurel Fork's reply slips PO-5521 four days; the planning agent cites it and splits the cut, and Dana approves. */
export function Slip() {
  return <Story id="slip" eyebrow={<>Supplier slip<Mid />Wed Oct 14</>} title="Late walnut, caught early."
    line="The planning agent reads the supplier’s reply and hands Dana a new cut plan that still ships Nov 6.">
    <article className="card email-card" aria-label="Supplier reply">
      <p className="email-from">Laurel Fork Hardwoods<Mid />Oct 14, 10:41 AM</p>
      <p className="email-subject">Re: PO-5521 · Walnut 8/4 · 380 bd ft</p>
      <p className="email-body">Our kiln load is running behind. We can ship Friday, Oct 23.</p>
    </article>
    <article className="card agent-card" aria-label="Planning agent proposal">
      <header className="card-head"><h3>Planning agent · PO-5521</h3><span className="pill-red">ETA Oct 19 → Oct 23</span></header>
      <p className="source"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5L9.8 5.2M11.5 8.5a3.5 3.5 0 0 0-5 0L4 11a3.5 3.5 0 0 0 5 5l1.2-1.2" /></svg><span>Source: Laurel Fork reply<Mid />Oct 14, 10:41 AM</span></p>
      <ol className="agent-steps">{plan.map(step => <li key={step}>{step}</li>)}</ol>
      <p className="pill-lime big">Nov 6 still on <Tick /></p>
      <footer className="agent-foot"><span className="approved"><Avatar initials="DW" />Approved by Dana W.<Mid />11:02 AM</span><span className="muted">Next chase Oct 21 if no ship notice</span></footer>
    </article>
  </Story>
}
