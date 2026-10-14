import { Lockup } from './Lockup'
import { links } from './links'

/** Mark and name at left; Docs and Source at right; an ink rule under the bar. */
export function SiteHeader({ current }: { current?: 'docs' }) {
  return <header className="site-bar"><div className="site-bar-row">
    <Lockup />
    <nav aria-label="Site">
      <a href={links.docs} aria-current={current === 'docs' ? 'page' : undefined}>Docs</a>
      <a href={links.source}>Source</a>
    </nav>
  </div></header>
}
