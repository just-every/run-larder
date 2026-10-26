import { attach } from './attachments'
import { binRoom } from './bin-policy'
import { toBase } from './catalogue'
import { decimal, format } from './decimal'
import { lotBlock } from './lot-dates'
import { bump, fresh, get, nextReference, oneOf, row, text, type Context, type Row } from './model'
import { fail } from './problem'
import { allow } from './roles'
import { enforcePayload } from './scope'
import { availableAt, balance, move, withdraw } from './stock'

export function warehouseLogistics(c: Context, type: string, p: any): Row | undefined {
  if (type === 'bin.rule') {
    allow(c, [])
    const location = get(c.s, 'locations', p.locationId), item = get(c.s, 'items', p.itemId), source = get(c.s, 'locations', p.sourceLocationId)
    if (!location.siteId || location.archived || source.archived || location.id === source.id) fail('INPUT', 'Choose a named bin and a different replenishment source.')
    const capacity = decimal(p.capacity, 'capacity', { positive: true }), minimum = decimal(p.minimum, 'minimum'), target = decimal(p.target, 'target', { positive: true })
    if (minimum >= target || target > capacity) fail('INPUT', 'Minimum must be below target, and target cannot exceed capacity.')
    const lotId = p.lotId ? get(c.s, 'lots', p.lotId).id : ''
    if (lotId && get(c.s, 'lots', lotId).itemId !== item.id) fail('BIN_LOT', 'Choose a lot of this item.')
    const data = { locationId: location.id, itemId: item.id, sourceLocationId: source.id, capacity: format(capacity), minimum: format(minimum), target: format(target), lotId, reason: text(p.reason, 'rule reason') }
    const existing = c.s.binRules.find(r => r.locationId === location.id && r.itemId === item.id)
    if (existing) { fresh(existing, p.version); return bump(existing, { ...data, history: [...(existing.history ?? []), { ...existing, history: undefined }] }) }
    return row(c, 'binRules', data)
  }
  if (['transit.dispatch', 'putaway.move', 'bin.replenish'].includes(type)) {
    allow(c, ['manager', 'warehouse'])
    const item = get(c.s, 'items', p.itemId), from = get(c.s, 'locations', p.fromLocationId), to = get(c.s, 'locations', p.toLocationId)
    if (from.id === to.id || from.archived || to.archived) fail('INPUT', 'Choose different active locations.')
    const rule = c.s.binRules.find(r => r.itemId === item.id && r.locationId === to.id)
    if (rule) enforcePayload(c, rule)
    if (type !== 'transit.dispatch' && !rule) fail('BIN_RULE', 'Configure a bin rule before putaway or replenishment.')
    const lotId = p.lotId ? get(c.s, 'lots', p.lotId).id : ''
    const lot = lotId ? get(c.s, 'lots', lotId) : undefined
    if (lot && (lot.itemId !== item.id || lot.status !== 'released' || lotBlock(lot, c.now.slice(0, 10)))) fail('LOT_BLOCKED', 'Choose a released lot of this item.')
    const quantity = toBase(item, p.quantity, p.unit)
    if (type === 'bin.replenish') {
      const held = balance(c.s, item.id, to.id)
      if (rule!.sourceLocationId !== from.id || held >= decimal(rule!.minimum)) fail('BIN_RULE', 'Replenishment needs the configured source and a bin below its minimum.')
      if (quantity !== decimal(rule!.target) - held) fail('BIN_RULE', 'Replenish exactly to the configured target.')
    }
    if (availableAt(c.s, item.id, from.id, c.now.slice(0, 10)) < quantity) fail('INSUFFICIENT_STOCK', 'Only released, unreserved stock can leave the source.')
    const t = row(c, 'transfers', { reference: nextReference(c.s.transfers, 'TR'), itemId: item.id, fromLocationId: from.id, toLocationId: to.id, lotId, quantity: format(quantity), reason: text(p.reason, 'reason'), status: type === 'transit.dispatch' ? 'in transit' : 'done', logistics: true, ruleId: rule?.id ?? '', ruleVersion: rule?.version ?? null, sources: [] })
    for (const out of withdraw(c, { itemId: item.id, locationId: from.id, status: 'available', lotId: lotId || undefined, quantity: -quantity, kind: 'transfer', documentKind: 'transfers', documentId: t.id, reason: t.reason })) {
      t.sources.push({ lotId: out.lotId, quantity: format(-out.quantity), unitCost: format(out.unitCost) })
      if (t.status === 'done') move(c, { itemId: item.id, locationId: to.id, status: 'available', lotId: out.lotId, quantity: -out.quantity, unitCost: out.unitCost, kind: 'transfer', documentKind: 'transfers', documentId: t.id, reason: t.reason })
    }
    return t
  }
  if (type === 'transit.receive') {
    allow(c, ['manager', 'warehouse'])
    const t = get(c.s, 'transfers', p.transferId); fresh(t, p.version)
    if (!t.logistics || t.status !== 'in transit') fail('STATE', 'Only an outstanding transit can be received once.')
    const location = get(c.s, 'locations', t.toLocationId)
    if (location.archived) fail('STATE', 'The receiving location is archived.')
    const reason = text(p.reason, 'receipt reason')
    for (const source of t.sources) {
      const block = lotBlock(c.s.lots.find(l => l.id === source.lotId), c.now.slice(0, 10))
      const held = c.s.qualityHolds.some(h => h.status === 'open' && h.lots.some((l: any) => l.lotId === source.lotId))
      if (block || held || c.s.lots.some(l => l.id === source.lotId && l.status !== 'released')) fail('LOT_BLOCKED', 'The transit lot needs a quality disposition before receipt.')
      move(c, { itemId: t.itemId, locationId: t.toLocationId, status: 'available', lotId: source.lotId, quantity: decimal(source.quantity), unitCost: decimal(source.unitCost), kind: 'transfer', documentKind: 'transfers', documentId: t.id, reason })
    }
    return bump(t, { status: 'done', receivedBy: c.actor.id, receivedAt: c.now, receiptReason: reason })
  }
  if (type === 'custody.receive') {
    allow(c, ['manager', 'warehouse'])
    const item = get(c.s, 'items', p.itemId), location = get(c.s, 'locations', p.locationId), owner = get(c.s, 'parties', p.ownerId)
    const ownership = oneOf(p.ownership, ['customer-owned', 'consigned'] as const, 'ownership')
    if (location.archived || (ownership === 'customer-owned' ? owner.kind === 'supplier' : owner.kind === 'customer')) fail('INPUT', 'Choose an active location and the correct property owner.')
    const code = text(p.lot, 'custody lot', 80), quantity = toBase(item, p.quantity, p.unit)
    if (c.s.lots.some(l => l.itemId === item.id && l.code === code)) fail('DUPLICATE_LOT', 'Use a new custody lot reference.')
    const lot = row(c, 'lots', { itemId: item.id, code, ownerId: owner.id, ownership, source: 'custody', status: 'released' })
    binRoom(c, item.id, location.id, lot.id, quantity)
    return row(c, 'custodyLedger', { itemId: item.id, locationId: location.id, lotId: lot.id, ownerId: owner.id, ownership, quantity: format(quantity), evidence: attach(c, p.evidence), reason: text(p.reason, 'custody reason') })
  }
  if (type === 'custody.move') {
    allow(c, ['manager', 'warehouse'])
    const lot = get(c.s, 'lots', p.lotId), from = get(c.s, 'locations', p.fromLocationId), to = get(c.s, 'locations', p.toLocationId), item = get(c.s, 'items', lot.itemId)
    if (!lot.ownerId || lot.source !== 'custody' || from.id === to.id || from.archived || to.archived) fail('INPUT', 'Choose a custody lot and different active locations.')
    const quantity = toBase(item, p.quantity, p.unit), reason = text(p.reason, 'custody movement reason')
    const held = c.s.custodyLedger.filter(r => r.lotId === lot.id && r.locationId === from.id).reduce((n, r) => n + decimal(r.quantity, 'custody quantity', { signed: true }), 0n)
    if (held < quantity) fail('INSUFFICIENT_STOCK', 'Not enough property belonging to this owner at the source.')
    if (lot.status !== 'released' || lotBlock(lot, c.now.slice(0, 10))) fail('LOT_BLOCKED', 'Held property cannot be put away.')
    binRoom(c, item.id, to.id, lot.id, quantity)
    const base = { itemId: item.id, lotId: lot.id, ownerId: lot.ownerId, ownership: lot.ownership, reason }
    const out = row(c, 'custodyLedger', { ...base, locationId: from.id, toLocationId: to.id, quantity: format(-quantity) })
    return row(c, 'custodyLedger', { ...base, locationId: to.id, fromLocationId: from.id, quantity: format(quantity), sourceId: out.id })
  }
}
