// Current indicative material pegs share MRP-001's single allocation pass.
// Reverse lookup never reallocates a PO/lot or invents a work-to-sales link.
import { decimal } from './decimal'
import { materialDates } from './material-dates'
import { get, oneOf, text, type State } from './model'
import { fail } from './problem'

export function materialPegging(s: State, query: URLSearchParams) {
  const kind = oneOf(query.get('kind'), ['item', 'sales', 'work', 'purchase', 'receipt', 'lot', 'forecast'] as const, 'kind')
  const id = text(query.get('id'), 'id', 100), lineId = query.get('lineId')
  const collection = { item: 'items', sales: 'salesOrders', work: 'workOrders', purchase: 'purchaseOrders', receipt: 'receipts', lot: 'lots', forecast: 'forecasts' } as const
  const selected = get(s, collection[kind], id)
  if (lineId !== null) {
    const lines = kind === 'work' ? selected.components : ['sales', 'purchase', 'receipt'].includes(kind) ? selected.lines : null
    if (!lines) fail('INPUT', 'lineId is supported only for sales, work, purchase or receipt selections.')
    if (!lines.some((l: any) => (kind === 'receipt' ? l.lineId : l.id) === lineId)) fail('NOT_FOUND', 'That line was not found on the selected document.')
  }
  const receipts = kind === 'receipt' ? [selected] : kind === 'purchase' ? s.receipts.filter(r => r.poId === id) : []
  const receiptLines = receipts.flatMap(r => r.lines.filter((l: any) => lineId === null || l.lineId === lineId))
  const lots = new Set<string>(kind === 'lot' ? [id] : receiptLines.map((l: any) => l.lotId).filter(Boolean))
  const plan = materialDates(s)
  const matchesDemand = (r: (typeof plan.requirements)[number]) => kind === 'item' ? r.itemId === id
    : ['sales', 'work', 'forecast'].includes(kind) && r.documentId === id && (lineId === null || r.lineId === lineId)
  const matchesSource = (source: (typeof plan.requirements)[number]['sources'][number]) =>
    (kind === 'purchase' && source.kind === 'purchase' && source.documentId === id && (lineId === null || source.lineId === lineId))
    || (source.kind === 'stock' && lots.has(source.lotId ?? ''))
  const requirements = plan.requirements.filter(r => matchesDemand(r) || r.sources.some(matchesSource)
    || (kind === 'purchase' && decimal(r.shortage) > 0n && r.unavailablePurchases.some(p => p.documentId === id && (lineId === null || p.lineId === lineId))))
  const demand = (r: (typeof requirements)[number]) => ({ kind: r.kind, documentId: r.documentId, lineId: r.lineId,
    reference: r.reference, itemId: r.itemId, requiredBy: r.requiredBy, path: r.path })
  const pegs = requirements.flatMap(r => r.sources.filter(source => matchesDemand(r) || matchesSource(source)).map(source => ({ demand: demand(r), source })))
  // Late candidates retain their own available quantity; they are alternatives,
  // never allocated edges to sum across competing demand.
  const lateCandidates = requirements.filter(r => decimal(r.shortage) > 0n).flatMap(r => r.unavailablePurchases
    .filter(p => matchesDemand(r) || (kind === 'purchase' && p.documentId === id && (lineId === null || p.lineId === lineId)))
    .map(source => ({ demand: demand(r), source })))
  const salesIds = new Set(pegs.filter(p => p.demand.kind === 'sales' || p.demand.kind === 'dependent').map(p => p.demand.documentId))
  return { version: plan.version, asOf: plan.asOf, selection: { kind, id, lineId },
    scope: 'current indicative dated material allocations; not persisted reservations, physical genealogy or approved supply changes',
    requirements, pegs, lateCandidates,
    allocatedSalesOrders: s.salesOrders.filter(o => salesIds.has(o.id)).map(o => ({ id: o.id, reference: o.reference, customerId: o.customerId })),
    untrackedReceiptLines: receiptLines.filter((l: any) => !l.lotId).map((l: any) => ({ lineId: l.lineId, itemId: l.itemId, locationId: l.locationId, quantity: l.quantity })),
    blockedExplosions: plan.blockedExplosions.filter(b => kind === 'item' ? b.itemId === id
      : kind === 'work' ? b.documentId === id || b.workOrderIds.includes(id) : requirements.some(r => r.documentId === b.documentId && r.lineId === b.lineId)),
    limitations: [...plan.limitations,
      'Pegs are recomputed shared-pool allocations, not an approval or a promise change. Late candidates are unallocated alternatives, not quantities to sum.',
      'Received supply is followed through recorded lots only; unlotted receipts have no exact current-demand peg.',
      'Released work exposes pinned component inputs; customer demand is not linked through provisional work output. Expedite, defer and cancel approval are not implemented.'],
  }
}
