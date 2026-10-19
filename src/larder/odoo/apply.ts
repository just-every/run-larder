// Apply a reviewed Odoo plan to the in-memory state. Every created record
// carries its Odoo External ID (sourceId) and the import batch id.
import { saveItem } from '../catalogue'
import { decimal, format, times } from '../decimal'
import { move } from '../stock'
import { activeBom } from '../bom'
import { validateBomGraph } from '../bom-explosion'
import { bump, newId, nextReference, row, type Context, type Row } from '../model'
import type { Plan } from './map'

export function applyPlan(c: Context, batch: Row, plan: Plan) {
  const importId = batch.id
  const party = (id: string) => c.s.parties.find(p => p.sourceId === id)!.id
  const item = (id: string) => c.s.items.find(i => i.sourceId === id)!
  const location = (id: string) => c.s.locations.find(l => l.sourceId === id)!.id
  for (const p of plan.parties) row(c, 'parties', { name: p.name, kind: p.kind, email: p.email, abn: p.abn, terms: '', sourceId: p.sourceId, importId })
  for (const i of plan.items) saveItem(c, { sku: i.sku, name: i.name, kind: i.kind, baseUnit: i.baseUnit, template: i.template, attributes: i.attributes, conversions: i.conversions, standardCost: i.standardCost, salePrice: i.salePrice, sourceId: i.sourceId }, importId)
  for (const l of plan.locations) row(c, 'locations', { name: l.name, note: '', archived: false, sourceId: l.sourceId, importId })
  for (const b of plan.boms) {
    const made = item(b.itemSource), previous = activeBom(c.s, made.id)
    if (previous) bump(previous, { status: 'superseded' })
    row(c, 'boms', { itemId: made.id, revision: Math.max(0, ...c.s.boms.filter(x => x.itemId === made.id).map(x => x.revision)) + 1, components: b.components.map(x => ({ itemId: item(x.itemSource).id, quantity: x.quantity, note: '' })), routing: b.routing.map((r, i) => ({ sequence: i + 1, ...r })), note: 'Moved in from Odoo', status: 'active', sourceId: b.sourceId, importId })
  }
  validateBomGraph(c.s, c.now.slice(0, 10))
  for (const o of plan.openings) {
    const opening = row(c, 'openings', { reference: nextReference(c.s.openings, 'OS'), locationId: location(o.locationSource), countedOn: batch.opening.countedOn, valuationBasis: batch.opening.valuationBasis, countedBy: batch.opening.countedBy, evidence: batch.files.find((f: any) => f.model === 'stock.quant'), lines: [], importId })
    for (const l of o.lines) {
      const it = item(l.itemSource)
      const lot = l.lot ? row(c, 'lots', { itemId: it.id, code: l.lot, supplierId: null, source: 'opening', documentId: opening.id, status: 'released', importId }) : null
      move(c, { itemId: it.id, locationId: opening.locationId, status: 'available', lotId: lot?.id, quantity: decimal(l.quantity), unitCost: decimal(l.unitCost), kind: 'opening', documentKind: 'openings', documentId: opening.id, reason: `Opening count ${batch.opening.countedOn} moved in from Odoo`, importId })
      opening.lines.push({ itemId: it.id, quantity: l.quantity, unitCost: l.unitCost, lotId: lot?.id ?? '' })
    }
  }
  for (const o of plan.salesOrders) row(c, 'salesOrders', {
    reference: nextReference(c.s.salesOrders, 'SO'), customerId: party(o.partySource), customerReference: o.partyReference, promiseDate: o.date, note: `Moved in from Odoo ${o.reference}`,
    lines: o.lines.map(l => ({ id: newId(), itemId: item(l.itemSource).id, quantity: l.quantity, unitPrice: l.unitPrice, shipped: '0', returned: '0', cancelled: '0', odooOrdered: l.ordered, odooDelivered: l.done })),
    status: o.status, preparedBy: c.actor.id, ...(o.status === 'confirmed' ? { confirmedBy: c.actor.id, confirmedAt: c.now } : {}), sourceId: o.sourceId, sourceReference: o.reference, importId,
  })
  for (const o of plan.purchaseOrders) {
    const lines = o.lines.map(l => ({ id: newId(), itemId: item(l.itemSource).id, quantity: l.quantity, unitPrice: l.unitPrice, received: '0', rejected: '0', odooOrdered: l.ordered, odooReceived: l.done }))
    const po = row(c, 'purchaseOrders', {
      reference: nextReference(c.s.purchaseOrders, 'PO'), supplierId: party(o.partySource), lines, expectedDate: o.date, requiredBy: '', reason: `Moved in from Odoo ${o.reference}`,
      exposure: format(lines.reduce((n, l) => n + times(decimal(l.quantity), decimal(l.unitPrice)), 0n)), status: o.status, preparedBy: c.actor.id, history: [], supplierReference: o.partyReference, confirmedDate: '', sourceId: o.sourceId, sourceReference: o.reference, importId,
    })
    if (o.status === 'approved') {
      const approval = row(c, 'approvals', { subjectKind: 'purchaseOrders', subjectId: po.id, subjectVersion: po.version, decision: 'approved', role: c.actor.role, note: `Approved in Odoo (${o.reference}); accepted with the move-in`, importId })
      bump(po, { approvalId: approval.id, approvedBy: c.actor.id })
    }
  }
}
