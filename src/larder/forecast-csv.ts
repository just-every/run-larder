import { decimal, format, times } from './decimal'
import { fail } from './problem'
import { parseCsv } from './odoo/csv'
import { weekOf } from './forecast-plan'
import type { State } from './model'

export function parseForecast(s: State, content: string, file: string) {
  if (typeof content !== 'string' || content.length > 1024 * 1024) fail('INPUT', 'Use a forecast CSV up to 1 MiB.')
  const rows = parseCsv(content, file), header = rows.shift(), seen = new Set<string>(), errors: any[] = [], buckets: any[] = []
  if (!header || header.join(',') !== 'sku,week,quantity,seasonality') fail('CSV', 'Use columns sku,week,quantity,seasonality in that order. Quantities use the SKU base unit.')
  if (!rows.length || rows.length > 500) fail('CSV', 'Import between 1 and 500 weekly forecasts at a time.')
  rows.forEach((cells, i) => {
    try {
      if (cells.length !== 4) fail('CSV', 'Each row needs four cells.')
      const [sku, inputWeek, quantity, factor] = cells, item = s.items.find(i => i.sku === sku && !i.archived) ?? fail('INPUT', 'Unknown or archived SKU.')
      const week = weekOf(inputWeek)
      if (week !== inputWeek) fail('INPUT', 'Week must be a Monday (YYYY-MM-DD, UTC).')
      const key = `${item.id}|${week}`
      if (seen.has(key)) fail('INPUT', 'Duplicate SKU/week in this file.')
      seen.add(key)
      const q = decimal(quantity), seasonality = decimal(factor || '1')
      decimal(format(times(q, seasonality)), 'adjusted forecast')
      buckets.push({ itemId: item.id, week, quantity: format(q), seasonality: format(seasonality), overrideQuantity: null })
    } catch (e) { errors.push({ file, row: i + 2, reason: e instanceof Error ? e.message : String(e) }) }
  })
  if (errors.length) fail('CSV_ROWS', 'Correct the forecast rows; nothing was imported.', errors)
  return buckets
}
