import type { ReactNode } from 'react'

const set = (name: string, widths: number[], type: 'avif' | 'webp') => widths.map(w => `/site/${name}-${w}.${type} ${w}w`).join(', ')

/** A painted plate from public/site at its responsive widths, AVIF first; `phone` swaps in a crop at 760 px and under. */
export function Painting({ name, widths, sizes, width, height, className, eager, phone }: {
  name: string; widths: number[]; sizes: string; width: number; height: number; className?: string; eager?: boolean
  phone?: { name: string; widths: number[]; width: number; height: number }
}) {
  const media = '(max-width: 760px)'
  return <picture className={className}>
    {phone && <source media={media} type="image/avif" srcSet={set(phone.name, phone.widths, 'avif')} sizes="100vw" width={phone.width} height={phone.height} />}
    {phone && <source media={media} type="image/webp" srcSet={set(phone.name, phone.widths, 'webp')} sizes="100vw" width={phone.width} height={phone.height} />}
    <source type="image/avif" srcSet={set(name, widths, 'avif')} sizes={sizes} />
    <img src={`/site/${name}-${widths.at(-1)}.webp`} srcSet={set(name, widths, 'webp')} sizes={sizes} width={width} height={height} alt=""
      loading={eager ? 'eager' : 'lazy'} decoding="async" {...(eager ? { fetchPriority: 'high' as const } : {})} />
  </picture>
}

/** The stage-and-date line over each section heading: a red square, then tracked capitals. */
export const Eyebrow = ({ children }: { children: ReactNode }) => <p className="eyebrow"><span className="eyebrow-mark" aria-hidden="true" /><span>{children}</span></p>

/** A section of the order's story: eyebrow, heading and line, then its product drawing. */
export function Story({ id, eyebrow, title, line, className = '', children }: { id: string; eyebrow: ReactNode; title: ReactNode; line: ReactNode; className?: string; children: ReactNode }) {
  return <section id={id} className={`story ${className}`} aria-labelledby={`${id}-title`}>
    <div className="site-wrap story-grid">
      <div className="story-copy">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 id={`${id}-title`}>{title}</h2>
        <p className="story-line">{line}</p>
      </div>
      {children}
    </div>
  </section>
}

export const Tick = ({ className = '' }: { className?: string }) => <svg className={`tick ${className}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 8.4 6.6 11.4 12.6 4.8" /></svg>
/** A passed check: the tick in a round chip (lime by default). */
export const CheckDot = ({ tone = 'lime' }: { tone?: 'lime' | 'green' | 'dark' }) => <span className={`check-dot ${tone}`} aria-hidden="true"><Tick /></span>
export const Avatar = ({ initials, tone = 'grey' }: { initials: string; tone?: 'grey' | 'dark' }) => <span className={`avatar ${tone}`} aria-hidden="true">{initials}</span>
// Separators carry a no-break space before the dot (and before →) everywhere on the page, so a line never starts with one.
// Separators carry a no-break space before the dot (and before an arrow) across the page, so no line starts with one.
export const Mid = () => <span className="mid" aria-hidden="true"> · </span>
