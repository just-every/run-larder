// Dated MRP demand graph. The order collects every parent branch before a
// shared component is netted; quantities and stock allocation live elsewhere.
import { activeBom } from './bom'
import { fail } from './problem'
import type { State } from './model'
import type { MaterialTiming } from './material-lead'

export type SupplyMode = 'make' | 'buy' | 'phantom'
export type MaterialSource = { kind: 'stock' | 'purchase'; documentId: string; lineId?: string; reference: string; locationId?: string; lotId?: string; date: string; quantity: string; reserved: boolean }
export type MaterialDemand = {
  kind: 'sales' | 'work' | 'forecast' | 'safety' | 'dependent'; documentId: string; lineId: string; reference: string
  itemId: string; date: string; quantity: bigint; customerId?: string; locationId?: string; catalogLocationIds?: string[]
  workTiming?: MaterialTiming
  rank: number; sources: MaterialSource[]; left: bigint; supply: SupplyMode
  path: { itemId: string; bomId: string; revision: number; timing?: MaterialTiming }[]
}
export const materialMode = (s: State, line: { itemId: string; supply?: SupplyMode }): SupplyMode =>
  line.supply ?? (s.items.find(i => i.id === line.itemId)?.kind === 'make' ? 'make' : 'buy')
export const demandOrder = (a: MaterialDemand, b: MaterialDemand) =>
  a.date.localeCompare(b.date) || a.rank - b.rank || a.reference.localeCompare(b.reference) || a.documentId.localeCompare(b.documentId) || a.lineId.localeCompare(b.lineId) || JSON.stringify(a.path).localeCompare(JSON.stringify(b.path)) || a.supply.localeCompare(b.supply)

export function materialOrder(s: State, demands: MaterialDemand[], on: string) {
  const edges = new Map<string, Set<string>>(), visited = new Set<string>()
  const discover = (id: string, supply: SupplyMode) => {
    if (!edges.has(id)) edges.set(id, new Set())
    const key = JSON.stringify([id, supply])
    if (visited.has(key)) return
    visited.add(key)
    if (supply === 'buy') return
    for (const line of activeBom(s, id, on)?.components ?? []) {
      edges.get(id)!.add(line.itemId)
      discover(line.itemId, materialMode(s, line))
    }
  }
  for (const d of demands) discover(d.itemId, d.supply)
  const incoming = new Map([...edges.keys()].map(id => [id, 0]))
  for (const children of edges.values()) for (const id of children) incoming.set(id, (incoming.get(id) ?? 0) + 1)
  const ready = [...incoming].filter(([, n]) => n === 0).map(([id]) => id).sort(), ordered: string[] = []
  while (ready.length) {
    const id = ready.shift()!; ordered.push(id)
    for (const child of edges.get(id) ?? []) {
      const count = incoming.get(child)! - 1; incoming.set(child, count)
      if (!count) { ready.push(child); ready.sort() }
    }
  }
  if (ordered.length !== incoming.size) fail('BOM_CYCLE', 'The effective manufacturing recipes contain a cycle. Correct the BOM before planning.')
  return ordered
}
