import { sha256 } from '../modules/import-kit/src/d1/index'
import { bump, fresh, get, list, oneOf, row, text, type Actor, type Context, type Row } from './model'
import { Problem, fail, forbidden } from './problem'
import { authority, roleSql } from './storage'
import { unscoped } from './scope'

const resources = ['catalog', 'orders', 'operations', 'trace'] as const
export function serviceKeys(c: Context, type: string, p: any): Row | undefined {
  if (!['integration.key.issue', 'integration.key.revoke'].includes(type)) return
  if (c.actor.role !== 'owner') forbidden('Only the owner manages integration read credentials.')
  if (type === 'integration.key.revoke') {
    const key = get(c.s, 'integrationGrants', p.keyId, 'integration credential')
    fresh(key, p.version)
    return bump(key, { status: 'revoked', revokedAt: c.now, reason: text(p.reason, 'revocation reason', 400) })
  }
  if (p.consent !== true) fail('INPUT', 'Explicit owner consent is required.')
  const scopes = [...new Set(list(p.resources, 'resources', resources.length).map(r => oneOf(r, resources, 'resource')))]
  const minutes = p.minutes
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) fail('INPUT', 'Choose an expiry from 1 to 60 minutes.')
  c.serviceSecret = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('')
  return row(c, 'integrationGrants', { id: c.commandId, name: text(p.name, 'integration name', 80), resources: scopes, expiresAt: Date.now() + minutes * 60000, status: 'active', consent: true, authority: 'read only, current owner session, costs restricted' })
}

export function serviceKeyStatements(db: D1Database, c: Context, type: string, result: any) {
  if (type === 'integration.key.issue') return [db.prepare('INSERT INTO larder_service_keys(id,digest,operator_id,session_id,operator_version,expires_at) VALUES(?,?,?,?,?,?)').bind(result.id, sha256(c.serviceSecret!), c.actor.id, c.actor.sessionId, c.actor.operatorVersion, result.expiresAt)]
  if (type === 'integration.key.revoke') return [db.prepare('UPDATE larder_service_keys SET revoked=1 WHERE id=?').bind(result.id)]
  return []
}

export async function serviceActor(db: D1Database, request: Request): Promise<Actor | null> {
  const authorization = request.headers.get('authorization')
  if (!authorization) return null
  const value = /^Bearer ([a-f0-9]{64})$/.exec(authorization)?.[1]
  if (!value) throw new Problem('AUTH', 'Invalid integration credential.', null, 401)
  const key = await db.prepare(`SELECT k.*,o.display_name AS name,${roleSql} AS role FROM larder_service_keys k JOIN oa_operators o ON o.id=k.operator_id WHERE k.digest=? AND k.revoked=0 AND k.expires_at>?`).bind(sha256(value), Date.now()).first<any>()
  if (!key || key.role !== 'owner') throw new Problem('AUTH', 'Integration credential expired or revoked.', null, 401)
  const actor: Actor = { id: key.operator_id, name: key.name, sessionId: key.session_id, operatorVersion: key.operator_version, role: key.role, scope: { ...unscoped, costs: true } }
  const alive = await db.prepare(`SELECT CASE WHEN (${authority(actor).sql}) THEN 1 ELSE 0 END AS ok`).bind(...authority(actor).params).first<{ ok: number }>()
  if (alive?.ok !== 1) throw new Problem('AUTH', 'The authorizing native session is no longer active.', null, 401)
  const grant = await db.prepare("SELECT data FROM larder_records WHERE kind='integrationGrants' AND id=?").bind(key.id).first<{ data: string }>()
  const resource = /^\/api\/larder\/v1\/(catalog|orders|operations|trace)$/.exec(new URL(request.url).pathname)?.[1]
  if (!grant || JSON.parse(grant.data).status !== 'active' || request.method !== 'GET' || !resource || !JSON.parse(grant.data).resources.includes(resource)) forbidden('This integration credential does not permit that resource or action.')
  return actor
}
