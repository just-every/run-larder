// GOV-004: the append-only audit. Each command that changes records writes one
// entry per changed record (actor, time, source, before/after, reason, linked
// evidence) in the same atomic batch. Values are minimised on the way in: no
// credentials, no document bodies, only digests of long text.
import { sha256 } from '../modules/import-kit/src/d1/index'
import { format } from './decimal'
import { collections, type Context, type State } from './model'

export const auditDomains = ['stock', 'revisions', 'time', 'quality', 'schedules', 'roles', 'integrations', 'agent', 'commercial', 'records'] as const
export type AuditEntry = {
  id: string; at: string; actorId: string; actorName: string; actorRole: string; source: 'person' | 'agent' | 'import'
  commandId: string; commandType: string; domain: string; subjectKind: string; subjectId: string; subjectVersion: number
  op: 'create' | 'update' | 'delete' | 'post' | 'bulk'; before: unknown; after: unknown; reason: string; evidence: unknown[]; refs: string
}

const credentialKey = /(secret|token|passw|passcode|api[\s_-]?key|access[\s_-]?key|private[\s_-]?key|authorization|credential|cookie|signature|bearer)/i
const bodyKey = /^(content|base64|bytes|html|body|enquiry|message|file|files|original|originals)$/i
const credentialShape = /\b(?:(?:sk|pk|rk|ghp|gho|ghs|xox[abprs])[-_][A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})/g
const labelled = /(\b(?:secret|token|passw(?:or)?d|passcode|api[\s_-]?key|access[\s_-]?key|private[\s_-]?key|authorization|credential|bearer)s?\b\s*(?:is|was|[:=])?\s*)(\S+)/gi
const withheld = '[withheld]'
const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g
const digest = (v: unknown) => { const t = typeof v === 'string' ? v : JSON.stringify(v) ?? ''; return { sha256: sha256(t), length: t.length } }

export function scrubText(t: string) {
  return t.replace(labelled, (_m, label) => `${label}${withheld}`).replace(credentialShape, withheld)
}

// A value as the audit keeps it.
export function scrub(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value ?? null
  if (typeof value === 'bigint') return format(value)
  if (typeof value === 'string') { const t = scrubText(value); return t.length > 240 ? digest(t) : t }
  if (depth > 6) return digest(value)
  if (Array.isArray(value)) {
    const items = value.map(v => scrub(v, depth + 1))
    return JSON.stringify(items).length > 4000 ? { ...digest(value), count: value.length } : items
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as object)) out[k] = credentialKey.test(k) ? withheld : bodyKey.test(k) && v ? digest(v) : scrub(v, depth + 1)
  return JSON.stringify(out).length > 8000 ? { ...digest(value), keys: Object.keys(out).length } : out
}

const byKind: Record<string, string> = {
  boms: 'revisions', bomChanges: 'revisions', engineeringChanges: 'revisions', catalogChanges: 'revisions', items: 'revisions', partyItems: 'revisions',
  roles: 'roles', customRoles: 'roles', approvalPolicies: 'roles', approvalDelegations: 'roles', approvalSignatures: 'roles', imports: 'integrations', cutovers: 'integrations', historyImports: 'integrations', sourceHistory: 'integrations', handoffs: 'integrations',
  qualityHolds: 'quality', inspections: 'quality', inspectionPlans: 'quality', nonconformances: 'quality', recalls: 'quality', certificates: 'quality', certificatePolicies: 'quality',
  scheduleGrants: 'schedules', schedulePolicies: 'schedules', schedulePlans: 'schedules', scheduleBookings: 'schedules', machineCalendars: 'schedules', laborCalendars: 'schedules', laborRates: 'schedules', productionPlans: 'schedules', forecasts: 'schedules',
  receipts: 'stock', shipments: 'stock', returns: 'stock', transfers: 'stock', counts: 'stock', openings: 'stock', reversals: 'stock', lots: 'stock', countSessions: 'stock', subcontractCustody: 'stock', movements: 'stock',
  salesOrders: 'commercial', purchaseOrders: 'commercial', parties: 'commercial',
}
const byCommand: [RegExp, string][] = [
  [/^wo\.operation\./, 'time'], [/^(opening|count|transfer|receipt|shipment|return|movement|quarantine|customerStock)\.|^wo\.(issue|output|reserve|batch)|^so\.reserve/, 'stock'],
  [/^(bom|catalog|engineering|item)\./, 'revisions'], [/^(quality|certificate|nonconformance|recall|lot|rework)\./, 'quality'], [/^(schedule|capacity|mps|forecast|order\.rank|work\.expected|plan|inventory)\.|^wo\.(release|split|merge)/, 'schedules'],
  [/^(role|member)\./, 'roles'], [/^(import|history|handoff)\./, 'integrations'], [/^(so|po|party|partyItem|supplier)\./, 'commercial'],
]
const proposalDomain: Record<string, string> = { reschedule: 'schedules', 'item-merge': 'revisions', replenishment: 'commercial', 'order-intake': 'commercial', reconciliation: 'integrations' }

function domainOf(c: Context, kind: string, type: string, payload: any) {
  if (kind === 'workOrders') return /^wo\.operation\./.test(type) ? 'time' : 'schedules'
  if (type === 'proposal.prepare') return 'agent'
  if (kind === 'proposals' || kind === 'approvals') {
    const proposal = c.s.proposals.find(p => p.id === payload?.proposalId)
    if (proposal) return proposalDomain[proposal.kind] ?? 'records'
  }
  return byKind[kind] ?? byCommand.find(([re]) => re.test(type))?.[1] ?? 'records'
}

const reasonOf = (p: any) => {
  for (const k of ['reason', 'note', 'justification', 'explanation', 'summary', 'comment']) if (typeof p?.[k] === 'string' && p[k].trim()) return scrubText(p[k].trim()).slice(0, 400)
  return ''
}
const refsOf = (...values: unknown[]) => [...new Set(values.flatMap(v => JSON.stringify(v ?? null).match(uuid) ?? []))].slice(0, 100)
const changedFields = (old: Record<string, any>, next: Record<string, any>) => {
  const before: Record<string, unknown> = {}, after: Record<string, unknown> = {}
  for (const k of new Set([...Object.keys(old), ...Object.keys(next)])) {
    if (k === 'version' || JSON.stringify(old[k]) === JSON.stringify(next[k])) continue
    before[k] = old[k]; after[k] = next[k]
  }
  return { before, after }
}
// A command that touches more records than this in one kind is recorded as one
// bulk entry (count, ids digest and first ids), never row by row.
const bulkAbove = 40

export function auditEntries(c: Context, before: State, type: string, payload: any, imported = false): AuditEntry[] {
  const source = c.actor.role === 'agent' ? 'agent' : imported ? 'import' : 'person'
  const evidence = c.attachments.map(a => ({ id: a.id, name: scrubText(a.name).slice(0, 120), sha256: a.sha256, size: a.size }))
  const reason = reasonOf(payload)
  const out: AuditEntry[] = []
  const add = (kind: string, subjectId: string, subjectVersion: number, op: AuditEntry['op'], was: unknown, now: unknown, full: unknown = now) => {
    out.push({
      id: `${c.commandId}:${out.length}`, at: c.now, actorId: c.actor.id, actorName: c.actor.name, actorRole: c.actor.role, source, commandId: c.commandId, commandType: type,
      domain: source === 'agent' && type === 'proposal.prepare' ? 'agent' : domainOf(c, kind, type, payload), subjectKind: kind, subjectId, subjectVersion, op,
      before: scrub(was), after: scrub(now), reason, evidence, refs: refsOf(subjectId, full).join(' '),
    })
  }
  for (const kind of collections) {
    const old = new Map(before[kind].map(r => [r.id, r])), next = new Set(c.s[kind].map(r => r.id))
    const touched: { r: any; was?: any }[] = []
    for (const r of c.s[kind]) { const was = old.get(r.id); if (!was || JSON.stringify(was) !== JSON.stringify(r)) touched.push({ r, was }) }
    const removed = before[kind].filter(r => !next.has(r.id))
    if (touched.length + removed.length > bulkAbove) {
      const ids = [...touched.map(t => t.r.id), ...removed.map(r => r.id)]
      add(kind, `${type}:${kind}`, 0, 'bulk', { count: before[kind].length }, { changed: touched.length, removed: removed.length, ids: ids.slice(0, 10), idsDigest: digest(ids) })
      continue
    }
    for (const { r, was } of touched) {
      if (!was) add(kind, r.id, r.version, 'create', {}, r)
      else { const d = changedFields(was, r); add(kind, r.id, r.version, 'update', d.before, d.after, r) }
    }
    for (const r of removed) add(kind, r.id, r.version, 'delete', r, {}, r)
  }
  const posted = c.s.movements.slice(before.movements.length)
  if (posted.length > bulkAbove) add('movements', `${type}:movements`, 0, 'bulk', { count: before.movements.length }, { posted: posted.length, ids: posted.slice(0, 10).map(m => m.id), idsDigest: digest(posted.map(m => m.id)) })
  else for (const m of posted) add('movements', m.id, 1, 'post', {}, { sequence: m.sequence, itemId: m.itemId, locationId: m.locationId, status: m.status, lotId: m.lotId, quantity: format(m.quantity), unitCost: format(m.unitCost), kind: m.kind, documentKind: m.documentKind, documentId: m.documentId, reversesId: m.reversesId, reason: m.reason })
  return out
}

export const auditInsertSql = 'INSERT INTO larder_audit(id,at,actor_id,actor_name,actor_role,source,command_id,command_type,domain,subject_kind,subject_id,subject_version,op,before,after,reason,evidence,refs) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
export const auditParams = (e: AuditEntry): unknown[] => [e.id, e.at, e.actorId, e.actorName, e.actorRole, e.source, e.commandId, e.commandType, e.domain, e.subjectKind, e.subjectId, e.subjectVersion, e.op, JSON.stringify(e.before), JSON.stringify(e.after), e.reason, JSON.stringify(e.evidence), e.refs]
