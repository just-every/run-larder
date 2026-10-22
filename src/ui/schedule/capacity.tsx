import { FiniteReschedule } from './reschedule'
import { useEffect, useState } from 'react'
import { can, personName, rows } from '../api'
import type { Larder } from '../app'
import { Area, Card, Choose, Field, Form, Table, text } from '../controls'

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const minute = (v: string) => { const [h, m] = v.split(':').map(Number); return h! * 60 + m! }
const clock = (n: number) => `${String(Math.floor(n % 1440 / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
const local = (v: string) => { const d = new Date(v); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
const tokens = (v: string) => v.split(',').map(v => v.trim()).filter(Boolean)

function CalendarEditor({ larder, kind }: { larder: Larder; kind: 'machine' | 'labor' }) {
  const s = larder.state!, calendars = rows(s, kind === 'machine' ? 'machineCalendars' : 'laborCalendars')
  const [picked, setPicked] = useState(''), selected = calendars.find(r => r.id === picked)
  const first = selected?.shifts[0], label = kind === 'machine' ? 'Machine' : 'Labor'
  const [outage, setOutage] = useState('')
  const target = calendars.find(r => r.id === outage)
  return <Card title={`${label} calendars`}>
    <p className="muted">{kind === 'machine' ? 'Define named work centers and parallel machines.' : 'Each person belongs to one availability calendar. Team members share its shifts, skills and task limit.'} Changes retain the previous definition and reason.</p>
    {calendars.length > 0 && <Table head={['Calendar', 'Availability', 'Capacity', 'Exceptions']}>
      {calendars.map(r => <tr key={r.id}><td><strong>{r.name}</strong><br />{r.timeZone}<br />{r.effectiveFrom} – {r.effectiveTo}</td><td>{r.shifts.map((shift: any, i: number) => <div key={i}>{shift.weekdays.map((d: number) => weekdays[d]).join(', ')} {clock(shift.start)}–{clock(shift.end)}{shift.end > 1440 ? ' next day' : ''}{shift.breaks.map((b: any) => `; break ${clock(b.start)}–${clock(b.end)}`).join('')}</div>)}{r.usHolidays && <div>US federal holidays closed</div>}{kind === 'labor' && <div>{r.operatorIds.map((id: string) => personName(s, id)).join(', ')} · Skills: {r.skills.join(', ') || 'none recorded'}</div>}</td><td>{r.capacity} {kind === 'machine' ? `parallel · ${r.efficiency}% efficiency` : 'tasks per person'}</td><td>{r.closedDates.join(', ') || 'No date closures'}{r.exceptions.map((e: any, i: number) => <p key={i}><time>{e.startsAt}</time> – <time>{e.endsAt}</time><br />{e.reason}</p>)}</td></tr>)}
    </Table>}
    {can(s, kind === 'machine' ? ['manager', 'planner'] : ['manager']) && <details><summary>{label} calendar settings</summary>
      <label className="field"><span>Edit calendar</span><select aria-label={`Edit ${kind} calendar`} value={picked} onChange={e => setPicked(e.target.value)}><option value="">New calendar</option>{calendars.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <Form key={picked + ':' + selected?.version} title={selected ? `Edit ${selected.name}` : `New ${kind} calendar`} submit={`Save ${kind} calendar`} busy={larder.busy} onSubmit={async d => {
        const start = minute(text(d, 'start')), rawEnd = minute(text(d, 'end')), end = rawEnd <= start ? rawEnd + 1440 : rawEnd
        const breakStart = text(d, 'breakStart'), breakEnd = text(d, 'breakEnd')
        const afterStart = (v: string) => minute(v) < start ? minute(v) + 1440 : minute(v)
        return larder.run(`capacity.${kind}`, { ...(selected ? { id: selected.id, version: selected.version } : {}), name: text(d, 'name'), timeZone: text(d, 'zone'), effectiveFrom: text(d, 'from'), effectiveTo: text(d, 'to'), shifts: [{ weekdays: text(d, 'days').split(',').map(x => weekdays.findIndex(day => day.toLowerCase() === x.trim().toLowerCase())), start, end, breaks: [...(breakStart || breakEnd ? [{ start: afterStart(breakStart), end: afterStart(breakEnd) }] : []), ...(first?.breaks.slice(1) ?? [])] }, ...(selected?.shifts.slice(1) ?? [])], closedDates: tokens(text(d, 'closed')), usHolidays: d.has('holidays'), exceptions: selected?.exceptions ?? [], capacity: Number(text(d, 'capacity')), reason: text(d, 'reason'), ...(kind === 'machine' ? { efficiency: Number(text(d, 'efficiency')) } : { operatorIds: d.getAll('members'), skills: tokens(text(d, 'skills')) }) })
      }}>
        <Field label={`${label} calendar name`} name="name" defaultValue={selected?.name} />
        <Field label={`${label} time zone`} name="zone" defaultValue={selected?.timeZone ?? 'America/New_York'} />
        <Field label={`${label} effective from`} name="from" type="date" defaultValue={selected?.effectiveFrom ?? new Date().toISOString().slice(0, 10)} />
        <Field label={`${label} effective through`} name="to" type="date" defaultValue={selected?.effectiveTo ?? `${new Date().getFullYear() + 1}-12-31`} />
        <Field label={`${label} weekdays`} name="days" defaultValue={first ? first.weekdays.map((d: number) => weekdays[d]).join(', ') : 'Mon, Tue, Wed, Thu, Fri'} hint="Comma-separated: Sun, Mon, Tue, Wed, Thu, Fri, Sat" />
        <Field label={`${label} shift starts`} name="start" type="time" defaultValue={clock(first?.start ?? 420)} />
        <Field label={`${label} shift ends`} name="end" type="time" defaultValue={clock(first?.end ?? 900)} hint="An end at or before the start continues overnight." />
        <Field label={`${label} break starts`} name="breakStart" type="time" required={false} defaultValue={first?.breaks[0] ? clock(first.breaks[0].start) : ''} />
        <Field label={`${label} break ends`} name="breakEnd" type="time" required={false} defaultValue={first?.breaks[0] ? clock(first.breaks[0].end) : ''} />
        <Field label={`${label} closed dates`} name="closed" required={false} defaultValue={selected?.closedDates.join(', ')} hint="YYYY-MM-DD, separated by commas" />
        <label className="field"><span>Observed US federal holidays</span><input type="checkbox" name="holidays" defaultChecked={selected?.usHolidays ?? true} aria-label={`${label} closes US holidays`} /></label>
        <Field label={kind === 'machine' ? 'Parallel machines' : 'Simultaneous tasks per person'} name="capacity" type="number" min="1" max={kind === 'machine' ? 20 : 10} defaultValue={selected?.capacity ?? 1} />
        {kind === 'machine' ? <Field label="Machine efficiency percent" name="efficiency" type="number" min="1" max="100" defaultValue={selected?.efficiency ?? 100} /> : <>
          <label className="field"><span>Qualified people / team members</span><select multiple name="members" required aria-label="Qualified people / team members" defaultValue={selected?.operatorIds ?? []}>{rows(s, 'people').filter(p => ['owner', 'manager', 'production', 'operator'].includes(p.role)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <Field label="Authorized labor skills" name="skills" required={false} defaultValue={selected?.skills.join(', ')} hint="Exact routing skill names, comma-separated. This records a supervisor's authorization, never certification." />
        </>}
        <Area label={`${label} calendar reason`} name="reason" />
      </Form>
      {calendars.length > 0 && <Form title={kind === 'machine' ? 'Machine outage or downtime' : 'Vacation or time off'} submit={`Add ${kind} exception`} busy={larder.busy} onSubmit={d => target && larder.run(`capacity.${kind}`, { ...target, exceptions: [...target.exceptions, { startsAt: new Date(text(d, 'start')).toISOString(), endsAt: new Date(text(d, 'end')).toISOString(), reason: text(d, 'reason') }], reason: text(d, 'reason') })}>
        <Choose label={`${label} exception calendar`} name="calendar" value={outage} onChange={(e: any) => setOutage(e.target.value)} options={calendars.map(r => ({ value: r.id, label: r.name }))} />
        <Field label={`${label} exception starts (local time)`} name="start" type="datetime-local" />
        <Field label={`${label} exception ends (local time)`} name="end" type="datetime-local" />
        <Area label={`${label} exception reason`} name="reason" />
      </Form>}
    </details>}
  </Card>
}

export function Capacity({ larder }: { larder: Larder }) {
  const s = larder.state!, [start, setStart] = useState(() => new Date().toISOString()), [days, setDays] = useState(14), [plan, setPlan] = useState<any>(), [error, setError] = useState(''), [filter, setFilter] = useState('all')
  useEffect(() => {
    const controller = new AbortController(); setPlan(undefined); setError('')
    fetch(`/api/larder/scheduling/finite?asOf=${encodeURIComponent(start)}&days=${days}`, { signal: controller.signal, cache: 'no-store' }).then(async r => { const body: any = await r.json(); if (!r.ok) throw new Error(body.error?.message ?? 'Plan could not load.'); setPlan(body) }).catch(e => { if (e.name !== 'AbortError') setError(e.message) })
    return () => controller.abort()
  }, [s.version, start, days])
  const jobs = (plan?.jobs ?? []).filter((j: any) => filter === 'all' || (filter === 'late' ? j.late : j.unscheduled))
  return <section className="capacity" aria-label="Finite capacity planning">
    <Card title="Finite capacity plan">
      <p>Named machines and qualified people, inside their saved calendars. Unconfigured or infeasible work stays unscheduled. This projection changes no customer promise, execution assignment or resource booking.</p>
      <Form title="Planning window" submit="Run finite scheduling" onSubmit={d => { setStart(new Date(text(d, 'start')).toISOString()); setDays(Number(text(d, 'days'))); return false }}>
        <Field label="Finite plan starts (local time)" name="start" type="datetime-local" defaultValue={local(start)} />
        <Field label="Finite plan horizon days" name="days" type="number" min="1" max="60" defaultValue={days} />
      </Form>
      {error && <p role="alert">{error}</p>}
      {!plan && !error && <p role="status">Calculating finite capacity…</p>}
      {plan && <>
        <p className="capacity-counts"><button className="button" type="button" onClick={() => setFilter('late')}>Late {plan.counts.late}</button> <button className="button" type="button" onClick={() => setFilter('unscheduled')}>Unscheduled {plan.counts.unscheduled}</button> <button className="button" type="button" onClick={() => setFilter('all')}>All jobs</button></p>
        <p><strong>Bottleneck: {plan.bottleneck ? `${plan.bottleneck.name} (${plan.bottleneck.kind}, ${plan.bottleneck.percent}% load)` : 'none; no occupied capacity'}</strong></p>
        <details><summary>Machine and labor load</summary><Table head={['Resource', 'Occupied minutes', 'Available minutes', 'Load']}>
          {plan.loads.map((l: any) => <tr key={`${l.kind}:${l.id}`}><td>{l.name} · {l.kind}{l.kind === 'machine' && ` slot ${l.id.split(':').at(-1)}`}</td><td>{l.bookedMinutes}</td><td>{l.capacityMinutes}</td><td>{l.percent}%</td></tr>)}
        </Table></details>
        <details><summary>Customer promises and scheduled operations</summary>{plan.promises.length === 0 ? <p>No open customer promises.</p> : plan.promises.map((p: any, i: number) => <div key={i}><p><a href={`#orders/${p.orderId}`}>{p.reference}</a> · promised {p.promiseDate} · {p.quantity} base units</p><p>{p.basis}</p><ul>{p.workOrderIds.map((id: string) => <li key={id}><a href={`#make/wo/${id}`}>{plan.jobs.find((j: any) => j.workOrderId === id)?.reference}</a> · {p.operationKeys.filter((key: string) => key.startsWith(id + ':')).length} scheduled operations</li>)}</ul></div>)}</details>
        <h3>Production Gantt</h3>
        <p>Current day: <time dateTime={new Date().toISOString().slice(0, 10)}>{new Date().toISOString().slice(0, 10)}</time>. Bars show occupied intervals; gaps are breaks or unavailable capacity.</p>
        <div className="finite-chart" role="img" aria-label="Finite production timeline with current-day marker">
          <svg viewBox={`0 0 1000 ${Math.max(70, plan.operations.length * 30 + 50)}`} aria-hidden="true">
            {(() => { const today = new Date().toISOString().slice(0, 10); const x = today >= plan.startsAt.slice(0, 10) && today <= plan.endsAt.slice(0, 10) ? Math.max(230, (Date.now() - Date.parse(plan.startsAt)) / (Date.parse(plan.endsAt) - Date.parse(plan.startsAt)) * 760 + 230) : -1; return x >= 230 && x <= 990 ? <line x1={x} x2={x} y1="0" y2="100%" stroke="currentColor" strokeDasharray="3 3" data-current-day="true" /> : null })()}
            {Array.from({ length: plan.horizonDays + 1 }, (_, i) => { const x = 230 + i / plan.horizonDays * 760; const day = new Date(Date.parse(plan.startsAt) + i * 86400000).toISOString().slice(5, 10); return <g key={i}><line x1={x} x2={x} y1="22" y2="100%" stroke="#e2e5e3" /><text x={x} y="14" fontSize="10" textAnchor="middle">{day}</text></g> })}
            {plan.operations.map((o: any, i: number) => <g key={o.key}><text x="0" y={i * 30 + 47} fontSize="12">{o.reference} · {o.sequence} · {o.machineSlot}</text>{o.intervals.map((span: any, n: number) => <rect key={n} x={230 + (Date.parse(span.startsAt) - Date.parse(plan.startsAt)) / (Date.parse(plan.endsAt) - Date.parse(plan.startsAt)) * 760} y={i * 30 + 33} width={Math.max(1, (Date.parse(span.endsAt) - Date.parse(span.startsAt)) / (Date.parse(plan.endsAt) - Date.parse(plan.startsAt)) * 760)} height="17" fill={o.critical ? '#365c3d' : '#88a78d'}><title>{o.reference} · {o.name} · {o.machine} slot {o.machineSlot} · {o.person} · {span.startsAt} – {span.endsAt}</title></rect>)}</g>)}
          </svg>
        </div>
        <h3>{filter === 'all' ? 'Scheduled and unscheduled jobs' : `${filter === 'late' ? 'Late' : 'Unscheduled'} jobs`}</h3>
        <div aria-label="Finite plan jobs">{jobs.length === 0 ? <p>No {filter === 'all' ? 'open' : filter} jobs.</p> : jobs.map((j: any) => <details key={j.workOrderId}>
          <summary>{j.reference} · {j.unscheduled ? 'Unscheduled' : j.late ? 'Late' : 'On time'} · due {j.dueAt.slice(0, 10)}</summary>
          <p>{j.completionKind === 'recorded' ? 'Recorded operation finish' : 'Finish'}: {j.endsAt ?? 'unproven'} · Due slack: {j.dueSlackMinutes ?? 'unknown'} minutes · Critical path effort: {j.pathMinutes} minutes{j.provisional && ' · maintenance release required'}</p>
          <a href={`#make/wo/${j.workOrderId}`}>Open {j.reference}</a>
          {(plan.unscheduled ?? []).filter((u: any) => u.workOrderId === j.workOrderId).map((u: any, i: number) => <p key={i}>Operation {u.sequence ?? '—'}: {u.reason}</p>)}
          <Table head={['Operation', 'Machine and person', 'Occupied intervals', 'Timing and path']}>
            {plan.operations.filter((o: any) => o.workOrderId === j.workOrderId).map((o: any) => <tr key={o.key}><td>{o.sequence}. {o.name}</td><td>{o.machine} · slot {o.machineSlot}<br />{o.person}</td><td>{o.intervals.map((p: any, i: number) => <p key={i}><time dateTime={p.startsAt}>{p.startsAt}</time> – <time dateTime={p.endsAt}>{p.endsAt}</time></p>)}</td><td>{o.occupiedMinutes} occupied minutes; setup {o.setupMinutes}; run {o.runMinutes}/unit; queue {o.queueMinutes}<br />{o.critical ? 'Critical path' : `${o.slackMinutes} minutes dependency slack`}</td></tr>)}
          </Table>
        </details>)}</div>
        <p className="muted">Dependency slack uses occupied effort and queue time; due slack compares the projected finish with the UTC end of the due date. Resource load uses this complete planning window.</p>
      </>}
    </Card>
    {plan && <FiniteReschedule larder={larder} plan={plan} />}
    <CalendarEditor larder={larder} kind="machine" />
    <CalendarEditor larder={larder} kind="labor" />
    {can(s, ['manager', 'planner']) && <Card title="Qualified tools and setup families"><Form submit="Save sequence constraints" busy={larder.busy} onSubmit={d => { const m = rows(s, 'machineCalendars').find(m => m.id === text(d, 'machine')); return m && larder.run('capacity.sequence', { id: m.id, version: m.version, tools: text(d, 'tools').split(';').map(t => t.trim()).filter(Boolean), initialFamily: text(d, 'family'), planningHourlyCost: text(d, 'tariff'), overtimeHourlyCost: text(d, 'overtime') || undefined, outsourceCost: text(d, 'external') || undefined, outsourceDays: Number(text(d, 'lead') || 0), changeovers: text(d, 'transitions').split('\n').filter(Boolean).map(line => { const [from,to,minutes,cleanupMinutes] = line.split(',').map(v => v.trim()); return { from,to,minutes:Number(minutes),cleanupMinutes:Number(cleanupMinutes) } }), reason: text(d, 'reason') }) }}>
      <Choose label="Sequence machine" name="machine" options={rows(s, 'machineCalendars').map(m => ({ value:m.id,label:m.name }))} /><Field label="Qualified machine tools" name="tools" required={false} hint="Semicolon separated" /><Field label="Initial setup family" name="family" /><Field label="Public planning tariff USD/hour" name="tariff" inputMode="decimal" hint="Combined machine/labor estimate; never a wage or financial posting." /><Field label="Overtime estimate USD/hour" name="overtime" required={false} /><Field label="External service quote USD" name="external" required={false} /><Field label="External service lead days" name="lead" type="number" min="0" max="365" required={false} /><Area label="Family transitions" name="transitions" placeholder="old family,new family,changeover minutes,cleanup minutes" /><Area label="Sequence constraint reason" name="reason" />
    </Form></Card>}
    {can(s, ['manager', 'accounts']) && <Card title="Restricted wage and burden rates"><Form submit="Save labor rates" busy={larder.busy} onSubmit={d => {
      const laborId = text(d, 'labor'), old = rows(s, 'laborRates').find(r => r.laborId === laborId)
      return larder.run('capacity.rate', { laborId, ...(old ? { version: old.version } : {}), hourlyRate: text(d, 'wage'), burdenRate: text(d, 'burden'), reason: text(d, 'reason') })
    }}>
      <Choose label="Rate labor calendar" name="labor" options={rows(s, 'laborCalendars').map(r => ({ value: r.id, label: r.name }))} />
      <Field label="Hourly wage USD" name="wage" inputMode="decimal" /><Field label="Hourly burden USD" name="burden" inputMode="decimal" /><Area label="Labor rate reason" name="reason" />
    </Form>{rows(s, 'laborRates').map(r => <p key={r.id}>{rows(s, 'laborCalendars').find(l => l.id === r.laborId)?.name}: wage {r.hourlyRate} USD/hour; burden {r.burdenRate} USD/hour.</p>)}<a href="/api/larder/scheduling/labor-costs">Recorded operation labor costing evidence (JSON)</a><p>No payroll or automatic cost posting. Captured operation time remains costing evidence.</p></Card>}
  </section>
}
