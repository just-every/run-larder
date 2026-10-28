// Versioned conversion of a declared legacy AUD business archive. Preparation
// never edits an installation. Originals and every converted scalar travel with
// the result; unrecognised monetary shapes fail closed instead of being guessed.
import { canonicalJson, sha256 } from '../modules/import-kit/src/d1/index'
import { decimal, format, times, MAX } from './decimal'
import { collections, date, text, type Actor } from './model'
import { Problem, fail, forbidden } from './problem'
import type { Bindings } from '../auth.server'
import { authority } from './storage'

export const archiveFormat = 'larder-archive-v1'
const migrationFormat = 'larder-aud-to-usd-v1'
const moneyKeys = new Set(['standardCost', 'salePrice', 'price', 'unitPrice', 'quotedUnitCost', 'unitCost', 'standardUnitCost', 'actualUnitCost', 'unitAmount', 'amount', 'amountCents', 'total', 'exposure', 'materials', 'standardOutput', 'variance', 'cost', 'laborCost', 'machineCost', 'overheadCost', 'materialCost', 'serviceCost', 'rate', 'hourlyRate', 'laborRate', 'burdenRate', 'machineRate', 'overheadRate', 'freight', 'tax', 'priceVariance', 'value', 'valueChange', 'roundingResidual', 'stock', 'wip', 'cogs', 'revenue', 'margin', 'profit'])
// A closed schema is intentional. New financial sub-ledgers need their own
// conversion semantics (particularly approvals, valuations and source evidence).
const legacyKinds = new Set(['businessProfiles', 'items', 'locations', 'parties', 'partyItems', 'boms', 'salesOrders', 'purchaseOrders', 'workOrders', 'receipts', 'lots', 'shipments', 'returns', 'transfers', 'counts', 'openings', 'reversals', 'handoffs', 'roles', 'approvals', 'resolutions', 'sourceHistory', 'historyImports'])
const originalFields = new Set(['attributes', 'sourceAmount', 'sourcePrice', 'sourceCost', 'sourceUnitCost', 'sourceCurrency', 'conversionRate', 'rateToUsd', 'usdRate', 'original', 'evidence', 'attachments', 'drawings'])
const numeric = (v: unknown) => typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)
type Entry = { path: (string | number)[]; sourceCurrency: 'AUD'; currency: 'USD'; original: string; converted: string; representation: 'decimal' | 'scaled' }

export function archiveContent(a: any) {
  const { exportedAt, checksum, ledger, ...content } = a ?? {}
  if (content.format !== archiveFormat) fail('ARCHIVE', 'The file is not a Larder archive.')
  if (sha256(canonicalJson(content)) !== checksum) fail('CHECKSUM', 'The archive does not match its checksum. It was changed or damaged after export.')
  return content
}
export async function readArchiveRequest(request: Request) {
  const raw = await request.text()
  if (raw.length > 64 * 1024 * 1024) throw new Problem('SIZE', 'Archives over 64 MiB need the installation export (rer export).', null, 413)
  try { return JSON.parse(raw) } catch { return fail('ARCHIVE', 'The file is not valid archive JSON.') }
}
export function currencyDeclarations(records: Record<string, any[]>, currency = 'USD') {
  return { version: 1, records: Object.fromEntries(Object.entries(records).map(([kind, rows]) => [kind, rows.map(r => ({ id: r.id, currency: kind === 'sourceHistory' ? r.currency : currency }))])), movements: currency }
}
function stockValue(movements: any[]) {
  return movements.reduce((n, m) => n + times(BigInt(m.quantity), BigInt(m.unitCost)), 0n)
}
function convert(sourceArchive: any, input: any, actor: { id: string }, at: string) {
  const source = archiveContent(sourceArchive)
  if (source.currency !== 'AUD' || source.currencyMigration) fail('CURRENCY_MIGRATION', 'Version 1 requires an original archive explicitly declaring AUD; it cannot infer or re-convert a currency.')
  if (input?.version !== 1 || input?.consent !== true || input?.sourceChecksum !== sourceArchive.checksum) fail('CURRENCY_MIGRATION', 'Review the source checksum and explicitly consent to version 1 of this conversion.')
  const rate = decimal(input.rateToUsd, 'USD per AUD', { positive: true })
  const recordedOn = date(input.recordedOn, 'rate date'), basis = text(input.source, 'recorded rate source', 500), reason = text(input.reason, 'migration reason', 500)
  if (new Date(recordedOn + 'T00:00:00Z').toISOString().slice(0, 10) !== recordedOn) fail('CURRENCY_MIGRATION', 'The recorded rate date is not a calendar date.')
  if (!source.records || Object.entries(source.records).some(([kind, rows]) => !Array.isArray(rows) || (!(collections as readonly string[]).includes(kind) && (rows as any[]).length))) fail('CURRENCY_MIGRATION', 'The source contains an unknown record collection.')
  if (source.currencyDeclarations && canonicalJson(source.currencyDeclarations) !== canonicalJson(currencyDeclarations(source.records, 'AUD'))) fail('CURRENCY_MIGRATION', 'The source record declarations do not reconcile to AUD.')
  const target = structuredClone(source), entries: Entry[] = []
  function amount(value: string, path: (string | number)[], representation: Entry['representation'] = 'decimal') {
    const original = representation === 'scaled' ? (/^-?\d+$/.test(value) ? BigInt(value) : fail('CURRENCY_MIGRATION', 'A movement rate must be a scaled integer.')) : decimal(value, 'original AUD amount', { signed: true })
    const converted = times(original, rate)
    if (original > MAX || original < -MAX || converted > MAX || converted < -MAX) fail('CURRENCY_MIGRATION', 'A converted amount exceeds the supported exact range.')
    const result = representation === 'scaled' ? converted.toString() : format(converted)
    entries.push({ path, sourceCurrency: 'AUD', currency: 'USD', original: value, converted: result, representation })
    return result
  }
  function walk(value: any, path: (string | number)[]): any {
    if (Array.isArray(value)) return value.map((v, i) => walk(v, [...path, i]))
    if (!value || typeof value !== 'object') return value
    const out: any = {}
    for (const [key, v] of Object.entries(value)) {
      if (originalFields.has(key)) out[key] = v
      else if (key === 'currency' || key === 'functionalCurrency') {
        if (v !== 'AUD') fail('CURRENCY_MIGRATION', 'A native legacy record has a conflicting currency. Keep mixed-currency source evidence separate.')
        out[key] = 'USD'
      } else if (moneyKeys.has(key) && v !== null && typeof v !== 'object') {
        if (!numeric(v)) fail('CURRENCY_MIGRATION', 'A legacy monetary field is not an exact decimal string.')
        out[key] = amount(v as string, [...path, key])
      } else if (/(?:cost|price|amount|value|rate|total|exposure|margin|revenue|profit)/i.test(key) && numeric(v) && !['tolerancePercent', 'yieldRate', 'scrapRate', 'taxRate', 'discountRate', 'discountPercent', 'exchangeRate'].includes(key)) {
        fail('CURRENCY_MIGRATION', 'An unrecognised monetary field needs a newer migration version.', { path: [...path, key] })
      } else out[key] = walk(v, [...path, key])
    }
    return out
  }
  for (const [kind, rows] of Object.entries(source.records) as [string, any[]][]) {
    if (rows.length && !legacyKinds.has(kind)) fail('CURRENCY_MIGRATION', 'This archive needs a migration version covering its newer financial or operational records.', { collection: kind })
    // Source history already declares original currencies. It is not native AUD.
    target.records[kind] = ['sourceHistory', 'historyImports'].includes(kind) ? rows : rows.map((r, i) => walk(r, ['records', kind, i]))
  }
  target.movements = source.movements.map((m: any, i: number) => ({ ...m, unitCost: amount(m.unitCost, ['movements', i, 'unitCost'], 'scaled') }))
  // Original outcomes remain evidence, but replay cannot return AUD as native
  // USD or execute a capture again. The old identity remains reserved.
  target.commands = source.commands
  target.currency = 'USD'
  target.currencyDeclarations = currencyDeclarations(target.records)
  const before = stockValue(source.movements), after = stockValue(target.movements), expected = times(before, rate)
  const originalStock = source.movements.map((m: any) => ({ id: m.id, quantity: m.quantity, unitCost: m.unitCost }))
  target.currencyMigration = { format: migrationFormat, version: 1, sourceCurrency: 'AUD', currency: 'USD', sourceChecksum: sourceArchive.checksum, rateToUsd: format(rate), recordedOn, source: basis, reason, preparedBy: actor.id, preparedAt: at, input: { ...input, rateToUsd: format(rate), source: basis, reason }, originalCurrencyDeclarations: currencyDeclarations(source.records, 'AUD'), originalCommandIds: source.commands.map((c: any) => c.id), originalCommandsCurrency: 'AUD', originalStock, entries, totals: amountTotals(entries), reconciliation: { sourceStockValue: format(before), expectedUsd: format(expected), convertedStockValue: format(after), roundingDifferenceUsd: format(after - expected), quantityUnchanged: true }, boundary: 'Locally recorded conversion, not ledger, provider or tax confirmation. Per-amount half-away-from-zero rounding to six places; stock-rate rounding differences remain explicit.' }
  return target
}
function amountTotals(entries: Entry[]) {
  return [...new Set(entries.map(e => String(e.path.at(-1))))].sort().map(field => {
    const same = entries.filter(e => String(e.path.at(-1)) === field)
    const scaled = (e: Entry, value: string) => e.representation === 'scaled' ? BigInt(value) : decimal(value, field, { signed: true })
    return { field, count: same.length, sourceCurrency: 'AUD', currency: 'USD', original: format(same.reduce((n, e) => n + scaled(e, e.original), 0n)), converted: format(same.reduce((n, e) => n + scaled(e, e.converted), 0n)) }
  })
}
export function checkMigration(receipt: any) {
  if (receipt?.format !== migrationFormat || receipt.version !== 1 || receipt.sourceCurrency !== 'AUD' || receipt.currency !== 'USD' || receipt.originalCommandsCurrency !== 'AUD') fail('CURRENCY_MIGRATION', 'Unknown currency migration version.')
  const input = receipt.input, rate = decimal(receipt.rateToUsd, 'recorded USD per AUD', { positive: true })
  if (input?.version !== 1 || input.consent !== true || input.sourceChecksum !== receipt.sourceChecksum || input.rateToUsd !== receipt.rateToUsd || input.recordedOn !== receipt.recordedOn || input.source !== receipt.source || input.reason !== receipt.reason) fail('CURRENCY_MIGRATION', 'The recorded rate does not match the reviewed migration.')
  const paths = new Set<string>()
  for (const entry of receipt.entries as Entry[]) {
    const key = canonicalJson(entry.path)
    if (paths.has(key) || entry.sourceCurrency !== 'AUD' || entry.currency !== 'USD' || !['decimal', 'scaled'].includes(entry.representation)) fail('CURRENCY_MIGRATION', 'The migration contains an ambiguous amount declaration.')
    paths.add(key)
    const n = entry.representation === 'scaled' ? BigInt(entry.original) : decimal(entry.original, 'original AUD amount', { signed: true })
    const expected = times(n, rate)
    if (entry.converted !== (entry.representation === 'scaled' ? expected.toString() : format(expected))) fail('CURRENCY_MIGRATION', 'A converted amount does not match its original and recorded rate.')
  }
  const before = stockValue(receipt.originalStock), converted = stockValue(receipt.originalStock.map((m: any) => ({ ...m, unitCost: times(BigInt(m.unitCost), rate).toString() }))), expected = times(before, rate)
  if (canonicalJson(receipt.totals) !== canonicalJson(amountTotals(receipt.entries)) || canonicalJson(receipt.reconciliation) !== canonicalJson({ sourceStockValue: format(before), expectedUsd: format(expected), convertedStockValue: format(converted), roundingDifferenceUsd: format(converted - expected), quantityUnchanged: true })) fail('CURRENCY_MIGRATION', 'The migration totals or stock reconciliation do not match the original amounts.')
}
export async function migrateAudArchive(env: Bindings, actor: Actor, request: Request) {
  if (actor.role !== 'owner') forbidden('Only the native owner may prepare a currency migration.')
  if (request.headers.get('origin') !== new URL(env.AUTH_ORIGIN).origin) throw new Problem('ORIGIN', 'Prepare the migration from this installation.', null, 403)
  const body = await readArchiveRequest(request)
  const content = convert(body.archive, body.migration, actor, new Date().toISOString())
  const guard = authority(actor)
  const live = await env.DB.prepare(`SELECT CASE WHEN (${guard.sql}) THEN 1 ELSE 0 END AS ok`).bind(...guard.params).first<{ ok: number }>()
  if (live?.ok !== 1) throw new Problem('AUTH', 'Your owner session changed. Sign in again.', null, 401)
  return { ...content, exportedAt: new Date().toISOString(), checksum: sha256(canonicalJson(content)), ledger: content.movements.length }
}
