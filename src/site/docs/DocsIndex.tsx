import '../site.css'
import './docs.css'
import { SiteFooter } from '../shell/SiteFooter'
import { SiteHeader } from '../shell/SiteHeader'
import { docsLead, docsSections } from './content'
import { DocsNav } from './DocsNav'

/** /docs: every guide by section, each with its first line. */
export function DocsIndex() {
  let n = 0
  return <div className="site docs">
    <SiteHeader current="docs" />
    <main className="docs-layout">
      <DocsNav />
      <article className="docs-article" aria-labelledby="docs-title">
        <p className="docs-eyebrow">Docs</p>
        <h1 id="docs-title">Larder docs</h1>
        <p className="docs-lead">{docsLead}</p>
        {docsSections.map(section => <section key={section.title} className="docs-index-group" aria-label={section.title}>
          <h2>{section.title}</h2>
          <ul className="docs-cards">{section.pages.map(page => <li key={page.slug}><a href={`/docs/${page.slug}`}><span className="disc" aria-hidden="true">{++n}</span><span><strong dangerouslySetInnerHTML={{ __html: page.title }} /><span dangerouslySetInnerHTML={{ __html: page.lead }} /></span></a></li>)}</ul>
        </section>)}
      </article>
    </main>
    <SiteFooter />
  </div>
}
