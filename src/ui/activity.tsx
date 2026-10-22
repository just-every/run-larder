import { personName, rows } from './api'
import type { Larder } from './app'
import { Card, Empty, Table } from './controls'
import { AuditTrail } from './audit-trail'
import { when, words } from './format'

// Each recorded command, as the person who did it would say it.
export const actions: Record<string, string> = {
  'item.save': 'Saved an item', 'location.save': 'Saved a location', 'party.save': 'Saved a contact', 'partyItem.save': 'Saved a supplier or customer code',
  'bom.revise': 'Saved a bill of materials revision', 'opening.record': 'Recorded opening stock', 'transfer.create': 'Transferred stock',
  'count.record': 'Recorded a count', 'count.approve': 'Approved a count adjustment', 'count.reject': 'Asked for a recount', 'quarantine.decide': 'Decided on quarantined stock',
  'movement.reverse': 'Reversed a recorded movement', 'so.quote': 'Saved a quote', 'so.confirm': 'Confirmed an order', 'so.reserve': 'Reserved stock for an order',
  'so.cancelLine': 'Canceled open quantity', 'shipment.pick': 'Picked an order', 'shipment.pack': 'Packed a shipment', 'shipment.ship': 'Shipped', 'return.receive': 'Received a return',
  'plan.draft': 'Drafted from a shortage', 'po.draft': 'Drafted a purchase order', 'po.approve': 'Approved a purchase order', 'po.confirm': 'Recorded a supplier confirmation',
  'po.revise': 'Revised an expected delivery', 'supply.change.approve': 'Approved a purchase supply change', 'supply.change.reject': 'Rejected a purchase supply change', 'receipt.create': 'Received a delivery', 'wo.draft': 'Drafted a work order', 'wo.release': 'Released a work order',
  'wo.operation.pause': 'Paused an operation for lost time', 'wo.operation.resume': 'Resumed an operation',
  'wo.operation.report': 'Reported actual operation quantities', 'wo.operation.hold': 'Held completed operation units', 'wo.operation.holdRelease': 'Released an operation hold', 'wo.operation.backorder': 'Backordered uncompleted operation units', 'wo.operation.backorderResume': 'Resumed a manufacturing backorder',
  'wo.operation.progress': 'Reported operation progress and remaining effort', 'wo.operation.escalationAck': 'Acknowledged an in-app downtime escalation',
  'wo.reserve': 'Reserved materials', 'wo.issue': 'Issued materials', 'wo.output': 'Recorded output', 'wo.close': 'Closed a work order',
  'handoff.prepare': 'Prepared a handoff batch', 'handoff.acknowledge': 'Recorded the accountant’s acknowledgement', 'exception.resolve': 'Resolved an exception',
  'proposal.prepare': 'Prepared a proposal', 'proposal.approve': 'Approved a proposal', 'proposal.reject': 'Declined a proposal', 'role.set': 'Set a role',
  'import.preview': 'Previewed an Odoo move-in', 'import.commit': 'Committed an Odoo move-in', 'import.undo': 'Undid an Odoo move-in',
}

export function Activity({ larder }: { larder: Larder }) {
  const s = larder.state!, list = rows(s, 'commands')
  return <>
    {['owner', 'manager'].includes(s.actor.role) && <AuditTrail />}
    <Card title="Recorded actions">{list.length === 0 ? <Empty>No actions recorded yet.</Empty> :
      <Table head={['When', 'Who', 'What']}>{list.map(c => <tr key={c.id}><td>{when(c.createdAt)}</td><td>{personName(s, c.actorId)}</td><td>{actions[c.type] ?? words(String(c.type).replace('.', ' '))}</td></tr>)}</Table>}</Card>
  </>
}
