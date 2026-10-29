import { business } from './business'
import { recordStockClassification, rejectStockClassification } from './stock-classification'
import { recordAccessClassification } from './access-classification'
import { warehouseLogistics } from './warehouse-logistics'
import { serviceActor, serviceKeys } from './service-keys'
import { publicPage } from './public-api'
import { enforceRetention, retention, retentionPreview, operatorRetentionPreview } from './retention'
import { wavePicking } from './wave-picking'
import { recoveryInputsChanged } from './scheduling/recovery-options'
import { variance } from './costing/variance'
import { finishVariance } from './costing/variance-model'
import { coProducts, voidBatchReviews } from './co-products'
import { performanceReport, reportScheduling } from './costing/performance'
import { costing, costingReaders } from './costing/commands'
import { marginReport, varianceReport, reportCsv } from './costing/margins'
import { wipReport } from './costing/wip'
import { newBookings } from './scheduling/booking-guards'
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
import { migrateAudArchive } from './currency-migration'
import { approvalCommand } from './approval-policy'
import { cutover } from './cutover'
import { cutoverGuard } from './cutover-guard'
import { auditEntries } from './audit'
import { contactOutcomes, erasureCommand, erasurePlan } from './audit-erasure'
import { receiptJobAllocation } from './receipt-job-allocation'
import { auditCsv, auditExport, auditQuery, retentionLine } from './audit-read'
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
import { configurations, resolveFor } from './configurations'
import { kits } from './kits'
import { timeEntries, timeCosts } from './time-entries'
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
import { supplyChange, supplyChanges } from './supply-changes'
import { workTransfers } from './work-transfers'
import { salesAllocation } from './sales-allocation'
import { nesting } from './scheduling/nesting'
import { commandTime } from './clock'
import { lotTrace, traceCsv } from './trace'
import { serials, serialSearch } from './serials'
import { resolveScan } from './scan'
import { subcontract } from './subcontract'
import { rework } from './rework'
import { production } from './production'
import { operations } from './operations'
import { operationLedgerCommands } from './operation-ledger-commands'
import { proposals } from './proposals'
import { purchasing } from './purchasing'
import { receiving } from './receiving'
import { reversal } from './reversal'
import { resolutions } from './exceptions'
import { caseHumanRoleSql, followUps } from './follow-up'
import { observeFollowUps } from './follow-up-state'
import { sales } from './sales'
import { quoteReview } from './quote-review'
import { orderChanges } from './order-changes'
import { warehouse } from './warehouse'
import { Problem, fail, forbidden } from './problem'
import { roleCommand } from './roles'
import { effectiveScope, enforcePayload, enforceScope, hiddenLocations, isScoped, names, scopeOf } from './scope'
import { gateCommand } from './scope-gate'
import { redactCosts } from './scope-cost'
import { refuseHidden, scopedRead, scopedState, stubHidden, visibleState } from './scope-view'
import { commit, load, roleSql, saved, authority } from './storage'
import { stateView } from './view'
import { readsWages, withoutWages } from './wage-view'
import { get, type Actor, type Context, type Row } from './model'

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers })

async function current(request: Request, env: Bindings): Promise<Actor> {
  const integration = await serviceActor(env.DB, request)
  if (integration) return integration
  const session = await operatorAuth(env).getSession(request)
  if (!session) throw new Problem('AUTH', 'Sign in with a current session.', null, 401)
  const r = await env.DB.prepare(`SELECT ${roleSql} AS role FROM oa_operators o WHERE o.id=?`).bind(session.operator.id).first<{ role: string }>()
  const held = async (kind: string, id: string) => { const d = id ? await env.DB.prepare('SELECT data FROM larder_records WHERE kind=? AND id=?').bind(kind, id).first<{ data: string }>() : null; return d ? JSON.parse(d.data) : undefined }
  const member = await held('roles', session.operator.id), custom = await held('customRoles', member?.customRoleId ?? '')
  return { id: session.operator.id, name: session.operator.displayName, role: r?.role ?? 'viewer', sessionId: session.id, operatorVersion: session.operator.version, scope: effectiveScope(member, custom, (await env.DB.prepare("SELECT data FROM larder_records WHERE kind='locations'").all<{ data: string }>()).results.map(r => JSON.parse(r.data))) }
}

const handlers = [warehouseLogistics, business, quoteReview, serviceKeys, retention, wavePicking, variance, coProducts, salesAllocation, nesting, reportScheduling, costing, timeEntries, kits, configurations, approvalCommand, erasureCommand, supplyChange, receiving, receiptJobAllocation, cutover, replenishment, recovery, calendars, history, recall, nonconformance, subcontract, workTransfers, rework, followUps, inventory, certificates, expiry, quality, maintenance, engineering, downtime, catalogBulk, forecasts, catalogue, warehouse, serials, counts, ranking, bom, bomBulk, orderChanges, sales, purchasing, production, operations, operationLedgerCommands, planning, reversal, handoff, proposals, resolutions, imports]

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
  return executeCommand(env, actor, body)
}

async function executeCommand(env: Bindings, actor: Actor, body: any, automaticReport = false): Promise<Response> {
  // FLOOR-004 retains its explicit production authoring authority. Operators
  // and other readers never recover a rework rate from a prior command replay.
  const respond = (body: any) => json(scopeOf(actor).costs && body?.result ? { ...body, result: redactCosts(body.result) } : Array.isArray(body?.result?.labor) && !readsWages(actor, body.result) ? { ...body, result: withoutWages(body.result) } : body)
  // Cron identities contain colons, outside the public command alphabet.
  // A client can never reserve or replay a scheduler command identity.
  const { commandId, type, payload = {} } = body ?? {}
  if (typeof commandId !== 'string' || !(automaticReport ? /^cron:report:[-a-f0-9]{36}:\d{4}-\d{2}-\d{2}$/ : /^[-a-zA-Z0-9_]{8,100}$/).test(commandId) || typeof type !== 'string') throw new Problem('COMMAND', 'Send a unique commandId and a command type.', null, 400)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Problem('INPUT', 'The payload must be an object.', null, 400)
  rejectStockClassification(type, payload)
  if (actor.role === 'viewer') forbidden('Viewers can read but not change records.')
  if (type.startsWith('audit.')) forbidden('The audit is append-only: no role, including the owner, edits or deletes an entry.')
  if (['role.set', 'role.assign', 'member.scope'].includes(type) && actor.role === 'owner') {
    const target = await env.DB.prepare('SELECT role FROM oa_operators WHERE id=?').bind(payload.operatorId).first<{ role: string }>()
    if (!target) fail('NOT_FOUND', 'Choose an invited person.')
    if (target!.role === 'owner') fail('OWNER_ROLE', 'The owner keeps owner authority.')
  }
  if (type.startsWith('variance.') && actor.role !== 'owner') forbidden('Only the owner may review model evidence or authorize a run.')
  if (type === 'business.save' && actor.role !== 'owner') forbidden('Only the owner configures the business identity.')
  gateCommand(actor, type, payload)
  if (['so.review', 'so.reviewClear'].includes(type) && isScoped(actor)) forbidden('Costed quote preparation requires unrestricted commercial and location access.')
  if ((type.startsWith('costing.') || type.startsWith('reports.')) && !costingReaders.includes(actor.role)) forbidden('Only accounts or managers may use costing.')
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
  if (type.startsWith('reports.') && actor.role !== 'owner') forbidden('Only the owner manages report schedules.')
  const reportAuthority = type === 'reports.run' ? await liveReportOwner(env.DB, payload.scheduleId, automaticReport) : undefined
  const digest = sha256(canonicalJson({ type, payload }))
  const previous = await saved(env.DB, commandId, digest, actor)
  if (previous) {
    // A recorded outcome that names a location the member has since lost stays closed to them.
    if (scopeOf(actor).locations !== null && names(previous, hiddenLocations(await load(env.DB), scopeOf(actor)))) forbidden('This outcome involves a location outside your location scope.')
    return respond(previous)
  }
  let erasure = ['erasure.audit', 'erasure.contact', 'erasure.operator'].includes(type) ? await erasurePlan(env.DB, await load(env.DB), actor, payload) : undefined
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
    if (['erasure.contact', 'erasure.operator'].includes(type)) erasure = await contactOutcomes(env.DB, await erasurePlan(env.DB, before, actor, payload))
    if (blindSessions(s, actor).length && type !== 'count.submit') forbidden('Finish your assigned blind count before using other commands.')
    const c: Context = { s, actor, commandId, type, now: commandTime(), attachments: [], reportAuthority, automaticReport, ...((type === 'proposal.prepare' || type === 'proposal.approve' || type.startsWith('approval.') || ['po.approve', 'count.approve', 'count.reject', 'so.confirm', 'so.changeApprove', 'quality.release', 'quarantine.decide', 'nonconformance.release', 'nonconformance.reject', 'lot.dispose', 'nonconformance.deviation.approve', 'supply.change.approve', 'po.tolerance'].includes(type) || type.startsWith('schedule.') || type === 'nest.import' || type === 'so.review' || type.startsWith('replenishment.') || ['maintenance.create','maintenance.update','maintenance.release','wo.operation.pause','wo.operation.resume','wo.operation.progress','wo.operation.complete','po.revise','po.confirm','order.rank','work.expected'].includes(type)) ? { people: (await people(env, actor)).people as any } : {}) }
    if (erasure) c.erasure = erasure
    enforcePayload(c, payload)
    if (type === 'import.undo') enforceRetention(before, s, payload.importId)
    let result: Row | undefined = roleCommand(c, type, payload)
    for (const handle of handlers) { if (result !== undefined) break; result = handle(c, type, payload) }
    if (result === undefined) fail('COMMAND', 'Unknown command type.')
    recordStockClassification(c, before, type, payload, result!)
    recordAccessClassification(c, before, type, result!)
    enforceScope(c, before)
    if (!c.people && s.schedulePolicies.length && recoveryInputsChanged(before, s)) c.people = (await people(env, actor)).people as any
    observeRecovery(c, before, type, payload)
    observeFollowUps(c)
    voidBatchReviews(c)
    enforceRetention(before, s, undefined, type)
    cutoverGuard(before, s, c.now)
    const audit = auditEntries(c, before, type, payload, type.startsWith('import.'))
    if (type === 'import.commit' || type === 'import.undo') {
      await publishImport(env, c, before, type, digest, result!, audit)
      return respond((await saved(env.DB, commandId, digest, actor)) ?? fail('IMPORT_PUBLICATION', 'The import did not finish. Send the same command again to resume it.'))
    }
    try {
      const recorded = await commit(env.DB, c, before, type, digest, result, audit, erasure)
      if (type === 'variance.run') return respond(await finishVariance(env, actor, result!))
      if (c.serviceSecret) return respond({ ...recorded, result: { ...result, serviceCredential: c.serviceSecret } })
      return respond(recorded)
    }
    catch (error) {
      const replay = await saved(env.DB, commandId, digest, actor)
      if (replay) return respond(replay)
      if ((await load(env.DB)).version !== before.version && attempt < 7) continue
      // Native membership changes do not bump the domain version. Recompute
      // the event as a review proposal if its delegated authorizer was revoked.
      if (/CHECK constraint failed/.test(String((error as Error)?.message ?? '')) && newBookings(c,before).some(b=>b.automatic) && attempt < 7) continue
      const message = String((error as Error)?.message ?? '')
      if (reportAuthority) await liveReportOwner(env.DB, payload.scheduleId, automaticReport)
      if (/oversold|reserved_stock|negative_stock/.test(message)) fail('DEPENDENCY', 'Stock changed underneath this action. Reload and try again.')
      if (/CHECK constraint failed/.test(message) && (await env.DB.prepare(`SELECT CASE WHEN (${authority(actor).sql}) THEN 1 ELSE 0 END AS ok`).bind(...authority(actor).params).first<{ ok: number }>())?.ok !== 1) throw new Problem('AUTH', 'Your session or role changed. Sign in again.', null, 401)
      throw error
    }
  }
  return fail('BUSY', 'Records changed repeatedly. Send the same command again.')
}

// Trusted Worker cron only: no HTTP route accepts a scheduled actor. The
// original session reference grants no authority beyond its live native owner.
async function liveReportOwner(db: D1Database, scheduleId: string, automatic: boolean): Promise<Actor> {
  if (typeof scheduleId !== 'string' || !scheduleId) fail('INPUT', 'Choose a report schedule.')
  const binding = await db.prepare('SELECT actor FROM larder_report_sessions WHERE schedule_id=?').bind(scheduleId).first<{ actor: string }>()
  if (!binding) throw new Problem('AUTH', 'This schedule needs fresh owner consent.', null, 401)
  const actor: Actor = JSON.parse(binding.actor), fence = authority(actor)
  const live = await db.prepare(`SELECT 1 AS ok FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id WHERE s.id=? AND o.role='owner' AND (${fence.sql}) ${automatic ? "AND s.kind IN ('native','oidc','password')" : ''}`).bind(actor.sessionId, ...fence.params).first<{ ok: number }>()
  if (actor.role !== 'owner' || !live) throw new Problem('AUTH', 'The consenting native owner session is no longer active. Create a new schedule after signing in.', null, 401)
  return actor
}

export async function runDueReports(original: Bindings): Promise<void> {
  const env = runtimeBindings(original), today = commandTime().slice(0, 10)
  const due = (await load(env.DB)).reportSchedules.filter(r => r.status === 'active' && r.consent?.by === r.ownerId && r.nextDate <= today)
  const failures: unknown[] = []
  for (const r of due) {
    try {
      const actor = await liveReportOwner(env.DB, r.id, true)
      await executeCommand(env, actor, { commandId: `cron:report:${r.id}:${today}`, type: 'reports.run', payload: { scheduleId: r.id, version: r.version } }, true)
    } catch (error) {
      // A stopped session or a concurrent cancellation has no new consequence.
      // Unexpected failures surface after other due schedules have been tried.
      if (!(error instanceof Problem && ['AUTH', 'STATE', 'STALE', 'FORBIDDEN'].includes(error.code))) failures.push(error)
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Scheduled report generation failed.')
}

export async function larderResponse(request: Request, original: Bindings): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/larder/')) return null
  try {
    const env = runtimeBindings(original), actor = await current(request, env)
    const path = url.pathname.slice('/api/larder'.length)
    if (request.method === 'POST' && path === '/commands') return await command(env, actor, request)
    if (path !== '/state' && blindSessions(await load(env.DB), actor).length) forbidden('Downloads are unavailable during your assigned blind count.')
    if (request.method === 'POST' && path === '/archive/migrate-aud') return json(await migrateAudArchive(env, actor, request))
    if (request.method === 'POST' && path === '/archive/restore') return json(await restore(env, actor, request))
    if (request.method !== 'GET') throw new Problem('METHOD', 'Use GET to read or POST /api/larder/commands to act.', null, 405)
    const ok = await env.DB.prepare(`SELECT CASE WHEN (${authority(actor).sql}) THEN 1 ELSE 0 END AS ok`).bind(...authority(actor).params).first<{ ok: number }>()
    if (ok?.ok !== 1) throw new Problem('AUTH', 'Your session or role changed. Sign in again.', null, 401)
    const versionedResource = /^\/v1\/(catalog|orders|operations|trace)$/.exec(path)
    if (versionedResource) return json(publicPage(await load(env.DB), actor, versionedResource[1], url.searchParams))
    if (path === '/retention/operator') return json(await operatorRetentionPreview(env.DB, await load(env.DB), actor, url.searchParams.get('operatorId')))
    if (path === '/retention/contact') return json(retentionPreview(await load(env.DB), actor, url.searchParams.get('partyId'), commandTime()))
    if (path === '/state') { const s = await load(env.DB); return json(stateView(s, actor, await people(env, actor))) }
    // GOV-001: a scoped member reads these through their scope (see scope-view.ts); the audit, archive, handoff,
    // imports and attachment doors need an unscoped person.
    const scope = scopeOf(actor), scoped = isScoped(actor), read = async <T>(compute: (s: any) => T | Promise<T>) => scopedRead(await load(env.DB), scope, compute)
    if (scoped && (path.startsWith('/audit') || path.startsWith('/archive') || path.startsWith('/handoffs/') || path.startsWith('/imports/'))) forbidden('This download needs an unscoped owner or manager.')
    const sourcePath = /^\/costing\/explanations\/([^/]+)\/sources\/([^/]+)$/.exec(path)
    if (sourcePath) {
      if (actor.role !== 'owner') forbidden('Only the owner may read model source snapshots.')
      const analysis = get(await load(env.DB), 'varianceAnalyses', sourcePath[1])
      const source = analysis.evidence.sources.find((s: any) => s.key === decodeURIComponent(sourcePath[2]))
      if (!source) fail('NOT_FOUND', 'That cited source was not found.')
      return json(source)
    }
    if (/^\/costing\/(margins|variances|performance|wip)(\.csv)?$/.test(path)) {
      if (!costingReaders.includes(actor.role)) forbidden('Only accounts or managers may read cost reports.')
      const report = await read(s => path.startsWith('/costing/wip') ? wipReport(s, url.searchParams) : path.startsWith('/costing/margins') ? marginReport(s, url.searchParams) : path.startsWith('/costing/performance') ? performanceReport(s,url.searchParams) : varianceReport(s, url.searchParams))
      return path.endsWith('.csv') ? new Response(reportCsv(report), { headers: { ...headers, 'content-type':'text/csv; charset=utf-8', 'content-disposition':'attachment; filename="larder-costs.csv"' } }) : json(report)
    }
    if (path === '/scheduling/labor-costs') {
      if (!rateReaders.includes(actor.role) || scope.costs) forbidden('Only accounts or authorized managers may read wage-based costing evidence.')
      return json({ basis: 'Recorded operation time; not payroll or posted accounting cost.', rows: await read(s => laborCosts(s)), entries: await read(s => timeCosts(s)) })
    }
    if (path === '/scheduling/finite') {
      const named = await people(env, actor)
      return json(await read(s => finitePlan(s, named.people as any, url.searchParams.get('asOf') ?? new Date().toISOString(), Number(url.searchParams.get('days') ?? 14))))
    }
    if (path === '/purchasing/quotes') return json(await read(s => supplierQuotes(s, url.searchParams.get('itemId') ?? '', url.searchParams.get('quantity') ?? '', url.searchParams.get('requiredBy') ?? '', new Date().toISOString().slice(0, 10))))
    if (path === '/configurations/resolve') return json(await read(s => resolveFor(s, url.searchParams.get('itemId') ?? '', JSON.parse(url.searchParams.get('selection') ?? '{}'))))
    if (path === '/planning/materials') return json(await read(s => materialDates(s)))
    if (path === '/planning/pegging') return json(await read(s => materialPegging(s, url.searchParams)))
    if (path === '/planning/supply-changes') return json(await read(s => supplyChanges(s)))
    // FLOOR-008: resolve a scanned code, checked against the receipt, issue or pick it is for; never moves stock.
    if (path === '/scan') return json(await read(s => resolveScan(s, url.searchParams.get('code') ?? '', url.searchParams.get('use') || undefined, url.searchParams.get('id') ?? '', new Date().toISOString().slice(0, 10))))
    // TRACE-002 serial search: a scoped member never sees a serial or record outside their locations.
    if (path === '/serials') {
      const all = await load(env.DB), seen = scope.locations === null ? undefined : visibleState(all, scope)
      const found = serialSearch(all, url.searchParams.get('q') ?? '', url.searchParams.get('itemId') ?? '').filter(r => !seen?.hidden.has(r.lotId))
      return json(seen ? stubHidden(found, seen.hidden) : found)
    }
    const trace = /^\/lots\/([-0-9a-f]{36})\/trace(\.csv)?$/.exec(path)
    if (trace) {
      const all = await load(env.DB), seen = scope.locations === null ? undefined : visibleState(all, scope)
      if (seen) refuseHidden(trace[1], seen.hidden)
      let result: any = lotTrace(all, trace[1], url.searchParams.get('direction') ?? 'upstream')
      if (seen) result = stubHidden(result, seen.hidden)
      if (scope.costs) result = redactCosts(result)
      return trace[2] ? new Response(traceCsv(result), { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="larder-lot-trace.csv"' } }) : json(result)
    }
    const recallDownload = /^\/recalls\/([-0-9a-f]{36})\.json$/.exec(path)
    if (recallDownload) {
      // Recall or containment touching an out-of-scope lot or customer is refused to a scoped member.
      const all = await load(env.DB), pack = recallPack(all, recallDownload[1])
      if (scope.locations !== null) refuseHidden(pack, visibleState(all, scope).hidden)
      return json(scope.costs ? redactCosts(pack) : pack)
    }
    if (path === '/audit') return json(await auditQuery(env.DB, actor, url.searchParams))
    if (path === '/audit.json') return new Response(JSON.stringify(await auditExport(env.DB, actor, url.searchParams)), { headers: { ...headers, 'content-type': 'application/json', 'content-disposition': 'attachment; filename="larder-audit.json"' } })
    if (path === '/audit.csv') return new Response(auditCsv((await auditExport(env.DB, actor, url.searchParams)).entries), { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="larder-audit.csv"', 'x-audit-retention': retentionLine } })
    if (path === '/archive') return json(await archive(env, actor))
    if (path === '/archive.csv') return new Response(archiveCsv(await archive(env, actor)), { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="larder-archive.csv"' } })
    if (path === '/history') return json(await read(s => s.sourceHistory.filter((r: any) => historyMatches(r, url.searchParams.get('q') ?? ''))))
    if (path === '/catalog.csv') {
      if (!['owner', 'manager', 'buyer', 'production', 'engineer'].includes(actor.role)) forbidden('Only catalog managers, buyers or engineers export the catalog.')
      return new Response(catalogCsv(await scopedState(await load(env.DB), scope)), { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="larder-catalog.csv"' } })
    }
    if (path === '/boms.csv') {
      if (!['owner', 'manager', 'production', 'engineer'].includes(actor.role)) forbidden('Only manufacturing engineers or managers export BOMs.')
      return new Response(bomCsv(await scopedState(await load(env.DB), scope)), { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="larder-boms.csv"' } })
    }
    const certificateDownload = /^\/shipments\/([-0-9a-f]{36})\/certificates\.json$/.exec(path)
    if (certificateDownload) {
      const all = await load(env.DB), seen = scope.locations === null ? undefined : visibleState(all, scope)
      if (seen) refuseHidden(certificateDownload[1], seen.hidden)
      const pack = await certificatePack(env.DB, all, certificateDownload[1]), shown = seen ? stubHidden(pack, seen.hidden) : pack
      return json(scope.costs ? redactCosts(shown) : shown)
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
      const financialState = await load(env.DB)
      const financialFile = names([...financialState.marginCharges, ...financialState.jobCharges, ...financialState.costValuations, ...financialState.purchaseOrders.flatMap(o => [o.bills, o.landedCharges, ...(o.supplierClaims ?? []).map((r: any) => r.credits)])], new Set([file[1]]))
      if (financialFile && (!costingReaders.includes(actor.role) || scope.costs)) forbidden('This evidence requires unrestricted costing authority.')
      // A supplier's bill is a cost document: a member restricted from costs never opens it.
      if (scope.costs && names(financialState.subcontractOrders.map(o => [o.bill, o.bills]), new Set([file[1]]))) forbidden('This evidence requires unrestricted costing authority.')
      const a = await env.DB.prepare('SELECT name,content_type,bytes FROM larder_attachments WHERE id=?').bind(file[1]).first<any>()
      // A scoped member opens only evidence a record they can see names.
      if (a && scoped && !names(visibleState(financialState, scope).state, new Set([file[1]]))) forbidden('This evidence belongs to records outside your scope.')
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
