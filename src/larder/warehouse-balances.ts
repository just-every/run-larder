import { decimal, format } from './decimal'
import type { State } from './model'

export function custodyBalances(s: State) {
  const balances = new Map<string, { itemId: string; locationId: string; lotId: string; ownerId: string; ownership: string; quantity: bigint }>()
  for (const r of s.custodyLedger) {
    const key = `${r.lotId}:${r.locationId}`
    const value = balances.get(key) ?? { itemId: r.itemId, locationId: r.locationId, lotId: r.lotId, ownerId: r.ownerId, ownership: r.ownership, quantity: 0n }
    value.quantity += decimal(r.quantity, 'custody quantity', { signed: true })
    balances.set(key, value)
  }
  return [...balances.values()].filter(r => r.quantity !== 0n).map(r => ({ ...r, quantity: format(r.quantity) }))
}

export function ownershipBalances(s: State) {
  return s.items.map(item => {
    const ownedOnSite = s.movements.filter(m => m.itemId === item.id).reduce((n, m) => n + m.quantity, 0n)
    const inTransit = s.transfers.filter(t => t.logistics && t.status === 'in transit' && t.itemId === item.id).reduce((n, t) => n + decimal(t.quantity), 0n)
    const property = (ownership: string) => s.custodyLedger.filter(r => r.itemId === item.id && r.ownership === ownership).reduce((n, r) => n + decimal(r.quantity, 'custody quantity', { signed: true }), 0n)
    return { itemId: item.id, ownedOnSite: format(ownedOnSite), inTransit: format(inTransit), ownedTotal: format(ownedOnSite + inTransit), customerOwned: format(property('customer-owned')), consigned: format(property('consigned')) }
  })
}
