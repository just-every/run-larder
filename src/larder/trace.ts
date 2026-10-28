import { decimal, format } from './decimal'
import { movementDeviation } from './deviations'
import { get, oneOf, type State } from './model'
import { traceGraph, type TraceRow } from './trace-graph'

export function lotTrace(s: State, lotId: string, direction: unknown) {
  const selected = get(s, 'lots', lotId, 'lot'), way = oneOf(direction ?? 'upstream', ['upstream', 'downstream'] as const, 'trace direction'), g = traceGraph(s)
  const start = `lot:${selected.id}`, seen = new Set([start]), queue = [start], adjacent = new Map<string, string[]>()
  const context = (l: TraceRow) => l.basis === 'production job reference' || l.basis.startsWith('recorded WIP responsibility')
  for (const l of g.links.filter(l => !context(l))) { const from = way === 'upstream' ? l.to : l.from, to = way === 'upstream' ? l.from : l.to; adjacent.set(from, [...(adjacent.get(from) ?? []), to]) }
  for (let i = 0; i < queue.length; i++) for (const id of adjacent.get(queue[i]) ?? []) if (!seen.has(id)) { seen.add(id); queue.push(id) }
  // Add job/WIP context without following it into unrelated output batches.
  for (const l of g.links.filter(l => l.basis === 'production job reference' && seen.has(l.to))) seen.add(l.from)
  let changed = true
  while (changed) { changed = false; for (const l of g.links.filter(l => l.basis.startsWith('recorded WIP responsibility'))) { const from = way === 'upstream' ? l.to : l.from, to = way === 'upstream' ? l.from : l.to; if (seen.has(from) && !seen.has(to)) { seen.add(to); changed = true } } }
  const nodes = [...g.nodes.values()].filter(n => seen.has(n.id)), lotIds = new Set(nodes.flatMap(n => n.lotId ? [n.lotId] : []))
  const physical: TraceRow[] = s.movements.filter(m => lotIds.has(m.lotId) || seen.has(`untracked:${m.id}`) || (m.reversesId && seen.has(`untracked:${m.reversesId}`))).map(m => ({ recordType: 'movement', id: m.id, lotId: m.lotId, itemId: m.itemId, quantity: format(m.quantity), unit: s.items.find(i => i.id === m.itemId)?.baseUnit ?? '', date: m.createdAt, kind: m.kind, locationId: m.locationId, status: m.status, reversesId: m.reversesId ?? '', basis: 'owned physical ledger', ...g.document(m.documentKind, m.documentId), ...(movementDeviation(s, m) ? { reference: movementDeviation(s, m)! } : {}) }))
  physical.push(...s.subcontractCustody.filter(e => lotIds.has(e.lotId)).map(e => ({ recordType: 'custody', id: e.id, lotId: e.lotId, itemId: e.itemId, quantity: e.quantity, unit: s.items.find(i => i.id === e.itemId)?.baseUnit ?? '', date: e.createdAt, kind: e.kind, locationId: e.locationId, status: 'customer property', basis: 'customer custody; zero owned value', ...g.document('subcontractOrders', e.orderId), party: s.parties.find(p => p.id === e.ownerId)?.name ?? '' })))
  const totals = new Map<string, TraceRow>()
  for (const p of physical) {
    const key = `${p.recordType}:${p.lotId}:${p.itemId}:${p.locationId}:${p.status}`, prior = totals.get(key)
    totals.set(key, { ...p, recordType: 'balance', id: key, quantity: format(decimal(prior?.quantity ?? '0', 'balance', { signed: true }) + decimal(p.quantity, 'movement', { signed: true })), date: '', kind: '', documentId: '', reference: '', documentKind: '', orderReference: '', reversesId: '' })
  }
  const rows = [...g.links.filter(l => seen.has(l.from) && seen.has(l.to)), ...g.events.filter(e => seen.has(e.from)), ...physical, ...totals.values()].map(r => ({ ...r, selectedLotId: selected.id, selectedLot: selected.code, direction: way, fromLabel: g.nodes.get(r.from)?.label ?? '', toLabel: g.nodes.get(r.to)?.label ?? '', lot: s.lots.find(l => l.id === r.lotId)?.code ?? '', item: s.items.find(i => i.id === r.itemId)?.name ?? '', location: s.locations.find(l => l.id === r.locationId)?.name ?? '' }))
  return { selectedLotId: selected.id, selectedLot: selected.code, direction: way, nodes, rows }
}

const fields = ['selectedLotId', 'selectedLot', 'direction', 'recordType', 'id', 'from', 'fromLabel', 'to', 'toLabel', 'lotId', 'lot', 'itemId', 'item', 'unit', 'quantity', 'netQuantity', 'scrap', 'value', 'scrapValue', 'locationId', 'location', 'status', 'documentKind', 'documentId', 'reference', 'orderReference', 'party', 'date', 'movementId', 'originalMovementId', 'claimId', 'evidenceId', 'reversesId', 'kind', 'ownership', 'allocationBasis', 'basis']
export function traceCsv(trace: ReturnType<typeof lotTrace>) {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`
  return [fields, ...trace.rows.map(r => fields.map(f => (r as TraceRow)[f] ?? (f === 'basis' ? (r as TraceRow).restricted ?? '' : '')))].map(r => r.map(quote).join(',')).join('\r\n') + '\r\n'
}
