import { links } from './links'

/** The shelf-bracket mark and the name, as on the installed app. */
export function Lockup() {
  return <a className="lockup" href={links.home}><img src="/brand/mark.svg" alt="" width="40" height="36" /><span>Larder</span></a>
}
