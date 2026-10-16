import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { runPageHtml, siteNotFoundHtml, type RunData, type SiteBuild, type SiteContext } from '../base/run-site'
import { identity } from '../identity'
import { DocsArticle } from './docs/DocsArticle'
import { DocsIndex } from './docs/DocsIndex'
import { docsLead, docsPages, stripTags } from './docs/content'
import { copy } from './landing/copy'
import { Landing } from './landing/Landing'
import run from './run.json'

const entities: Record<string, string> = { '&amp;': '&', '&#39;': '’', '&quot;': '"', '&lt;': '<', '&gt;': '>' }
const text = (html: string) => stripTags(html).replace(/&(?:amp|#39|quot|lt|gt);/g, entity => entities[entity]!)

/**
 * The run site (run-larder.com), written by `rer build --site`: the landing at `/`, whose Run Larder opens the Run page
 * at `/run`; the guides at `/docs` and `/docs/<slug>`, rendered from the repository's Markdown; and the not-found page.
 * Every page is static, works without JavaScript and links to no instance-only route.
 */
export function sitePages({ styles }: SiteContext): SiteBuild {
  const data: RunData = run
  const document = (title: string, description: string, body: ReactElement) => '<!doctype html>' + renderToStaticMarkup(
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="theme-color" content="#F6F3E8" />
        <link rel="icon" type="image/svg+xml" href="/brand/mark.svg" />
        <link rel="preload" href="/fonts/bricolage/bricolage-grotesque-latin-opsz-normal.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="stylesheet" href="/rer-theme.css" />
        {styles.map(href => <link key={href} rel="stylesheet" href={href} />)}
      </head>
      <body>{body}</body>
    </html>,
  )
  return {
    pages: [
      { path: '/', html: document(copy.meta.title, copy.meta.description, <Landing />) },
      { path: '/run', html: runPageHtml(identity, data) },
      { path: '/docs', html: document('Docs · Larder', docsLead, <DocsIndex />) },
      ...docsPages.map(page => ({ path: `/docs/${page.slug}`, html: document(`${text(page.title)} · Larder docs`, text(page.lead), <DocsArticle slug={page.slug} />) })),
      { path: '/404', html: siteNotFoundHtml(identity, data) },
    ],
    assets: ['rer-theme.css', 'fonts', 'brand'],
  }
}
