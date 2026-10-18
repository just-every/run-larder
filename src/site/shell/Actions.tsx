import { links } from './links'

export const Arrow = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 10h13M11.5 5l5 5-5 5" /></svg>

/** Run Larder (the red button), then the demo and the docs as plain links. */
export function Actions({ demo = true }: { demo?: boolean }) {
  return <div className="site-actions">
    <a className="site-button" href={links.run}>Run Larder<Arrow /></a>
    {demo && <a className="site-link" href={links.demo}>Try the demo</a>}
    <a className="site-link" href={links.docs}>Read the docs</a>
  </div>
}
