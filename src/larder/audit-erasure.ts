// GOV-013: the erasure door. The audit is kept for the life of the installation and nobody
// purges it; an erasure request is the one exception. The owner names a data subject (a person
// or a party) and the door replaces that subject's personal values inside audit entries with a
// tombstone. The entry, its actor id, time, command, record link and the fact of replacement
// stay, and the request is itself retained as an `auditErasures` record (id, date, subject id,
// scope, the owner who ran it) that holds no personal value, and audited under the door's name. Live records are not touched here: GOV-005 inherits that scope and reuses this door.
import { forbidden, fail } from './problem'
import { get, optionalText, row, text, type Context, type Row, type State } from './model'

export const tombstone = '[erased]'
export const erasureScope = 'audit'
export type ErasurePlan = { kind: 'operator' | 'party'; id: string; values: string[]; entries: number; operatorVersion?: number; operatorStatus?: string; outcomes?: { id: string; result: string }[] }

const unique = (values: unknown[]) => [...new Set(values.filter((v): v is string => typeof v === 'string').map(v => v.trim()).filter(v => v.length >= 3))].sort((a, b) => b.length - a.length)
const encoded = (v: string) => JSON.stringify(v).slice(1, -1)
// The request record is retained without the erased values: the owner's free text is scrubbed of them.
export const scrubPersonalValues = (value: string, values: string[]) => values.reduce((t, v) => t.replace(new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), tombstone), value)

// Resolved before the command runs: the personal values live in the identity tables and the
// party record, never in the command's result or its audit entry.
export async function erasurePlan(db: D1Database, s: State, actor: { role: string }, p: any): Promise<ErasurePlan> {
  if (actor.role !== 'owner') forbidden('Only the owner passes an erasure request.')
  const subject = async (): Promise<{ kind: ErasurePlan['kind']; id: string; values: unknown[]; version?: number; status?: string }> => {
    if (typeof p.operatorId === 'string' && p.partyId === undefined) {
      const person = await db.prepare('SELECT o.id,o.email,o.display_name AS name,o.version,o.status FROM oa_operators o WHERE o.id=?').bind(p.operatorId).first<{ id: string; email: string; name: string; version: number; status: string }>()
      if (!person) return fail('NOT_FOUND', 'Choose a person invited to this installation.', { field: 'operatorId' })
      const used = (await db.prepare('SELECT DISTINCT actor_name AS name FROM larder_audit WHERE actor_id=?').bind(person.id).all<{ name: string }>()).results
      return { kind: 'operator', id: person.id, version: person.version, status: person.status, values: [person.email, person.name, ...used.map(r => r.name)] }
    }
    if (typeof p.partyId === 'string' && p.operatorId === undefined) {
      const party = get(s, 'parties', p.partyId, 'party')
      return { kind: 'party', id: party.id, values: [party.email, party.name] }
    }
    return fail('INPUT', 'Name one data subject: an operatorId or a partyId.')
  }
  const { kind, id, values, version, status } = await subject()
  const list = unique(values.flatMap(v => typeof v === 'string' ? [v, v.toLowerCase()] : []))
  if (!list.length) fail('INPUT', 'This data subject has no personal value to replace.')
  const clauses = list.flatMap(v => [`instr(before,?)>0`, `instr(after,?)>0`, `instr(reason,?)>0`, `instr(evidence,?)>0`, `instr(actor_name,?)>0`])
  const binds = list.flatMap(v => [encoded(v), encoded(v), v, encoded(v), v])
  const n = await db.prepare(`SELECT COUNT(*) AS n FROM larder_audit WHERE ${kind === 'operator' ? 'actor_id=? OR ' : ''}${clauses.join(' OR ')}`).bind(...(kind === 'operator' ? [id] : []), ...binds).first<{ n: number }>()
  return { kind, id, values: list, entries: n!.n, operatorVersion: version, operatorStatus: status }
}

export function erasureCommand(c: Context, type: string, p: any): Row | undefined {
  if (type !== 'erasure.audit') return
  if (c.actor.role !== 'owner') forbidden('Only the owner passes an erasure request.')
  const plan = c.erasure ?? fail('INPUT', 'Name one data subject: an operatorId or a partyId.')
  return row(c, 'auditErasures', { id: c.commandId, subjectKind: plan.kind, subjectId: plan.id, scope: erasureScope, entries: plan.entries, tombstone, request: scrubPersonalValues(optionalText(p.request, 'request reference', 200), plan.values), reason: scrubPersonalValues(text(p.reason, 'reason', 400), plan.values), requestedBy: c.actor.id })
}

// The statements that record the request and then replace the values, in the command's own batch.
export function erasureStatements(db: D1Database, c: Context, plan: ErasurePlan): D1PreparedStatement[] {
  const id = c.commandId
  const nest = (column: string, kind: 'text' | 'json') => ({ sql: plan.values.reduce((sql) => `replace(${sql},?,'${tombstone}')`, column), binds: plan.values.map(v => kind === 'json' ? encoded(v) : v) })
  const before = nest('before', 'json'), after = nest('after', 'json'), reason = nest('reason', 'text'), evidence = nest('evidence', 'json'), name = nest('actor_name', 'text')
  const where = plan.values.flatMap(() => ['instr(before,?)>0', 'instr(after,?)>0', 'instr(reason,?)>0', 'instr(evidence,?)>0', 'instr(actor_name,?)>0'])
  const whereBinds = plan.values.flatMap(v => [encoded(v), encoded(v), v, encoded(v), v])
  return [
    db.prepare('INSERT INTO larder_audit_erasures(id,at,actor_id,subject_kind,subject_id,entries,scope) VALUES(?,?,?,?,?,?,?)').bind(id, c.now, c.actor.id, plan.kind, plan.id, plan.entries, erasureScope),
    ...(c.type === 'erasure.operator' ? [
      db.prepare("INSERT INTO larder_guard(id,ok) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='inactive' AND version=?) THEN 1 ELSE 0 END)").bind(crypto.randomUUID(), plan.id, plan.operatorVersion),
      db.prepare("UPDATE oa_operators SET display_name=?,email=?,version=version+1 WHERE id=? AND status='inactive' AND version=?").bind(tombstone, 'erased-' + plan.id + '@invalid', plan.id, plan.operatorVersion),
    ] : []),
    ...(['erasure.contact', 'erasure.operator'].includes(c.type ?? '') ? (plan.outcomes ?? []).map(outcome => db.prepare('UPDATE larder_commands SET result=? WHERE id=?').bind(outcome.result, outcome.id)) : []),
    db.prepare(`UPDATE larder_audit SET actor_name=CASE WHEN ${plan.kind === 'operator' ? 'actor_id=?' : '0'} THEN '${tombstone}' ELSE ${name.sql} END, before=${before.sql}, after=${after.sql}, reason=${reason.sql}, evidence=${evidence.sql}, erasure_id=? WHERE ${plan.kind === 'operator' ? 'actor_id=? OR ' : ''}${where.join(' OR ')}`)
      .bind(...(plan.kind === 'operator' ? [plan.id] : []), ...name.binds, ...before.binds, ...after.binds, ...reason.binds, ...evidence.binds, id, ...(plan.kind === 'operator' ? [plan.id] : []), ...whereBinds),
  ]
}

// Replace human contact labels in cached outcomes without touching IDs, decimal
// fields, digests or original financial and evidence records.
export async function contactOutcomes(db: D1Database, plan: ErasurePlan) {
  const fields = new Set(['name', 'email', 'party', 'customerName', 'supplierName', 'displayName', 'actorName', 'reason', 'note'])
  const replace = (value: any, key = ''): any => {
    if (typeof value === 'string') return fields.has(key) ? scrubPersonalValues(value, plan.values) : value
    if (Array.isArray(value)) return value.map(v => replace(v, key))
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replace(v, k)]))
    return value
  }
  const commands = (await db.prepare('SELECT id,result FROM larder_commands').all<{ id: string; result: string }>()).results
  plan.outcomes = commands.flatMap(command => {
    const result = JSON.stringify(replace(JSON.parse(command.result)))
    return result !== command.result ? [{ id: command.id, result }] : []
  })
  return plan
}
