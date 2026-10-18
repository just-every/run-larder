import { CheckDot, Mid, Story } from '../parts'
import { Tin } from '../props'

const rows = ['412 items and variants', <>38 BOMs<Mid />up to 3 levels</>, '126 lots with expiry', <>7 open MOs<Mid />19 sales orders</>, <>Stock value $86,412.50<Mid />matched to the cent</>]

/** 12 · A Katana import preview, the other five sources, and the one line that starts Larder on your computer. */
export function MoveIn() {
  return <Story id="move-in" className="copy-right" eyebrow="Moving in" title="Bring your shop from Katana."
    line="Items, BOMs, lots, open orders and stock values come across. MRPeasy, Fishbowl, Odoo, Fulcrum and DOSS too.">
    <article className="card import-card" aria-label="Katana import preview">
      <h3>Katana import · preview</h3>
      <ul>{rows.map((row, i) => <li key={i}><CheckDot tone="green" /><span>{row}</span></li>)}<li className="review"><span className="review-dot" aria-hidden="true" /><span>2 rows to review<Mid />recipe units</span></li></ul>
      <p className="import-foot"><span className="dark-button">Import</span></p>
    </article>
    <div className="terminal-wrap">
      <Tin />
      <figure className="terminal" aria-label="Start Larder on your computer">
        <span className="dots" aria-hidden="true"><i /><i /><i /></span>
        <pre><code><span className="prompt" aria-hidden="true">$ </span>npx -y @runeditrun/rer dev just-every/run-larder{'\n'}<span className="comment"># clones, installs and starts Larder on your computer</span></code></pre>
      </figure>
    </div>
  </Story>
}
