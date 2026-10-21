// ENG-007: the CSV is a reviewed proposal; issued records are immutable inputs.
import { saveItem, savePartyItem } from './catalogue'
import { parseCatalogCsv } from './catalog-csv'
import { catalogItemColumns, normalizeCatalogSupplier, type CatalogGroup } from './catalog-fields'
import { positions } from './stock'
import { bump, fresh, get, row, text, type Context, type Row } from './model'
import { allow, approver } from './roles'
import { fail, Problem } from './problem'

function finalIdentities(c: Context, groups: CatalogGroup[]) {
  // Final identities allow a legitimate SKU/variant swap without bypassing
  // the normal validator or losing the old unit and stock checks.
  for (const g of groups) if (g.itemId) {
    const old = get(c.s, 'items', g.itemId)
    Object.assign(old, { sku: g.item.sku, template: g.item.template, attributes: g.item.attributes })
  }
}
function apply(c: Context, g: CatalogGroup) {
  const item = saveItem(c, { ...g.item, catalogLocations: g.locations })
  if (g.supplier !== undefined) {
    for (const old of c.s.partyItems.filter(t => t.itemId === item.id && t.preferred)) bump(old, { preferred: false })
    if (g.supplier) {
      const supplier = normalizeCatalogSupplier(c.s, item, g.supplier)
      const old = c.s.partyItems.find(t => t.itemId === item.id && t.partyId === supplier.partyId && t.unit === supplier.unit)
      savePartyItem(c, { ...supplier, itemId: item.id, preferred: true, ...(old ? { id: old.id, version: old.version } : {}) })
    }
  }
  return item
}

function impacts(c: Context, g: CatalogGroup) {
  const id = g.itemId
  const document = (rows: Row[]) => rows.filter(r => r.lines?.some((l: any) => l.itemId === id)).map(r => ({ id: r.id, reference: r.reference, status: r.status }))
  return {
    itemId: id ?? null, sku: g.item.sku, changes: g.changes,
    quotes: document(c.s.salesOrders.filter(o => o.status === 'quote')),
    orders: document(c.s.salesOrders.filter(o => ['confirmed', 'part shipped'].includes(o.status))),
    purchases: document(c.s.purchaseOrders.filter(po => ['draft', 'approved', 'confirmed', 'part received'].includes(po.status))),
    planning: { before: c.s.items.find(i => i.id === id)?.catalogLocations ?? [], after: g.locations,
      work: c.s.workOrders.filter(w => w.itemId === id && ['draft', 'released'].includes(w.status)).map(w => ({ id: w.id, reference: w.reference, status: w.status, bomRevision: w.bomRevision })),
      forecasts: c.s.forecasts.filter(f => f.itemId === id).map(f => ({ id: f.id, week: f.week, quantity: f.quantity })) },
    stock: positions(c.s).filter(p => p.itemId === id),
    treatment: 'Catalog values apply to future documents. Saved quotes, orders, POs, released work, stock movements and reservations retain their issued values. Location settings are retained for the demand-policy planner; they do not reallocate stock.' }
}

export function catalogBulk(c: Context, type: string, p: any): Row | undefined {
  if (type === 'catalog.bulkPreview') {
    allow(c, ['manager', 'buyer', 'production', 'engineer'])
    const file = text(p.file?.name, 'CSV filename', 200)
    if (typeof p.file?.content !== 'string' || p.file.content.length > 2 * 1024 * 1024) fail('INPUT', 'Send a catalog CSV of at most 2 MiB.')
    const parsed = parseCatalogCsv(c.s, p.file.content, file), errors = [...parsed.errors], rejected = [...parsed.rejectedGroups]
    let groups = parsed.groups.filter(g => g.changes.length || !g.itemId)
    // Removing one invalid group may reveal a conflict with its retained old
    // identity; recompute the final accepted set until no group is rejected.
    while (groups.length) {
      const bad = new Set<string>(), candidate = { ...c, s: structuredClone(c.s), attachments: [] }
      finalIdentities(candidate, groups)
      for (const g of groups) {
        try { apply(candidate, g) }
        catch (e) {
          if (!(e instanceof Problem)) throw e
          bad.add(g.key); rejected.push(g)
          errors.push({ file, row: g.rows[0], column: e.code === 'UNIT_FIXED' ? (g.item.baseUnit !== get(c.s, 'items', g.itemId).baseUnit ? 'base_unit' : 'conversions') : Object.entries(catalogItemColumns).find(([, field]) => field === (e.details as any)?.field)?.[0] ?? (e.details as any)?.field ?? 'row', reason: e.message, groupKey: g.key })
        }
      }
      if (!bad.size) break
      groups = groups.filter(g => !bad.has(g.key))
    }
    return row(c, 'catalogChanges', { file, content: p.file.content, groups, errors, impact: [...groups.map(g => ({ ...impacts(c, g), accepted: true })), ...rejected.map(g => ({ ...impacts(c, g), accepted: false }))], preparedBy: c.actor.id, status: 'preview', stateVersion: c.s.version + 1 })
  }
  if (type !== 'catalog.bulkApprove') return
  const preview = get(c.s, 'catalogChanges', p.previewId, 'catalog preview')
  approver(c, ['manager', 'buyer', 'production', 'engineer'], preview.createdBy); fresh(preview, p.version)
  if (preview.status !== 'preview') fail('STATE', 'This catalog preview has already been decided.')
  if (preview.stateVersion !== c.s.version) fail('STALE', 'Business records changed. Upload and review the catalog again.')
  if (!preview.groups.length) fail('INPUT', 'There are no valid catalog changes to approve.')
  if (preview.errors.length && p.acceptRejected !== preview.errors.length) fail('REJECTED_ROWS', 'Confirm the exact rejected-row count; those item groups stay unchanged.', { count: preview.errors.length })
  finalIdentities(c, preview.groups)
  const itemIds = preview.groups.map((g: CatalogGroup) => apply(c, g).id)
  return bump(preview, { status: 'approved', approvedBy: c.actor.id, approvedAt: c.now, itemIds })
}
