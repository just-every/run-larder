import { CheckDot, Mid, Story } from '../parts'
import { Tin } from '../props'

// The one start line every Run Edit Run page shows, and the alternative for people who already have Node.
const START = 'curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-larder'
const ALTERNATIVE = 'Already have Node 22 or later? npx -y @runeditrun/rer dev just-every/run-larder'

/** A command that wraps only between words, keeping the installer's `install.sh | sh` together. */
function words(line: string) {
  return line.split(/(\S*install\.sh \| sh|\S+)/).map((part, index) => {
    const pipe = /^(.*\/)(install\.sh \| sh)$/.exec(part)
    if (pipe) return <span key={index}><span className="nowrap">{pipe[1]}</span><wbr /><span className="nowrap">{pipe[2]}</span></span>
    return part.trim() ? <span key={index} className="nowrap">{part}</span> : part
  })
}

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
        <pre><code><span className="prompt" aria-hidden="true">$ </span>{words(START)}{'\n'}<span className="comment"># {words('installs rer, then gets and starts Larder on your computer')}</span>{'\n'}<span className="comment"># {words(ALTERNATIVE)}</span></code></pre>
      </figure>
    </div>
  </Story>
}
