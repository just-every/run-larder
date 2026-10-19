// AUTO-001: reads project the current condition, including after a restart or
// a UTC day boundary. Business writes retain observed closure/reopening history.
import { caseSources, caseStillOpen, type CaseSource } from './follow-up-criteria'
import { bump, type Context, type State } from './model'

export const caseStatus = (s: State, source: CaseSource, today: string) => caseStillOpen(s, source, today) ? 'following up' : 'closed'

function legacyKey(key: string) {
  const [kind, ...parts] = key.split(':')
  if (kind === 'wo-short') return `wo-blocked:${parts[0]}`
  if (['shortage', 'po-late', 'po-approval', 'count', 'proposal', 'import'].includes(kind)) return `${kind}:${parts[0]}`
  if (kind === 'quarantine') return `${kind}:${parts.slice(0, 3).join(':')}`
  if (kind === 'expiring' || kind === 'blocked-lot') return `${kind}:${parts[0]}`
  return key
}

export function legacyNotes(s: State, key: string) {
  return s.resolutions.filter(r => legacyKey(r.key) === key || (r.kind === 'mismatch' && key.startsWith(`handoff:${r.key.split(':')[1]}:`)))
    .map(r => ({ type: 'note', at: r.createdAt, by: r.createdBy, note: r.note, evidence: [], commandId: '' }))
}

export function followUpView(s: State, today: string) {
  const current = new Map(caseSources(s, today).map(source => [source.key, source]))
  for (const saved of s.followUps) if (!current.has(saved.key)) current.set(saved.key, saved.source)
  return [...current.values()].map(source => {
    const saved = s.followUps.find(f => f.key === source.key), status = caseStatus(s, source, today)
    const history = [...legacyNotes(s, source.key), ...(saved?.history ?? [])]
    return { ...source, caseId: saved?.id ?? null, version: saved?.version ?? 0,
      status, ownerId: saved?.ownerId ?? null, dueOn: saved?.dueOn ?? '', nextAction: saved?.nextAction ?? '',
      escalationOwnerId: saved?.escalationOwnerId ?? null,
      escalationDue: !!saved && status !== 'closed' && saved.dueOn < today,
      history,
    }
  }).filter(x => x.status !== 'closed' || x.caseId)
}

export function observeFollowUps(c: Context) {
  const today = c.now.slice(0, 10)
  for (const saved of c.s.followUps) {
    const status = caseStatus(c.s, saved.source, today), history = [...(saved.history ?? [])]
    const updates: Record<string, unknown> = {}
    if (status !== saved.observedStatus) {
      history.push({ type: status === 'closed' ? 'closed' : 'reopened', at: c.now, by: c.actor.id, commandId: c.commandId, note: saved.source.criteria, evidence: [] })
      updates.observedStatus = status
    }
    // A due notice is in the app, never a claim that email/chat was sent. Reads
    // also derive this condition when the clock moves without a business write.
    if (status !== 'closed' && saved.dueOn < today && saved.escalatedDueOn !== saved.dueOn) {
      history.push({ type: 'escalated', at: c.now, by: c.actor.id, commandId: c.commandId, note: 'Due follow-up recorded in app', ownerId: saved.escalationOwnerId, evidence: [] })
      updates.escalatedDueOn = saved.dueOn
    }
    if (Object.keys(updates).length) bump(saved, { ...updates, history })
  }
}
