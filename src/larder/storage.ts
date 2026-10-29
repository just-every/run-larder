import { serviceKeyStatements } from './service-keys'
import { bookingGuards } from './scheduling/booking-guards'
// Load the whole operational state and commit a command's changes as one
// atomic D1 batch, guarded by the session, the role and the state version.
import { fail } from './problem'
import { caseHumanRoleSql } from './follow-up'
import { auditInsertSql, auditParams, type AuditEntry } from './audit'
import { erasureStatements, type ErasurePlan } from './audit-erasure'
import { collections, type Actor, type Context, type State } from './model'

export const roleSql = `CASE WHEN EXISTS(SELECT 1 FROM larder_records WHERE kind='roles' AND id=o.id) THEN (SELECT json_extract(data,'$.role') FROM larder_records WHERE kind='roles' AND id=o.id) WHEN o.role='owner' THEN 'owner' ELSE 'viewer' END`

// True only while this exact session is live, its operator active and unchanged,
// and the operator still holds the role, scope and custom role the command was checked against (GOV-001).
export const authority = (a: Actor) => ({
  sql: `EXISTS(SELECT 1 FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id WHERE s.id=? AND o.id=? AND o.version=? AND s.operator_version=o.version AND o.status='active' AND s.revoked_at IS NULL AND s.expires_at>? AND ${roleSql}=? AND COALESCE((SELECT version FROM larder_records WHERE kind='roles' AND id=o.id),0)=? AND COALESCE((SELECT version FROM larder_records WHERE kind='customRoles' AND id=?),0)=?)`,
  params: [a.sessionId, a.id, a.operatorVersion, Date.now(), a.role, a.scope?.version ?? 0, a.scope?.customId ?? '', a.scope?.customVersion ?? 0] as unknown[],
})

export async function load(db: D1Database): Promise<State> {
  const out = await db.batch<any>([
    db.prepare('SELECT version FROM larder_meta WHERE id=1'),
    db.prepare("SELECT kind,data FROM larder_records ORDER BY kind,json_extract(data,'$.createdAt'),id"),
    db.prepare('SELECT * FROM larder_movements ORDER BY sequence'),
    db.prepare('SELECT * FROM larder_reservations ORDER BY rowid'),
  ])
  const s = { version: out[0].results[0].version, movements: [], reservations: [] } as unknown as State
  for (const k of collections) s[k] = []
  for (const r of out[1].results) if ((collections as readonly string[]).includes(r.kind)) s[r.kind as (typeof collections)[number]].push(JSON.parse(r.data))
  // Inspection decisions follow atomic commit order even when their timestamps tie.
  s.inspections.sort((a, b) => (a.recordedVersion ?? 0) - (b.recordedVersion ?? 0) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  s.movements = out[2].results.map((r: any) => ({ id: r.id, sequence: r.sequence, itemId: r.item_id, locationId: r.location_id, status: r.status, lotId: r.lot_id, quantity: BigInt(r.quantity), unitCost: BigInt(r.unit_cost), kind: r.kind, documentKind: r.document_kind, documentId: r.document_id, reversesId: r.reverses_id, actorId: r.actor_id, commandId: r.command_id, importId: r.import_id, reason: r.reason, createdAt: r.created_at }))
  s.reservations = out[3].results.map((r: any) => ({ id: r.id, demandKind: r.demand_kind, demandId: r.demand_id, lineId: r.line_id, itemId: r.item_id, locationId: r.location_id, quantity: BigInt(r.quantity) }))
  return s
}

export async function saved(db: D1Database, commandId: string, digest: string, actor: Actor) {
  const r = await db.prepare('SELECT * FROM larder_commands WHERE id=?').bind(commandId).first<any>()
  if (!r) return null
  if (r.digest !== digest || r.actor_id !== actor.id) fail('IDEMPOTENCY', 'This command identity was already used with different content or by someone else.')
  const migration = await db.prepare("SELECT data FROM larder_records WHERE kind='archiveCurrencyMigration' AND id='archive'").first<{ data: string }>()
  if (migration && JSON.parse(migration.data).originalCommandIds.includes(commandId)) fail('CURRENCY_MIGRATION', 'This action predates the currency migration. Its original AUD outcome remains in the archive; replay is refused.')
  return JSON.parse(r.result)
}

const n = (v: bigint) => Number(v)

// Statements that write the difference between `before` and the context state.
export function changes(db: D1Database, c: Context, before: State): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = []
  for (const kind of collections) {
    const old = new Map(before[kind].map(r => [r.id, JSON.stringify(r)])), next = new Set(c.s[kind].map(r => r.id))
    for (const r of c.s[kind]) if (old.get(r.id) !== JSON.stringify(r))
      out.push(db.prepare('INSERT INTO larder_records(kind,id,version,data) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET version=excluded.version,data=excluded.data').bind(kind, r.id, r.version, JSON.stringify(r)))
    for (const r of before[kind]) if (!next.has(r.id)) out.push(db.prepare('DELETE FROM larder_records WHERE kind=? AND id=?').bind(kind, r.id))
  }
  // Reservations shrink first, then movements post, then reservations grow, so
  // the oversell triggers see the same order the command applied in memory.
  const oldR = new Map(before.reservations.map(r => [r.id, r])), nextR = new Map(c.s.reservations.map(r => [r.id, r]))
  for (const r of before.reservations) if (!nextR.has(r.id)) out.push(db.prepare('DELETE FROM larder_reservations WHERE id=?').bind(r.id))
  for (const r of c.s.reservations) { const o = oldR.get(r.id); if (o && r.quantity < o.quantity) out.push(db.prepare('UPDATE larder_reservations SET quantity=? WHERE id=?').bind(n(r.quantity), r.id)) }
  for (const m of c.s.movements.slice(before.movements.length))
    out.push(db.prepare('INSERT INTO larder_movements VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(m.id, m.sequence, m.itemId, m.locationId, m.status, m.lotId, n(m.quantity), n(m.unitCost), m.kind, m.documentKind, m.documentId, m.reversesId, m.actorId, m.commandId, m.importId, m.reason, m.createdAt))
  for (const r of c.s.reservations) {
    const o = oldR.get(r.id)
    if (!o) out.push(db.prepare('INSERT INTO larder_reservations VALUES(?,?,?,?,?,?,?)').bind(r.id, r.demandKind, r.demandId, r.lineId, r.itemId, r.locationId, n(r.quantity)))
    else if (r.quantity > o.quantity) out.push(db.prepare('UPDATE larder_reservations SET quantity=? WHERE id=?').bind(n(r.quantity), r.id))
  }
  for (const a of c.attachments) out.push(db.prepare('INSERT INTO larder_attachments VALUES(?,?,?,?,?,?,?,?)').bind(a.id, a.name, a.contentType, a.size, a.sha256, a.bytes, a.createdBy, a.createdAt))
  return out
}

export async function commit(db: D1Database, c: Context, before: State, type: string, digest: string, result: unknown, audit: AuditEntry[], erasure?: ErasurePlan) {
  const a = authority(c.actor)
  const report = c.reportAuthority ? authority(c.reportAuthority) : undefined
  const response = { ok: true, result, version: before.version + 1 }
  await db.batch([
    db.prepare(`INSERT INTO larder_guard(id,ok) VALUES(?,CASE WHEN (${a.sql}) AND (SELECT version FROM larder_meta WHERE id=1)=? THEN 1 ELSE 0 END)`).bind(crypto.randomUUID(), ...a.params, before.version),
    // Native target changes do not advance the business version. Fence the
    // exact person facts used for classification in the same batch as access.
    ...(c.scopeTarget ? [db.prepare('INSERT INTO larder_guard(id,ok) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND role=? AND status=?) THEN 1 ELSE 0 END)').bind(crypto.randomUUID(), c.scopeTarget.id, c.scopeTarget.version, c.scopeTarget.role, c.scopeTarget.status)] : []),
    // Original report consent is fenced with the snapshot, audit and replay.
    ...(report ? [db.prepare(`INSERT INTO larder_guard(id,ok) VALUES(?,CASE WHEN (${report.sql}) AND EXISTS(SELECT 1 FROM larder_report_sessions b JOIN oa_sessions s ON s.id=json_extract(b.actor,'$.sessionId') JOIN oa_operators o ON o.id=s.operator_id WHERE b.schedule_id=? AND b.actor=? AND o.role='owner' ${c.automaticReport ? "AND s.kind IN ('native','oidc','password')" : ''}) THEN 1 ELSE 0 END)`).bind(crypto.randomUUID(), ...report.params, (result as any).id, JSON.stringify(c.reportAuthority))] : []),
    // A supervisor can lose authority after the handler read. Verify the
    // escalation destination in the same transaction that records the notice.
    ...(type === 'wo.operation.pause' ? (result as any).operationStates.flatMap((task: any) => (task.downtime ?? []).filter((d: any) => d.commandId === c.commandId).map((d: any) =>
      db.prepare(`INSERT INTO larder_guard(id,ok) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM oa_operators o WHERE o.id=? AND o.status='active' AND ${roleSql} IN ('owner','manager')) THEN 1 ELSE 0 END)`).bind(crypto.randomUUID(), d.escalationOwnerId))) : []),
    ...(type === 'wo.operation.assign' ? (result as any).operationStates.filter((task: any) => task.assignment?.at === c.now && task.assignment?.by === c.actor.id).map((task: any) =>
      db.prepare(`INSERT INTO larder_guard(id,ok) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM oa_operators o WHERE o.id=? AND o.status='active' AND ${roleSql} IN ('owner','manager','production','operator')) THEN 1 ELSE 0 END)`).bind(crypto.randomUUID(), task.assignment.operatorId)) : []),
    // Assignment and escalation destinations are checked in this same batch,
    // so a demotion/deactivation cannot receive a new case or escalation.
    ...(['exception.assign', 'exception.escalate'].includes(type) ? [
      ...(type === 'exception.assign' ? [[(result as any).ownerId, caseHumanRoleSql]] : []),
      [(result as any).escalationOwnerId, "'owner','manager'"],
    ].map(([id, permitted]) => db.prepare(`INSERT INTO larder_guard(id,ok) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM oa_operators o WHERE o.id=? AND o.status='active' AND ${roleSql} IN (${permitted})) THEN 1 ELSE 0 END)`).bind(crypto.randomUUID(), id)) : []),
    ...(type === 'capacity.labor' ? (result as any).operatorIds.map((id: string) => db.prepare(`INSERT INTO larder_guard(id,ok) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM oa_operators o WHERE o.id=? AND o.status='active' AND ${roleSql} IN ('owner','manager','production','operator')) THEN 1 ELSE 0 END)`).bind(crypto.randomUUID(), id)) : []),
    ...(type === 'proposal.approve' && (result as any).context?.capacity ? [...new Set<string>((result as any).context.capacity.after.operations.map((o: any) => o.operatorId))].map(id => db.prepare(`INSERT INTO larder_guard(id,ok) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM oa_operators o WHERE o.id=? AND o.status='active' AND ${roleSql} IN ('owner','manager','production','operator')) THEN 1 ELSE 0 END)`).bind(crypto.randomUUID(), id)) : []),
    ...bookingGuards(db, c, before),
    ...changes(db, c, before),
    ...(type === 'reports.schedule' ? [db.prepare("INSERT INTO larder_guard(id,ok) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND role='owner') THEN 1 ELSE 0 END)").bind(crypto.randomUUID(), c.actor.id), db.prepare('INSERT INTO larder_report_sessions(schedule_id,actor) VALUES(?,?)').bind((result as any).id, JSON.stringify(c.actor))] : []),
    ...(type === 'reports.cancel' ? [db.prepare('DELETE FROM larder_report_sessions WHERE schedule_id=?').bind((result as any).id)] : []),
    ...serviceKeyStatements(db, c, type, result),
    ...audit.map(e => db.prepare(auditInsertSql).bind(...auditParams(e))),
    // GOV-013: the erasure door records its request, then replaces the subject's personal values, in this same batch.
    ...(erasure ? erasureStatements(db, c, erasure) : []),
    db.prepare('UPDATE larder_meta SET version=version+1 WHERE id=1'),
    db.prepare('INSERT INTO larder_commands VALUES(?,?,?,?,?,?)').bind(c.commandId, c.actor.id, type, digest, JSON.stringify(response), c.now),
    db.prepare('DELETE FROM larder_guard'),
  ])
  return response
}
