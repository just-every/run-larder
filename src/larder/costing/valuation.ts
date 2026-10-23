// Monetary corrections are a separate append-only valuation ledger. Physical
// movements, quantities, custody and original rates are never rewritten.
import type { Movement, State } from '../model'
import { decimal } from '../decimal'
export function valuedRate(s: State, m: Movement): bigint {
  if (!m.lotId) return m.unitCost
  const valuation = s.costValuations.filter(v => v.status === 'approved' && v.lines.some((l: any) => l.lotId === m.lotId && l.itemId === m.itemId)).at(-1)
  return valuation ? decimal(valuation.lines.find((l: any) => l.lotId === m.lotId && l.itemId === m.itemId).unitCost) : m.unitCost
}
