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
import { allow, approver } from './roles'
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
    billingStatus: 'Not billed', paymentState: 'not connected', status: 'draft', preparedBy: preparedBy ?? c.actor.id, history: [], supplierReference: '', confirmedDate: '',
  })
}

// How a supplier's confirmation reached the buyer when it was not received by Larder's own mail (BUY-007 fills the same field later).
export const confirmationSources = ['phone', 'email', 'portal', 'in person', 'other'] as const

export const status = (po: Row) => po.lines.every((l: any) => decimal(l.quantity) === 0n) ? 'cancelled' : po.lines.every((l: any) => decimal(l.received) >= decimal(l.quantity)) ? 'received' : po.lines.some((l: any) => decimal(l.received) > 0n) ? 'part received' : po.supplierReference ? 'confirmed' : 'approved'

export function purchasing(c: Context, type: string, p: any): Row | undefined {
  if (/^po\.(bill|claim|landed)\./.test(type)) return purchaseAccounting(c, type, p)
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
      const confirmedDate = date(p.confirmedDate, 'confirmed delivery date'), source = oneOf(p.source, confirmationSources, 'source'), reference = text(p.supplierReference, 'supplier reference', 120)
      const targets = deliveryTargets(po, p.lineId)
      const schedulesBefore = structuredClone(po.lines)
      // BUY-009: the line keeps what we asked for (requestedDate, set by an approved supply change) apart from what the supplier confirmed.
      for (const l of targets) { l.expectedDate = confirmedDate; l.confirmedDate = confirmedDate; l.confirmation = { date: confirmedDate, source, reference, by: c.actor.id, at: c.now } }
      const nextDate = purchaseNextDate(po)
      const evidence = p.evidence ? attach(c, p.evidence) : null
      po.history.push({ at: c.now, by: c.actor.id, change: 'supplier confirmed', from: po.expectedDate, to: confirmedDate, source, note: reference, evidence, schedulesBefore, schedulesAfter: structuredClone(po.lines) })
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

// Financial records stay on their original PO and travel in the existing archive.
// Decisions below prepare accountant handoffs; they never contact a provider.
function purchaseAccounting(c: Context, type: string, p: any): Row {
  if (c.actor.scope?.costs) fail('FORBIDDEN', 'This door requires unrestricted cost access.')
  const po = get(c.s, 'purchaseOrders', p.poId, 'purchase order')
  fresh(po, p.version)
  const reason = text(p.reason, 'reason', 400)
  const stamp = () => ({ id: newId(), at: c.now, by: c.actor.id, reason })
  const bills = po.bills ??= [], claims = po.supplierClaims ??= [], charges = po.landedCharges ??= []
  const bill = () => bills.find((b: any) => b.id === p.billId) ?? fail('NOT_FOUND', 'Choose a bill on this purchase order.')
  const claim = () => claims.find((r: any) => r.id === p.claimId) ?? fail('NOT_FOUND', 'Choose a claim on this purchase order.')
  const saved = () => bump(po, {})
  if (type === 'po.bill.capture') {
    allow(c, ['accounts'])
    if (po.status === 'draft') fail('STATE', 'Approve the purchase order before capturing a bill.')
    const reference = text(p.reference, 'invoice reference', 120)
    if (c.s.purchaseOrders.some(o => o.supplierId === po.supplierId && (o.bills ?? []).some((b: any) => b.reference === reference))) fail('DUPLICATE_BILL', 'That supplier invoice is already captured.')
    const currency = text(p.currency, 'invoice currency', 3)
    if (!/^[A-Z]{3}$/.test(currency)) fail('INPUT', 'Invoice currency needs three uppercase letters.')
    const seen = new Set<string>()
    const lines = list(p.lines).map((x: any) => {
      const line = po.lines.find((l: any) => l.id === x.lineId) ?? fail('NOT_FOUND', 'Choose a purchase order line.')
      if (seen.has(line.id)) fail('INPUT', 'List each purchase order line once.'); seen.add(line.id)
      const quantity = decimal(x.quantity, 'billed quantity', { positive: true }), unitPrice = decimal(x.unitPrice, 'invoice unit price')
      const accepted = c.s.receipts.filter(r => r.poId === po.id).flatMap(r => r.lines).filter((l: any) => l.lineId === line.id && l.inspection === 'accept').reduce((n: bigint, l: any) => n + decimal(l.quantity), 0n)
      const prior = bills.filter((b: any) => b.status === 'ready for handoff').flatMap((b: any) => b.lines).filter((l: any) => l.lineId === line.id).reduce((n: bigint, l: any) => n + decimal(l.quantity), 0n)
      return { lineId: line.id, itemId: line.itemId, quantity: format(quantity), unitPrice: format(unitPrice), acceptedQuantity: format(accepted), priorBilledQuantity: format(prior), quantityVariance: format(quantity + prior - accepted), priceVariance: format(unitPrice - decimal(line.unitPrice)) }
    })
    const freight = decimal(p.freight ?? '0', 'freight'), tax = decimal(p.tax ?? '0', 'tax')
    bills.push({ ...stamp(), reference, currency, lines, freight: format(freight), tax: format(tax), amount: format(lines.reduce((n: bigint, l: any) => n + times(decimal(l.quantity), decimal(l.unitPrice)), freight + tax)), evidence: attach(c, p.evidence), preparedBy: c.actor.id, status: 'captured', paymentState: 'not connected' })
    return saved()
  }
  if (type === 'po.bill.resolve') {
    allow(c, ['accounts'])
    const b = bill(); approver(c, ['accounts'], b.preparedBy)
    if (!['captured', 'resolved'].includes(b.status)) fail('STATE', 'Resolve a captured invoice before approval.')
    // Recompute against current receipts and approved bills at decision time.
    for (const l of b.lines) {
      const accepted = c.s.receipts.filter(r => r.poId === po.id).flatMap(r => r.lines).filter((x: any) => x.lineId === l.lineId && x.inspection === 'accept').reduce((n: bigint, x: any) => n + decimal(x.quantity), 0n)
      const prior = bills.filter((x: any) => x.status === 'ready for handoff').flatMap((x: any) => x.lines).filter((x: any) => x.lineId === l.lineId).reduce((n: bigint, x: any) => n + decimal(x.quantity), 0n)
      l.acceptedQuantity = format(accepted); l.priorBilledQuantity = format(prior); l.quantityVariance = format(decimal(l.quantity) + prior - accepted)
    }
    Object.assign(b, { resolution: { ...stamp(), evidence: attach(c, p.evidence) }, resolutionPoVersion: po.version + 1, status: 'resolved' })
    return saved()
  }
  if (type === 'po.bill.approve') {
    allow(c, [])
    const b = bill()
    if (b.status !== 'resolved') fail('STATE', 'Resolve the exact invoice before owner approval.')
    if (b.resolutionPoVersion !== po.version) fail('STALE', 'Receipt or bill inputs changed after resolution; resolve the invoice again.')
    if (b.currency !== po.currency) fail('CURRENCY', 'Cross-currency bills need the connected ledger and a recorded conversion; no USD handoff is inferred.')
    Object.assign(b, { status: 'ready for handoff', approval: stamp() })
    po.billingStatus = po.lines.every((l: any) => bills.filter((b: any) => b.status === 'ready for handoff').flatMap((b: any) => b.lines).filter((b: any) => b.lineId === l.id).reduce((n: bigint, b: any) => n + decimal(b.quantity), 0n) >= decimal(l.quantity)) ? 'Billed' : 'Partially billed'
    po.paymentState = 'not connected'
    return saved()
  }
  if (type === 'po.claim.open') {
    allow(c, ['warehouse', 'manager'])
    const receipt = get(c.s, 'receipts', p.receiptId, 'receipt')
    if (receipt.poId !== po.id) fail('INPUT', 'The receipt belongs to another purchase order.')
    const source = receipt.lines.find((l: any) => l.movementId === p.movementId) ?? fail('NOT_FOUND', 'Choose an original receipt movement.')
    const lot = get(c.s, 'lots', source.lotId, 'received lot'), item = get(c.s, 'items', source.itemId, 'item')
    requireCatalogLot(item, lot.code)
    const quantity = toBase(item, p.quantity, p.unit), dueDate = date(p.dueDate, 'claim due date')
    if (dueDate < c.now.slice(0, 10)) fail('INPUT', 'Choose a current or future due date.')
    const committed = claims.filter((r: any) => r.movementId === source.movementId).reduce((n: bigint, r: any) => n + decimal(r.quantity), 0n)
    if (quantity + committed > decimal(source.quantity)) fail('CLAIM_QUANTITY', 'Claims cannot exceed the original receipt quantity.')
    const original = c.s.movements.find(m => m.id === source.movementId)!
    claims.push({ ...stamp(), receiptId: receipt.id, movementId: source.movementId, itemId: item.id, lotId: lot.id, locationId: source.locationId, quantity: format(quantity), unitCost: format(original.unitCost), purpose: oneOf(p.purpose, ['rejected', 'excess'] as const, 'return reason'), supplierRma: text(p.supplierRma, 'supplier RMA reference', 120), ownerId: c.actor.id, dueDate, evidence: attach(c, p.evidence), shipments: [], replacements: [], credits: [], status: 'open' })
    return saved()
  }
  if (type === 'po.claim.ship') {
    allow(c, [])
    const r = claim(), quantity = decimal(p.quantity, 'return quantity', { positive: true })
    const sent = r.shipments.reduce((n: bigint, x: any) => n + decimal(x.quantity), 0n)
    if (quantity + sent > decimal(r.quantity)) fail('CLAIM_QUANTITY', 'Return only the unshipped claim quantity.')
    const stockStatus = oneOf(p.stockStatus, ['available', 'quarantine'] as const, 'stock status')
    if (stockStatus === 'available') assertLotNotHeld(c.s, r.lotId, 'returned to the supplier')
    if (r.purpose === 'rejected' && stockStatus !== 'quarantine') fail('STATE', 'Rejected returns ship only from quarantine.')
    const m = move(c, { itemId: r.itemId, lotId: r.lotId, locationId: r.locationId, status: stockStatus, quantity: -quantity, kind: 'supplier-return', documentKind: 'receipts', documentId: r.receiptId, reason: `${r.supplierRma}: ${reason}` })
    r.shipments.push({ ...stamp(), quantity: format(quantity), movementId: m.id, reference: text(p.reference, 'dispatch reference', 120), evidence: attach(c, p.evidence) })
    return saved()
  }
  if (type === 'po.claim.replace' || type === 'po.claim.credit') {
    allow(c, [])
    const r = claim(), quantity = decimal(p.quantity, 'settled quantity', { positive: true })
    const sent = r.shipments.reduce((n: bigint, x: any) => n + decimal(x.quantity), 0n), settled = [...r.replacements, ...r.credits].reduce((n: bigint, x: any) => n + decimal(x.quantity), 0n)
    if (settled + quantity > sent) fail('CLAIM_QUANTITY', 'Replacement and credit together cannot exceed the shipped quantity.')
    const reference = text(p.reference, 'supplier document reference', 120), evidence = attach(c, p.evidence)
    if (type === 'po.claim.replace') {
      const lot = row(c, 'lots', { itemId: r.itemId, code: text(p.lot, 'replacement lot', 80), supplierId: po.supplierId, source: 'receipt', documentId: r.receiptId, status: 'quarantined', replacementFor: r.lotId, claimId: r.id })
      const m = move(c, { itemId: r.itemId, lotId: lot.id, locationId: r.locationId, status: 'quarantine', quantity, unitCost: decimal(r.unitCost), kind: 'supplier-replacement', documentKind: 'receipts', documentId: r.receiptId, reason })
      r.replacements.push({ ...stamp(), quantity: format(quantity), lotId: lot.id, movementId: m.id, reference, evidence })
    } else {
      const b = bills.find((b: any) => b.id === p.billId && b.status === 'ready for handoff') ?? fail('STATE', 'Match the credit to an approved original bill.')
      const lineId = c.s.receipts.find(x => x.id === r.receiptId)!.lines.find((l: any) => l.movementId === r.movementId).lineId
      const billed = b.lines.find((l: any) => l.lineId === lineId) ?? fail('INPUT', 'The bill does not include this receipt line.')
      const credited = claims.filter((x: any) => c.s.receipts.find(y => y.id === x.receiptId)?.lines.some((l: any) => l.movementId === x.movementId && l.lineId === lineId)).flatMap((x: any) => x.credits).filter((x: any) => x.billId === b.id).reduce((n: bigint, x: any) => n + decimal(x.quantity), 0n)
      if (credited + quantity > decimal(billed.quantity)) fail('CREDIT_QUANTITY', 'Credits cannot exceed the original billed quantity.')
      if (c.s.purchaseOrders.some(o => o.supplierId === po.supplierId && (o.supplierClaims ?? []).some((r: any) => r.credits.some((x: any) => x.reference === reference)))) fail('DUPLICATE_CREDIT', 'That supplier credit is already matched.')
      const amount = decimal(p.amount, 'credit amount', { positive: true })
      if (amount !== times(quantity, decimal(r.unitCost))) fail('CREDIT_VARIANCE', 'Resolve a credit price variance in the connected ledger; this handoff matches the original receipt basis exactly.')
      r.credits.push({ ...stamp(), quantity: format(quantity), amount: format(amount), billId: b.id, reference, evidence })
    }
    return saved()
  }
  if (type === 'po.claim.close') {
    allow(c, [])
    const r = claim()
    if (r.status !== 'open') fail('STATE', 'Close an open claim once.')
    const sent = r.shipments.reduce((n: bigint, x: any) => n + decimal(x.quantity), 0n), settled = [...r.replacements, ...r.credits].reduce((n: bigint, x: any) => n + decimal(x.quantity), 0n)
    if (sent !== decimal(r.quantity) || settled !== sent) fail('CLAIM_OPEN', 'Ship and settle every claimed unit before closure.')
    for (const credit of r.credits) if (!c.s.handoffs.some(h => h.lines.some((l: any) => (l.purchasingCorrectionIds ?? []).includes(credit.id) && h.reconciliation?.some((x: any) => x.lineId === l.id && x.state === 'matched')))) fail('CLAIM_OPEN', 'Reconcile every credit with an accountant acknowledgement first.')
    Object.assign(r, { status: 'closed', closure: stamp(), reconciliation: 'accountant acknowledged; not provider verified' })
    return saved()
  }
  if (type === 'po.landed.prepare') {
    allow(c, ['accounts'])
    const policy = oneOf(p.policy, ['quantity', 'value', 'weight'] as const, 'allocation policy'), amount = decimal(p.amount, 'landed charge', { signed: true })
    if (amount === 0n) fail('INPUT', 'A landed charge must be nonzero.')
    if (amount < 0n && !charges.some((x: any) => x.id === p.correctsId && x.status === 'approved')) fail('INPUT', 'A negative correction must name an approved charge.')
    const seen = new Set<string>()
    const sources = list(p.sources).map((x: any) => {
      if (seen.has(x.movementId)) fail('INPUT', 'List each receipt movement once.'); seen.add(x.movementId)
      const m = c.s.movements.find(m => m.id === x.movementId && m.kind === 'receipt' && m.lotId && c.s.receipts.some(r => r.id === m.documentId && r.poId === po.id)) ?? fail('INPUT', 'Choose an exact lotted receipt on this purchase order.')
      const weight = policy === 'quantity' ? m.quantity : policy === 'value' ? times(m.quantity, m.unitCost) : decimal(x.weight, 'allocation weight', { positive: true })
      if (weight <= 0n) fail('INPUT', 'Allocation bases must be positive.')
      const movements = c.s.movements.filter(x => x.lotId === m.lotId)
      // Completed production needs exact downstream value attribution: never guess it from a job-level total.
      const out = movements.filter(x => x.quantity < 0n && !['transfer', 'release'].includes(x.kind))
      if (out.some(x => !['issue', 'shipment'].includes(x.kind) || (x.kind === 'issue' && c.s.workOrders.some(w => w.id === x.documentId && (decimal(w.output) > 0n || w.status === 'closed'))))) fail('LANDED_TRACE', 'This receipt needs downstream production or return cost attribution before allocation.')
      const stock = movements.reduce((n, x) => n + x.quantity, 0n), wip = -out.filter(x => x.kind === 'issue').reduce((n, x) => n + x.quantity, 0n), cogs = -out.filter(x => x.kind === 'shipment').reduce((n, x) => n + x.quantity, 0n)
      if (stock + wip + cogs !== m.quantity) fail('LANDED_TRACE', 'The receipt quantity does not reconcile to stock, open WIP and direct COGS.')
      return { movementId: m.id, itemId: m.itemId, lotId: m.lotId, weight, stock, wip, cogs, quantity: m.quantity }
    })
    const total = sources.reduce((n, x) => n + x.weight, 0n)
    let assigned = 0n, cumulative = 0n
    const lines = sources.map(x => {
      cumulative += x.weight
      const through = amount * cumulative / total, allocation = through - assigned; assigned = through
      const stock = allocation * x.stock / x.quantity, wip = allocation * (x.stock + x.wip) / x.quantity - stock
      return { movementId: x.movementId, itemId: x.itemId, lotId: x.lotId, weight: format(x.weight), quantity: format(x.quantity), amount: format(allocation), stock: format(stock), wip: format(wip), cogs: format(allocation - stock - wip) }
    })
    charges.push({ ...stamp(), kind: oneOf(p.kind, ['freight', 'duty', 'insurance', 'handling'] as const, 'charge kind'), policy, amount: format(amount), reference: text(p.reference, 'charge reference', 120), evidence: attach(c, p.evidence), correctsId: p.correctsId ?? '', lines, stateVersion: c.s.version + 1, status: 'draft' })
    return saved()
  }
  if (type === 'po.landed.approve') {
    allow(c, [])
    const charge = charges.find((x: any) => x.id === p.chargeId) ?? fail('NOT_FOUND', 'Choose a landed charge.')
    if (charge.status !== 'draft') fail('STATE', 'Approve a draft charge once.')
    if (charge.stateVersion !== c.s.version) fail('STALE', 'Stock or financial records changed; prepare a fresh allocation.')
    Object.assign(charge, { status: 'approved', approval: stamp() })
    return saved()
  }
  return fail('COMMAND', 'Unknown purchasing accounting command.')
}
