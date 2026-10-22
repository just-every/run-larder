import { can, personName, rows, type Rec } from '../api'
import type { Larder } from '../app'
import { Area, Card, Chip, Empty, Field, Form, text } from '../controls'

const eventTypes = [
  { value: 'progress', label: 'Production progress' },
  { value: 'ETA', label: 'Material ETA' },
  { value: 'breakdown', label: 'Machine breakdown' },
  { value: 'priority', label: 'Priority change' },
]
const selected = (data: FormData, name: string) => data.getAll(name).map(String).filter(Boolean)
const localTime = (value: string) => {
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, -1)
}

function GrantPreparation({ larder, grant }: { larder: Larder; grant?: Rec }) {
  const s = larder.state!, machines = rows(s, 'machineCalendars'), jobs = rows(s, 'workOrders')
  const machineOptions = machines.map(m => ({ id: m.id, label: m.name }))
  const jobOptions = jobs.map(w => ({ id: w.id, label: w.reference }))
  // Retain the exact recorded scope when a referenced resource is no longer available.
  for (const id of grant?.machineIds ?? []) if (!machineOptions.some(m => m.id === id)) machineOptions.push({ id, label: `Unavailable machine (${id})` })
  for (const id of grant?.workOrderIds ?? []) if (!jobOptions.some(w => w.id === id)) jobOptions.push({ id, label: `Unavailable work order (${id})` })
  const clearValidity = (form: HTMLFormElement | null) => {
    form?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(input => input.setCustomValidity(''))
  }
  return <Form submit={grant ? 'Prepare replacement grant' : 'Prepare automation grant'} busy={larder.busy || (!machineOptions.length && !jobOptions.length)} onSubmit={(data, form) => {
    clearValidity(form)
    const events = selected(data, 'eventTypes'), machineIds = selected(data, 'machineIds'), workOrderIds = selected(data, 'workOrderIds')
    if (!events.length) {
      form.querySelector<HTMLInputElement>('input[name="eventTypes"]')!.setCustomValidity('Choose at least one event type.')
      form.reportValidity()
      return false
    }
    if (!machineIds.length && !workOrderIds.length) {
      const scope = form.querySelector<HTMLInputElement>('input[name="machineIds"], input[name="workOrderIds"]')
      scope?.setCustomValidity('Choose at least one machine or work order. An empty scope never means all work.')
      form.reportValidity()
      return false
    }
    return larder.run('schedule.grant.prepare', {
      ...(grant ? { id: grant.id, version: grant.version } : {}),
      eventTypes: events, machineIds, workOrderIds,
      maxDelayMinutes: Number(text(data, 'maxDelayMinutes')),
      maxDisplacementMinutes: Number(text(data, 'maxDisplacementMinutes')),
      expiresAt: new Date(text(data, 'expiresAt')).toISOString(), reason: text(data, 'reason'),
    })
  }}>
    <fieldset className="lines wide" onChange={event => clearValidity(event.currentTarget.form)}><legend>Permitted events</legend>
      {eventTypes.map(event => <label className="check" key={event.value}><input type="checkbox" name="eventTypes" value={event.value} defaultChecked={grant?.eventTypes.includes(event.value) ?? false} /> {event.label}</label>)}
    </fieldset>
    <fieldset className="lines wide" onChange={event => clearValidity(event.currentTarget.form)}><legend>Explicit machine and work order scope</legend>
      <p>Choose at least one machine or work order. No selection grants no authority.</p>
      {machineOptions.map(machine => <label className="check" key={`machine-${machine.id}`}><input type="checkbox" name="machineIds" value={machine.id} defaultChecked={grant?.machineIds.includes(machine.id) ?? false} /> Machine · {machine.label}</label>)}
      {jobOptions.map(job => <label className="check" key={`job-${job.id}`}><input type="checkbox" name="workOrderIds" value={job.id} defaultChecked={grant?.workOrderIds.includes(job.id) ?? false} /> Work order · {job.label}</label>)}
      {!machineOptions.length && !jobOptions.length && <p>No machines or work orders are available to scope a grant.</p>}
    </fieldset>
    <Field label="Maximum per-job delay (minutes)" name="maxDelayMinutes" type="number" min="0" max="86400" step="1" defaultValue={grant?.maxDelayMinutes} hint="Enter a whole-minute limit, including zero if no delay is allowed." />
    <Field label="Maximum per-job displacement (minutes)" name="maxDisplacementMinutes" type="number" min="0" max="86400" step="1" defaultValue={grant?.maxDisplacementMinutes} />
    <Field label="Grant expires (local time)" name="expiresAt" type="datetime-local" step="any" defaultValue={grant ? localTime(grant.expiresAt) : undefined} />
    <Area label={grant ? 'Replacement grant reason' : 'Grant preparation reason'} name="reason" />
    {grant && <p className="wide">Preparing this replacement stops the current version immediately. The replacement needs a fresh independent approval.</p>}
  </Form>
}

export function ScheduleGrants({ larder, plan }: { larder: Larder; plan: any }) {
  const s = larder.state!, grants = [...rows(s, 'scheduleGrants')].reverse(), protection = rows(s, 'schedulePolicies')[0]
  const preparer = can(s, ['manager', 'planner', 'agent']), reviewer = can(s, ['manager', 'planner'])
  const machineName = (id: string) => rows(s, 'machineCalendars').find(m => m.id === id)?.name ?? `Unavailable machine (${id})`
  const jobName = (id: string) => rows(s, 'workOrders').find(w => w.id === id)?.reference ?? `Unavailable work order (${id})`
  return <Card title="Bounded automatic internal bookings">
    <p>A grant permits only internal machine and person time bookings after the selected events from people's commands. Scenarios and agent proposals never run automatically. Frozen and locked work stays protected; started operations keep their machine and person. Customer dates, spending, stock, calendars, assignments, priorities and messages keep their separate approvals.</p>
    <p>Enter every event, scope, limit and expiry explicitly. Delay limits a job’s later finish; displacement limits the largest start or finish shift of any operation in that job. A different owner, manager or planner approves the exact version; the owner may approve their own. Agents prepare only. Every edit needs fresh approval.</p>
    <p>Current planning window: {plan.asOf} · {plan.horizonDays} days. Protection version: {protection?.version ?? 'not saved'}. An expired or revoked grant, changed protection or an approver who loses authority leaves the next event for review. Every automatic application is all or nothing.</p>
    {grants.length === 0 && <Empty>No automation grants. Event reflows stay proposals for human review.</Empty>}
    {grants.map(grant => {
      const expired = new Date(grant.expiresAt).getTime() <= Date.now()
      const authorityLost = grant.status === 'active' && !rows(s, 'people').some(p => p.id === grant.approvedBy && ['owner','manager','planner'].includes(p.role))
      const protectionChanged = grant.protectionVersion !== protection?.version
      const independentReviewer = reviewer && (grant.preparedBy !== s.actor.id || s.actor.role === 'owner')
      const approve = grant.status === 'draft' && !expired && !protectionChanged && independentReviewer
      const revoke = grant.status !== 'revoked' && (can(s, ['manager']) || grant.preparedBy === s.actor.id || grant.approvedBy === s.actor.id)
      return <details key={`${grant.id}:${grant.version}`} open={grant.status !== 'revoked'} aria-label={`Automation grant: ${grant.reason}, version ${grant.version}`}>
        <summary>Automation grant · version {grant.version} · <Chip tone={grant.status === 'active' && !expired && !protectionChanged && !authorityLost ? 'good' : grant.status === 'draft' ? 'warn' : 'neutral'}>{grant.status}</Chip>{expired ? ' · expired' : protectionChanged ? ' · protection changed' : authorityLost ? ' · approver inactive or unauthorized' : ''}</summary>
        <p>{grant.reason}</p>
        <p>Prepared by {personName(s, grant.preparedBy)}. {grant.approvedBy ? <>Approved by {personName(s, grant.approvedBy)} at <time dateTime={grant.approvedAt}>{grant.approvedAt}</time>.</> : 'Awaiting human approval.'}</p>
        <p>Events: {grant.eventTypes.map((type: string) => eventTypes.find(event => event.value === type)?.label ?? type).join(', ')}.</p>
        <p>Machines: {grant.machineIds.length ? grant.machineIds.map(machineName).join(', ') : 'none selected'}. Work orders: {grant.workOrderIds.length ? grant.workOrderIds.map(jobName).join(', ') : 'none selected'}.</p>
        <p>Maximum delay: {grant.maxDelayMinutes} minutes per job. Maximum displacement: {grant.maxDisplacementMinutes} minutes per job.</p>
        <p>Expires: <time dateTime={grant.expiresAt}>{grant.expiresAt}</time> (UTC). Bound to protection version {grant.protectionVersion}.</p>
        {grant.status !== 'revoked' && (expired || protectionChanged) && <p>This version cannot be approved or authorize the next event. Prepare and approve a new version to enable automatic bookings.</p>}
        {grant.suspensionReason && <p>Suspended: {grant.suspensionReason} Prepare a new version for fresh approval.</p>}
        {grant.revokeReason && <p>Revocation reason: {grant.revokeReason}</p>}
        {grant.status === 'draft' && !independentReviewer && <p>A different authorized person must approve this version. Agents cannot approve.</p>}
        {approve && <Form submit="Approve automation grant" busy={larder.busy} onSubmit={data => larder.run('schedule.grant.approve', { grantId: grant.id, version: grant.version, reason: text(data, 'reason') })}>
          <Area label="Automation grant approval reason" name="reason" />
        </Form>}
        {revoke && <Form submit="Revoke automation grant" busy={larder.busy} quiet onSubmit={data => larder.run('schedule.grant.revoke', { grantId: grant.id, version: grant.version, reason: text(data, 'reason') })}>
          <Area label="Automation grant revocation reason" name="reason" />
        </Form>}
        {preparer && <details><summary>Replace with a newly reviewed version</summary><GrantPreparation larder={larder} grant={grant} /></details>}
      </details>
    })}
    {preparer && <details><summary>Prepare an automation grant</summary><GrantPreparation larder={larder} /></details>}
  </Card>
}
