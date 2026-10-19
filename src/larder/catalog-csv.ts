import { decimal, format } from './decimal'
import { type Row, type State } from './model'
import { parseCsv } from './odoo/csv'
import {
  catalogHeaders, catalogItemColumns, catalogItemSnapshot, catalogLocationColumns, catalogSupplierColumns,
  normalizeCatalogItem, normalizeCatalogSupplier, preferredCatalogSupplier,
  type CatalogGroup, type CatalogLocation, type CatalogSupplier,
} from './catalog-fields'

export type CatalogCsvError = { file: string; row: number; column: string; reason: string; groupKey?: string }
const numericColumns = new Set(['standard_cost', 'sale_price', 'purchase_price', 'reorder_point', 'safety_stock', 'min_stock', 'max_stock', 'lead_days', 'supplier_lead_days', 'archived'])
const reason = (e: unknown) => e instanceof Error ? e.message : String(e)
const canonical = (value: any): string => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v) ?? 'undefined'
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b)

// All exported text gains one apostrophe (including numeric identifiers).
// Import strips exactly one; double a literal leading apostrophe. #CLEAR clears;
// \#CLEAR is literal #CLEAR. Add one backslash to escape any backslash run
// immediately before #CLEAR. Empty decoded cells always mean unchanged.
const catalogClear = Symbol('catalog clear')
function catalogCell(value: unknown, text: boolean): string {
  let cell = value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (/^\\*#CLEAR$/.test(cell)) cell = '\\' + cell
  if (text && cell !== '') cell = "'" + cell
  return `"${cell.replace(/"/g, '""')}"`
}
function readCatalogCell(cell: string): string | typeof catalogClear | undefined {
  if (cell.startsWith("'")) cell = cell.slice(1)
  if (cell === '') return undefined
  if (cell === '#CLEAR') return catalogClear
  return /^\\+#CLEAR$/.test(cell) ? cell.slice(1) : cell
}
function catalogRowLines(content: string): number[] {
  const lines: number[] = []
  let quoted = false, line = 1, start = 1, occupied = false
  for (let i = content.startsWith('\uFEFF') ? 1 : 0; i < content.length; i++) {
    const ch = content[i]
    if (ch === '"') {
      if (quoted && content[i + 1] === '"') { occupied = true; i++ }
      else quoted = !quoted
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && content[i + 1] === '\n') i++
      line++
      if (!quoted) { if (occupied) lines.push(start); occupied = false; start = line }
      else occupied = true
    } else if (quoted || ch !== ',') occupied = true
  }
  if (occupied) lines.push(start)
  return lines
}

export function catalogCsv(s: State): string {
  const rows: unknown[][] = [catalogHeaders]
  for (const item of s.items.filter(i => !i.archived)) {
    const snapshot = catalogItemSnapshot(item), supplier = preferredCatalogSupplier(s, item.id)
    const locations = s.locations.filter(l => !l.archived)
    for (const location of locations.length ? locations : [undefined]) {
      const settings = snapshot.catalogLocations.find((l: CatalogLocation) => l.locationId === location?.id)
      const data: Record<string, unknown> = { larder_id: item.id, location_id: location?.id ?? '' }
      for (const [column, field] of Object.entries(catalogItemColumns)) data[column] = snapshot[field]
      for (const [column, field] of Object.entries(catalogSupplierColumns)) data[column] = supplier?.[field]
      for (const [column, field] of Object.entries(catalogLocationColumns)) data[column] = settings?.[field]
      rows.push(catalogHeaders.map(column => data[column]))
    }
  }
  return rows.map((row, index) => row.map((value, i) => catalogCell(value, index !== 0 && !numericColumns.has(catalogHeaders[i]))).join(',')).join('\r\n') + '\r\n'
}

type Pending = {
  group: CatalogGroup; current?: Row; invalid: boolean; edits: Map<string, unknown>; supplierEdits: Map<string, unknown>;
  seen: Set<string>; source: Map<string, number>; beforeSupplier?: CatalogSupplier;
}
function editedValue(column: string, value: string | typeof catalogClear): unknown {
  if (value === catalogClear) {
    if (column === 'conversions') return []
    if (column === 'attributes') return {}
    if (['template', 'category', 'price_list', 'barcode', 'supplier_code'].includes(column)) return ''
    if (column === 'preferred_supplier_id') return null
    if (column in catalogLocationColumns) return undefined
    throw new Error('This field cannot be cleared; supply an explicit value.')
  }
  if (column === 'conversions' || column === 'attributes') return JSON.parse(value)
  if (column === 'archived') {
    if (value !== 'true' && value !== 'false') throw new Error('Use true or false.')
    return value === 'true'
  }
  if (column === 'lead_days' || column === 'supplier_lead_days') {
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Use a nonnegative whole number of days.')
    return Number(value)
  }
  if (numericColumns.has(column)) return format(decimal(value, column))
  return value
}
function columnFor(field: string, supplier = false): string {
  const maps = supplier ? catalogSupplierColumns : { ...catalogItemColumns, ...catalogLocationColumns }
  return Object.entries(maps).find(([, key]) => key === field)?.[0] ?? field
}

export function parseCatalogCsv(s: State, content: string, file: string): { groups: CatalogGroup[]; rejectedGroups: CatalogGroup[]; errors: CatalogCsvError[] } {
  const errors: CatalogCsvError[] = [], pending = new Map<string, Pending>()
  const error = (row: number, column: string, message: string, groupKey?: string) => errors.push({ file, row, column, reason: message, ...(groupKey ? { groupKey } : {}) })
  let rows: string[][]
  const lines = catalogRowLines(content)
  try { rows = parseCsv(content, file) }
  catch (e) {
    const logical = Number(/line (\d+)/.exec(reason(e))?.[1] ?? lines.length)
    error(lines[logical - 1] ?? 1, 'file', reason(e)); return { groups: [], rejectedGroups: [], errors }
  }
  const header = rows.shift()
  if (!header) { error(1, 'file', 'The CSV file is empty.'); return { groups: [], rejectedGroups: [], errors } }
  if (!header.includes('larder_id') && !header.includes('sku')) error(lines[0] ?? 1, 'header', 'Include larder_id for edits or sku for creates.')
  header.forEach((column, i) => {
    if (!catalogHeaders.includes(column)) error(lines[0] ?? 1, column || 'header', 'Unknown column.')
    if (header.indexOf(column) !== i) error(lines[0] ?? 1, column, 'Duplicate column.')
  })
  if (errors.length) return { groups: [], rejectedGroups: [], errors }
  if (!rows.length) error((lines[0] ?? 1) + 1, 'file', 'The CSV file has no item rows.')
  rows.forEach((cells, index) => {
    const row = lines[index + 1] ?? index + 2
    const data = Object.fromEntries(header.map((column, i) => [column, readCatalogCell(cells[i] ?? '')]))
    const id = data.larder_id, sku = data.sku
    if (id === catalogClear || (typeof id !== 'string' && id !== undefined)) { error(row, 'larder_id', 'Larder ID cannot be cleared.'); return }
    const current = id ? s.items.find(item => item.id === id) : undefined
    if (id && !current) { error(row, 'larder_id', 'Unknown Larder ID; supply an existing ID or leave it blank for a create.', `id:${id}`); return }
    if (!current && (typeof sku !== 'string' || !sku.trim())) { error(row, 'sku', 'A SKU is required for a new item.'); return }
    const key = current ? `id:${current.id}` : `sku:${(sku as string).toLowerCase()}`
    let p = pending.get(key)
    if (!p) {
      p = { group: { key, itemId: current?.id, item: catalogItemSnapshot(current), locations: structuredClone(current?.catalogLocations ?? []), supplier: undefined, changes: [], rows: [] }, current, invalid: false, edits: new Map(), supplierEdits: new Map(), seen: new Set(), source: new Map() }
      pending.set(key, p)
      try { p.beforeSupplier = current ? preferredCatalogSupplier(s, current.id) : undefined }
      catch (e) { p.invalid = true; error(row, 'preferred_supplier_id', reason(e), key) }
    }
    const target = p
    target.group.rows.push(row)
    const reject = (column: string, message: string) => { target.invalid = true; error(row, column, message, key) }
    if (cells.length !== header.length) reject('row', `Expected ${header.length} columns; received ${cells.length}.`)
    const locationId = data.location_id
    if (locationId === catalogClear) reject('location_id', 'Location ID cannot be cleared.')
    if (typeof locationId === 'string' && !s.locations.some(l => l.id === locationId)) reject('location_id', 'Unknown location ID.')
    const locationKey = typeof locationId === 'string' ? locationId : ''
    if (target.seen.has(locationKey)) reject('location_id', 'Repeated item/location row; list each item once per location.')
    target.seen.add(locationKey)
    const settings = { ...(target.group.locations.find(l => l.locationId === locationKey) ?? { locationId: locationKey }) }
    let settingsEdited = false
    for (const [column, raw] of Object.entries(data)) {
      if (raw === undefined || column === 'larder_id' || column === 'location_id') continue
      try {
        const value = editedValue(column, raw as string | typeof catalogClear)
        target.source.set(column, target.source.get(column) ?? row)
        if (column in catalogLocationColumns) {
          if (!locationKey) { reject(column, 'A location ID is required for location settings.'); continue }
          const field = catalogLocationColumns[column as keyof typeof catalogLocationColumns]
          if (value === undefined) delete (settings as any)[field]
          else (settings as any)[field] = value
          settingsEdited = true
        } else {
          const edits = column in catalogSupplierColumns ? target.supplierEdits : target.edits
          if (edits.has(column) && !same(edits.get(column), value)) reject(column, 'Nonblank global values must agree across all rows for this item.')
          else edits.set(column, value)
        }
      } catch (e) { reject(column, reason(e)) }
    }
    if (settingsEdited) {
      const i = target.group.locations.findIndex(l => l.locationId === locationKey)
      if (Object.keys(settings).length === 1) { if (i >= 0) target.group.locations.splice(i, 1) }
      else if (i >= 0) target.group.locations[i] = settings
      else target.group.locations.push(settings)
    }
  })
  for (const p of pending.values()) {
    const group = p.group, before = catalogItemSnapshot(p.current)
    for (const [column, value] of p.edits) group.item[catalogItemColumns[column as keyof typeof catalogItemColumns]] = value
    group.item.catalogLocations = group.locations
    const reject = (e: unknown, supplier = false) => {
      p.invalid = true
      const field = (e as any)?.details?.field
      const column = field ? columnFor(field, supplier) : supplier ? 'preferred_supplier_id' : 'item'
      const locationId = (e as any)?.details?.locationId
      const locationRow = locationId ? group.rows.find(row => {
        const cells = rows[lines.slice(1).indexOf(row)]
        return cells && readCatalogCell(cells[header.indexOf('location_id')] ?? '') === locationId
      }) : undefined
      error(locationRow ?? p.source.get(column) ?? group.rows[0], column, reason(e), group.key)
    }
    try { group.item = normalizeCatalogItem(s, group.item, p.current); group.locations = group.item.catalogLocations }
    catch (e) { reject(e) }
    if (p.supplierEdits.size) {
      if (p.supplierEdits.get('preferred_supplier_id') === null) {
        if ([...p.supplierEdits.keys()].some(column => column !== 'preferred_supplier_id')) reject(new Error('Removing the preferred supplier cannot also edit its fields.'), true)
        group.supplier = null
      } else {
        const supplier: CatalogSupplier = { partyId: '', partyCode: '', price: '0', unit: group.item.baseUnit, leadDays: 0, ...p.beforeSupplier }
        for (const [column, value] of p.supplierEdits) (supplier as any)[catalogSupplierColumns[column as keyof typeof catalogSupplierColumns]] = value
        group.supplier = supplier
        try { group.supplier = normalizeCatalogSupplier(s, group.item, supplier) }
        catch (e) { reject(e, true) }
      }
    }
    for (const field of Object.values(catalogItemColumns)) if (!same(before[field], group.item[field])) group.changes.push({ field, before: before[field], after: group.item[field] })
    const locationIds = new Set([...before.catalogLocations, ...group.locations].map((l: CatalogLocation) => l.locationId))
    for (const locationId of locationIds) {
      const old = before.catalogLocations.find((l: CatalogLocation) => l.locationId === locationId), next = group.locations.find(l => l.locationId === locationId)
      for (const field of Object.values(catalogLocationColumns)) if (!same(old?.[field], next?.[field])) group.changes.push({ field, locationId, before: old?.[field], after: next?.[field] })
    }
    if (group.supplier !== undefined) for (const [column, field] of Object.entries(catalogSupplierColumns)) {
      if (!same(p.beforeSupplier?.[field], group.supplier?.[field])) group.changes.push({ field: column, before: p.beforeSupplier?.[field], after: group.supplier?.[field] })
    }
  }
  return { groups: [...pending.values()].filter(p => !p.invalid).map(p => p.group), rejectedGroups: [...pending.values()].filter(p => p.invalid).map(p => p.group), errors }
}
