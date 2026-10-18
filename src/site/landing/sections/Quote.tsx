import { Mid, Story, Tick } from '../parts'

const lines = [
  ['Walnut end-grain board 12×18', '240 × $96.00', '$23,040.00'],
  ['Board butter 4 oz tin', '240 × $6.50', '$1,560.00'],
  ['Freight', 'UPS Ground', '$410.00'],
  ['Sales tax', 'resale certificate on file', '$0.00'],
]
const options = [
  { title: 'All 240 · ships Fri Nov 6', note: 'Router 1 + 2 · walnut by Oct 19 · Laurel Fork lead time', chosen: true },
  { title: '120 Oct 30 + 120 Nov 13', note: 'Split shipment' },
  { title: 'Saturday overtime · ships Nov 3', note: '+$640 labor' },
]

/** 02 · Quote Q-0412 to Hearth & Table with three capable-to-promise ship dates; the cards overlap, as drawn. */
export function Quote() {
  return <Story id="quote" eyebrow={<>Quote<Mid />Wed Oct 7</>} title={<>A ship date the <span className="nowrap">shop can hit.</span></>}
    line="Larder checks walnut, machines and people before it offers a ship date, then prices the job to the cent.">
    <div className="quote-stage">
      <article className="card quote-card" aria-label="Quote Q-0412">
        <header className="card-head"><h3>Quote Q-0412 · Hearth &amp; Table</h3><span className="chip">Sent Oct 7, 2:15 PM</span></header>
        <table className="lines">
          <tbody>{lines.map(([item, detail, amount]) => <tr key={item}><th scope="row">{item}<Mid />{detail}</th><td>{amount}</td></tr>)}</tbody>
          <tfoot><tr><th scope="row">Total</th><td>$25,010.00</td></tr></tfoot>
        </table>
        <p className="quote-foot">Est. margin 42.0%<Mid />valid to Oct 21</p>
      </article>
      <div className="options-wrap">
        <article className="card options-card" aria-label="Ship date options">
          <h3>Ship date options</h3>
          <ul>{options.map(o => <li key={o.title} className={o.chosen ? 'chosen' : undefined}>
            <span className="radio" aria-hidden="true" />
            <span className="option-text"><b>{o.title}</b><small>{o.note}</small></span>
            {o.chosen && <span className="pill-lime">Chosen <Tick /></span>}
          </li>)}</ul>
        </article>
        <p className="confirmed">Confirmed Thu Oct 8 → SO-1184</p>
      </div>
    </div>
  </Story>
}
