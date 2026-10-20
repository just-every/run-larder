// BUY-004: approved service orders, lot-exact custody and partial receipts.
import { attach } from './attachments'
import { plansFor } from './quality-holds'
import { requiredTypes } from './certificate-policy'
import { customerStock, custody } from './subcontract-custody'
import { decimal, exactDivide, format, times } from './decimal'
import { bump, date, fresh, get, list, nextReference, row, text, type Context, type Row } from './model'
import { allow, approver } from './roles'
import { fail } from './problem'
import { move, withdraw } from './stock'

export function subcontract(c: Context, type: string, p: any): Row | undefined {
  if (type === 'customerStock.receive') return customerStock(c, type, p)
  if (!type.startsWith('subcontract.')) return
  if (type === 'subcontract.draft') {
    allow(c, ['manager', 'buyer', 'agent'])
    const supplier = get(c.s, 'parties', p.supplierId), item = get(c.s, 'items', p.itemId), location = get(c.s, 'locations', p.vendorLocationId)
    if (supplier.kind !== 'supplier') fail('INPUT', 'Choose a subcontract supplier.')
    const customer = p.customerId ? get(c.s, 'parties', p.customerId) : null
    if (customer && customer.kind !== 'customer') fail('INPUT', 'Choose a customer owner.')
    const quantity = decimal(p.quantity, 'output quantity', { positive: true }), serviceRate = decimal(p.serviceRate, 'service rate')
    return row(c, 'subcontractOrders', { reference: nextReference(c.s.subcontractOrders, 'SC'), supplierId: supplier.id, vendorLocationId: location.id, itemId: item.id, customerId: customer?.id ?? '', quantity: format(quantity), serviceRate: format(serviceRate), exposure: format(times(quantity, serviceRate)), expectedDate: date(p.expectedDate), operation: text(p.operation, 'operation'), status: 'draft', issued: [], receipts: [], returns: [], good: '0', scrap: '0', serviceAccrued: '0' })
  }
  const order = get(c.s, 'subcontractOrders', p.orderId); fresh(order, p.version)
  if (type === 'subcontract.approve') {
    approver(c, ['manager', 'buyer'], order.createdBy)
    if (order.status !== 'draft') fail('STATE', 'Approve a draft service order.')
    return bump(order, { status: 'approved', approval: { by: c.actor.id, at: c.now, operation: order.operation, quantity: order.quantity, serviceRate: order.serviceRate, exposure: order.exposure } })
  }
  if (!['approved', 'part received', 'received'].includes(order.status)) fail('STATE', 'Approve the service order first.')
  if (type === 'subcontract.dispatch') {
    allow(c, ['manager', 'buyer', 'warehouse'])
    if (order.status === 'received') fail('STATE', 'This order is fully received.')
    for (const line of list(p.lines)) {
      const lot = get(c.s, 'lots', line.lotId), from = get(c.s, 'locations', line.locationId), q = decimal(line.quantity, 'quantity', { positive: true })
      if (from.id === order.vendorLocationId) fail('INPUT', 'Choose a source outside vendor custody.')
      if ((lot.ownerId ?? '') !== order.customerId) fail('OWNERSHIP', 'Input ownership must match this service order.')
      const entry = { id: crypto.randomUUID(), itemId: lot.itemId, lotId: lot.id, quantity: format(q), consumed: '0', returned: '0', sourceLocationId: from.id, movementIds: [] as string[] }
      if (order.customerId) { custody(c, lot.id, from.id, -q, 'dispatch', order.id); custody(c, lot.id, order.vendorLocationId, q, 'dispatch', order.id) }
      else {
        const out = withdraw(c, { itemId: lot.itemId, locationId: from.id, lotId: lot.id, status: 'available', quantity: -q, kind: 'transfer', documentKind: 'subcontractOrders', documentId: order.id, reason: order.operation })[0]
        const incoming = move(c, { ...out, locationId: order.vendorLocationId, status: 'quarantine', quantity: q, unitCost: out.unitCost, kind: 'subcontract-custody' })
        entry.movementIds.push(out.id, incoming.id)
      }
      order.issued.push(entry)
    }
    return bump(order, {})
  }
  if (type === 'subcontract.receive') {
    allow(c, ['manager', 'buyer', 'warehouse'])
    const good = decimal(p.good, 'good quantity'), scrap = decimal(p.scrap, 'scrap quantity'), total = good + scrap
    if (!total || decimal(order.good) + decimal(order.scrap) + total > decimal(order.quantity)) fail('OVER_RECEIPT', 'Good plus scrap must be positive and within the approved quantity.')
    const location = get(c.s, 'locations', p.locationId), evidence = attach(c, p.evidence), reason = text(p.reason, 'receipt/yield note')
    if (location.id === order.vendorLocationId) fail('INPUT', 'Receive into a location outside vendor custody.')
    let material = 0n
    const inputs = list(p.inputs).map((line: any) => {
      const issued = order.issued.find((i: any) => i.id === line.issuedId) ?? fail('INPUT', 'Choose an issued material lot.')
      const q = decimal(line.quantity, 'consumed quantity', { positive: true })
      if (q > decimal(issued.quantity) - decimal(issued.consumed) - decimal(issued.returned)) fail('OVER_CONSUMPTION', 'Only remaining free-issue material can be consumed.')
      let movementId = ''
      if (order.customerId) custody(c, issued.lotId, order.vendorLocationId, -q, 'consume', order.id)
      else {
        const out = move(c, { itemId: issued.itemId, locationId: order.vendorLocationId, status: 'quarantine', lotId: issued.lotId, quantity: -q, kind: 'subcontract-consume', documentKind: 'subcontractOrders', documentId: order.id, reason })
        material += times(q, out.unitCost); movementId = out.id
      }
      issued.consumed = format(decimal(issued.consumed) + q)
      return { itemId: issued.itemId, lotId: issued.lotId, quantity: format(q), movementId }
    })
    const service = times(total, decimal(order.serviceRate)), value = material + (order.customerId ? 0n : service)
    const cost = exactDivide(value, total) ?? fail('COST_PRECISION', 'Material plus service must allocate exactly at six decimals across good plus scrap.')
    if (times(good, cost) + times(scrap, cost) !== value) fail('COST_PRECISION', 'Good and scrap allocations must conserve the exact six-decimal total.')
    const receipt = { id: crypto.randomUUID(), at: c.now, good: format(good), scrap: format(scrap), reason, evidence, inputs, material: format(material), service: format(service), unitCost: format(cost), outputValue: format(times(good, cost)), scrapValue: format(times(scrap, cost)), lotId: '', locationId: location.id }
    if (good) {
      const lot = row(c, 'lots', { itemId: order.itemId, code: text(p.lot, 'finished lot', 80), source: 'subcontract', documentId: order.id, receiptId: receipt.id, supplierId: order.supplierId, ownerId: order.customerId || undefined, status: order.customerId ? 'customer property' : (requiredTypes(c.s, order.itemId).length || plansFor(c.s, 'receipt', order.itemId, null).some(p => p.required)) ? 'quarantined' : 'released' })
      receipt.lotId = lot.id
      if (order.customerId) custody(c, lot.id, location.id, good, 'output', order.id)
      else move(c, { itemId: order.itemId, locationId: location.id, status: lot.status === 'quarantined' ? 'quarantine' : 'available', lotId: lot.id, quantity: good, unitCost: cost, kind: 'subcontract-output', documentKind: 'subcontractOrders', documentId: order.id, reason })
    }
    order.receipts.push(receipt)
    if (order.bill) { order.bill = { ...order.bill, expected: format(decimal(order.serviceAccrued) + service), difference: format(decimal(order.bill.amount) - decimal(order.serviceAccrued) - service), status: decimal(order.bill.amount) === decimal(order.serviceAccrued) + service ? 'recorded match' : 'difference' } }
    const newGood = decimal(order.good) + good, newScrap = decimal(order.scrap) + scrap
    return bump(order, { good: format(newGood), scrap: format(newScrap), serviceAccrued: format(decimal(order.serviceAccrued) + service), status: newGood + newScrap === decimal(order.quantity) ? 'received' : 'part received', yield: format(newGood ? exactDivide(newGood, newGood + newScrap) ?? (newGood * 1000000n / (newGood + newScrap)) : 0n) })
  }
  if (type === 'subcontract.return') {
    allow(c, ['manager', 'buyer', 'warehouse'])
    const issued = order.issued.find((i: any) => i.id === p.issuedId) ?? fail('INPUT', 'Choose issued material.'), q = decimal(p.quantity, 'quantity', { positive: true }), location = get(c.s, 'locations', p.locationId), reason = text(p.reason, 'return reason')
    if (location.id === order.vendorLocationId) fail('INPUT', 'Return outside vendor custody.')
    if (q > decimal(issued.quantity) - decimal(issued.consumed) - decimal(issued.returned)) fail('OVER_CONSUMPTION', 'Only remaining custody stock can return.')
    if (order.customerId) { custody(c, issued.lotId, order.vendorLocationId, -q, 'return', order.id); custody(c, issued.lotId, location.id, q, 'return', order.id) }
    else { const out = move(c, { itemId: issued.itemId, lotId: issued.lotId, locationId: order.vendorLocationId, status: 'quarantine', quantity: -q, kind: 'subcontract-return', documentKind: 'subcontractOrders', documentId: order.id, reason }); move(c, { ...out, locationId: location.id, status: 'available', quantity: q }) }
    issued.returned = format(decimal(issued.returned) + q); order.returns.push({ issuedId: issued.id, quantity: format(q), locationId: location.id, reason, at: c.now })
    return bump(order, {})
  }
  if (type === 'subcontract.bill') {
    allow(c, ['manager', 'accounts'])
    const amount = decimal(p.amount, 'bill amount'), reference = text(p.reference, 'supplier bill reference'), evidence = attach(c, p.evidence)
    const bill = { reference, amount: format(amount), expected: order.serviceAccrued, difference: format(amount - decimal(order.serviceAccrued)), by: c.actor.id, at: c.now, evidence, status: amount === decimal(order.serviceAccrued) ? 'recorded match' : 'difference' }
    order.bills ??= []; order.bills.push(bill)
    return bump(order, { bill })
  }
}
