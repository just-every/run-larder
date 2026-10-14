// Deterministic shortages and drafted purchase or work orders. The numbers come
// from orders, released work, stock and open supply only; nothing is forecast.
import { expectedProduction, expectedPurchase, open } from './availability'
import { activeBom } from './bom'
import { day } from './day'
import { decimal, format, max } from './decimal'
import { fail } from './problem'
import { allow } from './roles'
import { draftPurchase } from './purchasing'
import { draftWork } from './production'
import { onHand, reservedQuantity } from './stock'
import { get, text, type Context, type Row, type State } from './model'

export type Shortage = { itemId: string; kind: string; demand: string; available: string; expected: string; shortage: string; requiredBy: string; reasons: { document: string; reference: string; quantity: string; date: string }[]; supplierId: string | null; unitPrice: string; hasBom: boolean }

export function shortages(s: State): Shortage[] {
  const out: Shortage[] = []
  for (const item of s.items) {
    const reasons: Shortage['reasons'] = []
    for (const o of s.salesOrders) if (['confirmed', 'part shipped'].includes(o.status))
      for (const l of o.lines) if (l.itemId === item.id) {
        const need = max(0n, open(l) - reservedQuantity(s, o.id, l.id))
        if (need > 0n) reasons.push({ document: 'salesOrders', reference: o.reference, quantity: format(need), date: o.promiseDate })
      }
    for (const w of s.workOrders) if (w.status === 'released')
      for (const l of w.components) if (l.itemId === item.id) {
        const need = max(0n, decimal(l.required) - decimal(l.issued) - reservedQuantity(s, w.id, l.id))
        if (need > 0n) reasons.push({ document: 'workOrders', reference: w.reference, quantity: format(need), date: w.requiredBy })
      }
    if (!reasons.length) continue
    const demand = reasons.reduce((n, r) => n + decimal(r.quantity), 0n)
    const reserved = s.reservations.filter(r => r.itemId === item.id).reduce((n, r) => n + r.quantity, 0n)
    const free = max(0n, onHand(s, item.id) - reserved), expected = expectedPurchase(s, item.id) + expectedProduction(s, item.id)
    const drafted = s.purchaseOrders.filter(p => p.status === 'draft').flatMap(p => p.lines).filter((l: any) => l.itemId === item.id).reduce((n: bigint, l: any) => n + decimal(l.quantity), 0n)
      + s.workOrders.filter(w => w.status === 'draft' && w.itemId === item.id).reduce((n, w) => n + decimal(w.quantity), 0n)
    const short = demand - free - expected - drafted
    if (short <= 0n) continue
    const terms = s.partyItems.filter(p => p.itemId === item.id && s.parties.some(x => x.id === p.partyId && x.kind !== 'customer'))
    const preferred = terms.find(t => t.preferred) ?? terms[0]
    out.push({ itemId: item.id, kind: item.kind, demand: format(demand), available: format(free), expected: format(expected + drafted), shortage: format(short), requiredBy: reasons.map(r => r.date).sort()[0], reasons, supplierId: preferred?.partyId ?? null, unitPrice: preferred?.price ?? item.standardCost, hasBom: !!activeBom(s, item.id) })
  }
  return out
}

export function planning(c: Context, type: string, p: any): Row | undefined {
  if (type !== 'plan.draft') return
  allow(c, ['manager', 'buyer', 'production', 'agent'])
  const item = get(c.s, 'items', p.itemId, 'item')
  const shortage = shortages(c.s).find(x => x.itemId === item.id) ?? fail('NO_SHORTAGE', `${item.name} has no shortage to cover right now.`)
  const quantity = p.quantity ?? shortage.shortage
  if (decimal(quantity, 'quantity', { positive: true }) < decimal(shortage.shortage)) fail('INPUT', `Draft at least the ${shortage.shortage} ${item.baseUnit} short.`)
  const reason = `${text(p.reason ?? 'Covers shortage', 'reason', 400)}: ${shortage.reasons.map(r => `${r.reference} needs ${r.quantity} by ${day(r.date)}`).join('; ')}`
  if (item.kind === 'make') return draftWork(c, { itemId: item.id, quantity, requiredBy: shortage.requiredBy, reason })
  const supplierId = p.supplierId ?? shortage.supplierId ?? fail('NO_SUPPLIER', `Choose a supplier for ${item.name}; none is on file.`)
  return draftPurchase(c, { supplierId, lines: [{ itemId: item.id, quantity, unitPrice: p.unitPrice ?? shortage.unitPrice }], expectedDate: p.expectedDate ?? shortage.requiredBy, requiredBy: shortage.requiredBy, reason })
}
