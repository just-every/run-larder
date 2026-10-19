// Items, variants, units, locations and parties.
import { normalizeCatalogFields } from './catalog-fields'
import { decimal, format, SCALE } from './decimal'
import { fail } from './problem'
import { allow } from './roles'
import { bump, fresh, get, oneOf, optionalText, row, text, type Context, type Row, type State } from './model'

export const unitName = (value: unknown, name = 'unit') => text(value, name, 40).toLowerCase().replace(/\s+/g, ' ')

// Is the item referenced by stock, documents, BOMs or references? Then its
// base unit and existing conversions are fixed.
export function itemInUse(s: State, itemId: string) {
  const lines = (rows: Row[], key = 'lines') => rows.some(r => (r[key] ?? []).some((l: any) => l.itemId === itemId))
  return s.forecasts.some(f => f.itemId === itemId) || s.movements.some(m => m.itemId === itemId) || lines(s.salesOrders) || lines(s.purchaseOrders) || s.workOrders.some(w => w.itemId === itemId)
    || s.boms.some(b => b.itemId === itemId || b.components.some((l: any) => l.itemId === itemId)) || s.partyItems.some(p => p.itemId === itemId)
}

// Base-unit quantity for a quantity in any unit the item defines. Unknown units
// and conversions that would round are refused rather than guessed.
export function toBase(item: Row, quantity: unknown, unit?: unknown, name = 'quantity'): bigint {
  const q = decimal(quantity, name, { positive: true })
  if (unit === undefined || unit === null || unit === '' || unitName(unit) === item.baseUnit) return q
  const u = unitName(unit)
  const matches = (item.conversions ?? []).filter((c: any) => c.unit === u)
  if (matches.length !== 1) fail(matches.length ? 'AMBIGUOUS_UNIT' : 'UNKNOWN_UNIT', `${item.name} has no single conversion for “${u}”. Define it on the item first.`, { itemId: item.id, unit: u })
  const raw = q * decimal(matches[0].factor)
  if (raw % SCALE !== 0n) fail('INEXACT_CONVERSION', `${format(q)} ${u} does not convert exactly to ${item.baseUnit}.`, { itemId: item.id, unit: u })
  return raw / SCALE
}

function conversions(value: unknown, baseUnit: string) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 20) fail('INPUT', 'Conversions must be a list of at most 20 units.')
  const seen = new Map<string, string>()
  return (value as any[]).map(c => {
    const unit = unitName(c?.unit), factor = format(decimal(c?.factor, `factor for ${unit}`, { positive: true }))
    if (unit === baseUnit) fail('AMBIGUOUS_UNIT', `“${unit}” is the base unit; it cannot also be a conversion.`, { unit })
    if (seen.has(unit) && seen.get(unit) !== factor) fail('AMBIGUOUS_UNIT', `“${unit}” is defined twice with different factors (${seen.get(unit)} and ${factor}).`, { unit })
    seen.set(unit, factor)
    return { unit, factor }
  }).filter((c, i, all) => all.findIndex(x => x.unit === c.unit) === i)
}

export function saveItem(c: Context, p: any, importId?: string): Row {
  const sku = text(p.sku, 'SKU', 64), name = text(p.name, 'name', 200)
  const baseUnit = unitName(p.baseUnit, 'base unit')
  const kind = oneOf(p.kind ?? 'buy', ['make', 'buy'] as const, 'kind')
  const template = optionalText(p.template, 'template', 200)
  const attributes: Record<string, string> = {}
  if (p.attributes !== undefined) {
    if (!p.attributes || typeof p.attributes !== 'object' || Array.isArray(p.attributes)) fail('INPUT', 'Attributes must be name/value pairs.')
    for (const [k, v] of Object.entries(p.attributes)) attributes[text(k, 'attribute', 60)] = text(v, k, 120)
  }
  const units = conversions(p.conversions, baseUnit)
  const duplicate = c.s.items.find(i => i.id !== p.id && i.sku.toLowerCase() === sku.toLowerCase())
  if (duplicate) fail('DUPLICATE_SKU', `SKU ${sku} already belongs to ${duplicate.name}.`, { itemId: duplicate.id })
  if (template) {
    const key = JSON.stringify(Object.entries(attributes).sort())
    const twin = c.s.items.find(i => i.id !== p.id && i.template === template && JSON.stringify(Object.entries(i.attributes ?? {}).sort()) === key)
    if (twin) fail('DUPLICATE_VARIANT', `${template} already has a variant with those attributes (${twin.sku}).`, { itemId: twin.id })
  }
  const standardCost = p.standardCost === undefined ? '0' : format(decimal(p.standardCost, 'standard cost'))
  const salePrice = p.salePrice === undefined ? '0' : format(decimal(p.salePrice, 'sale price'))
  const extended = normalizeCatalogFields(c.s, p, p.id ? get(c.s, 'items', p.id, 'item') : undefined)
  const data = { ...extended, sku, name, kind, baseUnit, template, attributes, conversions: units, standardCost, salePrice, archived: p.archived === true, sourceId: p.sourceId ?? null, importId: importId ?? null }
  if (!p.id) return row(c, 'items', data)
  const item = get(c.s, 'items', p.id, 'item')
  fresh(item, p.version)
  if (itemInUse(c.s, item.id)) {
    if (item.baseUnit !== baseUnit) fail('UNIT_FIXED', `${item.name} is already in use; its base unit stays ${item.baseUnit}. Create a new SKU to change it.`)
    for (const old of item.conversions) {
      const next = units.find(u => u.unit === old.unit)
      if (!next || next.factor !== old.factor) fail('UNIT_FIXED', `${item.name} is already in use; the ${old.unit} conversion stays ${old.factor} ${item.baseUnit}.`)
    }
  }
  return bump(item, { ...data, sourceId: item.sourceId, importId: item.importId })
}

export function catalogue(c: Context, type: string, p: any): Row | undefined {
  switch (type) {
    case 'item.save':
      allow(c, ['manager', 'buyer'])
      return saveItem(c, p)
    case 'location.save': {
      allow(c, ['manager', 'warehouse'])
      const name = text(p.name, 'location name', 120)
      if (c.s.locations.some(l => l.id !== p.id && l.name.toLowerCase() === name.toLowerCase())) fail('DUPLICATE_LOCATION', `A location called ${name} already exists.`)
      if (!p.id) return row(c, 'locations', { name, note: optionalText(p.note, 'note', 400), archived: false })
      const l = get(c.s, 'locations', p.id, 'location'); fresh(l, p.version)
      return bump(l, { name, note: optionalText(p.note, 'note', 400), archived: p.archived === true })
    }
    case 'party.save': {
      allow(c, ['manager', 'buyer', 'sales'])
      const name = text(p.name, 'name', 200), kind = oneOf(p.kind, ['customer', 'supplier', 'both'] as const, 'kind')
      const twin = c.s.parties.find(x => x.id !== p.id && x.name.toLowerCase() === name.toLowerCase())
      if (twin) fail('DUPLICATE_PARTY', `${name} already exists. Use the existing record or give it a distinguishing name.`, { partyId: twin.id })
      const data = { name, kind, email: optionalText(p.email, 'email', 200), abn: optionalText(p.abn, 'EIN', 20), terms: optionalText(p.terms, 'terms', 200) }
      if (!p.id) return row(c, 'parties', { ...data, sourceId: null, importId: null })
      const party = get(c.s, 'parties', p.id, 'party'); fresh(party, p.version)
      return bump(party, data)
    }
    case 'partyItem.save': {
      allow(c, ['manager', 'buyer', 'sales'])
      return savePartyItem(c, p)
    }
  }
}


// Shared catalog write primitive; each public command establishes its role first.
export function savePartyItem(c: Context, p: any): Row {
  const party = get(c.s, 'parties', p.partyId, 'party'), item = get(c.s, 'items', p.itemId, 'item')
  const code = text(p.partyCode, 'their code', 64)
  const clash = c.s.partyItems.find(x => x.id !== p.id && x.partyId === party.id && x.partyCode.toLowerCase() === code.toLowerCase() && x.itemId !== item.id)
  if (clash) fail('AMBIGUOUS_REFERENCE', `${party.name} already uses code ${code} for another item.`, { partyItemId: clash.id })
  if (p.unit) toBase(item, '1', p.unit)
  const data = { partyId: party.id, itemId: item.id, partyCode: code, unit: p.unit ? unitName(p.unit) : item.baseUnit, price: format(decimal(p.price ?? '0', 'price')), leadDays: Number.isSafeInteger(p.leadDays) && p.leadDays >= 0 && p.leadDays < 366 ? p.leadDays : 0, preferred: p.preferred === true }
  const existing = p.id ? get(c.s, 'partyItems', p.id, 'reference') : null
  if (!existing) return row(c, 'partyItems', data)
  fresh(existing, p.version)
  return bump(existing, data)
}
