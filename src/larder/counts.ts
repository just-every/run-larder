// Counts retain their original observations; only approval posts movements.
import { decimal, format, times } from './decimal'
import { fail } from './problem'
import { allow, approver } from './roles'
import { averageCost, balance, withdraw } from './stock'
import { bump, fresh, get, nextReference, optionalText, row, type Context, type Row } from './model'
import { countSessions, decideSessionCount } from './count-sessions'

export function counts(c: Context, type: string, p: any): Row | undefined {
  const session = countSessions(c, type, p)
  if (session) return session
  switch (type) {
    case 'count.record': {
      allow(c, ['manager', 'warehouse'])
      const item = get(c.s, 'items', p.itemId, 'item'), location = get(c.s, 'locations', p.locationId, 'location')
      const counted = decimal(p.counted, 'counted quantity'), lotId = p.lotId ? get(c.s, 'lots', p.lotId, 'lot').id : ''
      // Without a lot, the count covers everything available at the location.
      const system = balance(c.s, item.id, location.id, 'available', lotId || undefined)
      return row(c, 'counts', { reference: nextReference(c.s.counts, 'CT'), itemId: item.id, locationId: location.id, lotId, counted: format(counted), system: format(system), variance: format(counted - system), frontier: c.s.movements.at(-1)?.sequence ?? 0, unitCost: format(averageCost(c.s, item.id)), note: optionalText(p.note, 'note', 400), status: counted === system ? 'matched' : 'awaiting approval' })
    }
    case 'count.approve':
    case 'count.reject': {
      approver(c, ['manager'])
      const count = get(c.s, 'counts', p.countId, 'count'); fresh(count, p.version)
      approver(c, ['manager'], count.createdBy)
      decideSessionCount(c, count, type)
      if (count.status !== 'awaiting approval') fail('STATE', 'Only a count awaiting approval can be decided.')
      const later = c.s.movements.some(m => m.sequence > count.frontier && m.itemId === count.itemId && m.locationId === count.locationId && (!count.sessionId || m.lotId === count.lotId))
      if (type === 'count.approve' && later) fail('STALE_COUNT', 'Stock moved at this location after the count. Count again before adjusting.', { countId: count.id })
      const approval = row(c, 'approvals', { subjectKind: 'counts', subjectId: count.id, subjectVersion: count.version, decision: type === 'count.approve' ? 'approved' : 'rejected', role: c.actor.role, note: optionalText(p.note, 'note', 400) })
      if (type === 'count.reject') return bump(count, { status: 'rejected', approvalId: approval.id })
      const variance = decimal(count.variance, 'variance', { signed: true })
      const movements = variance === 0n ? [] : withdraw(c, { itemId: count.itemId, locationId: count.locationId, status: 'available', lotId: count.lotId || undefined, quantity: variance, unitCost: count.unitCost ? decimal(count.unitCost) : undefined, kind: 'adjustment', documentKind: 'counts', documentId: count.id, reason: `Approved count ${count.reference}` })
      return bump(count, { status: 'adjusted', approvalId: approval.id, approvedAt: c.now, approvedBy: c.actor.id, adjustmentMovementIds: movements.map(m => m.id), valueVariance: format(movements.reduce((n, m) => n + times(m.quantity, m.unitCost), 0n)) })
    }
  }
}
