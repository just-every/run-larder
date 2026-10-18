import { Actions } from '../shell/Actions'
import { SiteHeader } from '../shell/SiteHeader'
import { Painting, Tick } from './parts'

/** The five records the page follows, at the places the hero's blueprint puts them (percent of the plate). */
const cards = [
  { key: 'walnut', at: [2.0, 44.8], body: <>Walnut 8/4 · 1,240 bd ft · reserved</> },
  { key: 'router', at: [34.8, 47.0], body: <>Router 2 down 2 hrs → 3 jobs <br />moved to Router 1 · <mark>Nov 6 still on <Tick /></mark></> },
  { key: 'qc', at: [55.4, 50.7], body: <>QC · fill weight 4.0 oz · passed <Tick className="lime" /></> },
  { key: 'margin', at: [75.0, 56.7], body: <>Order margin 41.6%</> },
  { key: 'lot', at: [63.5, 84.9], body: <>Lot BB-1020 · 480 tins · Oct 20 · exp Apr 2028</> },
]

/** Dana's sawtooth workshop as a white-line blueprint on charcoal, the promise over it and the order's records in it. */
export function Hero() {
  return <section className="hero" aria-labelledby="hero-title">
    <SiteHeader tone="dark" />
    <div className="site-wrap hero-copy">
      <h1 id="hero-title">Promise dates you can keep.</h1>
      <p className="hero-sub">Larder plans your materials and machines, runs the shop floor, traces every lot, costs every job and keeps QuickBooks in sync.</p>
      <p className="hero-alt">100% free, open source alternative to <strong>Katana</strong>, <strong>MRPeasy</strong> and <strong>Fishbowl</strong></p>
      <Actions />
    </div>
    <div className="hero-scene">
      <Painting className="hero-art" name="hero" widths={[768, 1152, 1536]} sizes="(max-width: 1920px) 100vw, 1920px" width={1536} height={596} eager
        phone={{ name: 'hero-phone', widths: [640, 1076], width: 1076, height: 576 }} />
      <ul className="hero-cards" aria-label="SO-1184 in the workshop">
        {cards.map(card => <li key={card.key} className={`hero-card hc-${card.key}`} style={{ left: `${card.at[0]}%`, top: `${card.at[1]}%` }}>{card.body}</li>)}
      </ul>
    </div>
  </section>
}
