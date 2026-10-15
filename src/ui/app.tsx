import { useEffect, useState } from 'react'
import { useLarder } from './api'
import { Details } from './controls'
import { words } from './format'
import { Today } from './today'
import { Orders } from './orders'
import { Stock } from './stock'
import { MakeBuy } from './make'
import { Handoff } from './handoff'
import { More } from './more'
import { Icon } from './icons'
import './style.css'

const destinations = [
  { id: 'today', title: 'Today', icon: 'today' },
  { id: 'orders', title: 'Orders', icon: 'orders' },
  { id: 'stock', title: 'Stock', icon: 'stock' },
  { id: 'make', title: 'Make & buy', icon: 'make' },
  { id: 'handoff', title: 'Handoff', icon: 'handoff' },
  { id: 'more', title: 'More', icon: 'more' },
] as const

const readHash = () => { const [view = 'today', ...rest] = window.location.hash.slice(1).split('/'); return { view: destinations.some(d => d.id === view) ? view : 'today', rest } }
export const go = (path: string) => { window.location.hash = path }

export function LarderApp() {
  const larder = useLarder(), { state, error, details, notice, busy } = larder
  const [route, setRoute] = useState<{ view: string; rest: string[] }>({ view: 'today', rest: [] })
  useEffect(() => { const update = () => { setRoute(readHash()); larder.setNotice('') }; update(); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update) }, [])
  async function signOut() { await fetch('/auth/signout', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' }); window.location.href = '/signin' }
  const waiting = state ? state.exceptions.length : 0
  return <div className="larder">
    <div className="rail">
      <nav className="sidebar" aria-label="Larder">
        <a className="wordmark" href="#today"><img src="/brand/mark.svg" alt="" width="34" height="31" /><span data-rer-name>Larder</span></a>
        <ul>{destinations.map(d => <li key={d.id} className={d.id === 'more' ? 'more' : undefined}><a href={`#${d.id}`} aria-current={route.view === d.id ? 'page' : undefined}><Icon name={d.icon} /><span>{d.title}</span>{d.id === 'today' && waiting > 0 && <b className="count" aria-label={`${waiting} need attention`}>{waiting}</b>}</a></li>)}</ul>
      </nav>
      {state && <div className="account"><p className="who"><Icon name="person" /><span>{state.actor.name}<small>{words(state.actor.role)}</small></span></p><button className="signout" onClick={() => void signOut()}><Icon name="signout" />Sign out</button></div>}
    </div>
    <main className="main" aria-busy={busy}>
      {error && <div className="alert" role="alert"><strong>That did not go through.</strong> {error}{details !== null && <Details value={details} s={state ?? undefined} />}</div>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {!state ? <p role="status" className="loading">{error ? 'Records have not loaded.' : 'Loading your records…'}</p> : <>
        {route.view === 'today' && <Today larder={larder} />}
        {route.view === 'orders' && <Orders larder={larder} id={route.rest[0]} />}
        {route.view === 'stock' && <Stock larder={larder} />}
        {route.view === 'make' && <MakeBuy larder={larder} section={route.rest[0]} id={route.rest[1]} />}
        {route.view === 'handoff' && <Handoff larder={larder} id={route.rest[0]} />}
        {route.view === 'more' && <More larder={larder} section={route.rest[0]} />}
      </>}
    </main>
  </div>
}
export type Larder = ReturnType<typeof useLarder>
