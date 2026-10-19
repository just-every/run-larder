import { WorkDowntime } from './work-downtime'
import { can, personName, rows, type Rec } from './api'
import type { Larder } from './app'
import { Choose, Chip, Field, Form, text } from './controls'
import { when, words } from './format'

export function WorkOperations({ larder, w }: { larder: Larder; w: Rec }) {
  const s = larder.state!, actor = s.actor, operate = can(s, ['manager', 'production']), released = w.status === 'released'
  const states: any[] = w.operationStates ?? []
  if (!w.routing?.length) return null
  return <section aria-label="Pinned operation tasks">
    <h3>Operation tasks · BOM revision {w.bomRevision}</h3>
    <p className="muted">Instructions and drawings are pinned to this released job.</p>
    {w.routing.map((step: any, index: number) => {
      const sequence = step.sequence ?? index + 1, task = states.find(task => task.sequence === sequence) ?? { sequence, status: 'pending', acknowledgments: [] }
      const status = task?.status ?? 'pending', skills: string[] = step.requiredSkills ?? []
      const centres: string[] = step.eligibleCentres?.length ? step.eligibleCentres : step.workCentre ? [step.workCentre] : []
      const predecessors: number[] = step.dependsOn ?? (index ? [index] : [])
      const uncompleted = predecessors.filter(number => states.find(task => task.sequence === number)?.status !== 'done')
      const needsAck = Boolean(step.instructions || step.drawings?.length)
      const acknowledged = task?.acknowledgments?.some((ack: any) => ack.by === actor.id && ack.bomId === w.bomId)
      const assignment = task?.assignment, wrongOperator = assignment && assignment.operatorId !== actor.id
      const reasons = [
        ...(!released ? ['This job is not released.'] : []),
        ...(uncompleted.length ? [`Waiting for step ${uncompleted.join(', ')} to complete.`] : []),
        ...(needsAck && !acknowledged ? ['Acknowledge the pinned instructions and drawings before starting.'] : []),
        ...(skills.length && !assignment ? ['A manager must authorize an operator for the required skills.'] : []),
        ...(wrongOperator ? [`Assigned to ${personName(s, assignment.operatorId)}.`] : []),
      ]
      const payload = { workOrderId: w.id, version: w.version, sequence }
      return <fieldset className="lines wide" key={sequence}>
        <legend>Step {sequence}: {step.name}</legend>
        <p><Chip tone={status === 'done' ? 'good' : status === 'running' ? 'info' : 'neutral'}>{words(status)}</Chip> · BOM revision {w.bomRevision}</p>
        <p>Setup {step.setupMinutes ?? 0} min per job · run {step.runMinutes ?? step.minutes} min per unit · queue {step.queueMinutes ?? 0} min per job</p>
        <p>Eligible centers: {centres.join('; ') || 'No center specified'}<br />Required skills: {skills.join('; ') || 'None specified'}<br />Predecessors: {predecessors.length ? predecessors.join(', ') : 'None'}</p>
        {step.instructions && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{step.instructions}</p>}
        {step.drawings?.length > 0 && <ul>{step.drawings.map((drawing: any) => <li key={drawing.id}><a href={`/api/larder/attachments/${drawing.id}`} target="_blank" rel="noreferrer">Open drawing: {drawing.name}</a></li>)}</ul>}
        {task?.acknowledgments?.length > 0 && <ul>{task.acknowledgments.map((ack: any, i: number) => <li key={i}>{personName(s, ack.by)} acknowledged revision {w.bomRevision} · {when(ack.at)}</li>)}</ul>}
        {assignment && <p>Skill authorization: {personName(s, assignment.operatorId)} · authorized by {personName(s, assignment.by)} {when(assignment.at)}{assignment.skills?.length ? ` · ${assignment.skills.join('; ')}` : ''}</p>}
        {task?.startedBy && <p>Started by {personName(s, task.startedBy)} {when(task.startedAt)} · {task.workCentre}</p>}
        {task?.completedBy && <p>Completed by {personName(s, task.completedBy)} {when(task.completedAt)}</p>}
        {status === 'pending' && reasons.length > 0 && <ul className="warn-text">{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
        {released && task && operate && needsAck && !acknowledged && status !== 'done' && <div className="actions"><button type="button" className="button" disabled={larder.busy || Boolean(wrongOperator)} onClick={() => larder.run('wo.operation.acknowledge', { ...payload, bomId: w.bomId })}>Acknowledge step {sequence} instructions and drawings</button></div>}
        {released && task && status === 'pending' && skills.length > 0 && can(s, ['manager']) && <Form title={`Step ${sequence} skill authorization`} submit={`Authorize step ${sequence} operator`} busy={larder.busy} note="Authorize this named operator to perform the pinned required skills. This records a manager's authorization." onSubmit={data => larder.run('wo.operation.assign', { ...payload, operatorId: text(data, 'operatorId') })}>
          <Choose label={`Step ${sequence} authorized operator`} name="operatorId" options={rows(s, 'people').filter(person => ['owner', 'manager', 'production'].includes(person.role)).map(person => ({ value: person.id, label: person.name }))} />
        </Form>}
        {released && task && operate && status === 'pending' && <Form submit={`Start step ${sequence}`} busy={larder.busy || reasons.length > 0} onSubmit={data => larder.run('wo.operation.start', { ...payload, workCentre: text(data, 'workCentre') })}>
          <>{centres.length ? <Choose label={`Step ${sequence} work center`} name="workCentre" options={centres.map(centre => ({ value: centre, label: centre }))} required={centres.length > 0} defaultValue={centres.length === 1 ? centres[0] : ''} /> : <Field label={`Step ${sequence} work center`} name="workCentre" />}</>
        </Form>}
        {released && task && operate && status === 'running' && <div className="actions"><button type="button" className="button primary" disabled={larder.busy || task.startedBy !== actor.id} onClick={() => larder.run('wo.operation.complete', payload)}>Complete step {sequence}</button></div>}
        {released && <WorkDowntime larder={larder} w={w} task={task} sequence={sequence} />}
      </fieldset>
    })}
  </section>
}
