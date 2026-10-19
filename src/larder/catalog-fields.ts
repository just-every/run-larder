// ENG-007 pure field validation. Suppliers remain partyItems; locations are bins.
import { toBase, unitName } from './catalogue'
import { decimal, format } from './decimal'
import { oneOf, text, type Row, type State } from './model'
import { fail, Problem } from './problem'
import { positions } from './stock'

export type CatalogLocation = { locationId: string; reorderPoint?: string; safetyStock?: string; minStock?: string; maxStock?: string; defaultBin?: string; leadDays?: number }
export type CatalogSupplier = { partyId: string; partyCode: string; price: string; unit: string; leadDays: number }
export type CatalogChange = { field: string; locationId?: string; before: unknown; after: unknown }
export type CatalogGroup = { key: string; itemId?: string; item: Record<string, any>; locations: CatalogLocation[]; supplier: CatalogSupplier | null | undefined; changes: CatalogChange[]; rows: number[] }
export const catalogItemColumns = {
  sku: 'sku', name: 'name', kind: 'kind', base_unit: 'baseUnit', conversions: 'conversions', template: 'template', attributes: 'attributes',
  standard_cost: 'standardCost', sale_price: 'salePrice', archived: 'archived', category: 'category', price_list: 'priceList', barcode: 'barcode', tracking: 'tracking',
} as const
export const catalogLocationColumns = { reorder_point: 'reorderPoint', safety_stock: 'safetyStock', min_stock: 'minStock', max_stock: 'maxStock', default_bin: 'defaultBin', lead_days: 'leadDays' } as const
export const catalogSupplierColumns = { preferred_supplier_id: 'partyId', supplier_code: 'partyCode', purchase_price: 'price', purchase_unit: 'unit', supplier_lead_days: 'leadDays' } as const
export const catalogHeaders = ['larder_id', 'location_id', ...Object.keys(catalogItemColumns), ...Object.keys(catalogSupplierColumns), ...Object.keys(catalogLocationColumns)]

// Check text without trimming identifiers (SKU, barcode, supplier codes).
function exactText(value: unknown, field: string, max: number, optional = false): string {
  if (optional && (value === undefined || value === null || value === '')) return ''
  text(value, field, max)
  return value as string
}
function days(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) >= 366) fail('INPUT', `${field} must be a whole number from 0 to 365.`, { field })
  return value as number
}
function atField<T>(field: string, validate: () => T): T {
  try { return validate() }
  catch (e) {
    if (e instanceof Problem) throw new Problem(e.code, e.message, { ...(e.details && typeof e.details === 'object' ? e.details : {}), field }, e.status)
    throw e
  }
}

export function normalizeCatalogLocations(s: State, value: unknown): CatalogLocation[] {
  if (!Array.isArray(value)) return fail('INPUT', 'Catalog locations must be a list.', { field: 'catalogLocations' })
  const seen = new Set<string>()
  return value.map((input: any) => {
    const locationId = exactText(input?.locationId, 'locationId', 200)
    try {
    if (!s.locations.some(l => l.id === locationId)) fail('NOT_FOUND', 'Unknown catalog location.', { field: 'locationId', locationId })
    if (seen.has(locationId)) fail('INPUT', 'List each catalog location once.', { field: 'locationId', locationId })
    seen.add(locationId)
    const out: CatalogLocation = { locationId }
    for (const field of ['reorderPoint', 'safetyStock', 'minStock', 'maxStock'] as const) {
      if (input[field] !== undefined && input[field] !== null && input[field] !== '') out[field] = format(decimal(input[field], field))
    }
    if (input.defaultBin !== undefined && input.defaultBin !== null && input.defaultBin !== '') {
      out.defaultBin = exactText(input.defaultBin, 'defaultBin', 200)
      if (!s.locations.some(l => l.id === out.defaultBin)) fail('NOT_FOUND', 'Default bin must identify an existing location.', { field: 'defaultBin', locationId, defaultBin: out.defaultBin })
    }
    if (input.leadDays !== undefined && input.leadDays !== null && input.leadDays !== '') out.leadDays = days(input.leadDays, 'leadDays')
    if (out.minStock !== undefined && out.maxStock !== undefined && decimal(out.minStock) > decimal(out.maxStock)) fail('INPUT', 'Minimum stock cannot exceed maximum stock.', { field: 'minStock', locationId })
    return out
    } catch (e) {
      if (e instanceof Problem) throw new Problem(e.code, e.message, { ...(e.details && typeof e.details === 'object' ? e.details : {}), locationId }, e.status)
      throw e
    }
  })
}

// Reuse in saveItem after the owner approves wiring. Only a transition invokes
// the physical-stock guard; every disposition/location/lot is inspected.
export function normalizeCatalogFields(s: State, p: Record<string, any>, current?: Row) {
  const tracking = oneOf(p.tracking ?? current?.tracking ?? 'none', ['none', 'batch', 'serial'] as const, 'tracking')
  if (current && tracking !== (current.tracking ?? 'none') && tracking !== 'none') {
    const physical = positions(s).filter(pos => pos.itemId === current.id && decimal(pos.quantity, 'position', { signed: true }) > 0n)
    const offending = tracking === 'serial' ? physical : physical.filter(pos => !s.lots.some(l => l.id === pos.lotId && l.itemId === current.id && typeof l.code === 'string' && l.code.trim()))
    if (offending.length) fail('TRACKING_STOCK', tracking === 'serial' ? 'Serial tracking cannot be enabled while physical stock exists.' : 'Batch tracking cannot be enabled while physical stock lacks a valid lot.', { field: 'tracking', itemId: current.id, positions: offending })
  }
  return {
    category: exactText(p.category ?? current?.category, 'category', 200, true),
    priceList: exactText(p.priceList ?? current?.priceList, 'priceList', 200, true),
    barcode: exactText(p.barcode ?? current?.barcode, 'barcode', 128, true), tracking,
    catalogLocations: normalizeCatalogLocations(s, p.catalogLocations ?? current?.catalogLocations ?? []),
  }
}

export function catalogItemSnapshot(item?: Row): Record<string, any> {
  return {
    sku: '', name: '', kind: 'buy', baseUnit: '', conversions: [], template: '', attributes: {}, standardCost: '0', salePrice: '0', archived: false,
    category: '', priceList: '', barcode: '', tracking: 'none', catalogLocations: [],
    ...structuredClone(item ?? {}),
  }
}

export function preferredCatalogSupplier(s: State, itemId: string): CatalogSupplier | undefined {
  const matches = s.partyItems.filter(p => p.itemId === itemId && p.preferred && s.parties.some(party => party.id === p.partyId && ['supplier', 'both'].includes(party.kind)))
  if (matches.length > 1) fail('AMBIGUOUS_REFERENCE', 'The item has multiple preferred suppliers. Choose one before editing its catalog.', { itemId, partyItemIds: matches.map(p => p.id) })
  const p = matches[0]
  return p ? { partyId: p.partyId, partyCode: p.partyCode, price: p.price ?? '0', unit: p.unit ?? s.items.find(i => i.id === itemId)?.baseUnit, leadDays: p.leadDays ?? 0 } : undefined
}

export function normalizeCatalogSupplier(s: State, item: Record<string, any>, p: CatalogSupplier): CatalogSupplier {
  const party = s.parties.find(party => party.id === p.partyId) ?? fail('NOT_FOUND', 'Unknown supplier.', { field: 'partyId' })
  if (!['supplier', 'both'].includes(party.kind)) fail('NOT_FOUND', 'Preferred supplier must identify an existing supplier.', { field: 'partyId', partyId: p.partyId })
  const partyCode = exactText(p.partyCode, 'partyCode', 64)
  const clash = s.partyItems.find(ref => ref.partyId === party.id && ref.itemId !== item.id && String(ref.partyCode).toLowerCase() === partyCode.toLowerCase())
  if (clash) fail('AMBIGUOUS_REFERENCE', 'The supplier already uses this code for another item.', { field: 'partyCode', partyItemId: clash.id })
  const unit = atField('unit', () => unitName(p.unit))
  atField('unit', () => toBase(item as Row, '1', unit))
  return { partyId: party.id, partyCode, unit, price: format(decimal(p.price, 'price')), leadDays: days(p.leadDays, 'leadDays') }
}

// Validate the full prospective snapshot. saveItem later checks used-unit and
// final-state SKU/variant constraints through the same atomic command door.
export function normalizeCatalogItem(s: State, input: Record<string, any>, current?: Row): Record<string, any> {
  const item = { ...input }
  item.sku = exactText(item.sku, 'sku', 64); item.name = exactText(item.name, 'name', 200)
  item.kind = oneOf(item.kind, ['make', 'buy'] as const, 'kind'); item.baseUnit = unitName(item.baseUnit, 'baseUnit')
  item.template = exactText(item.template, 'template', 200, true)
  if (!item.attributes || typeof item.attributes !== 'object' || Array.isArray(item.attributes)) fail('INPUT', 'Attributes must be name/value pairs.', { field: 'attributes' })
  atField('attributes', () => { for (const [key, value] of Object.entries(item.attributes)) { text(key, 'attribute', 60); text(value, key, 120) } })
  if (!Array.isArray(item.conversions) || item.conversions.length > 20) fail('INPUT', 'Conversions must be a list of at most 20 units.', { field: 'conversions' })
  const units = new Map<string, string>()
  item.conversions = atField('conversions', () => item.conversions.map((c: any) => {
    const unit = unitName(c?.unit), factor = format(decimal(c?.factor, 'conversion factor', { positive: true }))
    if (unit === item.baseUnit || (units.has(unit) && units.get(unit) !== factor)) fail('AMBIGUOUS_UNIT', 'Conversion units must be unambiguous and differ from the base unit.', { field: 'conversions', unit })
    units.set(unit, factor); return { unit, factor }
  }).filter((c: any, index: number, all: any[]) => all.findIndex(other => other.unit === c.unit) === index))
  for (const field of ['standardCost', 'salePrice']) item[field] = format(decimal(item[field], field))
  if (typeof item.archived !== 'boolean') fail('INPUT', 'Archived must be true or false.', { field: 'archived' })
  return Object.assign(item, normalizeCatalogFields(s, item, current))
}

// Until TRACE-002 ships its serial-aware physical door, configured serial
// requirements refuse operations rather than pretending untracked stock is serial.
export function requireCatalogLot(item: Row, lot: unknown) {
  if (item.tracking === 'serial') fail('SERIAL_EXECUTION', 'Serial policy configured; serial execution not yet available.', { itemId: item.id })
  if (item.tracking === 'batch' && (typeof lot !== 'string' || !lot.trim())) fail('LOT_REQUIRED', 'This item requires a batch/lot on every receipt or production output.', { itemId: item.id })
}
