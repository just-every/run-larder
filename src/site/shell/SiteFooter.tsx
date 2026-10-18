import { Brand } from './Brand'
import { links } from './links'

/** One line set in type: the lockup, then Docs, Source, the contract and the licence. */
export function SiteFooter({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  return <footer className={`site-footer ${tone}`}>
    <div className="site-wrap"><div className="site-footer-row">
      <Brand tone={tone} size="footer" />
      <nav aria-label="Footer">
        <a href={links.docs}>Docs</a>
        <a href={links.source}>Source</a>
        <a href={links.contract}>Contract</a>
        <a href={links.licence}>MIT licensed</a>
      </nav>
    </div></div>
  </footer>
}
