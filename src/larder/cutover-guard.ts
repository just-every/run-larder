// MOVE-007: after an approved cutover time each channel is written by one system.
// The guard reads what a command wrote, not its name: a command whose writes touch
// a channel routed to the source system is refused before anything is saved, so
// every door that writes the channel, including doors added later, is covered.
import { fail } from './problem'
import type { Collection, State } from './model'

export const channels = ['sales-orders', 'purchase-orders', 'stock-ledger', 'accounting-handoff'] as const
export type Channel = (typeof channels)[number]

const rows = (s: State, k: Collection) => s[k].map(r => `${r.id}:${r.version}`).join()
// What each channel owns: sales orders with their reservations, shipments and returns;
// purchase orders and receipts; every stock movement; and the accountant handoff to the ledger.
const written: Record<Channel, (s: State) => string> = {
  'sales-orders': s => [rows(s, 'salesOrders'), rows(s, 'orderChanges'), rows(s, 'shipments'), rows(s, 'returns'), s.reservations.filter(r => r.demandKind === 'sales').map(r => `${r.id}:${r.quantity}`).join()].join('|'),
  'purchase-orders': s => [rows(s, 'purchaseOrders'), rows(s, 'receipts')].join('|'),
  'stock-ledger': s => s.movements.map(m => m.id).join(),
  'accounting-handoff': s => rows(s, 'handoffs'),
}

// The approved plan whose cutover time has passed, if any.
export const livePlan = (s: State, now: string) => s.cutovers.find(p => p.status === 'approved' && p.cutoverAt <= now)

export function cutoverGuard(before: State, after: State, now: string) {
  const plan = livePlan(before, now)
  if (!plan) return
  const touched = channels.filter(ch => plan.channels[ch] === 'source' && written[ch](before) !== written[ch](after))
  if (touched.length) fail('AUTHORITY', `Since the cutover at ${plan.cutoverAt}, ${touched.map(ch => ch.replace('-', ' ')).join(' and ')} are written in the source system. Ask the owner to route ${touched.length > 1 ? 'these channels' : 'this channel'} to Larder first.`, { channels: touched, cutoverAt: plan.cutoverAt })
}
