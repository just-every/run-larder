// The complete business archive and its restore into an empty installation.
// Restore is one atomic write that also proves every stock position equals the
// archived reconciliation; a mismatch writes nothing.
import type { Bindings } from '../auth.server'
import { canonicalJson, sha256 } from '../modules/import-kit/src/d1/index'
import { Problem, fail, forbidden } from './problem'
import { positions } from './stock'
import { authority, load } from './storage'
import { movementView } from './view'
import { collections, type Actor } from './model'

const FORMAT = 'larder-archive-v1'
// These are native USD records. Original source history and supplier quote
// currencies are independent declarations and must never be rewritten here.
const functionalMoney = ['items', 'salesOrders', 'purchaseOrders', 'workOrders', 'laborRates', 'jobCharges', 'costLinks', 'costValuations', 'marginCharges', 'handoffs'] as const
function checkFunctionalMoney(records: Partial<Record<(typeof functionalMoney)[number], any[]>>) {
  for (const kind of functionalMoney) for (const record of records[kind] ?? []) {
    if ((record.currency !== undefined && record.currency !== 'USD') || (record.functionalCurrency !== undefined && record.functionalCurrency !== 'USD')) fail('CURRENCY_MIGRATION', 'A native monetary record conflicts with the declared USD functional currency. Supply a versioned recorded-rate migration; original amounts cannot be relabelled.')
  }
}

const base64 = (bytes: ArrayBuffer | Uint8Array) => { let s = ''; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b); return btoa(s) }

export async function archive(env: Bindings, actor: Actor) {
  if (!['owner', 'manager'].includes(actor.role)) forbidden('Only the owner or a manager can export the business archive.')
  const s = await load(env.DB)
  const [commands, attachments, people, historicalPeople, historicalRoles] = await env.DB.batch<any>([
    env.DB.prepare('SELECT * FROM larder_commands ORDER BY created_at,id'),
    env.DB.prepare('SELECT * FROM larder_attachments ORDER BY created_at,id'),
    env.DB.prepare('SELECT id,display_name AS name FROM oa_operators ORDER BY id'),
    env.DB.prepare("SELECT data FROM larder_records WHERE kind='people' AND id='archive'"),
    env.DB.prepare("SELECT data FROM larder_records WHERE kind='archiveRoleHistory' AND id='archive'"),
  ])
  checkFunctionalMoney(s)
  const content = {
    format: FORMAT, version: s.version, currency: 'USD', precision: 6,
    records: Object.fromEntries(collections.map(k => [k, s[k]])),
    movements: s.movements.map(m => ({ ...m, quantity: m.quantity.toString(), unitCost: m.unitCost.toString() })),
    reservations: s.reservations.map(r => ({ ...r, quantity: r.quantity.toString() })),
    commands: commands.results, people: [...new Map([...historicalPeople.results.flatMap((r: any) => JSON.parse(r.data)), ...people.results].map((p: any) => [p.id, p])).values()],
    unmappedRoles: historicalRoles.results.flatMap((r: any) => JSON.parse(r.data)),
    attachments: attachments.results.map((a: any) => ({ ...a, bytes: base64(a.bytes) })),
    reconciliation: positions(s),
  }
  return { ...content, exportedAt: new Date().toISOString(), checksum: sha256(canonicalJson(content)), ledger: s.movements.map(movementView).length }
}

export async function restore(env: Bindings, actor: Actor, request: Request) {
  if (actor.role !== 'owner') forbidden('Only the owner can restore an archive.')
  if (request.headers.get('origin') !== new URL(env.AUTH_ORIGIN).origin) throw new Problem('ORIGIN', 'Restore from this installation.', null, 403)
  const raw = await request.text()
  if (raw.length > 64 * 1024 * 1024) throw new Problem('SIZE', 'Archives over 64 MiB need the installation export (rer export).', null, 413)
  let a: any
  try { a = JSON.parse(raw) } catch { fail('ARCHIVE', 'The file is not a Larder archive.') }
  const { exportedAt, checksum, ledger, ...content } = a ?? {}
  if (content.format !== FORMAT) fail('ARCHIVE', 'The file is not a Larder archive.')
  if (sha256(canonicalJson(content)) !== checksum) fail('CHECKSUM', 'The archive does not match its checksum. It was changed or damaged after export.')
  // Until an explicit functional-currency migration exists, refusing a legacy
  // archive is safer than restoring its amounts and later exporting them as USD.
  if (content.currency !== 'USD') fail('CURRENCY_MIGRATION', 'Restore requires an explicitly declared USD functional currency. Legacy non-USD amounts need a versioned migration with recorded rates and reconciliation; they cannot be relabelled.')
  checkFunctionalMoney(content.records ?? {})
  const empty = await env.DB.prepare('SELECT (SELECT version FROM larder_meta WHERE id=1)=0 AND NOT EXISTS(SELECT 1 FROM larder_records) AND NOT EXISTS(SELECT 1 FROM larder_movements) AND NOT EXISTS(SELECT 1 FROM larder_commands) AS empty').first<{ empty: number }>()
  if (empty?.empty !== 1) fail('NOT_EMPTY', 'Restore only into an empty installation. This one already has records.')
  const db = env.DB, guard = authority(actor)
  const statements: D1PreparedStatement[] = [db.prepare(`INSERT INTO larder_guard(id,ok) VALUES(?,CASE WHEN (${guard.sql}) AND (SELECT version FROM larder_meta WHERE id=1)=0 AND NOT EXISTS(SELECT 1 FROM larder_records) AND NOT EXISTS(SELECT 1 FROM larder_movements) AND NOT EXISTS(SELECT 1 FROM larder_commands) THEN 1 ELSE 0 END)`).bind(crypto.randomUUID(), ...guard.params)]
  const operators = new Set((await db.prepare('SELECT id FROM oa_operators').all<{ id: string }>()).results.map(r => r.id))
  let skippedRoles = 0
  const unmappedRoles = [...(content.unmappedRoles ?? [])]
  for (const kind of collections) for (const r of content.records[kind] ?? []) {
    if (kind === 'roles' && !operators.has(r.id)) { skippedRoles++; unmappedRoles.push(r); continue }
    const data = kind === 'reportSchedules' ? { ...r, status:'paused', consent:null, restoredAt:new Date().toISOString() } : kind === 'imports' ? { ...r, status: r.status === 'committed' ? 'restored' : r.status } : kind === 'scheduleGrants' ? { ...r, version: r.version + 1, status: 'draft', approvedBy: null, approvedAt: null, restoredAt: new Date().toISOString(), history: [...(r.history ?? []), (({ history, ...original }) => original)(r)] } : r
    statements.push(db.prepare('INSERT INTO larder_records(kind,id,version,data) VALUES(?,?,?,?)').bind(kind, r.id, data.version, JSON.stringify(data)))
  }
  for (const m of content.movements) statements.push(db.prepare('INSERT INTO larder_movements VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(m.id, m.sequence, m.itemId, m.locationId, m.status, m.lotId, Number(m.quantity), Number(m.unitCost), m.kind, m.documentKind, m.documentId, m.reversesId, m.actorId, m.commandId, m.importId, m.reason, m.createdAt))
  for (const r of content.reservations) statements.push(db.prepare('INSERT INTO larder_reservations VALUES(?,?,?,?,?,?,?)').bind(r.id, r.demandKind, r.demandId, r.lineId, r.itemId, r.locationId, Number(r.quantity)))
  for (const c of content.commands) statements.push(db.prepare('INSERT INTO larder_commands VALUES(?,?,?,?,?,?)').bind(c.id, c.actor_id, c.type, c.digest, c.result, c.created_at))
  for (const f of content.attachments) {
    const bytes = Uint8Array.from(atob(f.bytes), ch => ch.charCodeAt(0))
    if (sha256(bytes) !== f.sha256) fail('CHECKSUM', `Attachment ${f.name} does not match its digest.`)
    statements.push(db.prepare('INSERT INTO larder_attachments VALUES(?,?,?,?,?,?,?,?)').bind(f.id, f.name, f.content_type, f.size, f.sha256, bytes, f.created_by, f.created_at))
  }
  statements.push(db.prepare("INSERT INTO larder_records(kind,id,version,data) VALUES('people','archive',1,?)").bind(JSON.stringify(content.people)))
  statements.push(db.prepare("INSERT INTO larder_records(kind,id,version,data) VALUES('archiveRoleHistory','archive',1,?)").bind(JSON.stringify(unmappedRoles)))
  // Prove every archived position from the restored movements, inside the write.
  for (const p of content.reconciliation) statements.push(db.prepare("INSERT INTO larder_guard(id,ok) VALUES(?,CASE WHEN (SELECT COALESCE(SUM(quantity),0) FROM larder_movements WHERE item_id=? AND location_id=? AND status=? AND lot_id=?)=? THEN 1 ELSE 0 END)").bind(crypto.randomUUID(), p.itemId, p.locationId, p.status, p.lotId, scaled(p.quantity)))
  statements.push(db.prepare('INSERT INTO larder_guard(id,ok) VALUES(?,CASE WHEN (SELECT COUNT(*) FROM larder_movements)=? THEN 1 ELSE 0 END)').bind(crypto.randomUUID(), content.movements.length))
  statements.push(db.prepare('DELETE FROM larder_guard'), db.prepare('UPDATE larder_meta SET version=? WHERE id=1').bind(content.version))
  try { await db.batch(statements) }
  catch { fail('RECONCILE', 'The archive did not reconcile on restore; nothing was written.') }
  const after = positions(await load(db))
  return { ok: true, result: { restoredVersion: content.version, records: Object.fromEntries(collections.map(k => [k, (content.records[k] ?? []).length])), movements: content.movements.length, positions: after.length, skippedRoles, attachments: content.attachments.length } }
}

function scaled(v: string) {
  const negative = v.startsWith('-'), [w, f = ''] = v.replace('-', '').split('.')
  const n = Number(BigInt(w) * 1000000n + BigInt(f.padEnd(6, '0')))
  return negative ? -n : n
}
