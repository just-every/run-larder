// Recorded material WIP is derived from immutable issues and exact output
// allocations. It is a subledger bridge, never an external account balance.
import { decimal, format, times } from '../decimal'
import { date, type Row, type State } from '../model'
import { fail } from '../problem'

type Event = { id: string; documentId: string; documentKind: string; reference: string; at: string; kind: 'addition' | 'transfer' | 'write-off'; amount: bigint; movementIds: string[]; operation: string }
const d = (v: string) => decimal(v, 'recorded value', { signed: true })
const total = (values: bigint[]) => values.reduce((a, b) => a + b, 0n)

export function wipReport(s: State, q: URLSearchParams) {
  // Dates are explicit so a saved report has no wall-clock dependency.
  const from = date(q.get('from'), 'period start'), to = date(q.get('to'), 'period end')
  for (const day of [from, to]) if (new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day) fail('INPUT', 'Use a real calendar date.')
  if (from > to) fail('INPUT', 'Period end must be on or after period start.')
  const allocated = new Map<string, bigint>()
  const events: Event[] = [], missing: { documentId: string; reference: string; reason: string }[] = []
  const add = (w: Row, documentKind: string, id: string, at: string, kind: Event['kind'], amount: bigint, movementIds: string[] = []) => {
    if (at.slice(0, 10) <= to) events.push({ id, documentId: w.id, documentKind, reference: w.reference, at, kind, amount, movementIds, operation: 'Job material pool; operation allocation not recorded' })
  }
  for (const w of s.workOrders) {
    const input = s.movements.filter(m => m.documentKind === 'workOrders' && m.documentId === w.id && m.kind === 'issue')
    for (const m of input) add(w, 'workOrders', m.id, m.createdAt, 'addition', -times(m.quantity, m.unitCost), [m.id])
    for (const m of s.movements.filter(m => m.kind === 'issue-reversal' && input.some(i => i.id === m.reversesId))) add(w, 'workOrders', m.id, m.createdAt, 'addition', -times(m.quantity, m.unitCost), [m.id, m.reversesId!])
    for (const o of w.outputs ?? []) {
      if (o.at.slice(0, 10) > to) continue
      if (!o.allocations) { missing.push({ documentId: w.id, reference: w.reference, reason: 'Historical output has no exact component allocation; material WIP is unresolved.' }); continue }
      let cost = 0n
      for (const a of o.allocations) {
        const m = s.movements.find(m => m.id === a.movementId)
        if (!m) { missing.push({ documentId: w.id, reference: w.reference, reason: 'An allocated source movement is unavailable.' }); continue }
        // Cumulative differences retain the original movement's rounding residue.
        const before = allocated.get(m.id) ?? 0n, after = before + d(a.quantity)
        cost += times(after, m.unitCost) - times(before, m.unitCost)
        allocated.set(m.id, after)
      }
      const good = d(o.good), scrap = d(o.scrap), completed = good + scrap
      const scrapCost = completed ? cost * scrap / completed : 0n
      const sources = o.allocations.map((a: any) => a.movementId)
      add(w, 'workOrders', o.id + ':good', o.at, 'transfer', cost - scrapCost, [...sources, ...(o.movementId ? [o.movementId] : [])])
      add(w, 'workOrders', o.id + ':scrap', o.at, 'write-off', scrapCost, sources)
    }
  }
  // Splits and merges move existing WIP responsibility, never add it twice.
  for (const t of s.workTransfers) for (const [i, a] of t.transfers.entries()) {
    const amount = total(a.components.map((x: any) => d(x.cost)))
    for (const [id, sign] of [[a.sourceId, -1n], [a.destinationId, 1n]] as const) {
      const w = s.workOrders.find(w => w.id === id)
      if (w) add(w, 'workOrders', `${t.id}:${i}:${id}`, t.createdAt, 'addition', amount * sign)
    }
  }
  // Repair is an atomic consumption, labor, output and evidenced scrap posting.
  for (const w of s.reworkOrders.filter(w => w.executedAt && w.cost)) {
    const movements = s.movements.filter(m => m.documentKind === 'reworkOrders' && m.documentId === w.id)
    add(w, 'reworkOrders', w.id + ':inputs', w.executedAt, 'addition', d(w.cost.total), movements.filter(m => m.quantity < 0n && m.kind !== 'repair-release').map(m => m.id))
    add(w, 'reworkOrders', w.id + ':outputs', w.executedAt, 'transfer', d(w.cost.outputs), (w.outputLots ?? []).map((x: any) => x.movementId))
    add(w, 'reworkOrders', w.id + ':scrap', w.executedAt, 'write-off', d(w.cost.scrap))
  }
  // Owned subcontract material enters WIP only when consumed. Unconsumed
  // vendor custody remains inventory and customer property has no owned value.
  for (const w of s.subcontractOrders.filter(w => !w.customerId)) for (const r of w.receipts) {
    add(w, 'subcontractOrders', r.id + ':inputs', r.at, 'addition', d(r.material) + d(r.service), r.inputs.map((x: any) => x.movementId).filter(Boolean))
    add(w, 'subcontractOrders', r.id + ':outputs', r.at, 'transfer', d(r.outputValue), s.movements.filter(m => m.documentId === w.id && m.lotId === r.lotId && m.kind === 'subcontract-output').map(m => m.id))
    add(w, 'subcontractOrders', r.id + ':scrap', r.at, 'write-off', d(r.scrapValue))
  }
  const selected = events.filter(e => !q.get('workOrderId') || e.documentId === q.get('workOrderId'))
  const signed = (e: Event) => e.kind === 'addition' ? e.amount : -e.amount
  const rows = [...new Set(selected.map(e => e.documentId))].map(documentId => {
    const all = selected.filter(e => e.documentId === documentId).sort((a,b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
    const period = all.filter(e => e.at.slice(0, 10) >= from)
    const opening = total(all.filter(e => e.at.slice(0, 10) < from).map(signed)), additions = total(period.filter(e => e.kind === 'addition').map(e => e.amount)), transfers = total(period.filter(e => e.kind === 'transfer').map(e => e.amount)), writeOffs = total(period.filter(e => e.kind === 'write-off').map(e => e.amount))
    const closing = opening + additions - transfers - writeOffs
    const first = all.find(e => e.kind === 'addition' && e.amount > 0n)?.at.slice(0, 10) ?? to
    const ageDays = Math.max(0, Math.round((Date.parse(to) - Date.parse(first)) / 86400000))
    return { documentId, documentKind: all[0].documentKind, reference: all[0].reference, openingCost: format(opening), additionsCost: format(additions), transfersCost: format(transfers), writeOffCost: format(writeOffs), closingCost: format(closing), ageDays: closing ? ageDays : 0, ageBasis: 'Days since first recorded addition, not FIFO layers', agingBucket: !closing ? 'settled' : ageDays <= 30 ? '0–30 days' : ageDays <= 60 ? '31–60 days' : ageDays <= 90 ? '61–90 days' : 'over 90 days', transactionIds: period.map(e => e.id), missing: missing.filter(x => x.documentId === documentId).map(x => x.reason) }
  })
  const totals = Object.fromEntries(['openingCost', 'additionsCost', 'transfersCost', 'writeOffCost', 'closingCost'].map(key => [key, format(total(rows.map(r => d((r as any)[key]))))]))
  return { currency: 'USD', filters: { from, to, workOrderId: q.get('workOrderId') ?? '' }, basis: 'Recorded material at original movement rates and exact batch allocations; repair and received subcontract values include their recorded labor or service. Production labor, overhead, valuation corrections, operation allocation and external control-account tie-out are not included. No journals are posted.', totals, rows, transactions: selected.filter(e => e.at.slice(0, 10) >= from).sort((a,b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)).map(({ amount, ...e }) => ({ ...e, amount: format(amount) })), missing: missing.filter(x => !q.get('workOrderId') || x.documentId === q.get('workOrderId')), externalReconciliation: 'not connected; not reconciled' }
}
