// ENG-003: configurable and matrix BOMs. Engineers save versioned configuration models; sales and engineering pin a
// resolved configuration on a quote line or a work order; releasing configured work pins its components, routing and
// cost exactly as resolved, so a later rule edit never moves old work (see config-model.ts).
import { activeModel, resolveConfiguration } from './config-model'
import { fail } from './problem'
import { allow } from './roles'
import { normalizeModel } from './config-model'
import { bump, get, optionalText, row, type Context, type Row, type State } from './model'

export function configurations(c: Context, type: string, p: any): Row | undefined {
  if (type !== 'config.save') return
  allow(c, ['manager', 'production', 'engineer'])
  const def = normalizeModel(c.s, p.itemId, p)
  const previous = activeModel(c.s, def.itemId)
  if (previous) bump(previous, { status: 'superseded' })
  const revision = Math.max(0, ...c.s.configModels.filter(m => m.itemId === def.itemId).map(m => m.revision)) + 1
  return row(c, 'configModels', { ...def, revision, status: 'active', note: optionalText(p.note, 'change note', 400), approvedBy: c.actor.id, approvedAt: c.now })
}

// The current model of an item, or the exact one named, resolved for a choice.
export function resolveFor(s: State, itemId: string, input: any) {
  const model = input?.modelId ? get(s, 'configModels', input.modelId, 'configuration model') : activeModel(s, itemId) ?? fail('NO_CONFIGURATION', 'This item has no configuration model.')
  if (model.itemId !== itemId) fail('INPUT', 'That configuration model belongs to another item.')
  if (model.status !== 'active') fail('STALE', 'Those configuration rules were replaced. Configure again against the current rules.')
  return resolveConfiguration(s, model, input?.selection ?? input)
}

// A work order's pinned configuration: copied from the quote line it makes, or resolved now for a direct draft.
export function workConfiguration(c: Context, p: any): { configuration?: any; source?: any } {
  if (p.orderId === undefined && p.configuration === undefined) return {}
  if (p.orderId === undefined) return { configuration: resolveFor(c.s, p.itemId, p.configuration) }
  const order = get(c.s, 'salesOrders', p.orderId, 'order'), line = order.lines.find((l: any) => l.id === p.lineId) ?? fail('NOT_FOUND', 'That order line was not found.')
  if (line.itemId !== p.itemId || !line.configuration) fail('NO_CONFIGURATION', 'That order line is not a configured line of this item.')
  return { configuration: structuredClone(line.configuration), source: { orderId: order.id, lineId: line.id, reference: order.reference } }
}

// The recipe a configured work order releases: the pinned components and routing, as a one-level bill.
export function configuredBom(s: State, w: Row) {
  const { components, routing } = w.configuration, item = get(s, 'items', w.itemId, 'item')
  return {
    id: null, itemId: item.id, revision: null, yield: '1',
    components: components.map((l: any) => ({ supply: s.items.find(i => i.id === l.itemId)?.kind ?? 'buy', itemId: l.itemId, quantity: l.quantity })),
    routing: routing.map(({ because, ...step }: any) => step),
  } as unknown as Row
}
