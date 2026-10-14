// The Odoo move-in kit's commands: preview (a dry run that writes only the
// review record), commit (published through Base's import kit, which journals
// the job and keeps the original files) and undo (refused once later work
// depends on what was moved in).
import type { Bindings } from '../../auth.server'
import { applyD1ImportBatches, canonicalJson, createD1ImportJob, planD1Import, sha256, undoD1Import, type D1ImportContext, type D1Sql, type D1TargetAdapter, type SourceBundle, type TargetRow } from '../../modules/import-kit/src/d1/index'
import { fail } from '../problem'
import { allow, approver } from '../roles'
import { authority, load } from '../storage'
import { valuationBases } from '../warehouse'
import { collections, bump, date, fresh, get, list, oneOf, row, text, type Context, type Row, type State } from '../model'
import { applyPlan } from './apply'
import { mapOdoo, type OdooFile } from './map'

export const MAPPING = 'odoo-import-compatible-1'
const LIMIT = 1536 * 1024

const unitsBefore = (s: State) => Object.assign({}, ...s.imports.filter(i => i.status === 'committed').map(i => i.plan.units))
const counts = (plan: any) => ({ contacts: plan.parties.length, products: plan.items.length, locations: plan.locations.length, boms: plan.boms.length, openingLines: plan.openings.reduce((n: number, o: any) => n + o.lines.length, 0), salesOrders: plan.salesOrders.length, purchaseOrders: plan.purchaseOrders.length })

function preview(c: Context, p: any) {
  const files: OdooFile[] = list(p.files, 'files', 8).map((f: any) => ({ name: text(f.name, 'file name', 200), model: f.model, content: typeof f.content === 'string' ? f.content : fail('INPUT', 'Each file needs its CSV text.') }))
  const size = files.reduce((n, f) => n + new TextEncoder().encode(f.content).length, 0)
  if (size > LIMIT) fail('KIT_SIZE', 'A move-in batch is limited to 1.5 MiB of CSV. Move in master data and open orders in separate batches.')
  const plan = mapOdoo(c.s, files, unitsBefore(c.s))
  const opening = plan.openings.length ? { countedOn: date(p.opening?.countedOn, 'count date'), valuationBasis: oneOf(p.opening?.valuationBasis, valuationBases, 'valuation basis'), countedBy: text(p.opening?.countedBy, 'counted by', 120) } : null
  const described = files.map(f => { const bytes = new TextEncoder().encode(f.content); const meta = plan.files.find(x => x.name === f.name)!; return { name: f.name, model: meta.model, rows: meta.rows, sha256: sha256(bytes), size: bytes.length, content: f.content } })
  return row(c, 'imports', { label: text(p.label, 'label', 200), kit: 'odoo', mappingVersion: MAPPING, files: described, opening, plan, fingerprint: sha256(canonicalJson(plan)), counts: counts(plan), rejected: plan.rejected, skipped: plan.skipped, unsupported: plan.unsupported, status: 'previewed', preparedBy: c.actor.id })
}

function snapshot(before: State, after: State, importId: string) {
  const created: { kind: string; id: string; version: number }[] = [], changed: { kind: string; data: Row }[] = []
  for (const kind of collections) for (const r of after[kind]) {
    const old = before[kind].find(x => x.id === r.id)
    if (!old) created.push({ kind, id: r.id, version: r.version })
    else if (r.id !== importId && JSON.stringify(old) !== JSON.stringify(r)) changed.push({ kind, data: old })
  }
  return { created, changed, changedVersions: changed.map(x => ({ kind: x.kind, id: x.data.id, version: after[x.kind as (typeof collections)[number]].find(r => r.id === x.data.id)!.version })) }
}

// Anything recorded after the move-in that relies on it blocks undo.
export function undoDependencies(s: State, batch: Row) {
  const created = new Set(batch.created.map((x: any) => x.id)), out: string[] = []
  for (const m of s.movements) if (m.importId !== batch.id && (created.has(m.itemId) || created.has(m.locationId) || created.has(m.documentId))) out.push(`stock movement ${m.kind} (${m.reason})`)
  for (const r of s.reservations) if (created.has(r.demandId) || created.has(r.itemId)) out.push('a reservation on moved-in stock or orders')
  const moved = new Set(s.movements.filter(m => m.importId === batch.id).map(m => m.id))
  for (const h of s.handoffs) if (h.lines.some((l: any) => l.movementIds.some((id: string) => moved.has(id)))) out.push(`${h.reference} handed moved-in stock to the accountant`)
  for (const x of [...batch.created, ...batch.changedVersions]) { const r = s[x.kind as (typeof collections)[number]]?.find(y => y.id === x.id); if (r && r.version !== x.version) out.push(`${r.reference ?? r.sku ?? r.name ?? x.kind} was changed after the move-in`) }
  const refers = (v: unknown): boolean => typeof v === 'string' ? created.has(v) : Array.isArray(v) ? v.some(refers) : !!v && typeof v === 'object' && Object.values(v).some(refers)
  for (const kind of collections) if (kind !== 'imports') for (const r of s[kind]) if (!created.has(r.id) && refers(r)) out.push(`${r.reference ?? r.name ?? kind} refers to moved-in records`)
  return [...new Set(out)]
}

export function imports(c: Context, type: string, p: any): Row | undefined {
  switch (type) {
    case 'import.preview':
      allow(c, ['manager', 'agent'])
      return preview(c, p)
    case 'import.commit': {
      approver(c, ['manager'])
      const batch = get(c.s, 'imports', p.importId, 'move-in'); fresh(batch, p.version)
      approver(c, ['manager'])
      if (batch.status !== 'previewed') fail('STATE', 'Only a previewed move-in can be committed.')
      if (batch.rejected.length && p.acceptRejected !== batch.rejected.length) fail('REVIEW_REJECTED', `${batch.rejected.length} rows were rejected. Review them and confirm they stay out of this move-in.`, { rejected: batch.rejected.length })
      const plan = mapOdoo(c.s, batch.files.map((f: any) => ({ name: f.name, model: f.model, content: f.content })), unitsBefore(c.s))
      if (sha256(canonicalJson(plan)) !== batch.fingerprint) fail('STALE', 'Records changed since this preview. Preview the files again before committing.')
      const before = structuredClone(c.s)
      applyPlan(c, batch, plan)
      const approval = row(c, 'approvals', { subjectKind: 'imports', subjectId: batch.id, subjectVersion: batch.version, decision: 'approved', role: c.actor.role, note: `Committed move-in; ${batch.rejected.length} rejected rows kept out` })
      const snap = snapshot(before, c.s, batch.id)
      return bump(batch, { status: 'committed', approvalId: approval.id, committedBy: c.actor.id, committedAt: c.now, created: snap.created, changed: snap.changed, changedVersions: snap.changedVersions, movementIds: c.s.movements.filter(m => m.importId === batch.id).map(m => m.id) })
    }
    case 'import.undo': {
      approver(c, ['manager'])
      const batch = get(c.s, 'imports', p.importId, 'move-in'); fresh(batch, p.version)
      approver(c, ['manager'])
      if (batch.status !== 'committed') fail('STATE', batch.status === 'restored' ? 'A move-in restored from an archive is ordinary history; correct it with reversals.' : 'Only a committed move-in can be undone.')
      const blocking = undoDependencies(c.s, batch)
      if (blocking.length) fail('DEPENDENCY', 'Work has already been recorded on moved-in data, so the batch cannot simply be removed. Reverse that work first, or correct with reversals and counts.', { blocking })
      return bump(batch, { status: 'undone', undoneBy: c.actor.id, undoneAt: c.now, undoReason: text(p.reason, 'reason', 400) })
    }
  }
}

export function exportBatch(s: State, id: string) {
  const b = get(s, 'imports', id, 'move-in')
  return { label: b.label, kit: b.kit, mappingVersion: b.mappingVersion, status: b.status, files: b.files.map((f: any) => ({ name: f.name, model: f.model, sha256: f.sha256, size: f.size, rows: f.rows })), counts: b.counts, rejected: b.rejected, skipped: b.skipped, unsupported: b.unsupported }
}

// ---- Publication through Base's import kit -------------------------------------
const sql = (q: string, ...params: unknown[]): D1Sql => ({ sql: q, params })
const bigN = (v: bigint) => Number(v)
function groups<T>(rows: T[], limit = 96 * 1024) {
  const out: T[][] = []; let g: T[] = [], bytes = 2
  for (const r of rows) { const n = JSON.stringify(r).length + 1; if (g.length && bytes + n > limit) { out.push(g); g = []; bytes = 2 } g.push(r); bytes += n }
  if (g.length) out.push(g)
  return out
}
const base64 = (bytes: Uint8Array) => { let t = ''; for (const b of bytes) t += String.fromCharCode(b); return btoa(t) }
const pick = (i: number) => `json_extract(v.value,'$[${i}]')`

function writeSql(before: State, after: State): D1Sql[] {
  const records: unknown[][] = []
  for (const kind of collections) for (const r of after[kind]) { const old = before[kind].find(x => x.id === r.id); if (!old || JSON.stringify(old) !== JSON.stringify(r)) records.push([kind, r.id, r.version, JSON.stringify(r)]) }
  const movements = after.movements.slice(before.movements.length).map(m => [m.id, m.sequence, m.itemId, m.locationId, m.status, m.lotId, bigN(m.quantity), bigN(m.unitCost), m.kind, m.documentKind, m.documentId, m.reversesId, m.actorId, m.commandId, m.importId, m.reason, m.createdAt])
  return [
    ...groups(records).map(g => sql(`INSERT INTO larder_records(kind,id,version,data) SELECT ${[0, 1, 2, 3].map(pick).join(',')} FROM json_each(?) v WHERE true ON CONFLICT(kind,id) DO UPDATE SET version=excluded.version,data=excluded.data`, JSON.stringify(g))),
    ...groups(movements).map(g => sql(`INSERT INTO larder_movements SELECT ${Array.from({ length: 17 }, (_, i) => pick(i)).join(',')} FROM json_each(?) v`, JSON.stringify(g))),
  ]
}

export async function publishImport(env: Bindings, c: Context, before: State, type: string, digest: string, batch: Row) {
  const db = env.DB, undo = type === 'import.undo', a = authority(c.actor)
  const response = { ok: true, result: batch, version: before.version + 1 }
  const bookkeeping = () => [
    sql('UPDATE larder_meta SET version=version+1 WHERE id=1'),
    sql('INSERT INTO larder_commands VALUES(?,?,?,?,?,?)', c.commandId, c.actor.id, type, digest, JSON.stringify(response), c.now),
  ]
  const versionGuard = () => sql('(SELECT version FROM larder_meta WHERE id=1)=?+CASE WHEN EXISTS(SELECT 1 FROM larder_commands WHERE id=?) THEN 1 ELSE 0 END', before.version, c.commandId)
  const targets: D1TargetAdapter = {
    async read(database, d, kind, key) {
      const g = await database.prepare('SELECT revision,descriptor FROM larder_import_graphs WHERE id=?').bind(key).first<any>()
      return g ? { destination: d, targetKind: kind, targetId: key, revision: g.revision, value: JSON.parse(g.descriptor) } : undefined
    },
    matches(r, d, k, key) { const parts = targets.matchesParts!(r, d, k, key); return { sql: parts.map(x => `(${x.sql})`).join(' AND '), params: parts.flatMap(x => x.params ?? []) } },
    matchesParts(r, _d, _k, key) {
      return [r ? sql('EXISTS(SELECT 1 FROM larder_import_graphs WHERE id=? AND revision=?)', key, r.revision) : sql('NOT EXISTS(SELECT 1 FROM larder_import_graphs WHERE id=?)', key), versionGuard()]
    },
    write(target) {
      return [...writeSql(before, c.s), sql('INSERT INTO larder_import_graphs VALUES(?,?,?)', target.targetId, target.revision, JSON.stringify(target.value)), ...bookkeeping()]
    },
    remove(_d, _k, key) {
      const created = JSON.stringify(batch.created.map((x: any) => [x.kind, x.id]))
      return [
        sql('INSERT INTO larder_guard VALUES(?,1)', 'import-undo:' + key),
        sql('DELETE FROM larder_movements WHERE import_id=?', key),
        sql("DELETE FROM larder_records WHERE EXISTS(SELECT 1 FROM json_each(?) v WHERE larder_records.kind=json_extract(v.value,'$[0]') AND larder_records.id=json_extract(v.value,'$[1]'))", created),
        ...groups(batch.changed.map((x: any) => [x.kind, x.data.id, x.data.version, JSON.stringify(x.data)])).map(g => sql(`INSERT INTO larder_records(kind,id,version,data) SELECT ${[0, 1, 2, 3].map(pick).join(',')} FROM json_each(?) v WHERE true ON CONFLICT(kind,id) DO UPDATE SET version=excluded.version,data=excluded.data`, JSON.stringify(g))),
        sql("UPDATE larder_records SET version=?,data=? WHERE kind='imports' AND id=?", batch.version, JSON.stringify(batch), key),
        sql('DELETE FROM larder_import_graphs WHERE id=?', key),
        ...bookkeeping(),
        sql('DELETE FROM larder_guard'),
      ]
    },
    async list(database, d) {
      const ids = (await database.prepare('SELECT id FROM larder_import_graphs').all<{ id: string }>()).results, out: TargetRow[] = []
      for (const r of ids) { const v = await targets.read(database, d, 'batch', r.id); if (v) out.push(v) }
      return out
    },
    matchesCount(n) { return sql('(SELECT COUNT(*) FROM larder_import_graphs)=?', n) },
  }
  const context: D1ImportContext = {
    destination: 'larder', namespace: 'odoo', mappingVersion: batch.mappingVersion, operationKey: 'larder:' + batch.id, batchSize: 1000,
    storage: { database: db, targets },
    authorization: { principalId: 'role:' + c.actor.role, predicate: () => ({ sql: a.sql, params: a.params }) },
  }
  if (undo) {
    const job = await db.prepare('SELECT id FROM ik_jobs WHERE operation_key=?').bind(context.operationKey).first<{ id: string }>()
    if (!job) fail('IMPORT_JOURNAL', 'The move-in journal is missing.')
    const done = await undoD1Import(job!.id, context)
    if (done.state !== 'undone') fail('IMPORT_PUBLICATION', 'The undo did not finish. Send the same command again.')
    return
  }
  const pending = await db.prepare('SELECT id FROM ik_jobs WHERE operation_key=?').bind(context.operationKey).first<{ id: string }>()
  if (pending) {
    const done = await applyD1ImportBatches(pending.id, context)
    if (done.state !== 'completed') fail('IMPORT_PUBLICATION', 'The move-in did not finish. Send the same command again.')
    return
  }
  const descriptor = { importId: batch.id, created: batch.created, movementIds: batch.movementIds, commandId: c.commandId }
  // One source entry per original file keeps the bytes, digests and row counts in
  // the kit's custody; the single native effect publishes the whole batch.
  const payload = { fingerprint: batch.fingerprint, files: batch.files.map((f: any) => ({ name: f.name, model: f.model, sha256: f.sha256, rows: f.rows })), counts: batch.counts, rejected: batch.rejected.length }
  const source: SourceBundle = {
    artifacts: batch.files.map((f: any) => ({ name: f.name, sha256: f.sha256, size: f.size, original: { status: 'available', base64: base64(new TextEncoder().encode(f.content)) } })),
    records: [{ namespace: 'odoo', kind: 'larder-batch', sourceId: batch.id, payload, payloadHash: sha256(canonicalJson(payload)), artifactHash: batch.files[0].sha256, location: { artifact: batch.files[0].name, row: 1 } }],
    diagnostics: [],
  }
  const plan = await planD1Import(source, { version: batch.mappingVersion, map: () => ({ effects: [{ targetKind: 'batch', targetId: batch.id, value: descriptor as any }] }) } as any, context)
  context.reviewedFingerprint = plan.fingerprint
  const job = await createD1ImportJob(plan, context)
  const done = await applyD1ImportBatches(job.id, context)
  if (done.state !== 'completed') fail('IMPORT_PUBLICATION', 'The move-in did not finish. Send the same command again.')
}
