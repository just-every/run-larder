// The docs, rendered at build time from the repository's Markdown (docs/site.json and docs/*.md).
// A link to a page that is not listed, a missing file or a page without a title fails the run site build.
import { Marked, type Tokens } from 'marked'
import site from '../../../docs/site.json'

export type DocsPage = { slug: string; title: string; lead: string; html: string; toc: { id: string; text: string }[]; section: string }
export type DocsSection = { title: string; pages: { slug: string; title: string; lead: string }[] }

const files = import.meta.glob('../../../docs/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const source = (file: string) => {
  const text = files[`../../../docs/${file}`]
  if (text === undefined) throw new Error(`Docs: docs/${file} is listed in docs/site.json but missing.`)
  return text
}
const fileSlug = new Map(site.sections.flatMap(section => section.pages.map(page => [page.file, page.slug] as const)))
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
// Removes every match until none is left, so a removal cannot join its neighbours into a new tag or entity.
const removeAll = (text: string, pattern: RegExp) => {
  let next = text.replace(pattern, '')
  while (next !== text) { text = next; next = text.replace(pattern, '') }
  return text
}
export const stripTags = (html: string) => removeAll(html, /<[^>]+>/g)
const anchor = (text: string) => removeAll(stripTags(text.toLowerCase()), /&[a-z]+;/g).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function render(file: string) {
  const toc: DocsPage['toc'] = []
  let title = '', lead = ''
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const text = this.parser.parseInline(tokens)
        if (depth === 1) { title = text; return '' }
        const id = anchor(text)
        // The step number stays in the heading; "On this page" lists the names.
        if (depth === 2) toc.push({ id, text: text.replace(/^\d+\.\s+/, '') })
        return `<h${depth} id="${id}">${text}</h${depth}>`
      },
      paragraph({ tokens }: Tokens.Paragraph) {
        const text = this.parser.parseInline(tokens)
        if (title && !lead) { lead = text; return `<p class="docs-lead">${text}</p>` }
        return `<p>${text}</p>`
      },
      link({ href, tokens }: Tokens.Link) {
        const text = this.parser.parseInline(tokens)
        if (/^https:\/\//.test(href)) return `<a href="${escape(href)}">${text}</a>`
        const [path, hash] = href.split('#')
        const slug = fileSlug.get(path)
        if (!slug) throw new Error(`Docs: docs/${file} links to ${href}, which is not a docs page.`)
        return `<a href="/docs/${slug}${hash ? '#' + hash : ''}">${text}</a>`
      },
      // A short code word (an order number such as SO-0001, a menu name) never breaks at its hyphen; long commands still wrap.
      codespan({ text }: Tokens.Codespan) { return `<code${/^\S{1,24}$/.test(text) ? ' class="nowrap"' : ''}>${escape(text)}</code>` },
      code({ text }: Tokens.Code) { return `<div class="docs-code"><pre tabindex="0"><code>${escape(text)}</code></pre><button type="button" class="docs-copy" hidden>Copy</button></div>` },
      table(token: Tokens.Table) {
        const cell = (c: Tokens.TableCell) => this.parser.parseInline(c.tokens)
        return `<div class="docs-table"><table><thead><tr>${token.header.map(c => `<th scope="col">${cell(c)}</th>`).join('')}</tr></thead><tbody>${token.rows.map(row => `<tr>${row.map(c => `<td>${cell(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      },
      html({ text }: Tokens.HTML | Tokens.Tag) { return escape(text) },
    },
  })
  const html = marked.parse(source(file), { async: false }) as string
  if (!title || !lead) throw new Error(`Docs: docs/${file} needs a # title and a first paragraph.`)
  return { title, lead, html, toc }
}

export const docsPages: DocsPage[] = site.sections.flatMap(section => section.pages.map(page => ({ slug: page.slug, section: section.title, ...render(page.file) })))
export const docsSections: DocsSection[] = site.sections.map(section => ({ title: section.title, pages: section.pages.map(page => { const p = docsPages.find(x => x.slug === page.slug)!; return { slug: p.slug, title: p.title, lead: p.lead } }) }))
export const docsLead = 'How to run Larder, take an order through to the accountant, and keep your records.'
