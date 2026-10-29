import { useEffect, useState } from 'react'
import { rows, useLarder } from './api'
import { Details } from './controls'
import { Rail, TopBar, PlannerStrip, type Mode } from './shell'
import { Today } from './today'
import { Orders } from './orders'
import { Schedule } from './schedule/schedule'
import { Stock } from './stock'
import { BlindCounts } from './counts'
import { MakeBuy } from './make'
import { Handoff } from './handoff'
import { More } from './more'
import './styles/base.css'
import './styles/shell.css'
import './styles/pages.css'
import './styles/schedule.css'

export const destinations = [
  { id: 'today', title: 'Today', icon: 'today' },
  { id: 'orders', title: 'Orders', icon: 'orders' },
  { id: 'schedule', title: 'Schedule', icon: 'schedule' },
  { id: 'stock', title: 'Stock', icon: 'stock' },
  { id: 'make', title: 'Make & buy', icon: 'make' },
  { id: 'handoff', title: 'Handoff', icon: 'handoff' },
  { id: 'settings', title: 'Settings', icon: 'more' },
] as const

const readHash = () => { const [view = '', ...rest] = window.location.hash.slice(1).split('/'); return { view: view === 'more' ? 'settings' : destinations.some(d => d.id === view) ? view : '', rest } }
export const go = (path: string) => { window.location.hash = path }

export function LarderApp() {
  const larder = useLarder(), { state, error, details, notice, busy } = larder
  const [route, setRoute] = useState<{ view: string; rest: string[] }>({ view: '', rest: [] })
  const [mode, setMode] = useState<Mode>('week')
  useEffect(() => { const update = () => { setRoute(readHash()); larder.setNotice('') }; update(); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update) }, [])
  // The shop starts on its schedule once there is work to schedule; a new installation starts on Today's first steps.
  const view = state?.blindCounting ? 'stock' : route.view || (state && rows(state, 'workOrders').length ? 'schedule' : 'today')
  return <div className="larder">
    <TopBar larder={larder} view={view} mode={mode} setMode={setMode} />
    <Rail larder={larder} view={view} />
    <div className="workspace">
      <PlannerStrip larder={larder} />
      <main className="main" aria-busy={busy || (!state && !error)}>
        {error && <div className="alert" role="alert"><strong>That did not go through.</strong> {error}{details !== null && <Details value={details} s={state ?? undefined} />}</div>}
        {notice && <p className="notice" role="status">{notice}</p>}
        {!state ? <p role="status" className="loading">{error ? 'Records have not loaded.' : 'Loading your records…'}</p> : state.blindCounting ? <BlindCounts larder={larder} /> : <>
          {view === 'today' && <Today larder={larder} />}
          {view === 'orders' && <Orders larder={larder} id={route.rest[0]} />}
          {view === 'schedule' && <Schedule larder={larder} mode={mode} />}
          {view === 'stock' && <Stock larder={larder} />}
          {view === 'make' && <MakeBuy larder={larder} section={route.rest[0]} id={route.rest[1]} />}
          {view === 'handoff' && <Handoff larder={larder} id={route.rest[0]} />}
          {view === 'settings' && <More larder={larder} section={route.rest[0]} />}
        </>}
      </main>
    </div>
  </div>
}
export type Larder = ReturnType<typeof useLarder>
