import '../styles/site.css'
import '../styles/docs.css'
import { SiteFooter } from '../shell/SiteFooter'
import { SiteHeader } from '../shell/SiteHeader'
import { docsPages } from './content'
import { DocsNav } from './DocsNav'

/** One guide: menu, the article from its Markdown, "On this page" and the next guide. */
export function DocsArticle({ slug }: { slug: string }) {
  const index = docsPages.findIndex(page => page.slug === slug), page = docsPages[index], next = docsPages[index + 1]
  return <div className="site docs">
    <SiteHeader current="docs" />
    <main id="main" className="site-wrap docs-layout">
      <DocsNav current={slug} />
      <article className="docs-article" aria-labelledby="docs-title">
        <p className="eyebrow"><span className="eyebrow-mark" aria-hidden="true" />{page.section}</p>
        <h1 id="docs-title" dangerouslySetInnerHTML={{ __html: page.title }} />
        <div className="docs-body" dangerouslySetInnerHTML={{ __html: page.html }} />
        {next && <p className="docs-next"><a className="docs-next-link" href={`/docs/${next.slug}`}><small>Next</small><span dangerouslySetInnerHTML={{ __html: next.title }} /><span aria-hidden="true" className="arrow">→</span></a></p>}
      </article>
      {page.toc.length > 0 && <nav className="docs-toc" aria-labelledby="toc-title"><p id="toc-title" className="docs-toc-title">On this page</p><ul>{page.toc.map(entry => <li key={entry.id}><a href={`#${entry.id}`} dangerouslySetInnerHTML={{ __html: entry.text }} /></li>)}</ul></nav>}
    </main>
    <SiteFooter tone="light" />
  </div>
}
