import { allow } from './roles'
import { bump, date, fresh, get, type Context, type Row } from './model'
import { fail } from './problem'

export function ranking(c: Context, type: string, p: any): Row | undefined {
  if (type !== 'order.rank' && type !== 'work.expected') return
  allow(c, ['manager', 'production', 'planner'])
  if (type === 'work.expected') {
    const w = get(c.s, 'workOrders', p.workOrderId, 'work order'); fresh(w, p.version)
    if (!['draft', 'released'].includes(w.status)) fail('STATE', 'Only open work can change its expected completion.')
    const expectedOn = date(p.expectedOn, 'expected completion')
    if (new Date(expectedOn + 'T00:00:00Z').toISOString().slice(0, 10) !== expectedOn) fail('INPUT', 'Expected completion must be a real calendar date.')
    return bump(w, { expectedOn })
  }
  if (!['sales', 'work'].includes(p.kind)) fail('INPUT', 'Choose sales or work orders.')
  const order = get(c.s, p.kind === 'sales' ? 'salesOrders' : 'workOrders', p.orderId, 'order'); fresh(order, p.version)
  const states = p.kind === 'sales' ? ['quote', 'confirmed', 'part shipped'] : ['draft', 'released']
  if (!states.includes(order.status)) fail('STATE', 'Only open orders can be ranked.')
  if (!Number.isSafeInteger(p.rank) || p.rank < 1 || p.rank > 1000000) fail('INPUT', 'Rank must be a whole number from 1 to 1000000.')
  return bump(order, { rank: p.rank })
}
