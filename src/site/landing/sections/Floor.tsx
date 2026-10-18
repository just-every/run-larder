import { Avatar, CheckDot, Mid, Story } from '../parts'

/** The board's shop drawing: twenty-four end-grain squares inside the juice groove, and its edge. */
function Drawing() {
  const cells = Array.from({ length: 24 }, (_, i) => i)
  return <figure className="drawing">
    <svg viewBox="0 0 420 240" fill="none" stroke="currentColor" strokeWidth="1.2" role="img" aria-label="FW-EG-1218 rev C, 18 by 12 by 1.5 inches">
      <g className="dim"><path d="M60 22h270M60 16v12M330 16v12M64 22l-6-3v6zM326 22l6-3v6z" /><path d="M36 50v176M30 50h12M30 226h12M36 54l-3-6h6zM36 222l-3 6h6z" /><path d="M382 30v8M394 30v8M370 34h12M406 34h-12" /></g>
      <rect x="60" y="50" width="270" height="176" rx="6" />
      <rect x="70" y="60" width="250" height="156" rx="4" />
      {cells.map(i => <rect key={i} x={74 + (i % 6) * 40.3} y={64 + Math.floor(i / 6) * 37} width="40.3" height="37" className="cell" />)}
      {cells.map(i => <path key={`g${i}`} className="grain" d={`M${80 + (i % 6) * 40.3} ${70 + Math.floor(i / 6) * 37}q${8 + (i % 3) * 3} ${10 + (i % 2) * 4} ${(i % 4) * 4} ${24}`} />)}
      <rect x="380" y="50" width="16" height="176" rx="3" /><path d="M383 70h10M383 110h10M383 150h10M383 190h10" className="grain" />
    </svg>
    <span className="dim-label w">18 in</span><span className="dim-label h">12 in</span><span className="dim-label d">1.5 in</span>
    <figcaption>FW-EG-1218 rev C · juice groove 3/8 in</figcaption>
  </figure>
}

/** 07 · Luis's sanding tablet for MO-2207 Op 4 and the panel-saw phone that issues lot LF-1023 and refuses a held lot. */
export function Floor() {
  return <Story id="floor" eyebrow={<>Shop floor<Mid />Tue Oct 27<Mid />10:02 AM</>} title="The plan, on every station."
    line="Operators start and stop work on a tablet, scan every lot and log good and scrap as they go.">
    <div className="floor-stage">
      <div className="tablet" aria-label="Sanding station tablet">
        <div className="screen">
          <header className="station"><Avatar initials="LR" /><span>Sanding<Mid />Luis R.</span><time>10:02 AM</time></header>
          <h3>MO-2207 · Op 4 Sand <span className="nowrap">120 / 180 / 220</span></h3>
          <p className="job">Hearth &amp; Table<Mid />SO-1184<Mid />due Fri Nov 6</p>
          <dl className="counts"><div><dt>Good</dt><dd>96</dd></div><div className="scrap"><dt>Scrap</dt><dd>2 <span className="chip">tear-out ×2</span></dd></div><div><dt>To go</dt><dd>68</dd></div></dl>
          <p className="running"><span className="dot" aria-hidden="true" />Running 2:41:08</p>
          <Drawing />
          <p className="tablet-buttons"><span className="ghost-button">Pause</span><span className="red-button">Complete</span></p>
        </div>
      </div>
      <div className="phone" aria-label="Panel saw phone">
        <div className="screen">
          <header className="station"><Avatar initials="MK" /><span>Panel saw<Mid />Mon Oct 26</span></header>
          <h3>Issue to MO-2207</h3>
          <p className="scan ok"><CheckDot tone="green" /><span>Walnut 8/4 · <span className="nowrap">lot LF-1023</span><br />380 bd ft</span></p>
          <p className="scan no"><span className="no-dot" aria-hidden="true" /><span><span className="nowrap">Lot LF-0928</span> · on QC hold · refused</span></p>
        </div>
      </div>
    </div>
  </Story>
}
