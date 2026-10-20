import { decimal, times } from './decimal'
import type { Row, State } from './model'
// Transfers attribute existing issued WIP, never a second physical issue.
export function materialCost(s: State, w: Row, itemId?: string): bigint {
  const original = s.movements.filter(m => m.documentKind === 'workOrders' && m.documentId === w.id && m.kind === 'issue' && (!itemId || m.itemId === itemId)).reduce((n, m) => n - times(m.quantity, m.unitCost), 0n)
  const reversed = s.movements.filter(m => m.documentKind === 'reversals' && m.kind === 'issue-reversal' && (!itemId || m.itemId === itemId) && s.reversals.some(r => r.id === m.documentId && r.targetId === w.id)).reduce((n, m) => n + times(m.quantity, m.unitCost), 0n)
  let transferred = 0n
  for (const t of s.workTransfers) for (const a of t.transfers) for (const x of a.components) if (!itemId || x.itemId === itemId) {
    if (a.destinationId === w.id) transferred += decimal(x.cost)
    if (a.sourceId === w.id) transferred -= decimal(x.cost)
  }
  return original - reversed + transferred
}
