import { Painting, Tick } from '../parts'

/** 09 · No heading: the loading dock from the yard, and the order's tag over the truck. */
export function Interlude() {
  return <section className="interlude" aria-label="SO-1184 leaves the dock">
    <div className="interlude-scene">
      <Painting name="interlude" widths={[768, 1152, 1536]} sizes="(max-width: 1920px) 100vw, 1920px" width={1536} height={743}
        phone={{ name: 'interlude-phone', widths: [640, 1140], width: 1140, height: 640 }} />
      <p className="dock-tag"><span>SO-1184 · 21 cartons · out Fri Nov 6, 3:40 PM <Tick className="lime" /></span></p>
    </div>
  </section>
}
