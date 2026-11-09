// Versioned native-session reads reuse the app's current permission-filtered view.
import { fail, Problem } from './problem'
import { materialPegging } from './material-pegging'
import { scopeOf } from './scope'
import { visibleState, restrictedFigure } from './scope-view'
import { redactCosts } from './scope-cost'
import { attachmentAllowed } from './attachments'
import type { Actor, State } from './model'
import { stateView } from './view'

const resources = { catalog: 'items', orders: 'salesOrders', operations: 'workOrders', trace: 'lots' } as const
export function publicPage(s: State, actor: Actor, resource: string, params: URLSearchParams) {
  if (!(Object.hasOwn(resources, resource))) fail('NOT_FOUND', 'Unknown versioned resource.')
  const rawLimit = params.get('limit') ?? '50'
  if (!/^[1-9]\d{0,2}$/.test(rawLimit) || Number(rawLimit) > 100) fail('INPUT', 'limit must be a whole number from 1 to 100.')
  const limit = Number(rawLimit)
  let offset = 0
  if (params.has('cursor')) {
    let cursor: any
    try { cursor = JSON.parse(atob(params.get('cursor')!)) } catch { fail('INPUT', 'Invalid page cursor.') }
    if (!cursor || typeof cursor !== 'object' || cursor.resource !== resource || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0 || !Number.isSafeInteger(cursor.version)) fail('INPUT', 'Invalid page cursor.')
    if (cursor.version !== s.version) fail('STALE', 'Records changed between pages. Restart from the first page.')
    offset = cursor.offset
  }
  const view = stateView(s, actor, {}) as Record<string, any>
  const rows = [...view[resources[resource as keyof typeof resources]]].sort((a, b) => a.id.localeCompare(b.id))
  if (offset > rows.length) fail('INPUT', 'Invalid page cursor.')
  return { apiVersion: '1', version: s.version, data: rows.slice(offset, offset + limit), nextCursor: offset + limit < rows.length ? btoa(JSON.stringify({ resource, version: s.version, offset: offset + limit })) : null }
}

// Detail links are selected exclusively from the same records the native screen
// exposes. A movement is immutable: sequence is its ledger revision, not a
// fabricated editable-record version. An output uses its containing job version.
const detailCollections = { receipts: 'receipts', outputs: 'workOrders', shipments: 'shipments', lots: 'lots', movements: 'movements', purchases: 'purchaseOrders', orders: 'salesOrders', work: 'workOrders' } as const
type DetailKind = keyof typeof detailCollections
type Link = { kind: DetailKind; id: string; version: number; href: string }
const detailHref = (kind: DetailKind, id: string) => `/api/larder/v1/resources/${kind}/${encodeURIComponent(id)}`

export function publicDetail(s: State, actor: Actor, kind: string, id: string) {
  const view = stateView(s, actor, {}) as Record<string, any>
  const visibleMovements = new Set(view.movements.map((m: any) => m.id))
  const exactWork = (id: string) => !s.movements.some(m => m.documentKind === 'workOrders' && m.documentId === id && !visibleMovements.has(m.id))
  const rows = (k: DetailKind): any[] => k === 'outputs'
    ? view.workOrders.filter((w: any) => exactWork(w.id)).flatMap((w: any) => (w.outputs ?? []).map((o: any) => ({ ...o, workOrderId: w.id, version: w.version })))
    : view[detailCollections[k]]
  const find = (k: DetailKind, key: string) => {
    if (typeof key !== 'string' || !key) return undefined
    // Native order summaries can include received or shipped quantities from
    // other sites. Never turn such a summary into an exact detail resource.
    if (k === 'work' && !exactWork(key)) return undefined
    if (k === 'purchases' && s.receipts.some(r => r.poId === key && !view.receipts.some((v: any) => v.id === r.id))) return undefined
    if (k === 'orders' && s.shipments.some(r => r.orderId === key && !view.shipments.some((v: any) => v.id === r.id))) return undefined
    return rows(k).find(r => r.id === key)
  }
  if (!Object.hasOwn(detailCollections, kind)) throw new Problem('NOT_FOUND', 'No such resource.', null, 404)
  const selectedKind = kind as DetailKind, data = find(selectedKind, id)
  // No echo of the requested identifier and no distinct hidden-record error.
  if (!data) throw new Problem('NOT_FOUND', 'No such resource.', null, 404)
  const link = (k: DetailKind, r: any): Link => ({ kind: k, id: r.id, version: k === 'movements' ? r.sequence : r.version, href: detailHref(k, r.id) })
  const links = new Map<string, Link>(), records: any[] = [data]
  const add = (k: DetailKind, key: string) => {
    const r = find(k, key)
    if (!r) return
    const l = link(k, r)
    if (!links.has(l.href)) { links.set(l.href, l); records.push(r) }
    return l
  }
  const physicalLots = new Map<string, Link>(), physicalMovements = new Map<string, Link>()
  const allocations = new Map<string, { output: Link; movement: Link; lot?: Link; quantity: string }>()
  const lot = (key: string) => { const l = add('lots', key); if (l) physicalLots.set(l.id, l) }
  const allocated = (output: any) => {
    const report = add('outputs', output.id)
    if (!report) return
    for (const a of output.allocations ?? []) {
      const source = add('movements', a.movementId)
      if (source) allocations.set(`${output.id}:${a.movementId}`, { output: report, movement: source, lot: add('lots', a.lotId), quantity: a.quantity })
    }
  }
  const movement = (key: string) => {
    const m = find('movements', key), l = add('movements', key)
    if (!m || !l) return
    physicalMovements.set(l.id, l); lot(m.lotId)
    const k = ({ receipts: 'receipts', workOrders: 'work', shipments: 'shipments' } as const)[m.documentKind as 'receipts' | 'workOrders' | 'shipments']
    if (k) add(k, m.documentId)
  }
  if (selectedKind === 'receipts') {
    add('purchases', data.poId)
    for (const l of data.lines) { lot(l.lotId); movement(l.movementId) }
  }
  if (selectedKind === 'shipments') {
    add('orders', data.orderId)
    for (const m of view.movements.filter((m: any) => m.documentKind === 'shipments' && m.documentId === id)) movement(m.id)
  }
  if (selectedKind === 'outputs' || selectedKind === 'work') {
    const job = selectedKind === 'work' ? data : find('work', data.workOrderId)
    add('work', job.id)
    for (const o of selectedKind === 'work' ? job.outputs ?? [] : [data]) {
      add('outputs', o.id); lot(o.lotId); movement(o.movementId)
      for (const a of o.allocations ?? []) { lot(a.lotId); movement(a.movementId) }
      allocated(o)
    }
  }
  if (selectedKind === 'lots') {
    lot(id)
    for (const m of view.movements.filter((m: any) => m.lotId === id)) movement(m.id)
    for (const o of rows('outputs').filter(o => o.lotId === id || o.allocations?.some((a: any) => a.lotId === id))) add('outputs', o.id)
  }
  if (selectedKind === 'movements') movement(id)
  if (selectedKind === 'purchases') for (const r of view.receipts.filter((r: any) => r.poId === id)) add('receipts', r.id)
  if (selectedKind === 'orders') for (const r of view.shipments.filter((r: any) => r.orderId === id)) add('shipments', r.id)
  // Follow only recorded per-output allocations to original source files.
  // Legacy job-level ancestry does not authorize a guessed component link.
  const visited = new Set<string>()
  const sourceEvidence = (lotId: string) => {
    if (visited.has(lotId)) return
    visited.add(lotId)
    const r = find('lots', lotId)
    if (!r) return
    add('lots', lotId)
    if (r.source === 'receipt') add('receipts', r.documentId)
    if (r.source === 'production') {
      add('work', r.documentId)
      for (const o of rows('outputs').filter(o => o.lotId === lotId)) {
        add('outputs', o.id)
        allocated(o)
        for (const a of o.allocations ?? []) { add('movements', a.movementId); sourceEvidence(a.lotId) }
      }
    }
    if (r.source === 'opening') { const opening = view.openings.find((o: any) => o.id === r.documentId); if (opening) records.push(opening) }
  }
  for (const l of physicalLots.values()) sourceEvidence(l.id)
  const files = new Map<string, any>()
  const collectFiles = (value: any) => {
    if (!value || typeof value !== 'object') return
    if (typeof value.id === 'string' && typeof value.sha256 === 'string' && typeof value.name === 'string' && attachmentAllowed(s, actor, value.id))
      files.set(value.id, { ...value, href: `/api/larder/attachments/${value.id}` })
    else for (const v of Object.values(value)) collectFiles(v)
  }
  records.forEach(collectFiles)
  const selection = selectedKind === 'receipts' ? ['receipt', id] : selectedKind === 'outputs' ? ['work', data.workOrderId]
    : selectedKind === 'work' ? ['work', id] : selectedKind === 'shipments' ? ['sales', data.orderId]
      : selectedKind === 'orders' ? ['sales', id] : selectedKind === 'purchases' ? ['purchase', id]
        : selectedKind === 'lots' ? ['lot', id] : data.lotId ? ['lot', data.lotId] : null
  let planning: any = null
  if (selection) {
    const query = new URLSearchParams({ kind: selection[0], id: selection[1] })
    const scope = scopeOf(actor), full = materialPegging(s, query)
    // A mixed projection is withheld whole: no hidden edges, stubs or counts,
    // and no misleading partial allocation or aggregate is exposed.
    const seen = scope.locations === null ? full : materialPegging(visibleState(s, scope).state, query)
    planning = JSON.stringify(full) === JSON.stringify(seen) ? full : { version: s.version, asOf: full.asOf, restricted: restrictedFigure }
    if (!planning.restricted) {
      const current = new Map<string, Link>()
      let mixed = false
      const reference = (k: DetailKind, key: string) => {
        const record = find(k, key)
        if (record) { const l = link(k, record); current.set(l.href, l) }
        else mixed = true
      }
      // These links describe the current plan only. They never become recorded
      // consumption, and a mixed-site order or job still has no exact resource.
      for (const r of planning.requirements) {
        if (r.kind === 'sales' || (r.kind === 'dependent' && s.salesOrders.some(o => o.id === r.documentId))) reference('orders', r.documentId)
        if (r.kind === 'work' || (r.kind === 'dependent' && s.workOrders.some(w => w.id === r.documentId))) reference('work', r.documentId)
        for (const source of [...r.sources, ...r.unavailablePurchases]) {
          if (source.kind === 'stock' && source.lotId) reference('lots', source.lotId)
          if (source.kind === 'purchase') reference('purchases', source.documentId)
          if (source.kind === 'work') reference('work', source.documentId)
        }
      }
      // Parent line totals can already include hidden receipts or shipments in
      // both computations. Equal projections alone cannot authorize that money
      // or quantity: every supported source and demand must also be exact.
      planning = mixed ? { version: s.version, asOf: full.asOf, restricted: restrictedFigure }
        : { ...planning, href: `/api/larder/planning/pegging?${query}`, links: [...current.values()] }
    }
    if (scope.costs) planning = redactCosts(planning)
  }
  return { apiVersion: '1', version: s.version, resource: link(selectedKind, data), data,
    links: [...links.values()].filter(l => l.href !== detailHref(selectedKind, id)),
    physical: { basis: 'recorded physical movements and explicit output allocations; not planning pegs', lots: [...physicalLots.values()], movements: [...physicalMovements.values()], allocations: [...allocations.values()] },
    planning, files: [...files.values()] }
}
