// What a signed-in person or agent reads: records, formatted ledger, positions,
// availability, shortages and the exception queue.
import { availability } from './availability'
import { format } from './decimal'
import { exceptions } from './exceptions'
import { shortages } from './planning'
import { positions } from './stock'
import { handoffLines } from './handoff'
import { collections, type Actor, type State } from './model'

export const movementView = (m: State['movements'][number]) => ({ ...m, quantity: format(m.quantity), unitCost: format(m.unitCost) })

export function stateView(s: State, actor: Actor, extra: Record<string, unknown>) {
  const records = Object.fromEntries(collections.map(k => [k, s[k]]))
  return {
    version: s.version, actor, ...records,
    movements: s.movements.map(movementView),
    reservations: s.reservations.map(r => ({ ...r, quantity: format(r.quantity) })),
    positions: positions(s),
    availability: s.items.map(i => availability(s, i.id)),
    shortages: shortages(s),
    exceptions: exceptions(s, new Date().toISOString().slice(0, 10)),
    pendingHandoff: handoffLines(s).length,
    ...extra,
  }
}
