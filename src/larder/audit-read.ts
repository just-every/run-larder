// GOV-004: query and export the audit. Owners and managers read it; nobody
// changes or removes an entry, so there is no write door here.
import { Problem, forbidden } from './problem'
import { auditDomains } from './audit'
import type { Actor } from './model'

export const auditReaders = ['owner', 'manager']
const columns = 'seq,id,at,actor_id AS actorId,actor_name AS actorName,actor_role AS actorRole,source,command_id AS commandId,command_type AS commandType,domain,subject_kind AS subjectKind,subject_id AS subjectId,subject_version AS subjectVersion,op,before,after,reason,evidence,refs,erasure_id AS erasureId'
const parse = (r: any) => ({ ...r, before: JSON.parse(r.before), after: JSON.parse(r.after), evidence: JSON.parse(r.evidence), refs: r.refs ? String(r.refs).split(' ') : [] })

// GOV-013 (ct, 22 October 2026): kept for the life of the installation, no purge door for any role (the owner
// included). The one exception is an erasure request, which replaces a data subject's personal values inside
// entries with a tombstone through the erasure door only; entry, actor id, time, command and record link stay.
export const retentionLine = 'Kept for the life of the installation. Purge authority: none. Erasure replaces personal values with a tombstone and keeps the entry.'
export const auditRetention = {
  period: 'the life of the installation', purgeAuthority: 'none', policy: 'indefinite', removableBy: 'nobody',
  erasure: { door: 'erasure.audit', authority: 'owner', replaces: 'personal values of the data subject', keeps: ['entry', 'actor id', 'time', 'command', 'record link', 'fact of replacement'], tombstone: '[erased]' },
  note: 'Entries are kept for the life of the installation; no command, role or database statement purges one. An erasure request replaces a data subject\'s personal values with a tombstone through the erasure door only.',
}

export async function auditQuery(db: D1Database, actor: Actor, params: URLSearchParams, defaultLimit = 100, maxLimit = 500) {
  if (!auditReaders.includes(actor.role)) forbidden('Only the owner or a manager reads the audit.')
  const where: string[] = [], bind: unknown[] = []
  const domain = params.get('domain')
  if (domain) {
    if (!(auditDomains as readonly string[]).includes(domain)) throw new Problem('INPUT', `domain must be one of ${auditDomains.join(', ')}.`, null, 400)
    where.push(domain === 'agent' ? "(domain='agent' OR source='agent')" : 'domain=?'); if (domain !== 'agent') bind.push(domain)
  }
  const eq: [string, string, string][] = [['actor', 'actor_id', '='], ['source', 'source', '='], ['kind', 'subject_kind', '='], ['commandId', 'command_id', '='], ['op', 'op', '=']]
  for (const [name, column] of eq) { const v = params.get(name); if (v) { where.push(`${column}=?`); bind.push(v) } }
  const type = params.get('type'); if (type) { where.push("(command_type=? OR command_type LIKE ? ESCAPE '\\')"); bind.push(type, type.replace(/[%_\\]/g, '\\$&') + '.%') }
  const ref = params.get('ref'); if (ref) { where.push("(subject_id=? OR instr(' '||refs||' ',?)>0)"); bind.push(ref, ` ${ref} `) }
  const from = params.get('from'), to = params.get('to')
  if (from) { where.push('at>=?'); bind.push(from) }
  if (to) { where.push('at<=?'); bind.push(to.length === 10 ? to + 'T23:59:59.999Z' : to) }
  const q = params.get('q')?.trim().toLowerCase(); if (q) { where.push("(instr(lower(reason||' '||command_type||' '||actor_name||' '||subject_kind||' '||subject_id||' '||before||' '||after),?)>0)"); bind.push(q) }
  const filter = where.length ? ' WHERE ' + where.join(' AND ') : ''
  const limit = Math.min(maxLimit, Math.max(1, Number(params.get('limit') ?? defaultLimit) || defaultLimit)), afterSeq = Number(params.get('after') ?? 0) || 0
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM larder_audit${filter}`).bind(...bind).first<{ n: number }>())!.n
  const rows = (await db.prepare(`SELECT ${columns} FROM larder_audit${filter}${where.length ? ' AND' : ' WHERE'} seq>? ORDER BY seq LIMIT ?`).bind(...bind, afterSeq, limit).all()).results.map(parse)
  // GOV-013: each erasure request stays on record (never the erased values), so the export shows who erased whom, when and over what.
  const requests = (await db.prepare('SELECT id,at,actor_id AS ranBy,subject_kind AS subjectKind,subject_id AS subjectId,scope,entries FROM larder_audit_erasures ORDER BY at,id').all()).results
  return { total, entries: rows, next: rows.length === limit ? (rows.at(-1) as any).seq : null, retention: { ...auditRetention, erasureRequests: requests.length, requests } }
}

const cell = (v: unknown) => { const t = typeof v === 'string' ? v : JSON.stringify(v ?? ''); return `"${(/^[=+\-@\t\r]/.test(t) ? "'" + t : t).replaceAll('"', '""')}"` }
export const auditCsvColumns = ['seq', 'at', 'actorName', 'actorRole', 'source', 'domain', 'commandType', 'commandId', 'subjectKind', 'subjectId', 'subjectVersion', 'op', 'reason', 'before', 'after', 'evidence', 'erasureId']
export const auditCsv = (entries: Record<string, any>[]) => [auditCsvColumns.join(','), ...entries.map(e => auditCsvColumns.map(k => cell(e[k])).join(','))].join('\r\n') + '\r\n'

export async function auditExport(db: D1Database, actor: Actor, params: URLSearchParams) {
  const pages: any[] = []
  let after = 0, total = 0, retention: Record<string, unknown> = auditRetention
  for (let i = 0; i < 40; i++) {
    const page = new URLSearchParams(params); page.set('after', String(after)); page.set('limit', '500')
    const r = await auditQuery(db, actor, page, 500, 500); total = r.total; retention = r.retention; pages.push(...r.entries)
    if (r.next === null) break
    after = r.next
  }
  return { exportedAt: new Date().toISOString(), exportedBy: actor.id, filters: Object.fromEntries([...params].filter(([k]) => !['after', 'limit'].includes(k))), total, complete: pages.length === total, retention, entries: pages }
}
