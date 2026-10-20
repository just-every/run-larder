// Customer property is a separate custody ledger, never owned stock or valuation.
import { attach } from './attachments'
import { decimal, format } from './decimal'
import { get, row, text, type Context, type State } from './model'
import { fail } from './problem'
import { allow } from './roles'
export function customerBalance(s: State, lotId: string, locationId: string) {
  return s.subcontractCustody.filter(e => e.lotId === lotId && e.locationId === locationId).reduce((n, e) => n + decimal(e.quantity, 'custody quantity', { signed: true }), 0n)
}
export function custody(c: Context, lotId: string, locationId: string, quantity: bigint, kind: string, orderId = '') {
  const lot = get(c.s, 'lots', lotId)
  if (!lot.ownerId) fail('OWNERSHIP', 'Choose a customer-owned lot.')
  if (customerBalance(c.s, lotId, locationId) + quantity < 0n) fail('INSUFFICIENT_STOCK', 'Not enough customer property in custody.')
  return row(c, 'subcontractCustody', { lotId, itemId: lot.itemId, ownerId: lot.ownerId, locationId, quantity: format(quantity), kind, orderId, ownedValue: '0' })
}
export function customerStock(c: Context, type: string, p: any) {
  if (type !== 'customerStock.receive') return
  allow(c, ['manager', 'warehouse', 'buyer'])
  const customer = get(c.s, 'parties', p.customerId), item = get(c.s, 'items', p.itemId), location = get(c.s, 'locations', p.locationId)
  if (customer.kind === 'supplier') fail('INPUT', 'Choose a customer owner.')
  const evidence = attach(c, p.evidence), quantity = decimal(p.quantity, 'quantity', { positive: true })
  const lot = row(c, 'lots', { itemId: item.id, code: text(p.lot, 'customer lot', 80), ownerId: customer.id, source: 'customer-custody', evidence, status: 'customer property' })
  custody(c, lot.id, location.id, quantity, 'intake')
  return lot
}
