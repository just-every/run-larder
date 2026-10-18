import { links } from './links'

/** The jar and "Larder" in the heading face. `tone="dark"` is the reversed jar (white lid) for charcoal grounds. */
export function Brand({ tone = 'light', size = 'header' }: { tone?: 'light' | 'dark'; size?: 'header' | 'footer' }) {
  const [w, h] = size === 'header' ? [38, 40] : [27, 28]
  return <a className={`site-brand ${size}`} href={links.home}>
    <img src={tone === 'dark' ? '/brand/mark-reversed.svg' : '/brand/mark.svg'} alt="" width={w} height={h} />
    <span>Larder</span>
  </a>
}
