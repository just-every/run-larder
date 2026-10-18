import { Brand } from './Brand'
import { links } from './links'

/** The header on every run-site page: the lockup at left; Docs and Source at right, one row on phones too.
 * `tone="dark"` is the homepage's, on the hero's charcoal. */
export function SiteHeader({ current, tone = 'light' }: { current?: 'docs'; tone?: 'light' | 'dark' }) {
  return <header className={`site-header ${tone}`}>
    <a className="skip-link" href="#main">Skip to content</a>
    <div className="site-wrap"><div className="site-header-row">
      <Brand tone={tone} />
      <nav aria-label="Main">
        <a href={links.docs} aria-current={current === 'docs' ? 'page' : undefined}>Docs</a>
        <a href={links.source}>Source</a>
      </nav>
    </div></div>
  </header>
}
