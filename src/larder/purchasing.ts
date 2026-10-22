import { supplierTerms, quotedLines, validateQuoteLines, purchaseDate, purchaseNextDate } from './supplier-terms'
import { plansFor } from './quality-holds'
// Purchase orders: draft, approve, supplier confirmation, revised delivery,
// partial receipt with supplier lots, and quarantine decisions.
import { assertLotNotHeld } from './quality'
import { approvedCertificates, requiredTypes } from './certificate-policy'
import { requireCatalogLot } from './catalog-fields'
import { attach } from './attachments'
import { toBase } from './catalogue'
import { decimal, format, times } from './decimal'
import { fail } from './problem'
import { allow } from './roles'
import { authorize, gate } from './approval-policy'
import { averageCost, balance, move } from './stock'
import { lotDates } from './lot-dates'
import { damaged, overAllowance, tolerancePercent } from './receiving'
import { bump, date, fresh, get, list, newId, nextReference, oneOf, optionalText, row, text, type Context, type Row } from './model'

export function draftPurchase(c: Context, p: any, preparedBy?: string): Row {
  const supplier = get(c.s, 'parties', p.supplierId, 'supplier')
  if (supplier.kind === 'customer') fail('INPUT', `${supplier.name} is set up as a customer only.`)
  const expectedDate = date(p.expectedDate, 'expected date')
  const lines = list(p.lines).map((l: any) => {
    const item = get(c.s, 'items', l.itemId, 'item')
    if (item.archived) fail('ARCHIVED', `${item.name} is archived and cannot be bought.`)
    const quantity = toBase(item, l.quantity, l.unit), unitPrice = decimal(l.unitPrice, 'unit price')
    return { id: newId(), itemId: item.id, quantity: format(quantity), unitPrice: format(unitPrice), received: '0', rejected: '0', tolerancePercent: tolerancePercent(l.tolerancePercent), expectedDate: l.expectedDate ? date(l.expectedDate, 'line delivery date') : expectedDate }
  })
  validateQuoteLines(c, supplier.id, lines, p.requiredBy)
  const exposure = lines.reduce((n, l) => n + times(decimal(l.quantity), decimal(l.unitPrice)), 0n)
  return row(c, 'purchaseOrders', {
    reference: nextReference(c.s.purchaseOrders, 'PO'), supplierId: supplier.id, lines, supplierSnapshot: structuredClone({ id: supplier.id, name: supplier.name, terms: supplier.terms }), currency: 'USD', expectedDate: lines.map(l => l.expectedDate).sort()[0],
    requiredBy: p.requiredBy ? date(p.requiredBy, 'required-by date') : '', reason: text(p.reason, 'reason', 1000), exposure: format(exposure),
    status: 'draft', preparedBy: preparedBy ?? c.actor.id, history: [], supplierReference: '', confirmedDate: '',
  })
}

export const status = (po: Row) => po.lines.every((l: any) => decimal(l.quantity) === 0n) ? 'cancelled' : po.lines.every((l: any) => decimal(l.received) >= decimal(l.quantity)) ? 'received' : po.lines.some((l: any) => decimal(l.received) > 0n) ? 'part received' : po.supplierReference ? 'confirmed' : 'approved'

export function purchasing(c: Context, type: string, p: any): Row | undefined {
  switch (type) {
    case 'supplier.terms': return supplierTerms(c, p)
    case 'po.selectQuote':
      allow(c, ['manager', 'buyer', 'agent'])
      return draftPurchase(c, quotedLines(c, p))
    case 'po.draft':
      allow(c, ['manager', 'buyer', 'agent'])
      return draftPurchase(c, p)
    case 'po.approve': {
      authorize(c, ['manager', 'buyer'], 'spend')
      const po = get(c.s, 'purchaseOrders', p.poId, 'purchase order'); fresh(po, p.version)
      if (po.status !== 'draft') fail('STATE', 'Only a draft purchase order can be approved.')
      for (const l of po.lines) if (l.supplierQuote) {
        const ref = get(c.s, 'partyItems', l.supplierQuote.partyItemId, 'supplier terms')
        if (ref.version !== l.supplierQuote.version) fail('STALE', 'Supplier terms changed. Select the quote again before approval.')
      }
      const signed = gate(c, { category: 'spend', subjectKind: 'purchaseOrders', subject: po, measure: () => decimal(po.exposure), permitted: ['manager', 'buyer'], preparedBy: po.preparedBy, p })
      if (signed && 'pending' in signed) return signed.pending
      const approval = row(c, 'approvals', { subjectKind: 'purchaseOrders', subjectId: po.id, subjectVersion: po.version, decision: 'approved', role: c.actor.role, note: optionalText(p.note, 'note', 400), terms: structuredClone({ supplierId: po.supplierId, lines: po.lines, expectedDate: po.expectedDate, exposure: po.exposure, currency: po.currency, supplier: po.supplierSnapshot }), ...(signed ? { signatureIds: signed.signatureIds, override: signed.override } : {}) })
      signed?.consume(approval.id)
      return bump(po, { status: 'approved', approvalId: approval.id, approvedBy: c.actor.id })
    }
    case 'po.amend': {
      allow(c, ['manager', 'buyer', 'agent'])
      const po = get(c.s, 'purchaseOrders', p.poId, 'purchase order'); fresh(po, p.version)
      if (po.status !== 'draft') fail('STATE', 'Only a draft purchase order can be amended; revise an approved order\'s delivery instead.')
      const changes = list(p.lines, 'lines', 200).map((x: any) => ({ line: po.lines.find((l: any) => l.id === x.lineId) ?? fail('NOT_FOUND', 'That purchase order line was not found.', { lineId: x.lineId }), x }))
      const note = text(p.reason, 'reason', 400)
      for (const { line, x } of changes) {
        if (line.supplierQuote) fail('QUOTE_LINE', 'This line was priced from supplier terms. Select the quote again instead of amending it.')
        if (x.quantity !== undefined) line.quantity = format(toBase(get(c.s, 'items', line.itemId, 'item'), x.quantity, x.unit))
        if (x.unitPrice !== undefined) line.unitPrice = format(decimal(x.unitPrice, 'unit price'))
      }
      po.history.push({ at: c.now, by: c.actor.id, change: 'draft amended', note })
      return bump(po, { exposure: format(po.lines.reduce((n: bigint, l: any) => n + times(decimal(l.quantity), decimal(l.unitPrice)), 0n)) })
    }
    case 'po.confirm': {
      allow(c, ['manager', 'buyer'])
      const po = get(c.s, 'purchaseOrders', p.poId, 'purchase order'); fresh(po, p.version)
      if (!['approved', 'confirmed'].includes(po.status)) fail('STATE', 'Record supplier confirmation on an approved purchase order.')
      const confirmedDate = date(p.confirmedDate, 'confirmed delivery date')
      const targets = deliveryTargets(po, p.lineId)
      const schedulesBefore = structuredClone(po.lines)
      for (const l of targets) l.expectedDate = confirmedDate
      const nextDate = purchaseNextDate(po)
      const evidence = p.evidence ? attach(c, p.evidence) : null
      po.history.push({ at: c.now, by: c.actor.id, change: 'supplier confirmed', from: po.expectedDate, to: confirmedDate, note: text(p.supplierReference, 'supplier reference', 120), evidence, schedulesBefore, schedulesAfter: structuredClone(po.lines) })
      return bump(po, { supplierReference: text(p.supplierReference, 'supplier reference', 120), confirmedDate, expectedDate: nextDate, status: 'confirmed' })
    }
    case 'po.revise': {
      allow(c, ['manager', 'buyer'])
      const po = get(c.s, 'purchaseOrders', p.poId, 'purchase order'); fresh(po, p.version)
      if (!['approved', 'confirmed', 'part received'].includes(po.status)) fail('STATE', 'Only an open approved purchase order can have its delivery revised.')
      const expectedDate = date(p.expectedDate, 'expected date')
      const targets = deliveryTargets(po, p.lineId), schedulesBefore = structuredClone(po.lines)
      for (const l of targets) l.expectedDate = expectedDate
      po.history.push({ at: c.now, by: c.actor.id, change: 'delivery revised', from: po.expectedDate, to: expectedDate, note: text(p.note, 'reason', 400), schedulesBefore, schedulesAfter: structuredClone(po.lines) })
      return bump(po, { expectedDate: purchaseNextDate(po) })
    }
    case 'receipt.create': {
      allow(c, ['manager', 'warehouse'])
      const po = get(c.s, 'purchaseOrders', p.poId, 'purchase order')
      if (!['approved', 'confirmed', 'part received'].includes(po.status)) fail('STATE', 'Receive only against an approved purchase order.')
      const documents = p.documents === undefined ? [] : list(p.documents, 'documents', 10).map((d: any) => attach(c, d))
      const receipt = row(c, 'receipts', { reference: nextReference(c.s.receipts, 'GR'), poId: po.id, supplierReference: text(p.supplierReference, 'delivery reference', 120), documents, lines: [], status: 'received' })
      for (const l of list(p.lines)) {
        const line = po.lines.find((x: any) => x.id === l.lineId) ?? fail('NOT_FOUND', 'That purchase order line was not found.')
        const item = get(c.s, 'items', line.itemId, 'item'), location = get(c.s, 'locations', l.locationId, 'location'), q = toBase(item, l.quantity, l.unit)
        const outstanding = decimal(line.quantity) - decimal(line.received)
        if (q > overAllowance(line)) fail('OVER_RECEIPT', `Only ${format(outstanding)} ${item.baseUnit} of ${item.name} is still expected on ${po.reference}${decimal(line.tolerancePercent ?? '0') > 0n ? `, plus its ${line.tolerancePercent}% tolerance` : ''}.`, { lineId: line.id })
        let inspection = oneOf(l.inspection ?? 'accept', ['accept', 'quarantine'] as const, 'inspection')
        requireCatalogLot(item, l.lot)
        if (requiredTypes(c.s, item.id).length) {
          text(l.lot, 'lot required for controlled certificates', 80)
          inspection = 'quarantine'
        }
        const code = optionalText(l.lot, 'supplier lot', 80), dates = lotDates(l.dates, code, c.now.slice(0, 10)), damage = damaged(l.damage, q)
        // Damaged units arrive in quarantine under their own lot, so they can never be allocated or issued as accepted stock.
        for (const part of [{ quantity: q - (damage?.quantity ?? 0n), inspection, damage: null }, ...(damage ? [{ quantity: damage.quantity, inspection: 'quarantine' as const, damage }] : [])]) {
          if (part.quantity <= 0n) continue
          const partCode = part.damage && code ? `${code}-DAMAGED` : code
          const lot = partCode ? row(c, 'lots', { itemId: item.id, code: partCode, supplierId: po.supplierId, source: 'receipt', documentId: receipt.id, status: part.inspection === 'quarantine' ? 'quarantined' : 'released', ...dates }) : null
          const movement = move(c, { itemId: item.id, locationId: location.id, status: part.inspection === 'quarantine' ? 'quarantine' : 'available', lotId: lot?.id, quantity: part.quantity, unitCost: decimal(line.unitPrice), kind: 'receipt', documentKind: 'receipts', documentId: receipt.id, reason: part.damage ? `Received damaged on ${po.reference}: ${part.damage.reason}` : `Received on ${po.reference}` })
          receipt.lines.push({ lineId: line.id, itemId: item.id, locationId: location.id, quantity: format(part.quantity), lotId: lot?.id ?? '', inspection: part.inspection, ...(part.damage ? { damageReason: part.damage.reason } : {}), movementId: movement.id, expectedDate: purchaseDate(po, line), approvedDate: c.s.approvals.find(a => a.id === po.approvalId)?.terms?.lines.find((l: any) => l.id === line.id)?.expectedDate ?? po.expectedDate })
        }
        line.received = format(decimal(line.received) + q)
      }
      bump(po, { status: status(po), expectedDate: purchaseNextDate(po) })
      return receipt
    }
    case 'quarantine.decide': {
      if (c.s.subcontractOrders.some(o => o.vendorLocationId === p.locationId && o.issued.some((i: any) => i.lotId === p.lotId))) fail('SUBCONTRACT_CUSTODY', 'Use the service order to receive work or return unused material.')
      if (p.decision === 'release' && c.s.lots.some(l => l.id === p.lotId && l.source === 'subcontract')) {
        for (const plan of plansFor(c.s, 'receipt', p.itemId, null).filter(p => p.required)) if (!c.s.inspections.filter(i => i.planId === plan.id && i.subjectId === p.lotId).at(-1)?.passed) fail('RETEST', 'Record a passing subcontract receipt inspection first.')
      }
      if (p.decision === 'release' && c.s.reworkOrders.some(w => w.status !== 'released' && w.outputLots?.some((x: any) => x.lotId === p.lotId))) fail('REWORK_RELEASE', 'Use the repair/unbuild order release with approved evidence.')
      allow(c, ['manager', 'warehouse'])
      if (c.actor.role === 'agent') fail('FORBIDDEN', 'Agents cannot release stock.')
      const item = get(c.s, 'items', p.itemId, 'item'), location = get(c.s, 'locations', p.locationId, 'location')
      const lotId = p.lotId ? get(c.s, 'lots', p.lotId, 'lot').id : ''
      const q = toBase(item, p.quantity, p.unit), decision = oneOf(p.decision, ['release', 'reject'] as const, 'decision')
      if (balance(c.s, item.id, location.id, 'quarantine', lotId) < q) fail('INSUFFICIENT_STOCK', `Only ${format(balance(c.s, item.id, location.id, 'quarantine', lotId))} ${item.baseUnit} is in quarantine there.`)
      if (decision === 'release') approvedCertificates(c.s, item.id, lotId, c.now.slice(0, 10))
      if (decision === 'release') assertLotNotHeld(c.s, lotId, 'released from quarantine')
      // GOV-002 thresholds on the value: a release makes it available (quality), a rejection writes it off (inventory adjustment).
      const signed = gate(c, { category: decision === 'release' ? 'quality' : 'inventoryAdjustment', subjectKind: lotId ? 'lots' : 'items', subject: lotId ? get(c.s, 'lots', lotId) : item, measure: () => times(q, averageCost(c.s, item.id)), permitted: ['manager', 'warehouse'], terms: { decision, itemId: item.id, locationId: location.id, lotId, quantity: format(q) }, p })
      if (signed && 'pending' in signed) return signed.pending
      const approval = row(c, 'approvals', { subjectKind: 'lots', subjectId: lotId || item.id, subjectVersion: 0, decision: decision === 'release' ? 'released' : 'rejected', role: c.actor.role, note: text(p.reason, 'reason', 400), quantity: format(q), locationId: location.id , ...(signed ? { signatureIds: signed.signatureIds, override: signed.override } : {}) })
      signed?.consume(approval.id)
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

function deliveryTargets(po: Row, lineId: unknown): any[] {
  const targets = po.lines.filter((l: any) => (!lineId || l.id === lineId) && decimal(l.received) < decimal(l.quantity))
  if (!targets.length) fail('NOT_FOUND', 'Choose an outstanding delivery line.')
  return targets
}
