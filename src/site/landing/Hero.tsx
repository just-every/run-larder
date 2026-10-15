import { links } from '../shell/links'
import { Arrow } from './Arrow'
import { copy } from './copy'
import { Goods, Print, Row } from './Print'

/** The headline, the line under it, Run Larder, and the order taken, made and shipped as three printed cards. */
export function Hero() {
  const [first, second, third] = copy.alternatives
  return <section className="hero" aria-labelledby="hero-title">
    <h1 id="hero-title"><span>{copy.headline[0]}</span> <span>{copy.headline[1]}</span></h1>
    <div className="hero-body">
      <div className="hero-text">
        <p className="sub">{copy.sub}</p>
        <p className="alternative">100% free, open source alternative to <b>{first}, {second}</b> and <b>{third}</b></p>
        <p className="actions"><a className="pill" href={links.run}>{copy.run} <Arrow /></a><a className="pill" style={{ paddingInline: 32 }} href="https://demo.run-larder.com/">Try the demo</a><a className="text-link" href={links.docs}>{copy.docs}</a></p>
        <p className="small">{copy.licence}</p>
      </div>
      <ol className="steps" aria-label={copy.drawingLabel}>
        <li className="step">
          <p className="step-head"><span className="disc">1</span> Confirmed</p>
          <Print><p className="ref">SO-0001</p><p className="serif">Harbour Kitchen Co</p><div className="rows"><Row label="Reserved" value="16" /><Row label="Short" value="24" /></div><Goods name="docket" /></Print>
        </li>
        <li className="step">
          <p className="step-head"><span className="disc">2</span> Made</p>
          <Print><p className="ref">WO-0001</p><p className="serif">Walnut serving board</p><p><span className="tag">BOM rev 2</span></p><Goods name="board" /><div className="rows"><Row label="Done" value="24" /></div></Print>
        </li>
        <li className="step">
          <p className="step-head"><span className="disc">3</span> Shipped</p>
          <Print><p className="ref">SH-0001</p><p className="serif">40 walnut serving boards</p><Goods name="parcel" /><p className="stamp"><span className="chip">Shipped</span></p></Print>
        </li>
      </ol>
    </div>
  </section>
}
