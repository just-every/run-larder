import { useState } from 'react'
import { byId, can, itemName, locationName, rows } from './api'
import type { Larder } from './app'
import { Card, Choose, Empty, Field, Form, options, Table, text } from './controls'
import { day, qty, words } from './format'
import { InventoryPlanView } from './inventory-plan-view'

export function InventoryPolicies({ larder }: { larder: Larder }) {
  const s = larder.state!, run = larder.run, busy = larder.busy, policies = rows(s, 'inventoryPolicies')
  const maintain = can(s, ['manager', 'production', 'planner']), prepare = can(s, ['manager', 'buyer', 'production', 'planner', 'agent'])
  const [selected, setSelected] = useState('')
  const policy = byId(s, 'inventoryPolicies', selected) ?? policies.at(-1)
  const supplies = policy ? [...rows(s, 'workOrders').filter(w => w.itemId === policy.itemId && ['draft', 'released'].includes(w.status) && !w.inventoryPolicy).map(w => ({ value: `workOrders:${w.id}`, label: `${w.reference} · ${qty(w.quantity)}` })), ...rows(s, 'purchaseOrders').filter(p => ['draft', 'approved', 'confirmed', 'part received'].includes(p.status)).flatMap(p => p.lines.filter((l: any) => l.itemId === policy.itemId && !l.inventoryPolicy && !p.inventoryPolicy).map((l: any) => ({ value: `purchaseOrders:${p.id}:${l.id}`, label: `${p.reference} · ${qty(l.quantity)}` })))] : []
  return <>
    <Card title="SKU and location policies"><p>Plan stock replenishment or customer-pegged manufacturing/assembly. <a href="#more/setup">Catalog bulk edit</a> maintains the authoritative reorder, safety, min/max, default-bin and lead-time settings. Quantities use base units; dates and calendar-day lead times use UTC.</p>
      {!policies.length ? <Empty>No inventory policies yet.</Empty> : <Table head={['Item / settings location', 'Mode', 'Effective / revision', 'Batch / multiple']} numeric={[3]}>{policies.map(p => <tr key={p.id}><td>{itemName(s, p.itemId)}<small>{locationName(s, p.locationId)}</small></td><td>{words(p.mode)}</td><td>{day(p.effectiveOn)} · {p.revision}</td><td>{qty(p.batchSize)} / {qty(p.orderMultiple)}</td></tr>)}</Table>}
      {maintain && <Form title="Save an immutable policy revision" submit="Save inventory policy" busy={busy} onSubmit={d => {
        const itemId = text(d, 'itemId'), locationId = text(d, 'locationId'), previous = policies.filter(p => p.itemId === itemId && p.locationId === locationId).sort((a, b) => b.revision - a.revision)[0]
        return run('inventory.policy', { itemId, locationId, previousId: previous?.id ?? null, mode: text(d, 'mode'), effectiveOn: text(d, 'effectiveOn'), batchSize: text(d, 'batchSize'), orderMultiple: text(d, 'orderMultiple'), reason: text(d, 'reason') })
      }}><Choose label="Policy item" name="itemId" options={options(rows(s, 'items').filter(i => !i.archived), i => `${i.name} · ${i.sku}`)} /><Choose label="Policy settings location" name="locationId" options={options(rows(s, 'locations').filter(l => !l.archived), l => l.name)} /><Choose label="Supply policy" name="mode" options={['make-to-stock', 'make-to-order', 'assemble-to-order'].map(value => ({ value, label: words(value) }))} /><Field label="Policy effective date" name="effectiveOn" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /><Field label="Batch size" name="batchSize" inputMode="decimal" defaultValue="1" /><Field label="Order multiple" name="orderMultiple" inputMode="decimal" defaultValue="1" /><Field label="Policy reason" name="reason" /></Form>}
    </Card>
    {prepare && policy && <Card title="Prepare an inventory plan"><Choose label="Inventory policy revision" name="policy" value={policy.id} onChange={(e: any) => setSelected(e.target.value)} options={policies.map(p => ({ value: p.id, label: `${itemName(s, p.itemId)} · ${locationName(s, p.locationId)} · ${words(p.mode)} · revision ${p.revision}` }))} />
      <Form submit="Preview inventory plan" busy={busy} note="Choose confirmed customer orders for this bin. Previously assigned open demand is always included. Available stock above the inventory floor is shared in rank order; hard reservations stay protected. Late supply is labelled, never a feasible capacity promise." onSubmit={d => run('inventory.preview', { policyId: policy.id, orderIds: d.getAll('orderId').map(String), reason: text(d, 'reason') })}>
        <fieldset className="lines wide"><legend>Customer demand</legend>{rows(s, 'salesOrders').filter(o => ['confirmed', 'part shipped'].includes(o.status) && o.lines.some((l: any) => l.itemId === policy.itemId)).map(o => <label key={o.id} className="check"><input type="checkbox" name="orderId" value={o.id} /> {o.reference} · {day(o.promiseDate)}</label>)}<p className="muted">Leave empty for stock replenishment without new customer demand.</p></fieldset><Field label="Inventory planning reason" name="reason" />
      </Form>
      {maintain && supplies.length > 0 && <Form title="Locate existing supply" submit="Record supply planning bin" busy={busy} note="Give an existing document the policy’s physical bin. This adds planning metadata only; it changes no quantities, dates, spend or physical stock." onSubmit={d => { const [kind, documentId, lineId] = text(d, 'supply').split(':'); const doc = byId(s, kind, documentId)!; return run('inventory.supplyAssign', { policyId: policy.id, kind, documentId, lineId, version: doc.version, reason: text(d, 'reason') }) }}><Choose label="Unlocated supply document" name="supply" options={supplies} /><Field label="Supply location reason" name="reason" /></Form>}
    </Card>}
    {[...rows(s, 'inventoryPlans')].reverse().map(plan => <InventoryPlanView key={plan.id} larder={larder} plan={plan} />)}
  </>
}
