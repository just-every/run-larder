// Reviewed SKU/location quantity policies. Physical and spending doors stay separate.
import { toBase } from './catalogue'
import { decimal, divide, format } from './decimal'
import { inventoryPlan } from './inventory-plan'
import { inventoryPolicyFields } from './inventory-policy-fields'
import { draftPurchase } from './purchasing'
import { draftWork } from './production'
import { fail } from './problem'
import { allow, approver } from './roles'
import { reserve } from './stock'
import { bump, fresh, get, row, text, type Context, type Row, type State } from './model'

export function currentInventoryPolicy(s: State, itemId: string, locationId: string, on: string) {
  return s.inventoryPolicies.filter(p => p.itemId === itemId && p.locationId === locationId && p.effectiveOn <= on)
    .sort((a, b) => b.effectiveOn.localeCompare(a.effectiveOn) || b.revision - a.revision)[0]
}
function active(c: Context, id: string) {
  const policy = get(c.s, 'inventoryPolicies', id, 'inventory policy'), on = c.now.slice(0, 10)
  if (currentInventoryPolicy(c.s, policy.itemId, policy.locationId, on)?.id !== policy.id) fail('POLICY_EFFECTIVE', 'Choose the current effective policy for this item and location.')
  inventoryPolicyFields(c.s, policy)
  return policy
}
function planningBin(s: State, policy: Row) {
  return get(s, 'items', policy.itemId).catalogLocations?.find((l: any) => l.locationId === policy.locationId)?.defaultBin ?? policy.locationId
}

export function inventory(c: Context, type: string, p: any): Row | undefined {
  if (!type.startsWith('inventory.')) return
  if (type === 'inventory.policy') {
    allow(c, ['manager', 'production', 'planner'])
    const fields = inventoryPolicyFields(c.s, p)
    const revisions = c.s.inventoryPolicies.filter(x => x.itemId === fields.itemId && x.locationId === fields.locationId).sort((a, b) => b.revision - a.revision)
    if ((p.previousId ?? null) !== (revisions[0]?.id ?? null)) fail('STALE', 'This policy changed. Review its latest revision.')
    return row(c, 'inventoryPolicies', { ...fields, revision: (revisions[0]?.revision ?? 0) + 1, previousId: revisions[0]?.id ?? null })
  }
  if (type === 'inventory.supplyAssign') {
    allow(c, ['manager', 'production', 'planner'])
    const policy = active(c, p.policyId), kind = p.kind
    if (kind !== 'workOrders' && kind !== 'purchaseOrders') fail('INPUT', 'Choose work or purchase supply.')
    const document = get(c.s, kind, p.documentId, 'supply document'); fresh(document, p.version)
    if (!(kind === 'workOrders' ? ['draft', 'released'] : ['draft', 'approved', 'confirmed', 'part received']).includes(document.status)) fail('STATE', 'Assign only open supply.')
    const target = kind === 'workOrders' ? document : document.lines.find((l: any) => l.id === p.lineId) ?? fail('NOT_FOUND', 'Choose a purchase line.')
    if (target.itemId !== policy.itemId) fail('INPUT', 'The supply must match the policy item.')
    const bin = planningBin(c.s, policy), orderId = p.orderId || null, lineId = p.orderLineId || null
    if (Boolean(orderId) !== Boolean(lineId)) fail('INPUT', 'A customer peg needs both order and line.')
    if (orderId) {
      const o = get(c.s, 'salesOrders', orderId, 'sales order')
      if (!['confirmed', 'part shipped'].includes(o.status) || !o.lines.some((l: any) => l.id === lineId && l.itemId === policy.itemId)) fail('INPUT', 'Choose an outstanding order line for this item.')
    }
    if (target.inventoryPolicy) fail('STATE', 'This supply already has a planning assignment; its commitments cannot be silently moved.')
    const tag = { policyId: policy.id, planningLocationId: policy.locationId, locationId: bin, orderId, lineId, assignedBy: c.actor.id, assignedAt: c.now, reason: text(p.reason, 'assignment reason', 400) }
    target.inventoryPolicy = tag
    document.inventoryHistory = [...(document.inventoryHistory ?? []), { lineId: target === document ? null : target.id, before: null, after: tag }]
    return bump(document, {})
  }
  if (type === 'inventory.preview') {
    allow(c, ['manager', 'buyer', 'production', 'planner', 'agent'])
    const policy = active(c, p.policyId), bin = planningBin(c.s, policy)
    if (!Array.isArray(p.orderIds) || p.orderIds.length > 500 || p.orderIds.some((id: any) => typeof id !== 'string')) fail('INPUT', 'Select up to 500 sales orders, or none for stock replenishment.')
    const orderIds = new Set<string>(p.orderIds)
    for (const o of c.s.salesOrders.filter(o => ['confirmed', 'part shipped'].includes(o.status))) {
      const relevant = o.lines.filter((l: any) => l.itemId === policy.itemId)
      if (orderIds.has(o.id) && relevant.some((l: any) => l.inventoryPoolLocationId && l.inventoryPoolLocationId !== bin)) fail('DEPENDENCY', 'An order line is already committed to another planning bin.', { orderId: o.id })
      if (relevant.some((l: any) => l.inventoryPoolLocationId === bin)) orderIds.add(o.id)
    }
    const preview = inventoryPlan(c.s, { ...policy, orderIds: [...orderIds] }, c.now.slice(0, 10))
    for (const suggestion of preview.suggestions) if (suggestion.kind === 'work' && !suggestion.bomId) preview.blockers.push({ code: 'NO_BOM', documentId: suggestion.itemId, message: 'Make supply needs an effective bill of materials.' })
    return row(c, 'inventoryPlans', { status: 'preview', stateVersion: c.s.version + 1, preparedBy: c.actor.id, reason: text(p.reason, 'planning reason', 400), preview })
  }
  if (type === 'inventory.approve') {
    const plan = get(c.s, 'inventoryPlans', p.planId, 'inventory preview'); fresh(plan, p.version)
    approver(c, ['manager', 'production', 'planner'], plan.preparedBy)
    if (plan.status !== 'preview') fail('STATE', 'Only a preview can be approved.')
    if (plan.stateVersion !== c.s.version) fail('STALE', 'Records changed. Prepare a fresh inventory preview.')
    const policy = active(c, plan.preview.policyId), preview = plan.preview
    if (preview.blockers.length) fail('DEPENDENCY', 'Resolve the listed planning blockers before approval.', preview.blockers)
    const touched = new Set<string>()
    for (const d of preview.demand) {
      const order = get(c.s, 'salesOrders', d.orderId), line = order.lines.find((l: any) => l.id === d.lineId)
      line.inventoryPoolLocationId = preview.poolLocationId; touched.add(order.id)
    }
    for (const allocation of preview.commonAllocations) {
      const quantity = decimal(allocation.quantity), actual = reserve(c, { demandKind: 'sales', demandId: allocation.orderId, lineId: allocation.lineId, itemId: allocation.itemId }, quantity, allocation.locationId)
      if (actual !== quantity) fail('STALE', 'Common stock no longer covers the reviewed allocation.')
    }
    for (const id of touched) bump(get(c.s, 'salesOrders', id), {})
    const documents = preview.suggestions.map((suggestion: any) => {
      const item = get(c.s, 'items', suggestion.itemId), reason = `${plan.reason}; ${policy.mode} policy revision ${policy.revision}`
      let document: Row, kind: string
      if (suggestion.kind === 'work') {
        kind = 'workOrders'; document = draftWork(c, { itemId: item.id, quantity: suggestion.quantity, requiredBy: suggestion.requiredBy, plannedStart: suggestion.plannedStart, reason }, plan.preparedBy)
        document.inventoryBomId = suggestion.bomId
      } else {
        kind = 'purchaseOrders'
        const terms = c.s.partyItems.filter(t => t.itemId === item.id && c.s.parties.some(v => v.id === t.partyId && v.kind !== 'customer'))
        const supplier = terms.find(t => t.preferred) ?? terms[0] ?? fail('NO_SUPPLIER', `Choose a supplier for ${item.name} before approving supply.`)
        document = draftPurchase(c, { supplierId: supplier.partyId, expectedDate: suggestion.requiredBy, requiredBy: suggestion.requiredBy, reason, lines: [{ itemId: item.id, quantity: suggestion.quantity, unitPrice: format(divide(decimal(supplier.price), toBase(item, '1', supplier.unit))) }] }, plan.preparedBy)
      }
      document.inventoryPolicy = { planId: plan.id, policyId: policy.id, planningLocationId: policy.locationId, locationId: suggestion.defaultBin, orderId: suggestion.orderId, lineId: suggestion.lineId, pegs: suggestion.pegs, quantity: suggestion.quantity, plannedStart: suggestion.plannedStart }
      return { kind, id: document.id, reference: document.reference, quantity: suggestion.quantity, pegs: suggestion.pegs }
    })
    return bump(plan, { status: 'approved', approvedBy: c.actor.id, approvedAt: c.now, documents })
  }
  return undefined
}
