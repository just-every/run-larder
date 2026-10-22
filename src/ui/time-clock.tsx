// FLOOR-002: clock setup, run and cleanup against an operation, pause for a reason, correct a missed stop with a
// supervisor's approval, and lock a closed period (accounts reopen it).
import { can, personName, rows, type Rec } from './api'
import type { Larder } from './app'
import { Chip, Choose, Field, Form, text } from './controls'
import { day, when, words } from './format'

const phases = ['setup', 'run', 'cleanup']
const reasons = ['breakdown', 'waiting-material', 'changeover', 'quality', 'break', 'other']
const hours = (e: Rec) => { const end = e.stoppedAt ? Date.parse(e.stoppedAt) : Date.now(), paused = (e.pauses ?? []).reduce((n: number, p: Rec) => n + Math.max(0, (p.stoppedAt ? Date.parse(p.stoppedAt) : end) - Date.parse(p.startedAt)), 0); return ((end - Date.parse(e.startedAt) - paused) / 3600000).toFixed(2) }
const iso = (local: string) => new Date(local).toISOString()

export function TimeClock({ larder, w, sequence }: { larder: Larder; w: Rec; sequence: number }) {
  const s = larder.state!, all = rows(s, 'timeEntries'), entries = all.filter(e => e.workOrderId === w.id && e.sequence === sequence), live = (e: Rec) => ['open', 'paused'].includes(e.status)
  const mine = all.find(e => e.operatorId === s.actor.id && live(e)), here = mine && mine.workOrderId === w.id && mine.sequence === sequence
  const operate = can(s, ['manager', 'production', 'operator']), supervisor = can(s, ['manager'])
  const correctable = entries.filter(e => e.operatorId === s.actor.id || supervisor)
  return <section aria-label={`Step ${sequence} time clock`}>
    <h4>Time clock</h4>
    {operate && !mine && <div className="actions">{phases.map(phase => <button key={phase} type="button" className="button" disabled={larder.busy} onClick={() => larder.run('time.start', { workOrderId: w.id, sequence, phase })}>Clock {phase} on step {sequence}</button>)}</div>}
    {operate && mine && !here && <p className="muted">You are clocked on step {mine.sequence} of another job; stop it before clocking here.</p>}
    {here && <div className="actions"><Chip tone={mine.status === 'open' ? 'info' : 'warn'}>{words(mine.phase)} {mine.status === 'open' ? 'running' : 'paused'}</Chip>
      {mine.status === 'paused' ? <button type="button" className="button" disabled={larder.busy} onClick={() => larder.run('time.resume', { entryId: mine.id })}>Resume step {sequence}</button> :
        <Form submit={`Pause step ${sequence}`} busy={larder.busy} quiet onSubmit={d => larder.run('time.pause', { entryId: mine.id, reason: text(d, 'reason') })}><Choose label={`Step ${sequence} pause reason`} name="reason" options={reasons.map(r => ({ value: r, label: words(r) }))} /></Form>}
      <button type="button" className="button primary" disabled={larder.busy} onClick={() => larder.run('time.stop', { entryId: mine.id })}>Stop step {sequence}</button></div>}
    {entries.length > 0 && <ul aria-label={`Step ${sequence} clocked time`} className="history">{entries.map(e => <li key={e.id}>{personName(s, e.operatorId)} · {words(e.phase)} · {when(e.startedAt)} to {e.stoppedAt ? when(e.stoppedAt) : 'now'} · {hours(e)} h{e.pauses?.length > 0 && ` · ${e.pauses.length} pause${e.pauses.length === 1 ? '' : 's'} (${e.pauses.map((p: Rec) => words(p.reason)).join(', ')})`}{e.corrected && ' · corrected'}
      {(e.corrections ?? []).map((c: Rec) => <small key={c.id}>Correction {words(c.status)}: {when(c.startedAt)} to {when(c.stoppedAt)} — {c.reason}{c.decisionReason && ` · ${c.decisionReason}`}
        {c.status === 'pending' && supervisor && (c.requestedBy !== s.actor.id || s.actor.role === 'owner') && <Form submit={`Decide correction ${c.id.slice(0, 4)}`} busy={larder.busy} quiet onSubmit={async d => larder.run('time.decide', { entryId: e.id, correctionId: c.id, decision: text(d, 'decision'), reason: text(d, 'reason') })}>
          <Choose label={`Decision ${c.id.slice(0, 4)}`} name="decision" options={[{ value: 'approve', label: 'Approve' }, { value: 'decline', label: 'Decline' }]} /><Field label={`Decision reason ${c.id.slice(0, 4)}`} name="reason" /></Form>}</small>)}</li>)}</ul>}
    {operate && correctable.length > 0 && <Form title={`Step ${sequence} correct clocked time`} submit={`Ask for correction on step ${sequence}`} busy={larder.busy} quiet note="A missed or wrong start or stop is corrected with a reason; a supervisor approves it. Impossible or overlapping times are refused."
      onSubmit={d => larder.run('time.correct', { entryId: text(d, 'entryId'), startedAt: iso(text(d, 'startedAt')), stoppedAt: iso(text(d, 'stoppedAt')), reason: text(d, 'reason') })}>
      <Choose label={`Step ${sequence} entry to correct`} name="entryId" options={correctable.map(e => ({ value: e.id, label: `${personName(s, e.operatorId)} · ${words(e.phase)} · ${when(e.startedAt)}` }))} />
      <Field label={`Step ${sequence} correct start`} name="startedAt" type="datetime-local" /><Field label={`Step ${sequence} correct stop`} name="stoppedAt" type="datetime-local" /><Field label={`Step ${sequence} correction reason`} name="reason" /></Form>}
  </section>
}

export function TimeLocks({ larder }: { larder: Larder }) {
  const s = larder.state!, locks = [...rows(s, 'timeLocks')].reverse()
  if (!can(s, ['accounts']) && locks.length === 0) return null
  return <section aria-label="Locked time periods"><h4>Locked time periods</h4>
    {locks.length === 0 ? <p className="muted">No period is locked. Accounts lock a finished period so clocked time in it cannot change.</p> : <ul className="history">{locks.map(l => <li key={l.id}>Through {day(l.through)} · {words(l.status)} · {l.reason}{l.status === 'locked' && can(s, ['accounts']) && <Form submit={`Reopen through ${l.through}`} busy={larder.busy} quiet onSubmit={d => larder.run('time.reopen', { lockId: l.id, version: l.version, reason: text(d, 'reason') })}><Field label={`Reopen reason ${l.through}`} name="reason" /></Form>}</li>)}</ul>}
    {can(s, ['accounts']) && <Form submit="Lock period" busy={larder.busy} quiet onSubmit={d => larder.run('time.lock', { through: text(d, 'through'), reason: text(d, 'reason') })}><Field label="Lock through" name="through" type="date" /><Field label="Lock reason" name="reason" /></Form>}</section>
}
