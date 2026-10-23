// Opening stock, transfers, counts with approved adjustments, and customer returns.
import { approvedCertificates, requiredTypes } from './certificate-policy'
import { requireCatalogLot } from './catalog-fields'
import { attach } from './attachments'
import { toBase } from './catalogue'
import { returnSources } from './sales-terms'
import { decimal, format } from './decimal'
import { fail } from './problem'
import { allow, approver } from './roles'
import { availableAt, balance, move, withdraw } from './stock'
import { lotBlock, lotDates } from './lot-dates'
import { bump, date, fresh, get, list, nextReference, oneOf, optionalText, row, text, type Context, type Row } from './model'

export const valuationBases = ['supplier-invoice', 'last-purchase', 'standard-cost', 'owner-estimate'] as const

export function warehouse(c: Context, type: string, p: any): Row | undefined {
  switch (type) {
    case 'site.save': {
      allow(c, [])
      const name = text(p.name, 'site name', 120)
      if (c.s.sites.some(site => site.id !== p.id && site.name.toLowerCase() === name.toLowerCase())) fail('INPUT', 'A site with this name already exists.')
      if (!p.id) return row(c, 'sites', { name })
      const site = get(c.s, 'sites', p.id, 'site'); fresh(site, p.version)
      return bump(site, { name })
    }
    case 'transfer.receive': {
      allow(c, ['manager', 'warehouse'])
      const transfer = get(c.s, 'transfers', p.transferId, 'transfer'); fresh(transfer, p.version)
      if (transfer.status !== 'in transit') fail('STATE', 'Receive an outstanding transit transfer once.')
      const destination = get(c.s, 'locations', transfer.toLocationId, 'destination')
      if (destination.archived) fail('INPUT', 'Choose an active destination before dispatch.')
      const disposition = oneOf(p.disposition ?? 'available', ['available', 'quarantine'] as const, 'disposition')
      const reason = text(p.reason, 'receipt reason', 400)
      for (const source of transfer.sources) {
        const lot = c.s.lots.find(l => l.id === source.lotId)
        if (disposition === 'available') {
          if (lotBlock(lot, c.now.slice(0, 10))) fail('LOT_BLOCKED', 'This lot needs an expiry disposition or a quarantine receipt.')
          if (c.s.qualityHolds.some(h => h.status === 'open' && (h.subjectId === source.lotId || h.lots?.some((l: any) => l.lotId === source.lotId))) || c.s.nonconformances.some(n => n.status === 'open' && n.lotId === source.lotId)) fail('QUALITY_HOLD', 'Receive held stock into quarantine.')
          approvedCertificates(c.s, transfer.itemId, source.lotId, c.now.slice(0, 10))
        }
        const quantity = decimal(source.quantity), unitCost = decimal(source.unitCost)
        move(c, { itemId: transfer.itemId, locationId: transfer.fromLocationId, lotId: source.lotId, status: 'transit', quantity: -quantity, unitCost, kind: 'transfer', documentKind: 'transfers', documentId: transfer.id, reason })
        const received = move(c, { itemId: transfer.itemId, locationId: transfer.toLocationId, lotId: source.lotId, status: disposition, quantity, unitCost, kind: 'transfer', documentKind: 'transfers', documentId: transfer.id, reason })
        if (disposition === 'quarantine') for (const hold of c.s.qualityHolds.filter(h => h.status === 'open' && h.lots?.some((l: any) => l.lotId === source.lotId))) {
          hold.held.push({ lotId: source.lotId, locationId: transfer.toLocationId, quantity: source.quantity })
          bump(hold, {})
        }
        source.receiptMovementId = received.id
      }
      return bump(transfer, { status: 'done', receivedBy: c.actor.id, receivedAt: c.now, receiptReason: reason, disposition })
    }
    case 'opening.record': {
      allow(c, ['manager', 'warehouse'])
      const location = get(c.s, 'locations', p.locationId, 'location')
      const countedOn = date(p.countedOn, 'count date'), basis = oneOf(p.valuationBasis, valuationBases, 'valuation basis')
      const evidence = attach(c, p.evidence)
      const opening = row(c, 'openings', { reference: nextReference(c.s.openings, 'OS'), locationId: location.id, countedOn, valuationBasis: basis, countedBy: text(p.countedBy, 'counted by', 120), evidence, lines: [] })
      for (const line of list(p.lines)) {
        const item = get(c.s, 'items', line.itemId, 'item')
        if (c.s.movements.some(m => m.itemId === item.id && m.locationId === location.id)) fail('OPENING_EXISTS', `${item.name} already has stock history at ${location.name}. Use a count to correct it.`, { itemId: item.id })
        if (opening.lines.some((l: any) => l.itemId === item.id && (l.lot ?? '') === (line.lot ?? ''))) fail('INPUT', `${item.name} appears twice on this opening count.`)
        const quantity = toBase(item, line.quantity, line.unit), unitCost = decimal(line.unitCost, 'unit cost')
        requireCatalogLot(item, line.lot)
        const controlled = requiredTypes(c.s, item.id).length > 0
        if (controlled) text(line.lot, 'lot required for controlled certificates', 80)
        const lot = optionalText(line.lot, 'lot', 80), dates = lotDates(line.dates, lot, c.now.slice(0, 10))
        const lotRow = lot ? row(c, 'lots', { itemId: item.id, code: lot, supplierId: null, source: 'opening', documentId: opening.id, status: controlled ? 'quarantined' : 'released', ...dates }) : null
        move(c, { itemId: item.id, locationId: location.id, status: controlled ? 'quarantine' : 'available', lotId: lotRow?.id, quantity, unitCost, kind: 'opening', documentKind: 'openings', documentId: opening.id, reason: `Opening count ${countedOn} (${basis})` })
        opening.lines.push({ itemId: item.id, quantity: format(quantity), unitCost: format(unitCost), lotId: lotRow?.id ?? '' })
      }
      return opening
    }
    case 'transfer.create':
    case 'transfer.dispatch': {
      allow(c, ['manager', 'warehouse'])
      const item = get(c.s, 'items', p.itemId, 'item'), from = get(c.s, 'locations', p.fromLocationId, 'location'), to = get(c.s, 'locations', p.toLocationId, 'location')
      if (from.id === to.id) fail('INPUT', 'Choose two different locations.')
      if (from.archived || to.archived) fail('INPUT', 'Choose active source and destination locations.')
      const transit = type === 'transfer.dispatch'
      if (!transit && from.siteId && to.siteId && from.siteId !== to.siteId) fail('TRANSIT_REQUIRED', 'Dispatch between sites, then receive at the destination.')
      const quantity = toBase(item, p.quantity, p.unit), lotId = p.lotId ? get(c.s, 'lots', p.lotId, 'lot').id : ''
      if (availableAt(c.s, item.id, from.id) < quantity) fail('INSUFFICIENT_STOCK', `Only ${format(availableAt(c.s, item.id, from.id))} ${item.baseUnit} of ${item.name} is free to move from ${from.name}.`)
      const t = row(c, 'transfers', { reference: nextReference(c.s.transfers, 'TR'), itemId: item.id, fromLocationId: from.id, toLocationId: to.id, quantity: format(quantity), lotId, reason: text(p.reason, 'reason', 400), status: transit ? 'in transit' : 'done', mode: transit ? 'transit' : 'immediate', sources: [] })
      for (const out of withdraw(c, { itemId: item.id, locationId: from.id, status: 'available', lotId: lotId || undefined, quantity: -quantity, kind: 'transfer', documentKind: 'transfers', documentId: t.id, reason: t.reason })) {
        const incoming = move(c, { itemId: item.id, locationId: transit ? from.id : to.id, status: transit ? 'transit' : 'available', lotId: out.lotId, quantity: -out.quantity, unitCost: out.unitCost, kind: 'transfer', documentKind: 'transfers', documentId: t.id, reason: t.reason })
        t.sources.push({ lotId: out.lotId, quantity: format(-out.quantity), unitCost: format(out.unitCost), dispatchMovementId: out.id, incomingMovementId: incoming.id })
      }
      return t
    }
    case 'return.receive': {
      allow(c, ['manager', 'warehouse'])
      const order = get(c.s, 'salesOrders', p.orderId, 'order'), line = order.lines.find((l: any) => l.id === p.lineId) ?? fail('NOT_FOUND', 'That order line was not found.')
      const item = get(c.s, 'items', line.itemId, 'item'), quantity = toBase(item, p.quantity, p.unit)
      if (decimal(line.shipped) - decimal(line.returned) < quantity) fail('RETURN_EXCEEDS', `Only ${format(decimal(line.shipped) - decimal(line.returned))} ${item.baseUnit} shipped on this line can come back.`)
      const location = get(c.s, 'locations', p.locationId, 'location'); let disposition = oneOf(p.disposition, ['restock', 'quarantine'] as const, 'disposition')
      if (requiredTypes(c.s, item.id).length) disposition = 'quarantine'
      const sources = returnSources(c.s, order, line, quantity)
      const r = row(c, 'returns', { reference: nextReference(c.s.returns, 'RT'), orderId: order.id, lineId: line.id, itemId: item.id, quantity: format(quantity), locationId: location.id, disposition, reason: text(p.reason, 'reason', 400), sources })
      for (const source of sources) {
        const original = c.s.movements.find(m => m.id === source.shipmentMovementId)!
        const movement = move(c, { itemId: item.id, locationId: location.id, status: disposition === 'restock' ? 'available' : 'quarantine', lotId: original.lotId, quantity: decimal(source.quantity), unitCost: decimal(source.unitCost), kind: 'return', documentKind: 'returns', documentId: r.id, reason: r.reason })
        Object.assign(source, { returnMovementId: movement.id })
      }
      line.returned = format(decimal(line.returned) + quantity)
      bump(order, {})
      return r
    }
  }
}
