import { Lockup } from './Lockup'
import { links } from './links'

export function SiteFooter() {
  return <footer className="site-foot">
    <div className="site-foot-row">
      <Lockup />
      <nav aria-label="Footer"><a href={links.docs}>Docs</a><a href={links.source}>Source</a></nav>
    </div>
    <p className="licence">Free and open source, MIT licensed.</p>
  </footer>
}
