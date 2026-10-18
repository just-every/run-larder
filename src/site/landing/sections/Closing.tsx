import { Actions } from '../../shell/Actions'
import { SiteFooter } from '../../shell/SiteFooter'
import { Painting } from '../parts'

/** 13 · The boxed board on the bench, the promise kept, the licence, and the footer set in type on the charcoal. */
export function Closing() {
  return <section className="closing" aria-labelledby="closing-title">
    <div className="site-wrap closing-copy">
      <h2 id="closing-title">Ship on the day you said.</h2>
      <p className="closing-sub">100% free and open source. MIT licensed.</p>
      <Actions demo={false} />
    </div>
    <div className="closing-scene">
      <Painting name="closing" widths={[768, 1152, 1536]} sizes="(max-width: 1920px) 100vw, 1920px" width={1536} height={660}
        phone={{ name: 'closing-phone', widths: [640, 1240], width: 1240, height: 660 }} />
    </div>
    <SiteFooter tone="dark" />
  </section>
}
