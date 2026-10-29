// The accountant handoff: immutable batches of operational movements valued
// for the external ledger, acknowledged line by line with ledger references.
// Larder never posts journals; the accountant's ledger stays the authority.
import { cents, decimal, format, times } from './decimal'
import { fail } from './problem'
import { shipmentPrice } from './sales-terms'
import { allow } from './roles'
import { bump, fresh, get, list, newId, nextReference, optionalText, row, text, type Context, type Movement, type Row, type State } from './model'

const internal = new Set(['transfer', 'release', 'transfer-reversal', 'release-reversal', 'batch-release'])
const handedOff = (s: State) => new Map(s.handoffs.flatMap(h => h.lines.flatMap((l: any) => l.movementIds.map((id: string) => [id, { handoffId: h.id, reference: h.reference, lineId: l.id }] as const))))

// A shipment line for invoice preparation retains its issued price; `m` is the shipment
// movement itself or the reversal that corrects it, whose sign it carries.
function invoiced(s: State, shipment: Movement, m: Movement) {
  const sh = s.shipments.find(x => x.id === shipment.documentId), o = s.salesOrders.find(x => x.id === sh?.orderId)
  const terms = shipmentPrice(s, shipment), price = decimal(terms.unitPrice)
  return { party: s.parties.find(p => p.id === o?.customerId)?.name ?? '', document: `${sh?.reference} / ${o?.reference}`, partyReference: sh?.commercialTerms?.customerReference ?? o?.customerReference ?? '', unitAmount: format(price), amount: times(-m.quantity, price), cost: format(times(m.quantity, m.unitCost)), priceBasis: terms.priceBasis }

}

function describe(s: State, m: Movement) {
  const item = s.items.find(i => i.id === m.itemId)
  const base = { itemSku: item?.sku ?? '', itemName: item?.name ?? '', party: '', document: '', partyReference: '', unitAmount: format(m.unitCost), amount: times(m.quantity, m.unitCost) }
  if (m.documentKind === 'receipts') {
    const r = s.receipts.find(x => x.id === m.documentId), po = s.purchaseOrders.find(x => x.id === r?.poId)
    return { ...base, type: m.kind === 'supplier-return' ? 'Supplier return stock correction' : m.kind === 'supplier-replacement' ? 'Supplier replacement receipt' : 'Supplier receipt', party: s.parties.find(p => p.id === po?.supplierId)?.name ?? '', document: `${r?.reference} / ${po?.reference}`, partyReference: r?.supplierReference ?? '' }
  }
  if (m.documentKind === 'shipments') return { ...base, ...invoiced(s, m, m), type: 'Customer shipment (invoice preparation)' }
  if (m.documentKind === 'reworkOrders') return { ...base, type: m.kind, document: s.reworkOrders.find(x => x.id === m.documentId)?.reference ?? '' }
  if (m.documentKind === 'workOrders') return { ...base, type: m.kind === 'issue' ? 'Production material issue' : 'Production output', document: s.workOrders.find(x => x.id === m.documentId)?.reference ?? '' }
  if (m.documentKind === 'counts') return { ...base, type: 'Count adjustment', document: s.counts.find(x => x.id === m.documentId)?.reference ?? '' }
  if (m.documentKind === 'openings') return { ...base, type: 'Opening stock', document: s.openings.find(x => x.id === m.documentId)?.reference ?? '' }
  if (m.documentKind === 'returns') {
    const record = s.returns.find(record => record.id === m.documentId), source = record?.sources?.find((source: any) => source.returnMovementId === m.id)
    return source ? { ...base, type: 'Customer return', document: record?.reference ?? '', unitAmount: source.unitPrice, amount: -times(m.quantity, decimal(source.unitPrice)), priceBasis: source.priceBasis }
      : { ...base, type: 'Customer return', document: record?.reference ?? '', priceBasis: 'legacy return has no recorded issued price; stock cost only' }
  }
  if (m.documentKind === 'reversals') {
    const document = s.reversals.find(x => x.id === m.documentId)?.targetReference ?? '', original = s.movements.find(x => x.id === m.reversesId)
    // A reversed shipment corrects an invoice line: value it at its issued price so it offsets that line exactly.
    if (original?.documentKind === 'shipments') return { ...base, ...invoiced(s, original, m), type: 'Correction (reversal)', document }
    if (original?.documentKind === 'returns') {
      const record = s.returns.find(record => record.id === original.documentId), source = record?.sources?.find((source: any) => source.returnMovementId === original.id)
      if (source) return { ...base, type: 'Correction (reversal)', document, unitAmount: source.unitPrice, amount: -times(m.quantity, decimal(source.unitPrice)), priceBasis: source.priceBasis }
    }
    return { ...base, type: 'Correction (reversal)', document }
  }
  if (m.kind === 'reject') return { ...base, type: 'Rejected to supplier' }
  return { ...base, type: m.kind }
}

export function pendingHandoffCount(s: State) {
  const done = handedOff(s)
  return s.movements.filter(m => !done.has(m.id) && !internal.has(m.kind)).length + pendingValuations(s).length + purchasingCorrections(s).length
}

function pendingValuations(s: State) {
  const done = new Set(s.handoffs.flatMap(h => h.lines.flatMap((l: any) => l.valuationIds ?? [])))
  // A batch allocation values its original output movements; it is not a later correcting entry.
  return s.costValuations.filter(v => v.status === 'approved' && !v.batchAllocation && !done.has(v.id))
}
export function handoffLines(s: State) {
  const done = handedOff(s)
  // The local costed invoice retains exact customer cents. The legacy movement
  // handoff has no reviewed foreign-currency reconciliation; refuse rather
  // than emit an inferred unit price or a second invoice preparation.
  const unsupported = s.movements.some(m => {
    if (done.has(m.id)) return false
    const original = m.reversesId ? s.movements.find(old => old.id === m.reversesId) ?? m : m
    const shipment = original.documentKind === 'shipments' ? s.shipments.find(sh => sh.id === original.documentId) : undefined
    const returned = original.documentKind === 'returns' ? s.returns.find(r => r.id === original.documentId) : undefined
    return s.salesOrders.some(o => o.quoteAcceptance && (o.id === shipment?.orderId || o.id === returned?.orderId))
  })
  if (unsupported) fail('CUSTOMER_CURRENCY_HANDOFF', 'An accepted costed order needs exact invoice reconciliation before accountant handoff. Its local invoice and original customer terms remain available; no inferred financial lines were prepared.')
  const movementLines = s.movements.filter(m => !done.has(m.id) && !internal.has(m.kind)).map(m => {
    const d = describe(s, m), corrects = m.reversesId ? done.get(m.reversesId) ?? null : null
    return { id: newId(), movementIds: [m.id], ...d, quantity: format(m.quantity), amount: format(d.amount), amountCents: cents(d.amount), corrects, date: m.createdAt.slice(0, 10) }
  })
  const valuationLines = pendingValuations(s).flatMap(v => v.lines.map((l: any) => ({ id:newId(),movementIds:[],valuationIds:[v.id],sourceMovementIds:[l.movementId],itemSku:s.items.find(i=>i.id===l.itemId)?.sku??'',itemName:s.items.find(i=>i.id===l.itemId)?.name??'',type:'Production valuation correction (no stock quantity)',party:'',partyReference:'',document:s.workOrders.find(w=>w.id===v.workOrderId)?.reference??'',unitAmount:l.unitCost,quantity:'0',amount:l.valueChange,amountCents:cents(decimal(l.valueChange,'valuation correction',{signed:true})),corrects:null,date:v.approvedAt.slice(0,10) })))
  return [...movementLines,...valuationLines,...purchasingCorrections(s)]
}

export const handoffColumns = ['line', 'date', 'type', 'document', 'party', 'party_reference', 'sku', 'item', 'quantity', 'unit_amount', 'amount', 'corrects_batch', 'corrects_line']
export function handoffCsv(h: Row) {
  const cell = (v: unknown) => {
    // Spreadsheet formula prefixes are neutralised; negative numbers stay numbers.
    let t = String(v ?? '')
    if (/^[=+@\t\r]/.test(t) || /^-(?!\d)/.test(t)) t = "'" + t
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  return [handoffColumns.join(','), ...h.lines.map((l: any) => [l.id, l.date, l.type, l.document, l.party, l.partyReference, l.itemSku, l.itemName, l.quantity, l.unitAmount, l.amountCents, l.corrects?.reference ?? '', l.corrects?.lineId ?? ''].map(cell).join(','))].join('\r\n') + '\r\n'
}

function reconcile(h: Row) {
  const latest = new Map<string, any>()
  for (const a of h.acknowledgements) latest.set(a.lineId, a)
  const lines = h.lines.map((l: any) => ({ lineId: l.id, expected: l.amountCents, ...(latest.get(l.id) ?? {}), state: !latest.has(l.id) ? 'waiting' : latest.get(l.id).amount === l.amountCents ? 'matched' : 'mismatch' }))
  const status = lines.some((l: any) => l.state === 'mismatch') ? 'mismatch' : lines.every((l: any) => l.state === 'matched') ? 'acknowledged' : lines.some((l: any) => l.state === 'matched') ? 'part acknowledged' : 'sent'
  return { lines, status }
}

export function handoff(c: Context, type: string, p: any): Row | undefined {
  switch (type) {
    case 'handoff.prepare': {
      allow(c, ['manager', 'accounts'])
      const lines = handoffLines(c.s)
      if (!lines.length) fail('NOTHING_TO_HAND_OFF', 'Every movement is already in a handoff batch.')
      const total = lines.reduce((n, l) => n + decimal(l.amount, 'amount', { signed: true }), 0n)
      return row(c, 'handoffs', { reference: nextReference(c.s.handoffs, 'HO'), frontier: c.s.movements.at(-1)?.sequence ?? 0, lines, total: format(total), note: optionalText(p.note, 'note', 400), acknowledgements: [], reconciliation: null, status: 'sent' })
    }
    case 'handoff.acknowledge': {
      allow(c, ['manager', 'accounts'])
      const h = get(c.s, 'handoffs', p.handoffId, 'handoff'); fresh(h, p.version)
      for (const e of list(p.entries, 'entries', 5000)) {
        if (!h.lines.some((l: any) => l.id === e.lineId)) fail('NOT_FOUND', 'An acknowledged line is not in this batch.', { lineId: e.lineId })
        const amount = cents(decimal(String(e.amount ?? ''), 'acknowledged amount', { signed: true }))
        h.acknowledgements.push({ lineId: e.lineId, ledgerId: text(e.ledgerId, 'ledger reference', 120), amount, note: optionalText(e.note, 'note', 400), by: c.actor.id, at: c.now })
      }
      const r = reconcile(h)
      return bump(h, { reconciliation: r.lines, status: r.status })
    }
  }
}


// Credit and landed-cost decisions are separate financial lines, never stock movements.
function purchasingCorrections(s: State) {
  const done = new Set(s.handoffs.flatMap(h => h.lines.flatMap((l: any) => l.purchasingCorrectionIds ?? [])))
  return s.purchaseOrders.flatMap(po => {
    const base = { movementIds: [], quantity: '0', unitAmount: '0', itemSku: '', itemName: '', party: s.parties.find(p => p.id === po.supplierId)?.name ?? '', document: po.reference, corrects: null }
    const credits = (po.supplierClaims ?? []).flatMap((r: any) => r.credits.filter((x: any) => !done.has(x.id)).map((x: any) => ({ ...base, id: newId(), purchasingCorrectionIds: [x.id], sourceMovementIds: [r.movementId], billId: x.billId, claimId: r.id, type: 'Supplier credit (payable correction; no stock quantity)', partyReference: x.reference, amount: format(-decimal(x.amount)), amountCents: cents(-decimal(x.amount)), date: x.at.slice(0, 10) })))
    const landed = (po.landedCharges ?? []).filter((x: any) => x.status === 'approved').flatMap((x: any) => {
      let cumulative = 0n, presented = 0n
      return x.lines.flatMap((l: any) => ['stock', 'wip', 'cogs'].filter(k => decimal(l[k], 'correction', { signed: true }) !== 0n).map(k => {
        cumulative += decimal(l[k], 'correction', { signed: true })
        const through = decimal(cents(cumulative), 'rounded correction', { signed: true }), amountCents = cents(through - presented)
        presented = through
        return { ...base, id: newId(), purchasingCorrectionIds: [`${x.id}:${l.movementId}:${k}`], sourceMovementIds: [l.movementId], type: `Landed cost ${k.toUpperCase()} correction (no stock quantity)`, partyReference: x.reference, amount: l[k], amountCents, date: x.approval.at.slice(0, 10), correctsChargeId: x.correctsId, allocationPolicy: x.policy }
      })).filter((l: any) => !done.has(l.purchasingCorrectionIds[0]))
    })
    return [...credits, ...landed]
  })
}
