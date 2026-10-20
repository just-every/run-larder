// Recorded genealogy. Job ancestry and WIP allocations are not invented batch allocations.
import { format } from './decimal'
import type { Movement, Row, State } from './model'
export type TraceRow = Record<string, string>
export type TraceNode = { id: string; kind: string; label: string; lotId?: string }
export function traceGraph(s: State) {
  const nodes = new Map<string, TraceNode>(), links: TraceRow[] = [], events: TraceRow[] = []
  const node = (id: string, kind: string, label: string, lotId?: string) => { if (!nodes.has(id)) nodes.set(id, { id, kind, label, ...(lotId ? { lotId } : {}) }); return id }
  const lot = (id: string, movementId = '', itemId = '') => id ? node(`lot:${id}`, 'lot', s.lots.find(l => l.id === id)?.code ?? id, id) : node(`untracked:${movementId}`, 'untracked', `Unlotted ${s.items.find(i => i.id === itemId)?.name ?? itemId}`)
  const doc = (kind: string, id: string) => { const r = (s as any)[kind]?.find((r: Row) => r.id === id); return node(`${kind}:${id}`, kind, r?.reference ?? id) }
  const party = (id: string) => node(`party:${id}`, 'party', s.parties.find(p => p.id === id)?.name ?? id)
  const link = (id: string, from: string, to: string, data: TraceRow) => links.push({ recordType: 'relation', id, from, to, ...data })
  const document = (kind: string, id: string): TraceRow => {
    const r = (s as any)[kind]?.find((r: Row) => r.id === id), order = r?.orderId ? s.salesOrders.find(o => o.id === r.orderId) : r?.poId ? s.purchaseOrders.find(o => o.id === r.poId) : undefined
    const owner = s.parties.find(p => p.id === (r?.supplierId ?? order?.supplierId ?? order?.customerId ?? r?.customerId))
    return { documentKind: kind, documentId: id, reference: r?.reference ?? '', orderReference: order?.reference ?? '', party: owner?.name ?? '' }
  }
  const measure = (itemId: string, quantity: string): TraceRow => ({ itemId, unit: s.items.find(i => i.id === itemId)?.baseUnit ?? '', quantity })
  const effective = (m: Movement) => m.quantity + s.movements.filter(r => r.reversesId === m.id).reduce((n, r) => n + r.quantity, 0n)
  for (const l of s.lots) {
    lot(l.id)
    if (l.source === 'customer-custody') link(`property:${l.id}`, party(l.ownerId), lot(l.id), { basis: 'customer-owned intake', date: l.createdAt, ...measure(l.itemId, ''), lotId: l.id })
  }
  for (const m of s.movements.filter(m => !m.reversesId)) {
    const data = { ...measure(m.itemId, format(m.quantity < 0n ? -m.quantity : m.quantity)), netQuantity: format(effective(m) < 0n ? -effective(m) : effective(m)), date: m.createdAt, movementId: m.id, ...document(m.documentKind, m.documentId) }
    if (m.documentKind === 'workOrders' && s.workOrders.find(w => w.id === m.documentId)?.traceAllocationVersion && ['issue', 'output'].includes(m.kind)) continue
    if ((m.documentKind === 'workOrders' && ['issue', 'output'].includes(m.kind)) || m.documentKind === 'reworkOrders') {
      if (!['issue', 'output', 'rework-source', 'repair-output', 'recovered-component'].includes(m.kind)) continue
      const a = lot(m.lotId, m.id, m.itemId), b = doc(m.documentKind, m.documentId)
      link(`movement:${m.id}`, m.quantity < 0n ? a : b, m.quantity < 0n ? b : a, { ...data, basis: m.documentKind === 'workOrders' ? 'job-level ancestry; component lots per output batch not recorded' : 'recorded repair/unbuild', kind: m.kind, allocationBasis: m.documentKind === 'workOrders' ? 'job' : 'record' })
    } else if (m.kind === 'receipt' || m.kind === 'opening') {
      const d = doc(m.documentKind, m.documentId)
      link(`movement:${m.id}`, d, lot(m.lotId, m.id, m.itemId), { ...data, kind: m.kind, basis: 'physical ingress' })
    } else if (m.kind === 'shipment') {
      link(`movement:${m.id}`, lot(m.lotId, m.id, m.itemId), doc('shipments', m.documentId), { ...data, kind: m.kind, basis: 'physical shipment' })
    } else if (m.kind === 'return') {
      link(`movement:${m.id}`, doc('returns', m.documentId), lot(m.lotId, m.id, m.itemId), { ...data, kind: m.kind, basis: 'physical customer return' })
    }
  }
  for (const r of s.receipts) {
    const po = s.purchaseOrders.find(p => p.id === r.poId)
    if (po) { link(`receipt:${r.id}`, doc('purchaseOrders', po.id), doc('receipts', r.id), { ...document('receipts', r.id), date: r.createdAt, basis: 'purchase reference' }); link(`supplier:${r.id}`, party(po.supplierId), doc('purchaseOrders', po.id), { date: po.createdAt, basis: 'supplier' }) }
  }
  for (const sh of s.shipments) {
    const so = s.salesOrders.find(o => o.id === sh.orderId)
    if (so && sh.shippedAt) { link(`sales:${sh.id}`, doc('shipments', sh.id), doc('salesOrders', so.id), { ...document('shipments', sh.id), date: sh.shippedAt, basis: 'sales order' }); link(`customer:${sh.id}`, doc('salesOrders', so.id), party(so.customerId), { date: sh.shippedAt, basis: 'customer' }) }
  }
  for (const r of s.returns) for (const source of r.sources ?? []) {
    const m = s.movements.find(m => m.id === source.shipmentMovementId)
    if (m) link(`return:${source.returnMovementId}`, doc('shipments', m.documentId), doc('returns', r.id), { ...document('returns', r.id), ...measure(r.itemId, source.quantity), date: r.createdAt, basis: 'recorded shipment-return allocation', movementId: source.returnMovementId })
  }
  for (const t of s.workTransfers) for (const [i, a] of t.transfers.entries()) {
    const from = doc('workOrders', a.sourceId), to = doc('workOrders', a.destinationId), w = s.workOrders.find(w => w.id === a.sourceId)!
    const data = { ...document('workTransfers', t.id), date: t.createdAt, basis: 'recorded WIP responsibility; not a physical movement', kind: t.kind }
    link(`wip:${t.id}:${i}`, from, to, { ...data, ...measure(w.itemId, a.quantity) })
    a.components.forEach((c: any, j: number) => link(`wip:${t.id}:${i}:component:${j}`, from, to, { ...data, ...measure(c.itemId, c.quantity), value: c.cost, kind: 'component WIP allocation' }))
  }
  for (const w of s.workOrders) for (const [i, o] of (w.outputs ?? []).entries()) {
    const batch = o.allocations ? node(`productionBatch:${o.id}`, 'production batch', `${w.reference} · ${s.lots.find(l => l.id === o.lotId)?.code ?? 'unlotted / scrap report'}`) : doc('workOrders', w.id)
    const data = { ...document('workOrders', w.id), date: o.at, allocationBasis: o.allocations ? 'batch' : 'job', basis: o.allocations ? 'recorded exact component-lot consumption' : 'job-level ancestry; component lots per output batch not recorded' }
    if (o.allocations) {
      link(`batch:job:${o.id}`, doc('workOrders', w.id), batch, { ...data, basis: 'production job reference' })
      for (const [j, a] of o.allocations.entries()) link(`batch:input:${o.id}:${j}`, lot(a.lotId, a.movementId, a.itemId), batch, { ...data, ...measure(a.itemId, a.quantity), movementId: a.movementId, lotId: a.lotId, kind: 'component consumed' })
      if (o.movementId) link(`batch:output:${o.id}`, batch, lot(o.lotId, o.movementId, w.itemId), { ...data, ...measure(w.itemId, o.good), movementId: o.movementId, lotId: o.lotId, kind: 'output' })
    }
    events.push({ recordType: 'event', id: `production:${w.id}:${i}`, from: batch, ...data, ...measure(w.itemId, o.good), scrap: o.scrap, kind: 'production report' })
  }
  for (const o of s.subcontractOrders) for (const r of o.receipts) {
    const id = node(`subcontractReceipt:${r.id}`, 'subcontract receipt', `${o.reference} · ${s.lots.find(l => l.id === r.lotId)?.code ?? 'scrap'}`)
    const data = { ...document('subcontractOrders', o.id), date: r.at, basis: 'recorded subcontract receipt', kind: 'subcontract', ownership: o.customerId ? 'customer property' : 'owned' }
    link(`subcontract:supplier:${r.id}`, party(o.supplierId), id, { ...data, basis: 'subcontract supplier' })
    for (const [i, input] of r.inputs.entries()) link(`subcontract:input:${r.id}:${i}`, lot(input.lotId), id, { ...data, ...measure(input.itemId, input.quantity), movementId: input.movementId, lotId: input.lotId })
    if (r.lotId) link(`subcontract:output:${r.id}`, id, lot(r.lotId), { ...data, ...measure(o.itemId, r.good), lotId: r.lotId })
    events.push({ recordType: 'event', id: `subcontract:report:${r.id}`, from: id, ...data, ...measure(o.itemId, r.good), scrap: r.scrap, value: r.outputValue, scrapValue: r.scrapValue })
  }
  for (const w of s.reworkOrders.filter(w => w.executedAt)) events.push({ recordType: 'event', id: `rework:report:${w.id}`, from: doc('reworkOrders', w.id), ...document('reworkOrders', w.id), date: w.executedAt, kind: w.kind, basis: 'recorded cost allocation; scrap value is not a physical quantity', scrapValue: w.cost.scrap })
  return { nodes, links, events, document }
}
