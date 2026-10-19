// Deterministic shortages and drafted purchase or work orders. The numbers come
// from confirmed orders, residual forecasts, released work, stock and open supply.
import { activeBom } from './bom'
import { day } from './day'
import { decimal, format } from './decimal'
import { fail } from './problem'
import { allow } from './roles'
import { draftPurchase } from './purchasing'
import { draftWork } from './production'
import { netRequirements, type Peg } from './mrp'
import { get, text, type Context, type Row, type State } from './model'

export type Shortage = { itemId: string; kind: string; demand: string; available: string; expected: string; shortage: string; requiredBy: string; reasons: { document: string; reference: string; quantity: string; date: string }[]; supplierId: string | null; unitPrice: string; hasBom: boolean; pegs: Peg[]; supplyChoices: { make: string; buy: string } }

export function shortages(s: State): Shortage[] {
  return netRequirements(s).filter(n => n.shortage > 0n).map(n => {
    const item = get(s, 'items', n.itemId, 'item')
    const terms = s.partyItems.filter(p => p.itemId === item.id && s.parties.some(x => x.id === p.partyId && x.kind !== 'customer'))
    const preferred = terms.find(t => t.preferred) ?? terms[0]
    const kind = n.makeShortage === 0n ? 'buy' : n.buyShortage === 0n ? 'make' : item.kind
    return { itemId: item.id, kind, demand: format(n.demand), available: format(n.available), expected: format(n.expected), shortage: format(n.shortage),
      requiredBy: n.pegs.map(r => r.date).sort()[0], reasons: n.pegs.map(({ document, reference, quantity, date }) => ({ document, reference, quantity, date })),
      supplierId: preferred?.partyId ?? null, unitPrice: preferred?.price ?? item.standardCost, hasBom: !!activeBom(s, item.id), pegs: n.pegs,
      supplyChoices: { make: format(n.makeShortage), buy: format(n.buyShortage) } }
  })
}

export function planning(c: Context, type: string, p: any): Row | undefined {
  if (type !== 'plan.draft') return
  allow(c, ['manager', 'buyer', 'production', 'agent'])
  const item = get(c.s, 'items', p.itemId, 'item')
  const shortage = shortages(c.s).find(x => x.itemId === item.id) ?? fail('NO_SHORTAGE', `${item.name} has no shortage to cover right now.`)
  const supply = p.supply ?? shortage.kind
  if (supply !== 'make' && supply !== 'buy') fail('INPUT', 'Choose make or buy supply.')
  const needed = shortage.supplyChoices[supply as 'make' | 'buy']
  if (decimal(needed) === 0n) fail('NO_SHORTAGE', `There is no ${supply} shortage for ${item.name}.`)
  const quantity = p.quantity ?? needed
  if (decimal(quantity, 'quantity', { positive: true }) < decimal(needed)) fail('INPUT', `Draft at least the ${needed} ${item.baseUnit} ${supply} shortage.`)
  const reason = `${text(p.reason ?? 'Covers shortage', 'reason', 400)}: ${shortage.reasons.map(r => `${r.reference} needs ${r.quantity} by ${day(r.date)}`).join('; ')}`
  if (supply === 'make') return draftWork(c, { itemId: item.id, quantity, requiredBy: shortage.requiredBy, reason })
  const supplierId = p.supplierId ?? shortage.supplierId ?? fail('NO_SUPPLIER', `Choose a supplier for ${item.name}; none is on file.`)
  return draftPurchase(c, { supplierId, lines: [{ itemId: item.id, quantity, unitPrice: p.unitPrice ?? shortage.unitPrice }], expectedDate: p.expectedDate ?? shortage.requiredBy, requiredBy: shortage.requiredBy, reason })
}
