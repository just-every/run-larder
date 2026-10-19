// Purchase orders: draft, approve, supplier confirmation, revised delivery,
// partial receipt with supplier lots, and quarantine decisions.
import { requireCatalogLot } from './catalog-fields'
import { attach } from './attachments'
import { toBase } from './catalogue'
import { decimal, format, times } from './decimal'
import { fail } from './problem'
import { allow, approver } from './roles'
import { balance, move } from './stock'
import { bump, date, fresh, get, list, newId, nextReference, oneOf, optionalText, row, text, type Context, type Row } from './model'

export function draftPurchase(c: Context, p: any, preparedBy?: string): Row {
  const supplier = get(c.s, 'parties', p.supplierId, 'supplier')
  if (supplier.kind === 'customer') fail('INPUT', `${supplier.name} is set up as a customer only.`)
  const lines = list(p.lines).map((l: any) => {
    const item = get(c.s, 'items', l.itemId, 'item')
    if (item.archived) fail('ARCHIVED', `${item.name} is archived and cannot be bought.`)
    const quantity = toBase(item, l.quantity, l.unit), unitPrice = decimal(l.unitPrice, 'unit price')
    return { id: newId(), itemId: item.id, quantity: format(quantity), unitPrice: format(unitPrice), received: '0', rejected: '0' }
  })
  const exposure = lines.reduce((n, l) => n + times(decimal(l.quantity), decimal(l.unitPrice)), 0n)
  return row(c, 'purchaseOrders', {
    reference: nextReference(c.s.purchaseOrders, 'PO'), supplierId: supplier.id, lines, expectedDate: date(p.expectedDate, 'expected date'),
    requiredBy: p.requiredBy ? date(p.requiredBy, 'required-by date') : '', reason: text(p.reason, 'reason', 1000), exposure: format(exposure),
    status: 'draft', preparedBy: preparedBy ?? c.actor.id, history: [], supplierReference: '', confirmedDate: '',
  })
}

const status = (po: Row) => po.lines.every((l: any) => decimal(l.received) >= decimal(l.quantity)) ? 'received' : po.lines.some((l: any) => decimal(l.received) > 0n) ? 'part received' : po.supplierReference ? 'confirmed' : 'approved'

export function purchasing(c: Context, type: string, p: any): Row | undefined {
  switch (type) {
    case 'po.draft':
      allow(c, ['manager', 'buyer', 'agent'])
      return draftPurchase(c, p)
    case 'po.approve': {
      approver(c, ['manager', 'buyer'])
      const po = get(c.s, 'purchaseOrders', p.poId, 'purchase order'); fresh(po, p.version)
      approver(c, ['manager', 'buyer'])
      if (po.status !== 'draft') fail('STATE', 'Only a draft purchase order can be approved.')
      const approval = row(c, 'approvals', { subjectKind: 'purchaseOrders', subjectId: po.id, subjectVersion: po.version, decision: 'approved', role: c.actor.role, note: optionalText(p.note, 'note', 400), terms: { supplierId: po.supplierId, lines: po.lines, expectedDate: po.expectedDate, exposure: po.exposure } })
      return bump(po, { status: 'approved', approvalId: approval.id, approvedBy: c.actor.id })
    }
    case 'po.confirm': {
      allow(c, ['manager', 'buyer'])
      const po = get(c.s, 'purchaseOrders', p.poId, 'purchase order'); fresh(po, p.version)
      if (!['approved', 'confirmed'].includes(po.status)) fail('STATE', 'Record supplier confirmation on an approved purchase order.')
      const confirmedDate = date(p.confirmedDate, 'confirmed delivery date')
      const evidence = p.evidence ? attach(c, p.evidence) : null
      po.history.push({ at: c.now, by: c.actor.id, change: 'supplier confirmed', from: po.expectedDate, to: confirmedDate, note: text(p.supplierReference, 'supplier reference', 120), evidence })
      return bump(po, { supplierReference: text(p.supplierReference, 'supplier reference', 120), confirmedDate, expectedDate: confirmedDate, status: 'confirmed' })
    }
    case 'po.revise': {
      allow(c, ['manager', 'buyer'])
      const po = get(c.s, 'purchaseOrders', p.poId, 'purchase order'); fresh(po, p.version)
      if (!['approved', 'confirmed', 'part received'].includes(po.status)) fail('STATE', 'Only an open approved purchase order can have its delivery revised.')
      const expectedDate = date(p.expectedDate, 'expected date')
      po.history.push({ at: c.now, by: c.actor.id, change: 'delivery revised', from: po.expectedDate, to: expectedDate, note: text(p.note, 'reason', 400) })
      return bump(po, { expectedDate })
    }
    case 'receipt.create': {
      allow(c, ['manager', 'warehouse'])
      const po = get(c.s, 'purchaseOrders', p.poId, 'purchase order')
      if (!['approved', 'confirmed', 'part received'].includes(po.status)) fail('STATE', 'Receive only against an approved purchase order.')
      const receipt = row(c, 'receipts', { reference: nextReference(c.s.receipts, 'GR'), poId: po.id, supplierReference: text(p.supplierReference, 'delivery reference', 120), lines: [], status: 'received' })
      for (const l of list(p.lines)) {
        const line = po.lines.find((x: any) => x.id === l.lineId) ?? fail('NOT_FOUND', 'That purchase order line was not found.')
        const item = get(c.s, 'items', line.itemId, 'item'), location = get(c.s, 'locations', l.locationId, 'location'), q = toBase(item, l.quantity, l.unit)
        const outstanding = decimal(line.quantity) - decimal(line.received)
        if (q > outstanding) fail('OVER_RECEIPT', `Only ${format(outstanding)} ${item.baseUnit} of ${item.name} is still expected on ${po.reference}.`, { lineId: line.id })
        const inspection = oneOf(l.inspection ?? 'accept', ['accept', 'quarantine'] as const, 'inspection')
        requireCatalogLot(item, l.lot)
        const code = optionalText(l.lot, 'supplier lot', 80)
        const lot = code ? row(c, 'lots', { itemId: item.id, code, supplierId: po.supplierId, source: 'receipt', documentId: receipt.id, status: inspection === 'quarantine' ? 'quarantined' : 'released' }) : null
        move(c, { itemId: item.id, locationId: location.id, status: inspection === 'quarantine' ? 'quarantine' : 'available', lotId: lot?.id, quantity: q, unitCost: decimal(line.unitPrice), kind: 'receipt', documentKind: 'receipts', documentId: receipt.id, reason: `Received on ${po.reference}` })
        line.received = format(decimal(line.received) + q)
        receipt.lines.push({ lineId: line.id, itemId: item.id, locationId: location.id, quantity: format(q), lotId: lot?.id ?? '', inspection })
      }
      bump(po, { status: status(po) })
      return receipt
    }
    case 'quarantine.decide': {
      allow(c, ['manager', 'warehouse'])
      if (c.actor.role === 'agent') fail('FORBIDDEN', 'Agents cannot release stock.')
      const item = get(c.s, 'items', p.itemId, 'item'), location = get(c.s, 'locations', p.locationId, 'location')
      const lotId = p.lotId ? get(c.s, 'lots', p.lotId, 'lot').id : ''
      const q = toBase(item, p.quantity, p.unit), decision = oneOf(p.decision, ['release', 'reject'] as const, 'decision')
      if (balance(c.s, item.id, location.id, 'quarantine', lotId) < q) fail('INSUFFICIENT_STOCK', `Only ${format(balance(c.s, item.id, location.id, 'quarantine', lotId))} ${item.baseUnit} is in quarantine there.`)
      const approval = row(c, 'approvals', { subjectKind: 'lots', subjectId: lotId || item.id, subjectVersion: 0, decision: decision === 'release' ? 'released' : 'rejected', role: c.actor.role, note: text(p.reason, 'reason', 400), quantity: format(q), locationId: location.id })
      const out = move(c, { itemId: item.id, locationId: location.id, status: 'quarantine', lotId, quantity: -q, kind: decision === 'release' ? 'release' : 'reject', documentKind: 'approvals', documentId: approval.id, reason: approval.note })
      if (decision === 'release') move(c, { itemId: item.id, locationId: location.id, status: 'available', lotId, quantity: q, unitCost: out.unitCost, kind: 'release', documentKind: 'approvals', documentId: approval.id, reason: approval.note })
      if (lotId && balance(c.s, item.id, location.id, 'quarantine', lotId) === 0n) {
        const lot = get(c.s, 'lots', lotId)
        bump(lot, { status: decision === 'release' ? 'released' : 'rejected' })
      }
      return approval
    }
  }
}
