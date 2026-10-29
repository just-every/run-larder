// Commercial money is allocated once from exact products, never a rounded USD
// unit price. Each posted source keeps the same cents in all downstream views.
import { cents, decimal, format, SCALE } from './decimal'
import { date, oneOf, text, type State } from './model'
import { fail } from './problem'

export function saleCurrency(p: any, asOf?: string) {
  const currency = oneOf(p.currency ?? 'USD', ['USD', 'CAD'] as const, 'customer currency')
  const usdRate = decimal(p.usdRate ?? (currency === 'USD' ? '1' : undefined), 'USD exchange rate', { positive: true })
  if (currency === 'USD' && usdRate !== SCALE) fail('INPUT', 'USD customer prices require a rate of one.')
  const rateDate = currency === 'USD' ? undefined : date(p.rateDate, 'exchange rate date')
  if (rateDate && (new Date(rateDate + 'T00:00:00Z').toISOString().slice(0, 10) !== rateDate || (asOf && rateDate > asOf))) fail('INPUT', 'Use a real, non-future recorded exchange rate date.')
  return { currency, functionalCurrency: 'USD', usdRate: format(usdRate), ...(currency === 'USD' ? {} : { rateDate, rateReference: text(p.rateReference, 'exchange rate reference', 200) }) }
}

// All operands remain integers until the final half-away-from-zero cent.
export function saleExtension(quantity: bigint, unitPrice: string, usdRate = '1') {
  const product = quantity * decimal(unitPrice) * decimal(usdRate), denominator = SCALE * SCALE * 10000n
  const absolute = product < 0n ? -product : product
  return (product < 0n ? -1n : 1n) * ((absolute + denominator / 2n) / denominator) * 10000n
}

export type SaleAllocation = { movementId: string; sourceMovementId: string; orderId: string; lineId: string; currency: string; usdRate: string; unitPrice: string; quantity: string; amount: string; usdAmount: string; kind: string }

// Replay the append-only ledger in sequence. New shipments and returns take the
// difference between rounded cumulative money and previously assigned cents.
// Reversals negate their source exactly; the next new posting takes any residual.
// Thus splitting, correction order and future stock valuation cannot rewrite an
// issued handoff or invoice. Groups isolate each issued commercial price and rate.
export function saleAllocations(s: State): Map<string, SaleAllocation> {
  const allocated = new Map<string, SaleAllocation>()
  const groups = new Map<string, { quantity: bigint; amount: bigint; usdAmount: bigint }>()
  const keys = new Map<string, string>()
  for (const m of [...s.movements].sort((a, b) => a.sequence - b.sequence)) {
    let source: SaleAllocation | undefined, terms: any, line: any, orderId: string | undefined
    if (m.reversesId) source = allocated.get(m.reversesId)
    else if (m.documentKind === 'returns') {
      const record = s.returns.find(r => r.id === m.documentId)
      const returned = record?.sources?.find((x: any) => x.returnMovementId === m.id)
      source = allocated.get(returned?.shipmentMovementId)
    } else if (m.documentKind === 'shipments') {
      const shipment = s.shipments.find(sh => sh.id === m.documentId)
      terms = shipment?.commercialTerms
      if (!terms?.allocationPolicy) continue
      line = shipment!.lines.find((l: any) => l.movementIds?.includes(m.id))
      if (!line) fail('HISTORICAL_TERMS', 'The issued commercial movement has no exact shipment line.')
      orderId = shipment!.orderId
    }
    if (!source && !line) continue
    const key = source ? keys.get(source.movementId)! : JSON.stringify([orderId, line.lineId, line.unitPrice, terms.currency, terms.usdRate])
    const group = groups.get(key) ?? { quantity: 0n, amount: 0n, usdAmount: 0n }
    const quantity = -m.quantity, nextQuantity = group.quantity + quantity
    const currency = source?.currency ?? terms.currency, usdRate = source?.usdRate ?? terms.usdRate, unitPrice = source?.unitPrice ?? line.unitPrice
    const amount = m.reversesId ? -decimal(source!.amount, 'source amount', { signed: true }) : saleExtension(nextQuantity, unitPrice) - group.amount
    const usdAmount = m.reversesId ? -decimal(source!.usdAmount, 'source USD amount', { signed: true }) : saleExtension(nextQuantity, unitPrice, usdRate) - group.usdAmount
    const value: SaleAllocation = { movementId: m.id, sourceMovementId: source?.movementId ?? m.id, orderId: source?.orderId ?? orderId!, lineId: source?.lineId ?? line.lineId, currency, usdRate, unitPrice, quantity: format(quantity), amount: cents(amount), usdAmount: cents(usdAmount), kind: m.reversesId ? 'correction' : m.documentKind === 'returns' ? 'return' : 'shipment' }
    allocated.set(m.id, value); keys.set(m.id, key)
    groups.set(key, { quantity: nextQuantity, amount: group.amount + amount, usdAmount: group.usdAmount + usdAmount })
  }
  return allocated
}

export function saleTotals(s: State) {
  const allocated = [...saleAllocations(s).values()]
  return Object.fromEntries(s.salesOrders.filter(o => o.currency && o.currency !== 'USD').map(order => {
    const sources = allocated.filter(a => a.orderId === order.id), invoices = order.invoices ?? []
    const total = (rows: any[], key: string) => cents(rows.reduce((n, row) => n + decimal(row[key], key, { signed: true }), 0n))
    return [order.id, { currency: order.currency, usdRate: order.usdRate,
      quotedAmount: cents(order.lines.reduce((n: bigint, l: any) => n + saleExtension(decimal(l.quantity) - decimal(l.cancelled ?? '0'), l.unitPrice), 0n)),
      quotedUsdAmount: cents(order.lines.reduce((n: bigint, l: any) => n + saleExtension(decimal(l.quantity) - decimal(l.cancelled ?? '0'), l.unitPrice, order.usdRate), 0n)),
      netAmount: total(sources, 'amount'), netUsdAmount: total(sources, 'usdAmount'), invoicedAmount: total(invoices, 'amount'), invoicedUsdAmount: total(invoices, 'usdAmount') }]
  }))
}
