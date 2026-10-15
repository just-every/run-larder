import type { Bindings } from './auth.server'
import { collections } from './larder/model'
import { workshop } from './demo/workshop'
import { canonicalJson, sha256 } from './modules/import-kit/src/d1/index'

// Demo-only bootstrap. It never fetches and never edits an existing record.
export async function seedDemo(env: Bindings, { ownerEmail, now }: { ownerEmail: string; now: Date }) {
  const owner = await env.DB.prepare("SELECT id FROM oa_operators WHERE email=? AND role='owner'").bind(ownerEmail).first<{ id: string }>()
  if (!owner) return
  if (await env.DB.prepare("SELECT 1 FROM larder_records WHERE kind='items' AND id='de000000-0000-4000-8000-000000000001'").first()) return
  const c = workshop(owner.id, now)
  // Domain operations allocate UUIDs. Give this fixed scenario stable UUIDs,
  // including nested references, before it ever reaches the database.
  const ids = new Map<string, string>()
  const stable = (value: unknown): any => {
    if (typeof value === 'string' && value !== owner.id && /^[0-9a-f]{8}(?:-[0-9a-f]+){4}$/i.test(value)) {
      if (!ids.has(value)) ids.set(value, `de000000-0000-4000-8000-${String(ids.size + 1).padStart(12, '0')}`)
      return ids.get(value)
    }
    if (Array.isArray(value)) return value.map(stable)
    if (value instanceof Uint8Array) return value
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stable(v)]))
    return value
  }
  const s = stable(c.s), attachments = stable(c.attachments), team = stable(c.team), commands = stable(c.commands)
  const statements: D1PreparedStatement[] = []
  // The workshop's own name for the owner a hosted demo's claim calls "Owner".
  statements.push(env.DB.prepare("UPDATE oa_operators SET display_name='Alex Morgan' WHERE id=? AND display_name='Owner'").bind(owner.id))
  for (const p of team) statements.push(env.DB.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES(?,?,?,'member','active',?) ON CONFLICT DO NOTHING").bind(p.id, p.email, p.name, p.joinedAt))
  for (const kind of collections) for (const r of s[kind]) statements.push(env.DB.prepare('INSERT INTO larder_records(kind,id,version,data) VALUES(?,?,?,?) ON CONFLICT DO NOTHING').bind(kind, r.id, r.version, JSON.stringify(r)))
  for (const m of s.movements) statements.push(env.DB.prepare('INSERT INTO larder_movements VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING').bind(m.id, m.sequence, m.itemId, m.locationId, m.status, m.lotId, Number(m.quantity), Number(m.unitCost), m.kind, m.documentKind, m.documentId, m.reversesId, m.actorId, m.commandId, m.importId, m.reason, m.createdAt))
  for (const r of s.reservations) statements.push(env.DB.prepare('INSERT INTO larder_reservations VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING').bind(r.id, r.demandKind, r.demandId, r.lineId, r.itemId, r.locationId, Number(r.quantity)))
  for (const a of attachments) statements.push(env.DB.prepare('INSERT INTO larder_attachments VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING').bind(a.id, a.name, a.contentType, a.size, a.sha256, a.bytes, a.createdBy, a.createdAt))
  for (const k of commands) statements.push(env.DB.prepare('INSERT INTO larder_commands VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING').bind(k.id, k.actorId, k.type, sha256(canonicalJson({ type: k.type, payload: k.payload })), JSON.stringify(k.result), k.createdAt))
  statements.push(env.DB.prepare('INSERT INTO oa_first_run(singleton,completed_by,completed_at) VALUES(1,?,?) ON CONFLICT DO NOTHING').bind(owner.id, now.getTime()))
  await env.DB.batch(statements)
}
