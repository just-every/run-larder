// A counter's active assignment is a server-enforced blind workspace, not
// merely a hidden field in the stock page. Old command replays/downloads are
// blocked too; other warehouse people keep receiving and moving stock.
import { collections, type Actor, type State } from './model'

export const blindSessions = (s: State, actor: Actor) => s.countSessions.filter(x => x.counterId === actor.id && x.status !== 'complete' && x.scheduledOn <= new Date().toISOString().slice(0, 10))

export function blindView(s: State, actor: Actor, extra: Record<string, unknown>) {
  const sessions = blindSessions(s, actor)
  if (!sessions.length) return null
  const lines = sessions.flatMap(s => s.lines)
  return {
    ...Object.fromEntries(collections.map(k => [k, []])), version: s.version, actor, blindCounting: true,
    items: s.items.filter(i => lines.some(l => l.itemId === i.id)).map(i => ({ id: i.id, name: i.name, sku: i.sku, baseUnit: i.baseUnit })),
    locations: s.locations.filter(l => sessions.some(s => s.locationId === l.id)).map(l => ({ id: l.id, name: l.name })),
    lots: s.lots.filter(l => lines.some(x => x.lotId === l.id)).map(l => ({ id: l.id, code: l.code })),
    countSessions: sessions.map(s => ({ id: s.id, version: s.version, reference: s.reference, locationId: s.locationId, scheduledOn: s.scheduledOn, counterId: s.counterId, basis: s.basis, status: s.status, lines: s.lines.map((l: any) => ({ id: l.id, itemId: l.itemId, lotId: l.lotId, status: l.status })) })),
    people: extra.people, operators: [], commands: [], movements: [], reservations: [], positions: [], availability: [], shortages: [], exceptions: [], pendingHandoff: 0,
  }
}
