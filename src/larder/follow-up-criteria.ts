// Follow-up identity belongs to the source, never its quantity, version or ETA.
// Notes and follow-up metadata have no bearing on these business conditions.
import { decimal, format } from './decimal'
import { acceptedPurchases, physicalShortages } from './follow-up-material'
import { lotStatuses } from './lot-dates'
import { activeMaintenance } from './maintenance-availability'
import { orderStatuses } from './order-status'
import type { StatusLine } from './order-supply'
import { deliveries } from './sales-schedules'
import { balance, positions } from './stock'
import type { Collection, Row, State } from './model'

export type CaseSource = {
  key: string; kind: string; title: string; detail: string; view: string; id: string; criteria: string
  related: { kind: string; id: string; reference: string }[]
}
type Related = CaseSource['related'][number]
const link = (kind: string, r: Row): Related => ({ kind, id: r.id, reference: r.reference ?? r.name ?? r.id })
const unique = (rows: Related[]) => [...new Map(rows.map(r => [`${r.kind}:${r.id}`, r])).values()]
const itemName = (s: State, id: string) => s.items.find(i => i.id === id)?.name ?? id

const purchaseOpen = (po: Row, accepted: Map<string, bigint>) => po.lines.some((l: any) => (accepted.get(`${po.id}:${l.id}`) ?? 0n) < decimal(l.quantity))
function workComplete(w: Row): boolean {
  return w.status === 'closed' && decimal(w.output) + decimal(w.scrap) >= decimal(w.quantity)
}
function workBlocked(s: State, w: Row, lines: StatusLine[], today: string): boolean {
  if (!['draft', 'released'].includes(w.status) || workComplete(w)) return false
  return lines.some(l => decimal(l.required) > decimal(l.available))
    || (w.status === 'draft' && !lines.length)
    || (w.operationStates ?? []).some((t: any) => t.status === 'paused')
    || (w.routing ?? []).some((step: any) => {
      if (w.operationStates?.some((t: any) => t.sequence === step.sequence && t.status === 'done')) return false
      const centres: string[] = step.eligibleCentres?.length ? step.eligibleCentres : step.workCentre ? [step.workCentre] : []
      return centres.length > 0 && centres.every(centre => activeMaintenance(s, centre, `${today}T23:59:59.999Z`).length > 0)
    })
}
const promiseOpen = (o: Row, today: string) => ['confirmed', 'part shipped'].includes(o.status)
  && o.lines.some((l: any) => deliveries(o, l).some(d => d.date < today && decimal(d.quantity) > 0n))
function ledgerState(h: Row, line: any): 'waiting' | 'mismatch' | 'matched' {
  const acknowledgement = (h.acknowledgements ?? []).filter((a: any) => a.lineId === line.id).at(-1)
  return !acknowledgement?.ledgerId ? 'waiting' : acknowledgement.amount === line.amountCents ? 'matched' : 'mismatch'
}

// Read through both ingredients and supplying work. These are ranked planning
// paths, not assertions that a supplier shipment is hard allocated to an order.
function purchasePaths(s: State, statuses: ReturnType<typeof orderStatuses>, poId: string): Related[] {
  const work = new Map(statuses.work.map(w => [w.id, w]))
  const uses = (lines: StatusLine[], seen = new Set<string>()): boolean => lines.some(l =>
    l.supplies.some(p => p.kind === 'purchase' && p.documentId === poId)
    || uses(l.ingredients ?? [], seen)
    || (l.supplyingWork ?? []).some(w => uses(w.lines, seen))
    || l.supplies.some(p => {
      if (p.kind !== 'work' || seen.has(p.documentId)) return false
      const next = new Set(seen); next.add(p.documentId)
      return uses(work.get(p.documentId)?.lines ?? [], next)
    }))
  return [...statuses.sales.filter(o => uses(o.lines)).map(o => link('salesOrders', s.salesOrders.find(r => r.id === o.id)!)),
    ...statuses.work.filter(o => uses(o.lines)).map(o => link('workOrders', s.workOrders.find(r => r.id === o.id)!))]
}

const approvalSources: { collection: Collection; prefix: string; status: string; view: string; label: string }[] = [
  { collection: 'purchaseOrders', prefix: 'po-approval', status: 'draft', view: 'purchase', label: 'Purchase approval' },
  { collection: 'counts', prefix: 'count', status: 'awaiting approval', view: 'stock', label: 'Count approval' },
  { collection: 'proposals', prefix: 'proposal', status: 'awaiting approval', view: 'today', label: 'Proposal decision' },
]

export function caseSources(s: State, today: string): CaseSource[] {
  const out: CaseSource[] = [], statuses = orderStatuses(s), accepted = acceptedPurchases(s)
  for (const n of physicalShortages(s, today)) out.push({ key: `shortage:${n.itemId}`, kind: 'shortage', title: `${itemName(s, n.itemId)} is short ${format(n.missing)}`,
    detail: n.pegs.map(p => `${p.reference} needs ${p.quantity} by ${p.date}`).join('; '), view: 'plan', id: n.itemId,
    criteria: 'Cover the current material requirement with accepted usable physical stock or actual completed demand; draft and expected supply do not close this case.',
    related: unique(n.pegs.map(p => ({ kind: p.document, id: p.documentId, reference: p.reference }))) })
  for (const po of s.purchaseOrders) if (po.status !== 'draft' && po.expectedDate < today && purchaseOpen(po, accepted)) out.push({
    key: `po-late:${po.id}`, kind: 'late', title: `${po.reference} is overdue (expected ${po.expectedDate})`,
    detail: `${s.parties.find(p => p.id === po.supplierId)?.name ?? ''}. Related orders are current ranked supply paths, not hard allocations.`, view: 'purchase', id: po.id,
    criteria: 'Every ordered line must be fully covered by non-reversed accepted receipts from this purchase. Quarantine, rejection and a revised ETA do not count as acceptance.',
    related: unique([link('purchaseOrders', po), ...purchasePaths(s, statuses, po.id)]) })
  for (const w of s.workOrders) if (workBlocked(s, w, statuses.work.find(x => x.id === w.id)?.lines ?? [], today)) out.push({
    key: `wo-blocked:${w.id}`, kind: 'blocked', title: `${w.reference} has blocked work`, detail: 'Required physical materials or execution are blocked.', view: 'make', id: w.id,
    criteria: 'Close the work order through its authorized completion workflow with output plus recorded scrap covering the ordered quantity. Receiving material, posting output alone or clearing a pause does not close the work.', related: [link('workOrders', w)] })
  for (const p of positions(s).filter(p => p.status === 'quarantine')) out.push({ key: `quarantine:${p.itemId}:${p.locationId}:${p.lotId}`, kind: 'quarantine',
    title: `${p.quantity} ${itemName(s, p.itemId)} waiting for a quality decision`, detail: `${s.locations.find(l => l.id === p.locationId)?.name ?? p.locationId}${p.lotId ? `, lot ${s.lots.find(l => l.id === p.lotId)?.code ?? p.lotId}` : ''}`,
    view: 'stock', id: p.itemId, criteria: 'No held quantity may remain at this item/location/lot: post an authorized release/rejection or reverse the source receipt.',
    related: [{ kind: 'items', id: p.itemId, reference: itemName(s, p.itemId) }, { kind: 'locations', id: p.locationId, reference: p.locationId }, { kind: 'lots', id: p.lotId, reference: p.lotId }] })
  for (const o of s.salesOrders) if (promiseOpen(o, today)) out.push({ key: `promise:${o.id}`, kind: 'promise', title: `${o.reference} has a missed delivery promise`,
    detail: o.lines.flatMap((l: any) => deliveries(o, l).filter(d => d.date < today && decimal(d.quantity) > 0n).map(d => `${d.quantity} ${itemName(s, l.itemId)} due ${d.date}`)).join('; '), view: 'orders', id: o.id,
    criteria: 'Ship the overdue obligation, or approve a customer-attested amendment that clears the current overdue delivery obligation. Picking, packing and notes do not ship goods.', related: [link('salesOrders', o)] })
  for (const h of s.handoffs) for (const line of h.lines) {
    const state = ledgerState(h, line)
    if (state === 'matched') continue
    out.push({ key: `handoff:${h.id}:${line.id}`, kind: state === 'mismatch' ? 'mismatch' : 'handoff', title: `${h.reference}: ${state === 'mismatch' ? 'amount differs from ledger' : 'line awaits ledger acknowledgment'}`,
      detail: `${line.document}; ${line.itemName}; expected ${line.amountCents}`, view: 'handoff', id: h.id,
      criteria: 'The latest acknowledgment for this exact line must have a ledger reference and match its issued amount.',
      related: [link('handoffs', h), { kind: 'handoff-line', id: line.id, reference: line.document ?? line.id }] })
  }
  for (const spec of approvalSources) for (const r of s[spec.collection]) if (r.status === spec.status) out.push({ key: `${spec.prefix}:${r.id}`, kind: spec.collection === 'proposals' ? 'proposal' : 'approval',
    title: `${r.reference ?? r.summary ?? spec.label} waits for a decision`, detail: r.reason ?? r.note ?? spec.label, view: spec.view, id: r.id,
    criteria: 'Complete the source approval/decision workflow; a follow-up note cannot approve it.', related: [link(spec.collection, r)] })
  for (const i of s.imports) if (i.status === 'previewed' && i.rejected.length) out.push({ key: `import:${i.id}`, kind: 'import', title: `Move-in preview has ${i.rejected.length} rejected rows`, detail: i.label,
    view: 'move-in', id: i.id, criteria: 'Replace the rejected preview with corrected source rows or explicitly commit its reviewed exclusions through move-in.', related: [link('imports', i)] })
  for (const l of lotStatuses(s, today)) if (decimal(l.onHand) > 0n && l.state !== 'current') out.push({ key: `${l.state === 'expiring' ? 'expiring' : 'blocked-lot'}:${l.lotId}`, kind: 'expiry',
    title: `Lot ${l.code} of ${itemName(s, l.itemId)} ${l.state === 'expiring' ? `expires ${l.expiresOn}` : l.reason}`, detail: `${l.onHand} on hand`, view: 'stock', id: l.lotId,
    criteria: 'Clear affected physical stock or record an authorized evidence-backed lot disposition that clears the date condition.', related: [{ kind: 'lots', id: l.lotId, reference: l.code }] })
  return out
}

export function caseStillOpen(s: State, source: CaseSource, today: string): boolean {
  if (source.key.startsWith('po-late:')) {
    const po = s.purchaseOrders.find(p => p.id === source.id)
    return !!po && purchaseOpen(po, acceptedPurchases(s))
  }
  if (source.key.startsWith('wo-blocked:')) {
    const w = s.workOrders.find(w => w.id === source.id)
    return !!w && !workComplete(w)
  }
  if (source.key.startsWith('quarantine:')) {
    const location = source.related.find(r => r.kind === 'locations')?.id
    const lot = source.related.find(r => r.kind === 'lots')?.id ?? ''
    return !!location && balance(s, source.id, location, 'quarantine', lot) > 0n
  }
  // Expiring and blocked are stages of the same lot obligation. Aging an
  // expiring lot into a blocked one cannot close its assigned warning.
  if (source.kind === 'expiry') return lotStatuses(s, today).some(l => l.lotId === source.id && decimal(l.onHand) > 0n && l.state !== 'current')
  return caseSources(s, today).some(current => current.key === source.key)
}
