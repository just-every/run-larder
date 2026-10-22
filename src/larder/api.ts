import { replenishment } from './replenishment'
import { recovery, observeRecovery } from './scheduling/recovery'
import { laborCosts } from './scheduling/labor-costs'
import { calendars, rateReaders } from './scheduling/calendars'
import { finitePlan } from './scheduling/finite'
import { supplierQuotes } from './supplier-terms'
// Larder's public door: /api/larder/*. Every request resolves the current
// native session and Larder role; every command re-checks both inside the
// atomic write that applies it.
import { operatorAuth, runtimeBindings, type Bindings } from '../auth.server'
import { canonicalJson, sha256 } from '../modules/import-kit/src/d1/index'
import { archive, restore } from './archive'
import { archiveCsv } from './archive-csv'
import { history, historyMatches } from './history'
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
import { inventory } from './inventory'
import { certificates } from './certificates'
import { certificatePack } from './certificate-pack'
import { maintenance } from './maintenance'
import { expiry } from './lot-dates'
import { recall, recallPack } from './recall'
import { nonconformance } from './nonconformance'
import { quality } from './quality'
import { downtime } from './downtime'
import { engineering } from './engineering'
import { planning } from './planning'
import { materialDates } from './material-dates'
import { materialPegging } from './material-pegging'
import { workTransfers } from './work-transfers'
import { lotTrace, traceCsv } from './trace'
import { subcontract } from './subcontract'
import { rework } from './rework'
import { production } from './production'
import { operations } from './operations'
import { operationLedgerCommands } from './operation-ledger-commands'
import { proposals } from './proposals'
import { purchasing } from './purchasing'
import { reversal } from './reversal'
import { resolutions } from './exceptions'
import { caseHumanRoleSql, followUps } from './follow-up'
import { observeFollowUps } from './follow-up-state'
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

const handlers = [replenishment, recovery, calendars, history, recall, nonconformance, subcontract, workTransfers, rework, followUps, inventory, certificates, expiry, quality, maintenance, engineering, downtime, catalogBulk, forecasts, catalogue, warehouse, counts, ranking, bom, bomBulk, orderChanges, sales, purchasing, production, operations, operationLedgerCommands, planning, reversal, handoff, proposals, resolutions, imports]

async function people(env: Bindings, actor: Actor) {
  const named = (await env.DB.prepare(`SELECT o.id,o.display_name AS name,${roleSql} AS role FROM oa_operators o WHERE o.status='active'`).all()).results
  const operators = actor.role === 'owner' ? (await env.DB.prepare(`SELECT o.id,o.email,o.display_name AS name,o.status,${roleSql} AS role FROM oa_operators o ORDER BY o.created_at`).all()).results : []
  const commands = (await env.DB.prepare('SELECT id,actor_id AS actorId,type,created_at AS createdAt FROM larder_commands ORDER BY created_at DESC LIMIT 200').all()).results
  return { people: named, operators, commands }
}

async function command(env: Bindings, actor: Actor, request: Request): Promise<Response> {
  // FLOOR-004 retains its explicit production authoring authority. Operators
  // and other readers never recover a rework rate from a prior command replay.
  const respond = (body: any) => json(![...rateReaders, 'production'].includes(actor.role) && Array.isArray(body?.result?.labor) ? { ...body, result: { ...body.result, labor: body.result.labor.map(({ rate, ...line }: any) => line) } } : body)
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
  if (type === 'count.schedule') {
    const counter = await env.DB.prepare(`SELECT ${roleSql} AS role FROM oa_operators o WHERE o.id=? AND o.status='active'`).bind(payload.counterId).first<{ role: string }>()
    if (counter?.role !== 'warehouse') fail('INPUT', 'Assign an active warehouse person.')
  }
  if (type.startsWith('capacity.')) {
    const permitted = ['capacity.machine', 'capacity.sequence'].includes(type) ? ['owner', 'manager', 'planner'] : type === 'capacity.rate' ? rateReaders : ['owner', 'manager']
    if (!permitted.includes(actor.role)) forbidden('Your role cannot change these capacity settings.')
    if (type === 'capacity.labor') for (const id of Array.isArray(payload.operatorIds) ? payload.operatorIds : []) {
      const target = await env.DB.prepare(`SELECT ${roleSql} AS role FROM oa_operators o WHERE o.id=? AND o.status='active'`).bind(id).first<{ role: string }>()
      if (!target || !['owner','manager','production','operator'].includes(target.role)) fail('INPUT', 'Calendar members must be active production people, operators or managers.')
    }
  }
  const digest = sha256(canonicalJson({ type, payload }))
  const previous = await saved(env.DB, commandId, digest, actor)
  if (previous) return respond(previous)
  if (type === 'exception.assign' || type === 'exception.escalate') {
    if (!['owner', 'manager'].includes(actor.role)) forbidden('Only an owner or manager assigns or escalates cases.')
    const existing = type === 'exception.escalate' ? (await load(env.DB)).followUps.find(f => f.key === payload.key) : undefined
    const targets = type === 'exception.assign' ? [[payload.ownerId, caseHumanRoleSql], [payload.escalationOwnerId, "'owner','manager'"]] : [[existing?.escalationOwnerId, "'owner','manager'"]]
    for (const [id, permitted] of targets) {
      if (typeof id !== 'string') fail('INPUT', 'Choose an active follow-up person and escalation owner.')
      const target = await env.DB.prepare(`SELECT 1 AS ok FROM oa_operators o WHERE o.id=? AND o.status='active' AND ${roleSql} IN (${permitted})`).bind(id).first<{ ok: number }>()
      if (!target) fail('INPUT', 'Choose an active human with write authority; escalation needs an owner or manager.')
    }
  }
  if (type === 'wo.operation.assign') {
    if (!['owner', 'manager'].includes(actor.role)) forbidden('Only a manager authorizes operation skills.')
    const person = await env.DB.prepare(`SELECT ${roleSql} AS role FROM oa_operators o WHERE o.id=? AND o.status='active'`).bind(payload.operatorId).first<{ role: string }>()
    if (!person || !['owner', 'manager', 'production', 'operator'].includes(person.role)) fail('INPUT', 'Assign an active operator, production person or manager.')
  }
  // Replaying a recorded outcome does not create a new escalation.
  if (type === 'wo.operation.pause') {
    const supervisor = await env.DB.prepare(`SELECT ${roleSql} AS role FROM oa_operators o WHERE o.id=? AND o.status='active'`).bind(payload.escalationOwnerId).first<{ role: string }>()
    if (!supervisor || !['owner', 'manager'].includes(supervisor.role)) fail('INPUT', 'Escalate to an active owner or manager.')
  }
  // A command that loses a concurrent write is recomputed against the new state.
  for (let attempt = 0; attempt < 8; attempt++) {
    const before = await load(env.DB), s = structuredClone(before)
    if (blindSessions(s, actor).length && type !== 'count.submit') forbidden('Finish your assigned blind count before using other commands.')
    const c: Context = { s, actor, commandId, now: new Date().toISOString(), attachments: [], ...((type === 'proposal.prepare' || type === 'proposal.approve' || type.startsWith('schedule.') || type.startsWith('replenishment.') || ['maintenance.create','maintenance.update','maintenance.release','wo.operation.pause','wo.operation.resume','wo.operation.progress','wo.operation.complete','po.revise','po.confirm','order.rank','work.expected'].includes(type)) ? { people: (await people(env, actor)).people as any } : {}) }
    let result: Row | undefined = roleCommand(c, type, payload)
    for (const handle of handlers) { if (result !== undefined) break; result = handle(c, type, payload) }
    if (result === undefined) fail('COMMAND', 'Unknown command type.')
    observeRecovery(c, before, type)
    observeFollowUps(c)
    if (type === 'import.commit' || type === 'import.undo') {
      await publishImport(env, c, before, type, digest, result!)
      return respond((await saved(env.DB, commandId, digest, actor)) ?? fail('IMPORT_PUBLICATION', 'The import did not finish. Send the same command again to resume it.'))
    }
    try { return respond(await commit(env.DB, c, before, type, digest, result)) }
    catch (error) {
      const replay = await saved(env.DB, commandId, digest, actor)
      if (replay) return respond(replay)
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
    if (path === '/scheduling/labor-costs') {
      if (!rateReaders.includes(actor.role)) forbidden('Only accounts or authorized managers may read wage-based costing evidence.')
      return json({ basis: 'Recorded operation time; not payroll or posted accounting cost.', rows: laborCosts(await load(env.DB)) })
    }
    if (path === '/scheduling/finite') {
      const named = await people(env, actor)
      return json(finitePlan(await load(env.DB), named.people as any, url.searchParams.get('asOf') ?? new Date().toISOString(), Number(url.searchParams.get('days') ?? 14)))
    }
    if (path === '/purchasing/quotes') return json(supplierQuotes(await load(env.DB), url.searchParams.get('itemId') ?? '', url.searchParams.get('quantity') ?? '', url.searchParams.get('requiredBy') ?? '', new Date().toISOString().slice(0, 10)))
    if (path === '/planning/materials') return json(materialDates(await load(env.DB)))
    if (path === '/planning/pegging') return json(materialPegging(await load(env.DB), url.searchParams))
    const trace = /^\/lots\/([-0-9a-f]{36})\/trace(\.csv)?$/.exec(path)
    if (trace) {
      const result = lotTrace(await load(env.DB), trace[1], url.searchParams.get('direction') ?? 'upstream')
      return trace[2] ? new Response(traceCsv(result), { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="larder-lot-trace.csv"' } }) : json(result)
    }
    const recallDownload = /^\/recalls\/([-0-9a-f]{36})\.json$/.exec(path)
    if (recallDownload) return json(recallPack(await load(env.DB), recallDownload[1]))
    if (path === '/archive') return json(await archive(env, actor))
    if (path === '/archive.csv') return new Response(archiveCsv(await archive(env, actor)), { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="larder-archive.csv"' } })
    if (path === '/history') return json((await load(env.DB)).sourceHistory.filter(r => historyMatches(r, url.searchParams.get('q') ?? '')))
    if (path === '/catalog.csv') {
      if (!['owner', 'manager', 'buyer', 'production', 'engineer'].includes(actor.role)) forbidden('Only catalog managers, buyers or engineers export the catalog.')
      return new Response(catalogCsv(await load(env.DB)), { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="larder-catalog.csv"' } })
    }
    if (path === '/boms.csv') {
      if (!['owner', 'manager', 'production', 'engineer'].includes(actor.role)) forbidden('Only manufacturing engineers or managers export BOMs.')
      return new Response(bomCsv(await load(env.DB)), { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="larder-boms.csv"' } })
    }
    const certificateDownload = /^\/shipments\/([-0-9a-f]{36})\/certificates\.json$/.exec(path)
    if (certificateDownload) return json(await certificatePack(env.DB, await load(env.DB), certificateDownload[1]))
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
