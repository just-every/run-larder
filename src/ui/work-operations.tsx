import { workHolds } from '../larder/quality-holds'
import { activeMaintenance } from '../larder/maintenance-availability'
import { operationStartGates } from '../larder/operations'
import { WorkDowntime } from './work-downtime'
import { can, personName, rows, type LarderState, type Rec } from './api'
import type { Larder } from './app'
import { Choose, Chip, Field, Form, text } from './controls'
import { when, words } from './format'

export function operationReadiness(s: LarderState, w: Rec, step: any) {
  const states: any[] = w.operationStates ?? []
  const task = states.find(t => t.sequence === step.sequence) ?? { status: 'pending', acknowledgments: [] }
  const centres: string[] = step.eligibleCentres?.length ? step.eligibleCentres : step.workCentre ? [step.workCentre] : []
  const predecessors: number[] = step.dependsOn ?? (step.sequence > 1 ? [step.sequence - 1] : [])
  const needsAck = Boolean(step.instructions || step.drawings?.length)
  const acknowledged = task.acknowledgments?.some((ack: any) => ack.by === s.actor.id && ack.bomId === w.bomId)
  const wrongOperator = task.assignment && task.assignment.operatorId !== s.actor.id
  const now = new Date().toISOString()
  const reasons = operationStartGates({ maintenance: rows(s, 'maintenance'), qualityHolds: rows(s, 'qualityHolds'), recalls: rows(s, 'recalls') }, s.actor, w, step, now).map(gate => gate.message)
  return { task, centres, predecessors, needsAck, acknowledged, wrongOperator, reasons }
}

export function WorkOperations({ larder, w, sequence: onlySequence }: { larder: Larder; w: Rec; sequence?: number }) {
  const s = larder.state!, actor = s.actor, operate = can(s, ['manager', 'production', 'operator']), released = w.status === 'released'
  const states: any[] = w.operationStates ?? []
  if (!w.routing?.length) return null
  return <section aria-label="Pinned operation tasks">
    <h3>Operation tasks · BOM revision {w.bomRevision}</h3>
    <p className="muted">Instructions and drawings are pinned to this released job.</p>
    {w.routing.filter((step: any) => onlySequence === undefined || step.sequence === onlySequence).map((step: any, index: number) => {
      const sequence = step.sequence ?? index + 1, task = states.find(task => task.sequence === sequence) ?? { sequence, status: 'pending', acknowledgments: [] }
      const status = task?.status ?? 'pending', skills: string[] = step.requiredSkills ?? []
      const { centres, predecessors, needsAck, acknowledged, wrongOperator, reasons } = operationReadiness(s, w, step)
      const assignment = task?.assignment
      const legacy = ['running', 'paused'].includes(status) && !assignment && Boolean(task.startedBy)
      const maintenance = activeMaintenance({ maintenance: rows(s, 'maintenance') }, task.workCentre || step.workCentre, new Date().toISOString())
      const payload = { workOrderId: w.id, version: w.version, sequence }
      return <fieldset className="lines wide" key={sequence}>
        <legend>Step {sequence}: {step.name}</legend>
        <p><Chip tone={status === 'done' ? 'good' : status === 'running' ? 'info' : 'neutral'}>{words(status)}</Chip> · BOM revision {w.bomRevision}</p>
        <p>Setup {step.setupMinutes ?? 0} min per job · run {step.runMinutes ?? step.minutes} min per unit · queue {step.queueMinutes ?? 0} min per job</p>
        <p>Eligible centers: {centres.join('; ') || 'No center specified'}<br />Required skills: {skills.join('; ') || 'None specified'}<br />Predecessors: {predecessors.length ? predecessors.join(', ') : 'None'}</p>
        <section aria-label={`Step ${sequence} safety and quality checks`}>
          <h4>Safety and quality checks</h4>
          <p>{needsAck ? acknowledged ? 'Pinned instruction and drawing acknowledgment recorded for you.' : 'Your acknowledgment of the pinned instructions and drawings is required.' : 'No instruction or drawing acknowledgment configured for this operation.'}</p>
          <p>{(task.workCentre ? [task.workCentre] : centres).map(center => `${center}: ${activeMaintenance({ maintenance: rows(s, 'maintenance') }, center, new Date().toISOString()).length ? 'maintenance release required' : 'no active maintenance hold recorded'}`).join('; ') || 'Choose a named center when starting; no eligible centers are pinned.'}</p>
          <p>{rows(s, 'inspectionPlans').filter(p => p.status === 'approved' && p.stage === 'in-process' && p.operationSequence === sequence && p.itemId === w.itemId && (p.revision === null || p.revision === w.bomRevision)).map(p => `In-process inspection after this step: ${p.name}, ${p.sampleSize} sampled`).join('; ') || 'No in-process inspection plan follows this operation.'}</p>
          {workHolds({ qualityHolds: rows(s, 'qualityHolds') }, w).map(h => <p key={h.id} className="warn-text">{`Quality hold: ${h.planName} failed; this job’s pending operations stay blocked until an owner or manager releases it.`}</p>)}
          <p className="muted">Operation safety checklists are not configured. Review the pinned instructions and actual station conditions.</p>
        </section>
        {step.instructions && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{step.instructions}</p>}
        {step.drawings?.length > 0 && <ul>{step.drawings.map((drawing: any) => <li key={drawing.id}><a href={`/api/larder/attachments/${drawing.id}`} target="_blank" rel="noreferrer">Open drawing: {drawing.name}</a></li>)}</ul>}
        {task?.acknowledgments?.length > 0 && <ul>{task.acknowledgments.map((ack: any, i: number) => <li key={i}>{personName(s, ack.by)} acknowledged revision {w.bomRevision} · {when(ack.at)}</li>)}</ul>}
        {assignment && <p>{skills.length ? 'Skill authorization' : 'Assignment'}: {personName(s, assignment.operatorId)} · authorized by {personName(s, assignment.by)} {when(assignment.at)}{assignment.skills?.length ? ` · ${assignment.skills.join('; ')}` : ''}{assignment.legacy && ` · legacy starter recorded: ${assignment.reason}`}</p>}
        {maintenance.length > 0 && <p className="warn-text">Equipment unavailable: {maintenance.map(m => m.reference).join(', ')}. <a href="#schedule">Maintenance release required</a>.</p>}
        {task.inheritedFrom?.length > 0 && <p>Completed-step evidence stays on {task.inheritedFrom.map((x: Rec) => <a key={x.workOrderId} href={`#make/wo/${x.workOrderId}`}>{rows(s, 'workOrders').find(w => w.id === x.workOrderId)?.reference} step {x.sequence} </a>)}. No execution time is copied.</p>}
        {task?.startedBy && <p>Started by {personName(s, task.startedBy)} {when(task.startedAt)} · {task.workCentre} · station {task.station || 'not recorded'}{task.startReason && ` · ${task.startReason}`}</p>}
        {task?.completedBy && <p>Completed by {personName(s, task.completedBy)} {when(task.completedAt)} · station {task.station || 'not recorded'}{task.completionReason && ` · ${task.completionReason}`}</p>}
        {legacy && <p className="warn-text">Legacy active task: a manager must record the existing starter’s assignment before completion. The original station remains not recorded.</p>}
        {status === 'pending' && reasons.length > 0 && <ul className="warn-text">{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
        {released && task && operate && needsAck && !acknowledged && status !== 'done' && <div className="actions"><button type="button" className="button" disabled={larder.busy || Boolean(wrongOperator)} onClick={() => larder.run('wo.operation.acknowledge', { ...payload, bomId: w.bomId })}>Acknowledge step {sequence} instructions and drawings</button></div>}
        {released && task && (status === 'pending' || legacy) && can(s, ['manager']) && <Form title={`Step ${sequence} ${skills.length ? 'skill authorization' : 'assignment'}`} submit={`Authorize step ${sequence} operator`} busy={larder.busy} note={legacy ? 'Record the existing starter without changing the recorded start or inventing a station.' : skills.length ? "Authorize this named operator to perform the pinned required skills. This records a manager's authorization." : 'Assign this operation to a named active operator before they start.'} onSubmit={data => larder.run('wo.operation.assign', { ...payload, operatorId: text(data, 'operatorId'), ...(legacy ? { reason: text(data, 'reason') } : {}) })}>
          <Choose label={`Step ${sequence} authorized operator`} name="operatorId" defaultValue={assignment?.operatorId ?? (legacy ? task.startedBy : '')} options={rows(s, 'people').filter(person => ['owner', 'manager', 'production', 'operator'].includes(person.role) && (!legacy || person.id === task.startedBy)).map(person => ({ value: person.id, label: person.name }))} />
          {legacy && <Field label={`Step ${sequence} legacy assignment reason`} name="reason" />}
        </Form>}
        {released && task && operate && status === 'pending' && <Form submit={`Start step ${sequence}`} busy={larder.busy || reasons.length > 0} onSubmit={data => larder.run('wo.operation.start', { ...payload, workCentre: text(data, 'workCentre'), station: text(data, 'station'), reason: text(data, 'reason') })}>
          <>{centres.length ? <Choose label={`Step ${sequence} work center`} name="workCentre" options={centres.map(centre => ({ value: centre, label: centre }))} required={centres.length > 0} defaultValue={centres.length === 1 ? centres[0] : ''} /> : <Field label={`Step ${sequence} work center`} name="workCentre" />}</>
          <Field label={`Step ${sequence} station`} name="station" maxLength={120} />
          <Field label={`Step ${sequence} start reason`} name="reason" />
        </Form>}
        {released && task && operate && status === 'running' && <Form submit={`Complete step ${sequence}`} busy={larder.busy || maintenance.length > 0 || task.startedBy !== actor.id || assignment?.operatorId !== actor.id} onSubmit={data => larder.run('wo.operation.complete', { ...payload, reason: text(data, 'reason') })}>
          <Field label={`Step ${sequence} completion reason`} name="reason" />
        </Form>}
        {task.events?.length > 0 && <details><summary>Step {sequence} execution history</summary><ul className="history">{task.events.map((event: any, i: number) => <li key={i}>{words(event.type)} · {personName(s, event.by)} · {when(event.at)} · station {event.station || 'not recorded'} · {event.reason}</li>)}</ul></details>}
        {released && <WorkDowntime larder={larder} w={w} task={task} sequence={sequence} />}
      </fieldset>
    })}
  </section>
}
