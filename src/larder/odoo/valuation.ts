// MOVE-007: stock valuation reconciliation for a move-in preview. The source total
// is every on-hand row at an internal location, valued at the source's own unit
// cost, converted to USD at the recorded rate; the Larder total is what the
// proposed opening would post. Their difference is exact to the cent, every row
// that did not move across (or moved with a rounding difference) is an exception to
// review, and "matched" means a zero difference.
import { cents, decimal, format, times } from '../decimal'
import type { State } from '../model'
import { readFiles, odooNumber, type Currency, type OdooFile, type Plan } from './map'

export type ValuationException = { file: string; line: number; sourceId: string; kind: 'not-moved' | 'unvalued' | 'rounding'; reason: string; quantity: string; sourceValue: string | null; sourceValueUsd: string | null; larderValueUsd: string | null }
export type Valuation = {
  currency: string; rateToUsd: string; asOf: string
  source: { rows: number; total: string; totalUsd: string }
  larder: { rows: number; totalUsd: string }
  differenceUsd: string; matched: boolean
  exceptions: ValuationException[]; reviewCount: number
  excluded: { file: string; line: number; sourceId: string; reason: string }[]
  lots: { sku: string; lot: string; quantity: string }[]
  stockValues: { sku: string; location: string; quantity: string; unitCostUsd: string; valueUsd: string; asOf: string }[]
}

const centsInt = (n: bigint) => BigInt(cents(n).replace('.', ''))
const money = (c: bigint) => `${c < 0n ? '-' : ''}${(c < 0n ? -c : c) / 100n}.${((c < 0n ? -c : c) % 100n).toString().padStart(2, '0')}`

export function valuate(s: State, files: OdooFile[], plan: Plan, currency: Currency, asOf: string): Valuation {
  const { tables } = readFiles(files), table = (m: string) => tables.find(t => t.model === m)
  const rate = decimal(currency.rateToUsd, 'conversion rate', { positive: true }), toUsd = (n: bigint) => currency.code === 'USD' ? n : times(n, rate)
  const costs = new Map<string, bigint | null>()
  for (const r of table('product.product')?.records ?? []) { const id = r.cells.id.trim(); if (!costs.has(id)) { try { costs.set(id, r.cells.standard_price ? odooNumber(r.cells.standard_price, 'standard_price') : 0n) } catch { costs.set(id, null) } } }
  const earlier = (id: string) => { const i = s.items.find(x => x.sourceId === id); return i ? decimal(i.standardCost) : undefined }
  const internal = new Set([...s.locations.map(l => l.sourceId).filter(Boolean), ...(table('stock.location')?.records ?? []).filter(r => r.cells.usage.trim() === 'internal').map(r => r.cells.id.trim())])
  const accepted = new Map<number, { quantity: string; unitCost: string }>()
  for (const o of plan.openings) for (const l of o.lines) accepted.set(l.line, l)
  const reasons = new Map(plan.rejected.map(r => [`${r.file}:${r.line}`, r.reason]))
  const exceptions: ValuationException[] = [], excluded: Valuation['excluded'] = []
  let sourceTotal = 0n, sourceRows = 0, larderTotal = 0n
  for (const r of table('stock.quant')?.records ?? []) {
    const file = table('stock.quant')!.file, product = r.cells['product_id/id'].trim(), loc = r.cells['location_id/id'].trim(), sourceId = r.cells.id?.trim() || `${product}@${loc}`
    const base = { file, line: r.line, sourceId }
    if (!internal.has(loc)) { excluded.push({ ...base, reason: 'Not an internal location: it holds no company stock and is outside the valuation.' }); continue }
    let q: bigint | null = null
    try { q = odooNumber(r.cells.quantity, 'quantity') } catch { /* an unreadable quantity cannot be valued */ }
    const cost = costs.has(product) ? costs.get(product)! : earlier(product) ?? null, hit = accepted.get(r.line)
    if (q === null || cost === null) { exceptions.push({ ...base, kind: 'unvalued', reason: reasons.get(`${file}:${r.line}`) ?? (q === null ? 'The quantity is not a number' : 'The product has no readable cost'), quantity: r.cells.quantity, sourceValue: null, sourceValueUsd: null, larderValueUsd: null }); continue }
    if (q === 0n) { excluded.push({ ...base, reason: 'Zero on hand' }); continue }
    const value = times(q, cost), valueUsd = toUsd(value)
    sourceTotal += value; sourceRows++
    if (!hit) { exceptions.push({ ...base, kind: 'not-moved', reason: reasons.get(`${file}:${r.line}`) ?? 'Not moved into Larder', quantity: format(q), sourceValue: format(value), sourceValueUsd: format(valueUsd), larderValueUsd: '0' }); continue }
    const larder = times(decimal(hit.quantity), decimal(hit.unitCost))
    larderTotal += larder
    if (centsInt(larder) !== centsInt(valueUsd)) exceptions.push({ ...base, kind: 'rounding', reason: `Larder values this row at ${money(centsInt(larder))} USD against ${money(centsInt(valueUsd))} USD converted from the source.`, quantity: format(q), sourceValue: format(value), sourceValueUsd: format(valueUsd), larderValueUsd: format(larder) })
  }
  const sourceUsd = toUsd(sourceTotal), difference = centsInt(larderTotal) - centsInt(sourceUsd)
  const sku = (source: string) => plan.items.find(i => i.sourceId === source)?.sku ?? s.items.find(i => i.sourceId === source)?.sku ?? source
  const place = (source: string) => plan.locations.find(l => l.sourceId === source)?.name ?? s.locations.find(l => l.sourceId === source)?.name ?? source
  return {
    currency: currency.code, rateToUsd: currency.rateToUsd, asOf,
    source: { rows: sourceRows, total: format(sourceTotal), totalUsd: money(centsInt(sourceUsd)) }, larder: { rows: accepted.size, totalUsd: money(centsInt(larderTotal)) },
    differenceUsd: money(difference), matched: difference === 0n, exceptions, reviewCount: exceptions.length, excluded,
    lots: plan.openings.flatMap(o => o.lines.filter(l => l.lot).map(l => ({ sku: sku(l.itemSource), lot: l.lot, quantity: l.quantity }))),
    stockValues: plan.openings.flatMap(o => o.lines.map(l => ({ sku: sku(l.itemSource), location: place(o.locationSource), quantity: l.quantity, unitCostUsd: l.unitCost, valueUsd: money(centsInt(times(decimal(l.quantity), decimal(l.unitCost)))), asOf }))),
  }
}
