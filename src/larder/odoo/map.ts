// Map Odoo export rows to a Larder plan. Nothing is guessed: a row that cannot
// be mapped exactly is rejected with its file, line, External ID and reason,
// and rows that depend on it are rejected too.
import { decimal, exactDivide, format, SCALE } from '../decimal'
import { Problem } from '../problem'
import { parseCsv } from './csv'
import { modelOf, shapes, type Model } from './shape'
import type { State } from '../model'

export type Rejection = { file: string; line: number; sourceId: string; reason: string }
type Rows = { file: string; model: Model; header: string[]; records: { line: number; cells: Record<string, string>; lines: { line: number; cells: Record<string, string> }[] }[] }
export type OdooFile = { name: string; model?: string; content: string }

const odooNumber = (v: string, name: string) => {
  const t = v.trim()
  if (!/^-?\d{1,10}(\.\d+)?$/.test(t)) throw new Problem('ROW', `${name} “${v}” is not a plain number`)
  const [w, f = ''] = t.replace('-', '').split('.')
  if (f.replace(/0+$/, '').length > 6) throw new Problem('ROW', `${name} ${v} has more than 6 decimal places`)
  const n = decimal(`${w}${f ? '.' + f.slice(0, 6) : ''}`, name)
  return t.startsWith('-') ? -n : n
}
const day = (v: string) => /^\d{4}-\d{2}-\d{2}/.test(v.trim()) ? v.trim().slice(0, 10) : ''
const unitKey = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ')
// A routing step's work center by its Odoo name. An export with only the External ID gets a readable label from
// it: __export__.mrp_workcenter_1_bench reads "Bench"; an id ending in Odoo's generated hash reads "Work center 1".
export function workCentreName(cells: Record<string, string>) {
  const name = (cells['operation_ids/workcenter_id/name'] || cells['operation_ids/workcenter_id'] || '').trim()
  if (name) return name
  const id = cells['operation_ids/workcenter_id/id']?.trim() ?? ''
  if (!id) return ''
  const m = /^(?:mrp_workcenter_)?(\d+)?_?(.*)$/.exec(id.slice(id.lastIndexOf('.') + 1))!
  const rest = /^[0-9a-f]{8}$/.test(m[2]!) ? '' : m[2]!.replace(/_/g, ' ').trim()
  return rest ? rest[0]!.toUpperCase() + rest.slice(1) : m[1] ? `Work center ${m[1]}` : id
}

export function readFiles(files: OdooFile[]): { tables: Rows[]; unsupported: { file: string; columns: string[] }[] } {
  const tables: Rows[] = [], unsupported: { file: string; columns: string[] }[] = []
  for (const f of files) {
    const model = modelOf(f.name, f.model)
    if (!model) throw new Problem('KIT_FILE', `${f.name}: name the file after its Odoo model (for example product.product.csv).`)
    if (tables.some(t => t.model === model)) throw new Problem('KIT_FILE', `Two files hold ${model}. Send one export per model.`)
    const rows = parseCsv(f.content, f.name), header = (rows.shift() ?? []).map(h => h.trim())
    const shape = shapes[model], missing = shape.required.filter(c => !header.includes(c))
    if (missing.length) throw new Problem('KIT_SHAPE', `${f.name} is not an import-compatible ${model} export: missing ${missing.join(', ')}.`, { file: f.name, missing })
    if (new Set(header).size !== header.length) throw new Problem('KIT_SHAPE', `${f.name} repeats a column.`)
    const extra = header.filter(c => !shape.required.includes(c) && !shape.optional.includes(c))
    if (extra.length) unsupported.push({ file: f.name, columns: extra })
    const records: Rows['records'] = []
    rows.forEach((cells, i) => {
      if (cells.length !== header.length) throw new Problem('KIT_SHAPE', `${f.name} line ${i + 2} has ${cells.length} values for ${header.length} columns.`)
      const named = Object.fromEntries(header.map((h, j) => [h, cells[j] ?? '']))
      const parent = shape.lines ? header.filter(h => !h.startsWith(shape.lines!) && !h.startsWith('operation_ids/')).some(h => named[h].trim() !== '') : true
      if (parent || !records.length) records.push({ line: i + 2, cells: named, lines: [{ line: i + 2, cells: named }] })
      else records.at(-1)!.lines.push({ line: i + 2, cells: named })
    })
    tables.push({ file: f.name, model, header, records })
  }
  return { tables, unsupported }
}

export type Plan = ReturnType<typeof mapOdoo>

export function mapOdoo(s: State, files: OdooFile[], previousUnits: Record<string, { name: string; category: string; ref: string }>) {
  const { tables, unsupported } = readFiles(files)
  const rejected: Rejection[] = [], skipped: Rejection[] = []
  const table = (m: Model) => tables.find(t => t.model === m)
  const reject = (t: Rows, line: number, sourceId: string, reason: string) => rejected.push({ file: t.file, line, sourceId, reason })
  const seen = (t: Rows) => { const ids = new Set<string>(); return (sourceId: string, line: number) => { if (!sourceId) { reject(t, line, '', 'The External ID (id) is empty.'); return false } if (ids.has(sourceId)) { reject(t, line, sourceId, 'This External ID appears twice in the file.'); return false } ids.add(sourceId); return true } }
  const guard = (t: Rows, line: number, sourceId: string, fn: () => void) => { try { fn() } catch (e) { if (e instanceof Problem) reject(t, line, sourceId, e.message); else throw e } }

  // Units: reference units per unit, exact, and unambiguous by name in a category.
  const units: Record<string, { name: string; category: string; ref: string }> = { ...previousUnits }
  const ut = table('uom.uom')
  if (ut) {
    const first = seen(ut), staged: { id: string; line: number; name: string; category: string; ref: bigint }[] = []
    for (const r of ut.records) {
      const id = r.cells.id.trim()
      if (!first(id, r.line)) continue
      guard(ut, r.line, id, () => {
        if (r.cells.active?.trim().toLowerCase() === 'false') { skipped.push({ file: ut.file, line: r.line, sourceId: id, reason: 'Archived unit' }); return }
        const type = r.cells.uom_type.trim(), name = unitKey(r.cells.name)
        let ref: bigint | null
        if (type === 'reference') ref = SCALE
        else if (type === 'bigger') ref = odooNumber(r.cells.factor_inv ?? '', 'factor_inv')
        else if (type === 'smaller') ref = exactDivide(SCALE, odooNumber(r.cells.factor ?? '', 'factor'))
        else throw new Problem('ROW', `Unknown unit type “${type}”`)
        if (ref === null || ref <= 0n) throw new Problem('ROW', `${name} does not convert exactly to its category's reference unit at 6 decimal places`)
        staged.push({ id, line: r.line, name, category: r.cells['category_id/id'].trim(), ref })
      })
    }
    for (const u of staged) {
      if (staged.some(o => o !== u && o.category === u.category && o.name === u.name && o.ref !== u.ref)) { reject(ut, u.line, u.id, `Unit name “${u.name}” is used twice in its category with different sizes; it is ambiguous.`); continue }
      units[u.id] = { name: u.name, category: u.category, ref: format(u.ref) }
    }
  }
  const unitOf = (id: string) => units[id.trim()] ?? (() => { throw new Problem('ROW', `Unit ${id || '(blank)'} is not in this batch's or an earlier move-in's units`) })()

  // Parties.
  const parties: { sourceId: string; name: string; kind: string; email: string; abn: string }[] = []
  const pt = table('res.partner')
  if (pt) {
    const first = seen(pt)
    for (const r of pt.records) {
      const id = r.cells.id.trim()
      if (!first(id, r.line)) continue
      guard(pt, r.line, id, () => {
        const name = r.cells.name.trim()
        if (!name) throw new Problem('ROW', 'The contact has no name')
        if (s.parties.some(p => p.sourceId === id)) throw new Problem('ROW', 'Already moved in by an earlier batch')
        if (s.parties.some(p => p.name.toLowerCase() === name.toLowerCase()) || parties.some(p => p.name.toLowerCase() === name.toLowerCase())) throw new Problem('ROW', `Another contact is already called ${name}; merge them in Odoo or rename one before moving in`)
        const customer = Number(r.cells.customer_rank || 0) > 0, supplier = Number(r.cells.supplier_rank || 0) > 0
        parties.push({ sourceId: id, name, kind: customer && supplier ? 'both' : supplier ? 'supplier' : 'customer', email: r.cells.email?.trim() ?? '', abn: r.cells.vat?.trim() ?? '' })
      })
    }
  }
  const partyKnown = (id: string) => parties.some(p => p.sourceId === id) || s.parties.some(p => p.sourceId === id)

  // Products.
  type Item = { sourceId: string; sku: string; name: string; kind: string; baseUnit: string; unitSource: string; template: string; attributes: Record<string, string>; conversions: { unit: string; factor: string }[]; standardCost: string; salePrice: string; templateSource: string }
  const items: Item[] = []
  const prt = table('product.product')
  if (prt) {
    const first = seen(prt)
    for (const r of prt.records) {
      const id = r.cells.id.trim()
      if (!first(id, r.line)) continue
      guard(prt, r.line, id, () => {
        if (r.cells.type?.trim() === 'service') { skipped.push({ file: prt.file, line: r.line, sourceId: id, reason: 'Service products hold no stock' }); return }
        if (r.cells.active?.trim().toLowerCase() === 'false') { skipped.push({ file: prt.file, line: r.line, sourceId: id, reason: 'Archived product' }); return }
        const sku = r.cells.default_code.trim(), name = r.cells.name.trim()
        if (!sku) throw new Problem('ROW', 'The product has no internal reference (default_code); Larder needs a SKU')
        if (!name) throw new Problem('ROW', 'The product has no name')
        if (s.items.some(i => i.sourceId === id)) throw new Problem('ROW', 'Already moved in by an earlier batch')
        if (s.items.some(i => i.sku.toLowerCase() === sku.toLowerCase()) || items.some(i => i.sku.toLowerCase() === sku.toLowerCase())) throw new Problem('ROW', `SKU ${sku} is already used by another product`)
        const base = unitOf(r.cells['uom_id/id']), conversions: Item['conversions'] = []
        for (const u of Object.values(units)) if (u.category === base.category && u.name !== base.name) {
          const factor = exactDivide(decimal(u.ref), decimal(base.ref))
          if (factor !== null) conversions.push({ unit: u.name, factor: format(factor) })
        }
        const attributes: Record<string, string> = {}
        for (const part of (r.cells.product_template_attribute_value_ids ?? '').split(',').map(x => x.trim()).filter(Boolean)) {
          const at = part.indexOf(':')
          if (at < 1) throw new Problem('ROW', `Variant value “${part}” is not “Attribute: Value”`)
          attributes[part.slice(0, at).trim()] = part.slice(at + 1).trim()
        }
        const routes = (r.cells['route_ids/id'] ?? '').toLowerCase()
        items.push({ sourceId: id, sku, name, kind: routes.includes('manufacture') ? 'make' : 'buy', baseUnit: base.name, unitSource: r.cells['uom_id/id'].trim(), template: Object.keys(attributes).length ? name : '', attributes, conversions, standardCost: format(r.cells.standard_price ? odooNumber(r.cells.standard_price, 'standard_price') : 0n), salePrice: format(r.cells.list_price ? odooNumber(r.cells.list_price, 'list_price') : 0n), templateSource: r.cells['product_tmpl_id/id']?.trim() ?? '' })
      })
    }
  }
  const itemFor = (id: string) => items.find(i => i.sourceId === id.trim()) ?? s.items.find(i => i.sourceId === id.trim()) as unknown as Item | undefined
  const needItem = (id: string) => itemFor(id) ?? (() => { throw new Problem('ROW', `Product ${id || '(blank)'} is not in this batch or an earlier move-in (or was rejected)`) })()
  const toBase = (item: Item, q: bigint, unitSource: string) => {
    if (!unitSource.trim()) return q
    const u = unitOf(unitSource)
    if (u.name === item.baseUnit) return q
    const conv = item.conversions.find(c => c.unit === u.name) ?? (() => { throw new Problem('ROW', `${u.name} has no exact conversion to ${item.baseUnit} for ${item.sku}`) })()
    const raw = q * decimal(conv.factor)
    if (raw % SCALE !== 0n) throw new Problem('ROW', `${format(q)} ${u.name} does not convert exactly to ${item.baseUnit}`)
    return raw / SCALE
  }

  // Locations: only internal stock locations hold stock.
  const locations: { sourceId: string; name: string }[] = []
  const lt = table('stock.location')
  if (lt) {
    const first = seen(lt)
    for (const r of lt.records) {
      const id = r.cells.id.trim()
      if (!first(id, r.line)) continue
      guard(lt, r.line, id, () => {
        if (r.cells.usage.trim() !== 'internal') { skipped.push({ file: lt.file, line: r.line, sourceId: id, reason: `${r.cells.usage.trim() || 'Unknown'} location holds no physical stock` }); return }
        const name = r.cells.complete_name.trim()
        if (!name) throw new Problem('ROW', 'The location has no name')
        if (s.locations.some(l => l.sourceId === id)) throw new Problem('ROW', 'Already moved in by an earlier batch')
        if (s.locations.some(l => l.name.toLowerCase() === name.toLowerCase())) throw new Problem('ROW', `A location called ${name} already exists`)
        locations.push({ sourceId: id, name })
      })
    }
  }
  const locationKnown = (id: string) => locations.some(l => l.sourceId === id) || s.locations.some(l => l.sourceId === id)

  // Bills of materials (one per made variant; a template BOM applies to each variant).
  const boms: { sourceId: string; itemSource: string; components: { itemSource: string; quantity: string }[]; routing: { name: string; workCentre: string; minutes: number }[] }[] = []
  const bt = table('mrp.bom')
  if (bt) {
    const first = seen(bt)
    for (const r of bt.records) {
      const id = r.cells.id.trim()
      if (!first(id, r.line)) continue
      guard(bt, r.line, id, () => {
        if ((r.cells.type ?? '').trim() && r.cells.type.trim() !== 'normal') { skipped.push({ file: bt.file, line: r.line, sourceId: id, reason: `${r.cells.type.trim()} BOMs (kits, subcontracting) are not production BOMs` }); return }
        const variant = r.cells['product_id/id']?.trim()
        const targets = variant ? [needItem(variant)] : items.filter(i => i.templateSource && i.templateSource === r.cells['product_tmpl_id/id'].trim())
        if (!targets.length) throw new Problem('ROW', `Product template ${r.cells['product_tmpl_id/id']} has no moved-in variant`)
        for (const target of targets) {
          if (!items.includes(target) && target.kind !== 'make') throw new Problem('ROW', `${target.sku} is set up as bought in Larder; mark it as made before moving in its BOM`)
          const made = toBase(target, odooNumber(r.cells.product_qty, 'product_qty'), r.cells['product_uom_id/id'])
          if (made <= 0n) throw new Problem('ROW', 'The BOM makes zero units')
          const components = r.lines.filter(l => l.cells['bom_line_ids/product_id/id']?.trim()).map(l => {
            const c = needItem(l.cells['bom_line_ids/product_id/id']), q = toBase(c, odooNumber(l.cells['bom_line_ids/product_qty'], 'component quantity'), l.cells['bom_line_ids/product_uom_id/id'])
            const per = exactDivide(q, made)
            if (per === null || per <= 0n) throw new Problem('ROW', `${c.sku} per unit (${format(q)} ÷ ${format(made)}) is not exact at 6 decimal places (line ${l.line})`)
            return { itemSource: c.sourceId, quantity: format(per) }
          })
          if (!components.length) throw new Problem('ROW', 'The BOM has no component lines')
          if (new Set(components.map(c => c.itemSource)).size !== components.length) throw new Problem('ROW', 'A component appears twice; combine the lines in Odoo')
          const routing = r.lines.filter(l => l.cells['operation_ids/name']?.trim()).map(l => ({ name: l.cells['operation_ids/name'].trim(), workCentre: workCentreName(l.cells), minutes: l.cells['operation_ids/time_cycle_manual']?.trim() ? Number(format(odooNumber(l.cells['operation_ids/time_cycle_manual'], 'minutes'))) : 0 }))
          if (s.boms.some(b => b.sourceId === id && s.items.find(i => i.id === b.itemId)?.sourceId === target.sourceId)) throw new Problem('ROW', 'Already moved in by an earlier batch')
          boms.push({ sourceId: id, itemSource: target.sourceId, components, routing })
          target.kind = 'make'
        }
      })
    }
  }

  // Opening counts from on-hand quantities, grouped by location.
  const openings: { locationSource: string; lines: { itemSource: string; quantity: string; unitCost: string; lot: string; line: number }[] }[] = []
  const qt = table('stock.quant')
  if (qt) for (const r of qt.records) {
    const id = r.cells.id?.trim() || `${r.cells['product_id/id']}@${r.cells['location_id/id']}`
    guard(qt, r.line, id, () => {
      const loc = r.cells['location_id/id'].trim()
      if (!locationKnown(loc)) throw new Problem('ROW', `Location ${loc || '(blank)'} is not an internal location in this batch or an earlier move-in`)
      const item = needItem(r.cells['product_id/id'])
      const q = odooNumber(r.cells.quantity, 'quantity')
      if (q < 0n) throw new Problem('ROW', 'Odoo shows negative stock here; count it physically before moving in')
      if (q === 0n) { skipped.push({ file: qt.file, line: r.line, sourceId: id, reason: 'Zero on hand' }); return }
      const quantity = toBase(item, q, r.cells['product_uom_id/id'] ?? ''), lot = r.cells['lot_id/name']?.trim() ?? ''
      if (s.movements.some(m => m.locationId === s.locations.find(l => l.sourceId === loc)?.id && m.itemId === s.items.find(i => i.sourceId === item.sourceId)?.id)) throw new Problem('ROW', 'This product already has stock history at that location')
      let group = openings.find(o => o.locationSource === loc)
      if (!group) openings.push(group = { locationSource: loc, lines: [] })
      if (group.lines.some(l => l.itemSource === item.sourceId && l.lot === lot)) throw new Problem('ROW', 'The same product and lot appear twice at this location')
      group.lines.push({ itemSource: item.sourceId, quantity: format(quantity), unitCost: item.standardCost, lot, line: r.line })
    })
  }

  // Open orders.
  type Doc = { sourceId: string; reference: string; partySource: string; date: string; partyReference: string; status: string; lines: { itemSource: string; quantity: string; unitPrice: string; ordered: string; done: string }[] }
  const orders = (model: 'sale.order' | 'purchase.order') => {
    const t = table(model), out: Doc[] = []
    if (!t) return out
    const first = seen(t), sale = model === 'sale.order'
    for (const r of t.records) {
      const id = r.cells.id.trim()
      if (!first(id, r.line)) continue
      guard(t, r.line, id, () => {
        const state = r.cells.state.trim()
        const status = sale ? ({ draft: 'quote', sent: 'quote', sale: 'confirmed' } as Record<string, string>)[state] : ({ draft: 'draft', sent: 'draft', 'to approve': 'draft', purchase: 'approved' } as Record<string, string>)[state]
        if (!status) { skipped.push({ file: t.file, line: r.line, sourceId: id, reason: `${state || 'Unknown'} orders are closed; only open orders move in` }); return }
        const party = r.cells['partner_id/id'].trim()
        if (!partyKnown(party)) throw new Problem('ROW', `Contact ${party || '(blank)'} is not in this batch or an earlier move-in (or was rejected)`)
        const date = day(sale ? (r.cells.commitment_date || r.cells.validity_date || '') : (r.cells.date_planned || ''))
        if (!date) throw new Problem('ROW', sale ? 'The order has no commitment date; Larder needs a promise date' : 'The order has no planned receipt date')
        if ((sale ? s.salesOrders : s.purchaseOrders).some(o => o.sourceId === id)) throw new Problem('ROW', 'Already moved in by an earlier batch')
        const qtyKey = sale ? 'order_line/product_uom_qty' : 'order_line/product_qty', doneKey = sale ? 'order_line/qty_delivered' : 'order_line/qty_received'
        const lines = r.lines.filter(l => l.cells['order_line/product_id/id']?.trim()).map(l => {
          const item = needItem(l.cells['order_line/product_id/id']), unit = l.cells['order_line/product_uom/id'] ?? ''
          const ordered = toBase(item, odooNumber(l.cells[qtyKey], 'line quantity'), unit), done = l.cells[doneKey]?.trim() ? toBase(item, odooNumber(l.cells[doneKey], 'done quantity'), unit) : 0n
          if (done > ordered) throw new Problem('ROW', `Line ${l.line} has more done than ordered`)
          const price = odooNumber(l.cells['order_line/price_unit'], 'unit price')
          if (price < 0n) throw new Problem('ROW', `Line ${l.line} has a negative price`)
          // Odoo prices the line's own unit; Larder prices the base unit.
          const perBase = exactDivide(price, toBase(item, SCALE, unit))
          if (perBase === null) throw new Problem('ROW', `Line ${l.line}'s price ${format(price)} per ${unitOf(unit).name} does not divide exactly into ${item.baseUnit}`)
          return { itemSource: item.sourceId, quantity: format(ordered - done), unitPrice: format(perBase), ordered: format(ordered), done: format(done) }
        }).filter(l => l.quantity !== '0')
        if (!lines.length) { skipped.push({ file: t.file, line: r.line, sourceId: id, reason: 'Nothing left open on this order' }); return }
        out.push({ sourceId: id, reference: r.cells.name.trim(), partySource: party, date, partyReference: (sale ? r.cells.client_order_ref : r.cells.partner_ref)?.trim() ?? '', status, lines })
      })
    }
    return out
  }
  const salesOrders = orders('sale.order'), purchaseOrders = orders('purchase.order')
  const ownUnits = Object.fromEntries(Object.entries(units).filter(([k]) => !previousUnits[k]))
  return { units: ownUnits, parties, items, locations, boms, openings, salesOrders, purchaseOrders, rejected, skipped, unsupported, files: tables.map(t => ({ name: t.file, model: t.model, rows: t.records.reduce((n, r) => n + r.lines.length, 0) })) }
}
