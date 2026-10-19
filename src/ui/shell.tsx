// The app's frame from the owner's pick: a charcoal top bar and labelled rail with the workshop's white line
// drawing, and the planner strip that says what agents have prepared for a person to approve.
import { useEffect, useState } from 'react'
import { personName, rows, type Rec } from './api'
import { destinations, type Larder } from './app'
import { Icon } from './icons'
import { Search } from './search'
import { clock, dayName, words } from './format'

export type Mode = 'day' | 'week'

export async function signOut() {
  await fetch('/auth/signout', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' })
  window.location.href = '/signin'
}
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('')
const shortName = (name: string) => { const [first, ...rest] = name.split(/\s+/).filter(Boolean); return rest.length ? `${first} ${rest[rest.length - 1]![0]}.` : first ?? '' }

export function TopBar({ larder, view, mode, setMode }: { larder: Larder; view: string; mode: Mode; setMode: (m: Mode) => void }) {
  const { state, busy, error, loadedAt } = larder
  // The day is read in the browser after hydration, so the server's clock and time zone never show.
  const [today, setToday] = useState<Date | null>(null)
  useEffect(() => setToday(new Date()), [])
  return <header className="topbar">
    <a className="wordmark" href="#"><img src="/brand/mark-reversed.svg" alt="" width="30" height="32" /><span data-rer-name>Larder</span></a>
    <p className="today-label"><strong>Today</strong> <span>{today ? dayName(today) : ''}</span></p>
    {view === 'schedule' && <div className="toggle" role="group" aria-label="Schedule span">{(['day', 'week'] as const).map(m => <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>{words(m)}</button>)}</div>}
    {state && <Search s={state} />}
    <p className={`sync ${error ? 'bad' : busy ? 'busy' : ''}`} role="status"><span className="dot" aria-hidden="true" /><span className="sync-text">{error ? 'Last change not saved' : busy ? 'Saving…' : loadedAt ? <>All changes saved<span className="since"> · loaded {clock(loadedAt)}</span></> : 'Loading…'}</span></p>
    {state && <details className="account">
      <summary><span className="avatar" aria-hidden="true">{initials(state.actor.name)}</span><span className="who">{shortName(state.actor.name)}</span><Icon name="down" /></summary>
      <div className="account-menu"><p><strong>{state.actor.name}</strong><small>{words(state.actor.role)}</small></p><button className="signout" type="button" onClick={() => void signOut()}><Icon name="signout" />Sign out</button></div>
    </details>}
  </header>
}

export function Rail({ larder, view }: { larder: Larder; view: string }) {
  const waiting = larder.state ? larder.state.exceptions.length : 0
  return <nav className="rail" aria-label="Larder">
    <ul>{destinations.map(d => <li key={d.id}><a href={`#${d.id}`} aria-current={view === d.id ? 'page' : undefined}><Icon name={d.icon} /><span>{d.title}</span>{d.id === 'today' && waiting > 0 && <b className="count" aria-label={`${waiting} need attention`}>{waiting}</b>}</a></li>)}</ul>
    <img className="rail-art" src="/brand/workshop-line.webp" alt="" width="332" height="698" />
  </nav>
}

// A proposal's subject in a few words; its full summary is in the panel and the strip's tooltip.
const subject = (p: Rec) => p.kind === 'reschedule' ? `reschedule ${(p.context?.before ?? []).map((b: Rec) => b.reference).join(', ')}` : String(p.kind).replaceAll('-', ' ')

// Agents prepare; people approve. The strip names what is waiting, never acts on its own.
export function PlannerStrip({ larder }: { larder: Larder }) {
  const s = larder.state
  if (!s) return null
  const waiting = rows(s, 'proposals').filter(p => p.status === 'awaiting approval')
  const latest = [...waiting].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
  return <aside className="planner" aria-label="Larder planner">
    <Icon name="info" /><strong>Larder planner</strong>
    <p title={latest?.summary}>{latest ? <>{waiting.length} {waiting.length === 1 ? 'plan' : 'plans'} awaiting your approval: {subject(latest)}. Prepared {clock(new Date(latest.createdAt))} by {personName(s, latest.preparedBy)}.</> : 'No plans are waiting. Agents prepare drafts and proposals; a person approves them.'}</p>
    <a href="#more/activity">View worklog <Icon name="arrow" /></a>
  </aside>
}
