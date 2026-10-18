import { CheckDot, Mid, Story } from '../parts'

const costs = [
  ['Walnut 8/4', '1,240 bd ft × $7.25', '$8,990.00'],
  ['Feet, finish and gift boxes', '240 × $2.30', '$552.00'],
  ['Board butter', '240 tins × $4.18', '$1,003.20'],
  ['Labor', '98.0 h approved', '$2,646.00'],
  ['Machine and overhead', '52 h', '$988.00'],
  ['Freight out', 'UPS · 21 cartons', '$430.00'],
]

/** 11 · What SO-1184 made: actual cost against the invoice, plan against actual with the agent's two causes, and the books. */
export function JobCost() {
  return <Story id="job-cost" className="centred" eyebrow={<>Job cost<Mid />Fri Nov 6</>} title="Know what every order made."
    line="Actual walnut, labor, machine time and tins, costed in dollars and posted to QuickBooks.">
    <article className="card cost-card" aria-label="Actual cost of SO-1184">
      <h3>Actual cost · <span className="nowrap">SO-1184</span> · Hearth &amp; Table</h3>
      <table className="lines cost">
        <tbody>{costs.map(([item, detail, amount]) => <tr key={item}><th scope="row">{item}<Mid /><span className="muted">{detail}</span></th><td>{amount}</td></tr>)}</tbody>
        <tbody className="totals"><tr><th scope="row">Actual cost</th><td>$14,609.20</td></tr><tr><th scope="row">Revenue<Mid /><span className="muted">Invoice 3317</span></th><td>$25,010.00</td></tr></tbody>
      </table>
      <p className="margin"><span>Order margin</span><mark>41.6%</mark></p>
    </article>
    <div className="cost-side">
      <article className="card variance-card" aria-label="Plan against actual">
        <h3>Plan vs actual</h3>
        <div className="variance-box"><p className="big">Quoted 42.0% → actual 41.6%</p><p className="red">Variance +$103.20</p></div>
        <table className="lines small"><tbody>
          <tr><th scope="row">Router 1 overtime to hold Nov 6<Mid /><span className="muted">Oct 28</span></th><td>+$84.00</td></tr>
          <tr><th scope="row">Board butter $4.18 vs $4.10<Mid /><span className="muted">240 tins</span></th><td>+$19.20</td></tr>
        </tbody></table>
        <p className="explained"><span><b>Explained by the planning agent</b><Mid />2 sources</span><CheckDot /></p>
      </article>
      <article className="card books-card" aria-label="QuickBooks">
        <h3>QuickBooks</h3>
        <ul><li><span>Invoice 3317<Mid />$25,010.00<Mid />synced</span><CheckDot /></li><li><span>COGS journal<Mid />$14,609.20<Mid />synced</span><CheckDot /></li></ul>
        <p className="muted">Nov 6, 4:12 PM</p>
      </article>
    </div>
  </Story>
}
