// Owned human follow-up changes responsibility/history, never operational facts.
import { attach } from './attachments'
import { caseSources } from './follow-up-criteria'
import { caseStatus } from './follow-up-state'
import { allow } from './roles'
import { fail, forbidden } from './problem'
import { bump, date, fresh, list, row, text, type Context, type Row } from './model'

export const caseHumanRoles = ['owner', 'manager', 'sales', 'buyer', 'production', 'warehouse', 'accounts'] as const
export const caseHumanRoleSql = caseHumanRoles.map(role => `'${role}'`).join(',')
const dueDate = (value: unknown) => {
  const on = date(value, 'due date')
  if (new Date(`${on}T00:00:00Z`).toISOString().slice(0, 10) !== on) fail('INPUT', 'Use a real UTC calendar date.', { field: 'dueOn' })
  return on
}

export function followUps(c: Context, type: string, p: any): Row | undefined {
  if (!['exception.assign', 'exception.followUp', 'exception.escalate'].includes(type)) return
  const key = text(p.key, 'case', 500), today = c.now.slice(0, 10)
  const existing = c.s.followUps.find(f => f.key === key)
  const source = existing?.source ?? caseSources(c.s, today).find(x => x.key === key) ?? fail('NOT_FOUND', 'That case is no longer open.')
  if (caseStatus(c.s, source, today) === 'closed') fail('CASE_CLOSED', 'This case is satisfied. Its history remains available.')
  if (existing) fresh(existing, p.version)
  else if (p.version !== 0) fail('STALE', 'Reload this case before assigning it.')
  const note = text(p.note, 'follow-up note', 1000)
  const event = { at: c.now, by: c.actor.id, commandId: c.commandId, note }
  if (type === 'exception.assign') {
    allow(c, ['manager'])
    const data = { key, source, ownerId: text(p.ownerId, 'follow-up owner', 100), escalationOwnerId: text(p.escalationOwnerId, 'escalation owner', 100),
      dueOn: dueDate(p.dueOn), nextAction: text(p.nextAction, 'next action', 1000), observedStatus: 'following up' }
    const history = [...(existing?.history ?? []), { ...event, type: 'assigned', ownerId: data.ownerId, escalationOwnerId: data.escalationOwnerId, dueOn: data.dueOn, nextAction: data.nextAction, evidence: [] }]
    return existing ? bump(existing, { ...data, history }) : row(c, 'followUps', { ...data, history })
  }
  if (!existing) fail('NOT_ASSIGNED', 'An owner or manager must assign this case first.')
  if (type === 'exception.escalate') allow(c, ['manager'])
  else if (!['owner', 'manager'].includes(c.actor.role) && (existing!.ownerId !== c.actor.id || !caseHumanRoles.includes(c.actor.role as typeof caseHumanRoles[number]))) forbidden('Only the current assignee or an owner/manager records follow-up.')
  if (p.evidence !== undefined && !Array.isArray(p.evidence)) fail('INPUT', 'Evidence must be a list of files.')
  const evidence = p.evidence?.length ? list(p.evidence, 'evidence', 5).map(file => attach(c, file)) : []
  if (type === 'exception.escalate') return bump(existing!, { history: [...existing!.history, { ...event, type: 'escalated', ownerId: existing!.escalationOwnerId, evidence }] })
  const dueOn = dueDate(p.dueOn), nextAction = text(p.nextAction, 'next action', 1000)
  return bump(existing!, { dueOn, nextAction, history: [...existing!.history, { ...event, type: 'follow-up', dueOn, nextAction, evidence }] })
}
