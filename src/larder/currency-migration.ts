// Versioned conversion of a declared legacy AUD business archive. Preparation
// never edits an installation. Originals and every converted scalar travel with
// the result; unrecognised monetary shapes fail closed instead of being guessed.
import { canonicalJson, sha256 } from '../modules/import-kit/src/d1/index'
import { decimal, format, times, cents, MAX } from './decimal'
import { collections, date, text, type Actor } from './model'
import { Problem, fail, forbidden } from './problem'
import type { Bindings } from '../auth.server'
import { authority } from './storage'

export const archiveFormat = 'larder-archive-v1'
const migrationFormat = 'larder-aud-to-usd-v1'
const moneyKeys = new Set(['standardLaborRate', 'standardCost', 'salePrice', 'price', 'unitPrice', 'quotedUnitCost', 'unitCost', 'standardUnitCost', 'actualUnitCost', 'unitAmount', 'amount', 'amountCents', 'total', 'exposure', 'materials', 'standardOutput', 'variance', 'cost', 'laborCost', 'machineCost', 'overheadCost', 'materialCost', 'serviceCost', 'rate', 'hourlyRate', 'laborRate', 'burdenRate', 'machineRate', 'overheadRate', 'freight', 'tax', 'priceVariance', 'value', 'valueChange', 'roundingResidual', 'stock', 'wip', 'cogs', 'revenue', 'margin', 'profit'])
// A closed schema is intentional. New financial sub-ledgers need their own
// conversion semantics (particularly approvals, valuations and source evidence).
const legacyKinds = new Set(['businessProfiles', 'items', 'locations', 'parties', 'partyItems', 'boms', 'salesOrders', 'purchaseOrders', 'workOrders', 'receipts', 'lots', 'shipments', 'returns', 'transfers', 'counts', 'openings', 'reversals', 'handoffs', 'roles', 'approvals', 'resolutions', 'sourceHistory', 'historyImports'])
const originalFields = new Set(['attributes', 'sourceAmount', 'sourcePrice', 'sourceCost', 'sourceUnitCost', 'sourceCurrency', 'conversionRate', 'rateToUsd', 'usdRate', 'original', 'evidence', 'attachments', 'drawings'])
const numeric = (v: unknown) => typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)
type Entry = { path: (string | number)[]; sourceCurrency: 'AUD'; currency: 'USD'; original: string; converted: string; representation: 'decimal' | 'scaled' | 'cents'; basisOriginal?: string }

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
  return { version: 1, records: Object.fromEntries(Object.entries(records).map(([kind, rows]) => [kind, rows.map(r => ({ id: r.id, currency: kind === 'sourceHistory' ? r.currency : currency, ...(kind === 'salesOrders' && r.currency === 'CAD' && r.functionalCurrency === 'USD' ? { customerCurrency: r.currency, usdRate: r.usdRate } : {}) }))])), movements: currency }
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
  const rules: any[] = input.declarations ?? [], used = new Set<string>()
  if (!Array.isArray(rules) || rules.length > 10000 || rules.some(r => !Array.isArray(r?.path) || !['amount', 'quantity'].includes(r.type) || !r.path.length || r.path.some((p: any) => !(typeof p === 'string' || Number.isSafeInteger(p))))) fail('CURRENCY_MIGRATION', 'Supply exact amount or quantity paths for additional record shapes.')
  const ruleMap = new Map(rules.map(r => [canonicalJson(r.path), r]))
  if (ruleMap.size !== rules.length) fail('CURRENCY_MIGRATION', 'A migration path can be classified only once.')
  const classify = (path: (string | number)[], v: unknown, required: boolean): string | undefined => {
    const rule = ruleMap.get(canonicalJson(path))
    if (!rule && required) fail('CURRENCY_MIGRATION', 'Review and classify every numeric field of an additional record shape.', { path })
    if (!rule) return
    used.add(canonicalJson(path))
    if (rule.type === 'quantity') {
      if (/(?:cost|price|amount|wage|burden|exposure|revenue|profit|margin|^rate$|standardLaborRate|machineRate|overheadRate|hourlyRate|laborRate)/i.test(String(path.at(-1)))) fail('CURRENCY_MIGRATION', 'A monetary field cannot be declared a quantity.', { path })
      text(rule.reason, 'unchanged quantity basis', 500)
      return
    }
    if (/(?:quantity|minutes|hours|percent|multiplier|sequence|version|days|count|yield|factor|good|scrap|received|shipped|issued|returned|cancelled|rejected|weight|seasonality|capacity|units|duration)/i.test(String(path.at(-1)))) fail('CURRENCY_MIGRATION', 'A physical quantity or operational factor cannot be converted as money.', { path })
    if (rule.currency !== 'AUD' || !numeric(v)) fail('CURRENCY_MIGRATION', 'A converted amount needs an explicit AUD declaration and an exact decimal string.', { path })
    return amount(v as string, path)
  }
  function amount(value: string, path: (string | number)[], representation: Entry['representation'] = 'decimal', basisOriginal?: string) {
    const original = representation === 'scaled' ? (/^-?\d+$/.test(value) ? BigInt(value) : fail('CURRENCY_MIGRATION', 'A movement rate must be a scaled integer.')) : decimal(value, 'original AUD amount', { signed: true })
    const converted = times(basisOriginal === undefined ? original : decimal(basisOriginal, 'full original AUD amount', { signed: true }), rate)
    if (original > MAX || original < -MAX || converted > MAX || converted < -MAX) fail('CURRENCY_MIGRATION', 'A converted amount exceeds the supported exact range.')
    const result = representation === 'scaled' ? converted.toString() : representation === 'cents' ? cents(converted) : format(converted)
    entries.push({ path, sourceCurrency: 'AUD', currency: 'USD', original: value, converted: result, representation, ...(basisOriginal === undefined ? {} : { basisOriginal }) })
    return result
  }
  function walk(value: any, path: (string | number)[], explicit = false): any {
    if (Array.isArray(value)) return value.map((v, i) => walk(v, [...path, i], explicit))
    if (!value || typeof value !== 'object') return explicit && (numeric(value) || typeof value === 'number') ? classify(path, value, true) ?? value : value
    const out: any = {}
    for (const [key, v] of Object.entries(value)) {
      if (originalFields.has(key) || key === 'id' || key === 'version' || /Ids?$/.test(key)) out[key] = v
      else if (key === 'currency' || key === 'functionalCurrency') {
        if (v !== 'AUD') fail('CURRENCY_MIGRATION', 'A native legacy record has a conflicting currency. Keep mixed-currency source evidence separate.')
        out[key] = 'USD'
      } else if (key === 'amountCents') {
        const rule = ruleMap.get(canonicalJson([...path, key]))
        if (explicit && !rule) fail('CURRENCY_MIGRATION', 'Review the cent amount declaration.', { path: [...path, key] })
        if (rule && (rule.type !== 'amount' || rule.currency !== 'AUD')) fail('CURRENCY_MIGRATION', 'A cent amount must be declared AUD money.')
        if (rule) used.add(canonicalJson([...path, key]))
        if (!numeric(v) || !numeric(value.amount)) fail('CURRENCY_MIGRATION', 'A cent-rounded amount needs its full original decimal amount.')
        out[key] = amount(v as string, [...path, key], 'cents', value.amount)
      } else if (explicit && (numeric(v) || typeof v === 'number') && key !== 'version') {
        out[key] = classify([...path, key], v, true) ?? v
      } else if (ruleMap.has(canonicalJson([...path, key]))) {
        if (moneyKeys.has(key) && ruleMap.get(canonicalJson([...path, key])).type !== 'amount') fail('CURRENCY_MIGRATION', 'A known native amount cannot be excluded from conversion.')
        out[key] = classify([...path, key], v, false) ?? v
      } else if (moneyKeys.has(key) && v !== null && typeof v !== 'object') {
        if (!numeric(v)) fail('CURRENCY_MIGRATION', 'A legacy monetary field is not an exact decimal string.')
        out[key] = amount(v as string, [...path, key])
      } else if (/(?:cost|price|amount|value|rate|total|exposure|margin|revenue|profit)/i.test(key) && numeric(v) && !['tolerancePercent', 'yieldRate', 'scrapRate', 'taxRate', 'discountRate', 'discountPercent', 'exchangeRate'].includes(key)) {
        fail('CURRENCY_MIGRATION', 'An unrecognised monetary field needs a newer migration version.', { path: [...path, key] })
      } else out[key] = walk(v, [...path, key], explicit)
    }
    return out
  }
  for (const [kind, rows] of Object.entries(source.records) as [string, any[]][]) {
    // Source history already declares original currencies. It is not native AUD.
    target.records[kind] = ['sourceHistory', 'historyImports'].includes(kind) ? rows : rows.map((r, i) => walk(r, ['records', kind, i], !legacyKinds.has(kind)))
  }
  if (used.size !== rules.length) fail('CURRENCY_MIGRATION', 'A declared path was not used. Review the exact source archive and declarations again.')
  target.movements = source.movements.map((m: any, i: number) => ({ ...m, unitCost: amount(m.unitCost, ['movements', i, 'unitCost'], 'scaled') }))
  // Original outcomes remain evidence, but replay cannot return AUD as native
  // USD or execute a capture again. The old identity remains reserved.
  target.commands = source.commands
  target.currency = 'USD'
  target.currencyDeclarations = currencyDeclarations(target.records)
  const before = stockValue(source.movements), after = stockValue(target.movements), expected = times(before, rate)
  const originalStock = source.movements.map((m: any) => ({ id: m.id, quantity: m.quantity, unitCost: m.unitCost }))
  target.currencyMigration = { format: migrationFormat, version: 1, sourceCurrency: 'AUD', currency: 'USD', sourceChecksum: sourceArchive.checksum, rateToUsd: format(rate), recordedOn, source: basis, reason, preparedBy: actor.id, preparedAt: at, sourceStateVersion: source.version, originalRecordVersions: Object.fromEntries(Object.entries(source.records).map(([kind, rows]) => [kind, (rows as any[]).map(r => ({ id: r.id, version: r.version }))])), input: { ...input, rateToUsd: format(rate), source: basis, reason }, originalCurrencyDeclarations: currencyDeclarations(source.records, 'AUD'), originalCommandIds: source.commands.map((c: any) => c.id), originalCommandsCurrency: 'AUD', originalStock, entries, totals: amountTotals(entries), reconciliation: { sourceStockValue: format(before), expectedUsd: format(expected), convertedStockValue: format(after), roundingDifferenceUsd: format(after - expected), quantityUnchanged: true }, boundary: 'Locally recorded conversion, not ledger, provider or tax confirmation. Per-amount half-away-from-zero rounding to six places; stock-rate rounding differences remain explicit.' }
  return target
}
function amountTotals(entries: Entry[]) {
  return [...new Set(entries.map(e => String(e.path.at(-1))))].sort().map(field => {
    const same = entries.filter(e => String(e.path.at(-1)) === field)
    const scaled = (e: Entry, value: string) => e.representation === 'scaled' ? BigInt(value) : decimal(value, field, { signed: true })
    return { field, count: same.length, sourceCurrency: 'AUD', currency: 'USD', original: format(same.reduce((n, e) => n + scaled(e, e.original), 0n)), converted: format(same.reduce((n, e) => n + scaled(e, e.converted), 0n)) }
  })
}
export function checkMigration(receipt: any, content: any) {
  if (receipt?.format !== migrationFormat || receipt.version !== 1 || receipt.sourceCurrency !== 'AUD' || receipt.currency !== 'USD' || receipt.originalCommandsCurrency !== 'AUD') fail('CURRENCY_MIGRATION', 'Unknown currency migration version.')
  const input = receipt.input, rate = decimal(receipt.rateToUsd, 'recorded USD per AUD', { positive: true })
  if (input?.version !== 1 || input.consent !== true || input.sourceChecksum !== receipt.sourceChecksum || input.rateToUsd !== receipt.rateToUsd || input.recordedOn !== receipt.recordedOn || input.source !== receipt.source || input.reason !== receipt.reason) fail('CURRENCY_MIGRATION', 'The recorded rate does not match the reviewed migration.')
  const paths = new Set<string>()
  for (const entry of receipt.entries as Entry[]) {
    const key = canonicalJson(entry.path)
    if (paths.has(key) || entry.sourceCurrency !== 'AUD' || entry.currency !== 'USD' || !['decimal', 'scaled', 'cents'].includes(entry.representation)) fail('CURRENCY_MIGRATION', 'The migration contains an ambiguous amount declaration.')
    paths.add(key)
    const n = entry.representation === 'scaled' ? BigInt(entry.original) : decimal(entry.original, 'original AUD amount', { signed: true })
    const expected = times(entry.basisOriginal === undefined ? n : decimal(entry.basisOriginal, 'full original AUD amount', { signed: true }), rate)
    if (entry.converted !== (entry.representation === 'scaled' ? expected.toString() : entry.representation === 'cents' ? cents(expected) : format(expected))) fail('CURRENCY_MIGRATION', 'A converted amount does not match its original and recorded rate.')
    if (entry.path[0] === 'movements') {
      const original = receipt.originalStock[Number(entry.path[1])], current = content.movements.find((m: any) => m.id === original.id)
      if (!current || current.unitCost !== entry.converted || current.quantity !== original.quantity) fail('CURRENCY_MIGRATION', 'An original migrated movement rate or quantity changed.')
    } else if (entry.path[0] === 'records') {
      const [_, kind, index, ...tail] = entry.path, original = receipt.originalRecordVersions[String(kind)][Number(index)]
      const current = content.records[String(kind)].find((r: any) => r.id === original.id)
      if ((!current && content.version === receipt.sourceStateVersion) || (current?.version === original.version && tail.reduce((v: any, k) => v?.[k], current) !== entry.converted)) fail('CURRENCY_MIGRATION', 'A migrated record amount changed without a subsequent native revision.')
    }

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
