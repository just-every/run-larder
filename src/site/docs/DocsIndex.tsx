import '../styles/site.css'
import '../styles/docs.css'
import { Painting } from '../landing/parts'
import { Drum, Planks, Tin } from '../landing/props'
import { SiteFooter } from '../shell/SiteFooter'
import { SiteHeader } from '../shell/SiteHeader'
import { docsLead, docsSections } from './content'
import { DocsNav } from './DocsNav'

/** /docs: every guide by section, each with its first line, under the workshop's line-art props and over its blueprint. */
export function DocsIndex() {
  let n = 0
  return <div className="site docs">
    <SiteHeader current="docs" />
    <main id="main" className="site-wrap docs-layout docs-index">
      <DocsNav />
      <article className="docs-article" aria-labelledby="docs-title">
        <div className="docs-index-head">
          <div>
            <p className="eyebrow"><span className="eyebrow-mark" aria-hidden="true" />Docs</p>
            <h1 id="docs-title">Larder docs</h1>
            <p className="docs-lead">{docsLead}</p>
          </div>
          <div className="docs-props" aria-hidden="true"><Planks /><Drum /><Tin /></div>
        </div>
        {docsSections.map(section => <section key={section.title} className="docs-index-group" aria-label={section.title}>
          <h2>{section.title}</h2>
          <ul className="docs-cards">{section.pages.map(page => <li key={page.slug}><a href={`/docs/${page.slug}`}><span className="disc" aria-hidden="true">{++n}</span><span><strong dangerouslySetInnerHTML={{ __html: page.title }} /><span dangerouslySetInnerHTML={{ __html: page.lead }} /></span></a></li>)}</ul>
        </section>)}
      </article>
    </main>
    <div className="docs-end">
      <Painting name="hero" widths={[768, 1152, 1536]} sizes="100vw" width={1536} height={596} className="docs-blueprint" />
      <SiteFooter tone="dark" />
    </div>
  </div>
}
