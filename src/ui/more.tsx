import { BusinessSettings } from './business-settings'
import type { Larder } from './app'
import { MoveIn } from './move-in'
import { Setup } from './setup'
import { People } from './people'
import { Archive } from './archive'
import { Activity } from './activity'
import { Cutover } from './cutover'
import { Approvals } from './approvals'
import { RetentionSettings } from './retention-settings'

const sections = [
  { id: 'retention', title: 'Retention and erasure', blurb: 'Review preservation periods, legal holds and exact erasure decisions.' },
  { id: 'move-in', title: 'Move in from Odoo', blurb: 'Preview, commit and undo a staged Odoo export.' },
  { id: 'cutover', title: 'Cutover', blurb: 'Rehearse, compare a day, approve one cutover time and route each channel.' },
  { id: 'setup', title: 'Items, contacts and locations', blurb: 'Units, variants, customer and supplier codes.' },
  { id: 'people', title: 'People and roles', blurb: 'Invite your team and set what each person can do.' },
  { id: 'approvals', title: 'Approvals', blurb: 'Thresholds, signatures and deputies for approvals.' },
  { id: 'archive', title: 'Business archive', blurb: 'Export everything; restore into an empty installation.' },
  { id: 'activity', title: 'Activity', blurb: 'Every recorded action, who did it and when.' },
]

export function More({ larder, section }: { larder: Larder; section?: string }) {
  const current = sections.find(x => x.id === section)
  return <div className="page">
    <header className="page-head"><p className="eyebrow">{current ? <a href="#settings">Settings</a> : 'Settings'}</p><h1>{current?.title ?? 'Settings'}</h1></header>
    {!current && <BusinessSettings larder={larder} />}
    {!current && <ul className="tiles">{sections.map(x => <li key={x.id}><a href={`#settings/${x.id}`}><strong>{x.title}</strong><span>{x.blurb}</span></a></li>)}</ul>}
    {section === 'retention' && <RetentionSettings larder={larder} />}
    {section === 'move-in' && <MoveIn larder={larder} />}
    {section === 'cutover' && <Cutover larder={larder} />}
    {section === 'setup' && <Setup larder={larder} />}
    {section === 'people' && <People larder={larder} />}
    {section === 'approvals' && <Approvals larder={larder} />}
    {section === 'archive' && <Archive larder={larder} />}
    {section === 'activity' && <Activity larder={larder} />}
  </div>
}
