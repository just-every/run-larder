import { CheckDot, Mid, Story } from '../parts'
import { Drum } from '../props'

const inputs = [
  [<b key="b">Beeswax</b>, <> · lot BW-0930 · Pisgah Apiary · 25 lb</>],
  [<b key="b">Mineral oil USP</b>, <> · lot MN-0914 · 98 lb</>],
  [<b key="b">4 oz tins</b>, <> · lot TN-0815 · 480</>],
]
const outputs = [
  [<b key="b">SO-1184</b>, <> · Hearth &amp; Table · <span className="nowrap">240 tins</span></>],
  [<b key="b">Shopify</b>, <> · 141 orders · 168 tins</>],
  [<b key="b">Amazon FBA</b>, <> · 72 tins</>],
]
const Arrow = ({ className = '' }: { className?: string }) => <svg className={`flow-arrow ${className}`} viewBox="0 0 34 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 7h31M26 1.5 32 7l-6 5.5" /></svg>

/** 05 · The board butter batch: beeswax, oil and tin lots through MO-2198 into Lot BB-1020, then out to every channel. */
export function Trace() {
  return <Story id="trace" className="wide" eyebrow={<>Batch room<Mid />Tue Oct 20</>} title="Every tin traces back to the drum."
    line="Lots, checks and expiry are recorded as you make. Trace any lot forward to every order or back to every input.">
    <div className="trace">
      <Drum />
      <div className="trace-in">
        <div className="lot held"><span className="muted">Beeswax · lot BW-0911 · held · CoA missing</span></div>
        <p className="swap"><svg viewBox="0 0 24 30" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 2h8a6 6 0 0 1 6 6v18M11 21l5 6 5-6" /></svg>swapped for BW-0930</p>
        <ul className="lots" aria-label="Inputs">{inputs.map(([a, b], i) => <li key={i} className="lot"><span>{a}{b}</span></li>)}</ul>
      </div>
      <Arrow className="a1" />
      <div className="lot batch"><b>MO-2198 · Batch kettle</b><span>Poured Tue Oct 20</span><span>Actual $4.18/tin<Mid />plan $4.10</span></div>
      <Arrow className="a2" />
      <div className="lot result">
        <p className="result-title">Lot BB-1020</p>
        <p className="result-meta">480 tins<Mid />Oct 20<Mid />exp Apr 2028</p>
        <p className="qc"><CheckDot tone="dark" />QC · fill weight 4.0 oz · passed</p>
        <p className="result-meta small">20 sampled<Mid />avg 4.03 oz<Mid />limits 3.95–4.15</p>
      </div>
      <svg className="fork" viewBox="0 0 44 210" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" preserveAspectRatio="none"><path d="M0 105h14M14 20v170M14 20h28M14 105h28M14 190h28" /></svg>
      <ul className="trace-out" aria-label="Where the lot went">{outputs.map(([a, b], i) => <li key={i} className="lot"><span>{a}{b}</span></li>)}</ul>
      <p className="pill-lime big on-time"><CheckDot tone="dark" />Batch on time</p>
      <p className="trace-buttons"><span className="ghost-button">Trace forward</span><span className="ghost-button">Trace back</span><span className="ghost-button">Export trace CSV</span></p>
    </div>
  </Story>
}
