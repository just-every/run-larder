// Requirements round upward at six quantity places, never below the need.
import { activeBom } from './bom'
import { decimal, format, SCALE } from './decimal'
import { fail } from './problem'
import type { Row, State } from './model'

export function componentQuantity(perUnit: string, quantity: bigint, yieldRate = '1'): bigint {
  const divisor = decimal(yieldRate, 'yield', { positive: true })
  if (divisor > SCALE) fail('INPUT', 'Yield cannot exceed one.')
  const numerator = decimal(perUnit) * quantity
  return (numerator + divisor - 1n) / divisor
}

export function validateBomGraph(s: State, from: string) {
  const dates = new Set([from, ...s.boms.map(b => b.effectiveOn).filter(d => d && d >= from)])
  for (const on of dates) {
    const visited = new Set<string>(), visiting = new Set<string>()
    const visit = (id: string, path: string[]) => {
      if (visiting.has(id)) fail('BOM_CYCLE', 'The effective BOM graph contains a cycle.', { on, path: [...path, id] })
      if (visited.has(id)) return
      visiting.add(id)
      const b = activeBom(s, id, on)
      for (const l of b?.components ?? []) {
        if (l.supply === 'phantom' && !activeBom(s, l.itemId, on)) fail('NO_BOM', 'A phantom assembly needs an effective BOM.', { itemId: l.itemId, on })
        visit(l.itemId, [...path, id])
      }
      visiting.delete(id); visited.add(id)
    }
    for (const item of s.items) visit(item.id, [])
  }
}

export function resolvedComponents(s: State, bom: Row, quantity: bigint, on = new Date().toISOString().slice(0, 10), overrides: Record<string, string> = {}) {
  const totals = new Map<string, { itemId: string; quantity: bigint; supply: string }>()
  const recipes = new Map<string, Row>(), ordered: string[] = [], visiting = new Set<string>()
  const discover = (b: Row) => {
    if (visiting.has(b.itemId)) fail('BOM_CYCLE', 'A phantom BOM contains a cycle.')
    if (recipes.has(b.itemId)) return
    visiting.add(b.itemId)
    for (const line of b.components) if (line.supply === 'phantom') {
      const child = (overrides[line.itemId] ? s.boms.find(b => b.id === overrides[line.itemId] && b.itemId === line.itemId) : activeBom(s, line.itemId, on)) ?? fail('NO_BOM', 'A phantom assembly needs an effective BOM.', { itemId: line.itemId })
      discover(child)
    }
    visiting.delete(b.itemId); recipes.set(b.itemId, b); ordered.push(b.itemId)
  }
  discover(bom)
  const amounts = new Map([[bom.itemId, quantity]])
  for (const id of ordered.reverse()) {
    const b = recipes.get(id)!, amount = amounts.get(id) ?? 0n
    for (const line of b.components) {
      const required = componentQuantity(line.quantity, amount, b.yield)
      const supply = line.supply ?? s.items.find(i => i.id === line.itemId)?.kind ?? 'buy'
      if (supply === 'phantom') amounts.set(line.itemId, (amounts.get(line.itemId) ?? 0n) + required)
      else {
        const key = line.itemId + ':' + supply, previous = totals.get(key)
        totals.set(key, { itemId: line.itemId, supply, quantity: required + (previous?.quantity ?? 0n) })
      }
    }
  }
  return { components: [...totals.values()].map(l => ({ ...l, quantity: format(l.quantity) })),
    revisions: [...recipes.values()].map(b => ({ bomId: b.id, itemId: b.itemId, revision: b.revision, yield: b.yield ?? '1' })) }
}
