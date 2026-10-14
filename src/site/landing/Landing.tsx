import '../site.css'
import './landing.css'
import { SiteFooter } from '../shell/SiteFooter'
import { SiteHeader } from '../shell/SiteHeader'
import { links } from '../shell/links'
import { Arrow } from './Arrow'
import { copy } from './copy'
import { drawings } from './Drawings'
import { Hero } from './Hero'

/** The run site's homepage (SPEC.md §1): hero, six sections with their printed cards, the tiles, and the closing band. */
export function Landing() {
  return <div className="site landing">
    <SiteHeader />
    <main>
      <Hero />
      {copy.sections.map((section, i) => { const Drawing = drawings[section.id]; return <section key={section.id} id={section.id} className={i % 2 ? 'feature flip' : 'feature'} aria-labelledby={`${section.id}-title`}>
        <div className="feature-text"><h2 id={`${section.id}-title`}>{section.heading}</h2><p>{section.line}</p></div>
        <div className="feature-drawing"><Drawing /></div>
      </section> })}
      <section id="included" className="included" aria-labelledby="included-title">
        <h2 id="included-title">{copy.included.heading}</h2>
        <ul>{copy.included.tiles.map(tile => <li key={tile.name}><img src={`/brand/goods/${tile.picture}.webp`} alt="" loading="lazy" /><p><b>{tile.name}</b><span>{tile.line}</span></p></li>)}</ul>
      </section>
      <section id="beside" className="beside" aria-labelledby="beside-title"><h2 id="beside-title">{copy.beside.heading}</h2><p>{copy.beside.line}</p></section>
      <section className="closing" aria-labelledby="closing-title">
        <img className="closing-mark" src="/brand/mark.svg" alt="" width="40" height="36" />
        <h2 id="closing-title">{copy.headline.join(' ')}</h2>
        <p className="actions"><a className="pill" href={links.run}>{copy.run} <Arrow /></a><a className="text-link" href={links.docs}>{copy.docs}</a></p>
        <img className="closing-art" src="/brand/goods/shelf.webp" alt="" />
      </section>
    </main>
    <SiteFooter />
  </div>
}
