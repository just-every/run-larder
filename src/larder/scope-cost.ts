// GOV-001 costs-and-wages scope (ct scope-review-50 b): wages (labor, burden and wage rates) and costs (unit costs,
// values, valuations, standard/actual/WIP cost, variances, purchase and sales prices, margins, cash exposure and
// anything computed from them) disappear from state, screens, API and downloads for a restricted member, shown as
// `restricted`. A restricted value is never echoed in an error, preview, evidence or audit text.
export const restricted = 'restricted'

const moneyTokens = new Set(['cost', 'costs', 'price', 'prices', 'rate', 'rates', 'wage', 'wages', 'burden', 'margin', 'valuation', 'amount', 'amounts', 'cents', 'usd', 'cash', 'value', 'values', 'total', 'totals', 'worth'])
const notMoney = new Set(['yield', 'conversion'])
const tokens = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
export const isCostKey = (key: string) => { const t = tokens(key); return t.some(x => moneyTokens.has(x)) && !t.some(x => notMoney.has(x)) }
const filled = (v: unknown) => v !== undefined && v !== null && v !== '' && v !== false

// Every door that needs or shows a cost field to its caller: refused to a restricted member.
export const costDoors = /^(so\.(quote|confirm|changePreview|cancelLine)|po\.(draft|approve|revise|confirm|amend|selectQuote|tolerance)|handoff\.|capacity\.rate|rework\.|subcontract\.(approve|bill|draft)|supplier\.terms|cutover\.|import\.|history\.|proposal\.(prepare|approve)|opening\.record)/

// Everything under a cost-named key is restricted (its identifiers stay, so the record keeps its shape).
const identity = (key: string) => key === 'id' || key === 'version' || /Ids?$/.test(key)
export function redactCosts<T>(value: T, inCost = false): T {
  if (Array.isArray(value)) return value.map(v => redactCosts(v, inCost)) as T
  if (typeof value !== 'object' || value === null) return (inCost && (typeof value === 'string' || typeof value === 'number') && filled(value) ? restricted : value) as T
  const o = value as Record<string, any>, out: Record<string, any> = {}
  const costField = typeof o.field === 'string' && isCostKey(o.field)
  for (const [k, v] of Object.entries(o)) {
    if (inCost && identity(k)) out[k] = v
    else out[k] = redactCosts(v, inCost || isCostKey(k) || (costField && ['before', 'after', 'from', 'to', 'old', 'new'].includes(k)))
  }
  return out as T
}

// True when a payload offers a cost or wage value.
export function offersCost(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(offersCost)
  if (typeof value !== 'object' || value === null) return false
  return Object.entries(value).some(([k, v]) => (isCostKey(k) && filled(v)) || offersCost(v))
}
