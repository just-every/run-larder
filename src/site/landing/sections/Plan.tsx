import { Mid, Story, Tick } from '../parts'
import { Planks } from '../props'

const bom = [
  { depth: 0, name: 'Walnut end-grain board 12×18', qty: '240' },
  { depth: 1, name: 'End-grain blank', tag: 'make', qty: '240' },
  { depth: 2, name: <>Walnut 8/4 FAS<Mid />5.17 bd ft each</>, tag: 'buy', qty: '1,240 bd ft' },
  { depth: 1, name: 'Rubber feet', tag: 'buy', qty: '960' },
  { depth: 1, name: 'Gift box', tag: 'buy', qty: '240', last: true },
  { depth: 0, name: 'Board butter 4 oz tin', tag: 'make', qty: '240', last: true },
]
const net = [
  ['Walnut 8/4', '1,240 bd ft', '860', '380', <>PO-5521 · Laurel Fork Hardwoods · due Oct 19</>],
  ['Rubber feet', '960', '1,400', '0', 'Reserved'],
  ['Gift box', '240', '90', '150', <>PO-5524 · Carolina Box Co. · due Oct 23</>],
  ['Board butter tins', '240', '0', '240', <>MO-2198 · make Oct 20</>],
] as const

/** 03 · The multilevel BOM for the order beside time-phased net requirements: what is short, and what is bought or made. */
export function Plan() {
  return <Story id="plan" className="wide" eyebrow={<>Plan<Mid />Thu Oct 8<Mid />9:14 AM</>} title="From one order to every board foot."
    line="MRP explodes the bill of materials, nets what you have and drafts what to buy, with dates.">
    <div className="plan-grid">
      <article className="card bom-card" aria-label="Bill of materials">
        <h3>BOM · FW-EG-1218 rev C</h3>
        <ul className="bom">{bom.map((row, i) => <li key={i} className={`d${row.depth}${row.last ? ' last' : ''}`}>
          <span className="bom-name">{row.name}{row.tag && <span className="tag">{row.tag}</span>}</span><span className="bom-qty">{row.qty}</span>
        </li>)}</ul>
      </article>
      <article className="card net-card" aria-label="Net requirements">
        <h3>Net requirements · ship Fri Nov 6</h3>
        <div className="scroll-x" tabIndex={-1}><table className="net">
          <thead><tr><th scope="col">Item</th><th scope="col">Need</th><th scope="col">Have</th><th scope="col">Short</th><th scope="col">Action</th></tr></thead>
          <tbody>{net.map(([item, need, have, short, action]) => <tr key={item}>
            <th scope="row">{item}</th><td data-label="Need">{need}</td><td data-label="Have">{have}</td>
            <td data-label="Short" className={short === '0' ? 'zero' : 'short'}>{short}</td><td className="action">{action}</td>
          </tr>)}</tbody>
        </table></div>
        <p className="net-foot"><span className="pill-lime big">2 POs approved by Dana W.<Mid />9:31 AM <Tick /></span><span className="rule" aria-hidden="true" /><span className="muted">3 suggestions</span></p>
      </article>
      <Planks />
    </div>
  </Story>
}
