// Larder's public door: /api/larder/*. Every request resolves the current
// native session and Larder role; every command re-checks both inside the
// atomic write that applies it.
import { operatorAuth, runtimeBindings, type Bindings } from '../auth.server'
import { canonicalJson, sha256 } from '../modules/import-kit/src/d1/index'
import { archive, restore } from './archive'
import { bom } from './bom'
import { bomBulk } from './bom-bulk'
import { bomCsv } from './bom-csv'
import { ranking } from './order-ranking'
import { counts } from './counts'
import { blindSessions } from './count-visibility'
import { catalogBulk } from './catalog-bulk'
import { catalogCsv } from './catalog-csv'
import { catalogue } from './catalogue'
import { exportBatch, imports, publishImport } from './odoo/imports'
import { handoff, handoffCsv } from './handoff'
import { forecasts } from './forecast'
import { maintenance } from './maintenance'
import { downtime } from './downtime'
import { engineering } from './engineering'
import { planning } from './planning'
import { production } from './production'
import { operations } from './operations'
import { proposals } from './proposals'
import { purchasing } from './purchasing'
import { reversal } from './reversal'
import { resolutions } from './exceptions'
import { sales } from './sales'
import { orderChanges } from './order-changes'
import { warehouse } from './warehouse'
import { Problem, fail, forbidden } from './problem'
import { roleCommand } from './roles'
import { commit, load, roleSql, saved, authority } from './storage'
import { stateView } from './view'
import { get, type Actor, type Context, type Row } from './model'

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers })

async function current(request: Request, env: Bindings): Promise<Actor> {
  const session = await operatorAuth(env).getSession(request)
  if (!session) throw new Problem('AUTH', 'Sign in with a current session.', null, 401)
  const r = await env.DB.prepare(`SELECT ${roleSql} AS role FROM oa_operators o WHERE o.id=?`).bind(session.operator.id).first<{ role: string }>()
  return { id: session.operator.id, name: session.operator.displayName, role: r?.role ?? 'viewer', sessionId: session.id, operatorVersion: session.operator.version }
}

const handlers = [maintenance, engineering, downtime, catalogBulk, forecasts, catalogue, warehouse, counts, ranking, bom, bomBulk, orderChanges, sales, purchasing, production, operations, planning, reversal, handoff, proposals, resolutions, imports]

async function people(env: Bindings, actor: Actor) {
  const named = (await env.DB.prepare(`SELECT o.id,o.display_name AS name,${roleSql} AS role FROM oa_operators o WHERE o.status='active'`).all()).results
  const operators = actor.role === 'owner' ? (await env.DB.prepare(`SELECT o.id,o.email,o.display_name AS name,o.status,${roleSql} AS role FROM oa_operators o ORDER BY o.created_at`).all()).results : []
  const commands = (await env.DB.prepare('SELECT id,actor_id AS actorId,type,created_at AS createdAt FROM larder_commands ORDER BY created_at DESC LIMIT 200').all()).results
  return { people: named, operators, commands }
}

async function command(env: Bindings, actor: Actor, request: Request): Promise<Response> {
  if (request.headers.get('origin') !== new URL(env.AUTH_ORIGIN).origin) throw new Problem('ORIGIN', 'Send commands from this installation.', null, 403)
  if (!request.headers.get('content-type')?.includes('application/json')) throw new Problem('CONTENT_TYPE', 'Use application/json.', null, 400)
  const raw = await request.text()
  if (raw.length > 4 * 1024 * 1024) throw new Problem('SIZE', 'A command is limited to 4 MiB.', null, 413)
  let body: any
  try { body = JSON.parse(raw) } catch { throw new Problem('JSON', 'Malformed JSON.', null, 400) }
  const { commandId, type, payload = {} } = body ?? {}
  if (typeof commandId !== 'string' || !/^[-a-zA-Z0-9_]{8,100}$/.test(commandId) || typeof type !== 'string') throw new Problem('COMMAND', 'Send a unique commandId and a command type.', null, 400)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Problem('INPUT', 'The payload must be an object.', null, 400)
  if (actor.role === 'viewer') forbidden('Viewers can read but not change records.')
  if (type === 'role.set' && actor.role === 'owner') {
    const target = await env.DB.prepare('SELECT role FROM oa_operators WHERE id=?').bind(payload.operatorId).first<{ role: string }>()
    if (!target) fail('NOT_FOUND', 'Choose an invited person.')
    if (target!.role === 'owner') fail('OWNER_ROLE', 'The owner keeps owner authority.')
  }
  if (blindSessions(await load(env.DB), actor).length && type !== 'count.submit') forbidden('Finish your assigned blind count before using other commands.')
  if (type === 'wo.operation.assign') {
    if (!['owner', 'manager'].includes(actor.role)) forbidden('Only a manager authorizes operation skills.')
    const person = await env.DB.prepare(`SELECT ${roleSql} AS role FROM oa_operators o WHERE o.id=? AND o.status='active'`).bind(payload.operatorId).first<{ role: string }>()
    if (!person || !['owner', 'manager', 'production'].includes(person.role)) fail('INPUT', 'Assign an active production person or manager.')
  }
  if (type === 'count.schedule') {
    const counter = await env.DB.prepare(`SELECT ${roleSql} AS role FROM oa_operators o WHERE o.id=? AND o.status='active'`).bind(payload.counterId).first<{ role: string }>()
    if (counter?.role !== 'warehouse') fail('INPUT', 'Assign an active warehouse person.')
  }
  const digest = sha256(canonicalJson({ type, payload }))
  const previous = await saved(env.DB, commandId, digest, actor)
  if (previous) return json(previous)
  // Replaying a recorded outcome does not create a new escalation.
  if (type === 'wo.operation.pause') {
    const supervisor = await env.DB.prepare(`SELECT ${roleSql} AS role FROM oa_operators o WHERE o.id=? AND o.status='active'`).bind(payload.escalationOwnerId).first<{ role: string }>()
    if (!supervisor || !['owner', 'manager'].includes(supervisor.role)) fail('INPUT', 'Escalate to an active owner or manager.')
  }
  // A command that loses a concurrent write is recomputed against the new state.
  for (let attempt = 0; attempt < 8; attempt++) {
    const before = await load(env.DB), s = structuredClone(before)
    if (blindSessions(s, actor).length && type !== 'count.submit') forbidden('Finish your assigned blind count before using other commands.')
    const c: Context = { s, actor, commandId, now: new Date().toISOString(), attachments: [] }
    let result: Row | undefined = roleCommand(c, type, payload)
    for (const handle of handlers) { if (result !== undefined) break; result = handle(c, type, payload) }
    if (result === undefined) fail('COMMAND', 'Unknown command type.')
    if (type === 'import.commit' || type === 'import.undo') {
      await publishImport(env, c, before, type, digest, result!)
      return json((await saved(env.DB, commandId, digest, actor)) ?? fail('IMPORT_PUBLICATION', 'The import did not finish. Send the same command again to resume it.'))
    }
    try { return json(await commit(env.DB, c, before, type, digest, result)) }
    catch (error) {
      const replay = await saved(env.DB, commandId, digest, actor)
      if (replay) return json(replay)
      if ((await load(env.DB)).version !== before.version && attempt < 7) continue
      const message = String((error as Error)?.message ?? '')
      if (/oversold|reserved_stock|negative_stock/.test(message)) fail('DEPENDENCY', 'Stock changed underneath this action. Reload and try again.')
      if (/CHECK constraint failed/.test(message) && (await env.DB.prepare(`SELECT CASE WHEN (${authority(actor).sql}) THEN 1 ELSE 0 END AS ok`).bind(...authority(actor).params).first<{ ok: number }>())?.ok !== 1) throw new Problem('AUTH', 'Your session or role changed. Sign in again.', null, 401)
      throw error
    }
  }
  return fail('BUSY', 'Records changed repeatedly. Send the same command again.')
}

export async function larderResponse(request: Request, original: Bindings): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/larder/')) return null
  try {
    const env = runtimeBindings(original), actor = await current(request, env)
    const path = url.pathname.slice('/api/larder'.length)
    if (request.method === 'POST' && path === '/commands') return await command(env, actor, request)
    if (path !== '/state' && blindSessions(await load(env.DB), actor).length) forbidden('Downloads are unavailable during your assigned blind count.')
    if (request.method === 'POST' && path === '/archive/restore') return json(await restore(env, actor, request))
    if (request.method !== 'GET') throw new Problem('METHOD', 'Use GET to read or POST /api/larder/commands to act.', null, 405)
    const ok = await env.DB.prepare(`SELECT CASE WHEN (${authority(actor).sql}) THEN 1 ELSE 0 END AS ok`).bind(...authority(actor).params).first<{ ok: number }>()
    if (ok?.ok !== 1) throw new Problem('AUTH', 'Your session or role changed. Sign in again.', null, 401)
    if (path === '/state') { const s = await load(env.DB); return json(stateView(s, actor, await people(env, actor))) }
    if (path === '/archive') return json(await archive(env, actor))
    if (path === '/catalog.csv') {
      if (!['owner', 'manager', 'buyer', 'production'].includes(actor.role)) forbidden('Only catalog managers, buyers or engineers export the catalog.')
      return new Response(catalogCsv(await load(env.DB)), { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="larder-catalog.csv"' } })
    }
    if (path === '/boms.csv') {
      if (!['owner', 'manager', 'production'].includes(actor.role)) forbidden('Only manufacturing engineers or managers export BOMs.')
      return new Response(bomCsv(await load(env.DB)), { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="larder-boms.csv"' } })
    }
    const csv = /^\/handoffs\/([-0-9a-f]{36})\.csv$/.exec(path)
    if (csv) {
      if (!['owner', 'manager', 'accounts'].includes(actor.role)) forbidden()
      const h = get(await load(env.DB), 'handoffs', csv[1], 'handoff')
      return new Response(handoffCsv(h), { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="larder-${h.reference}.csv"` } })
    }
    const exported = /^\/imports\/([-0-9a-f]{36})\.json$/.exec(path)
    if (exported) return json(exportBatch(await load(env.DB), exported[1]))
    const file = /^\/attachments\/([-0-9a-f]{36})$/.exec(path)
    if (file) {
      const a = await env.DB.prepare('SELECT name,content_type,bytes FROM larder_attachments WHERE id=?').bind(file[1]).first<any>()
      if (!a) throw new Problem('NOT_FOUND', 'No such attachment.', null, 404)
      return new Response(new Uint8Array(a.bytes), { headers: { ...headers, 'content-type': a.content_type, 'content-disposition': `attachment; filename="${String(a.name).replace(/[^\w.\- ]/g, '_')}"` } })
    }
    throw new Problem('NOT_FOUND', 'Unknown endpoint.', null, 404)
  } catch (error) {
    if (!(error instanceof Problem)) console.error('larder: unconfirmed outcome', error)
    if (error instanceof Problem) return json({ ok: false, error: { code: error.code, message: error.message, details: error.details } }, error.status)
    return json({ ok: false, error: { code: 'UNCONFIRMED', message: 'The outcome is not confirmed. Send the identical command again to recover its recorded result.' } }, 409)
  }
}
