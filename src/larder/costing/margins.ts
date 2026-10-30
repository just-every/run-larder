import { cents, decimal, divide, format, max, times } from '../decimal'
import { saleAllocations, saleExtension } from '../sales-money'
import { shipmentPrice } from '../sales-terms'
import { valuedRate, valuedAmount } from './valuation'
import { jobCosts } from './jobs'
import type { Row, State } from '../model'
const d = (v: string) => decimal(v, 'money', { signed: true })
const sum = (rows: any[], key: string): bigint | null =>
  rows.some((r) => r[key] === null) ? null : rows.reduce((n, r) => n + d(r[key]), 0n)
const percent = (revenue: bigint, cost: bigint | null) =>
  cost === null || revenue === 0n ? null : format(divide(times(revenue - cost, d('100')), revenue))
const costTotal = (r: any) => (r.actualCost === null ? null : d(r.actualCost))

export function marginReport(s: State, q = new URLSearchParams()) {
  const allocations = saleAllocations(s)
  const rows = s.salesOrders
    .filter((o) => !q.get('orderId') || o.id === q.get('orderId'))
    .flatMap((o) =>
      o.lines.map((l: any) => {
        const item = s.items.find((i) => i.id === l.itemId),
          quantity = d(l.quantity) - d(l.cancelled ?? '0'),
          open = max(0n, quantity - d(l.shipped)),
          quoted =
            l.quotedUnitCost === null || l.quotedUnitCost === undefined ? null : times(quantity, d(l.quotedUnitCost))
        const shipments = s.shipments.filter((sh) => sh.orderId === o.id)
        const sources = s.movements
          .filter(
            (m) =>
              m.itemId === l.itemId &&
              m.documentKind === 'shipments' &&
              shipments.some(
                (sh) =>
                  sh.id === m.documentId &&
                  sh.lines.some((x: any) => x.lineId === l.id && x.movementIds?.includes(m.id)),
              ),
          )
          .flatMap((m) => {
            const original = {
              movementId: m.id,
              shipmentId: m.documentId,
              kind: 'shipment',
              quantity: format(-m.quantity),
              unitPrice: shipmentPrice(s, m).unitPrice,
              unitCost: format(valuedRate(s, m)),
              revenue: allocations.get(m.id)?.usdAmount ?? format(times(-m.quantity, d(shipmentPrice(s, m).unitPrice))),
              customerAmount: allocations.get(m.id)?.amount ?? null,
              currency: allocations.get(m.id)?.currency ?? 'USD',
              usdRate: allocations.get(m.id)?.usdRate ?? '1',
              cost: format(-valuedAmount(s, m)),
            }
            const reversals = s.movements
              .filter((x) => x.reversesId === m.id)
              .map((x) => ({
                ...original,
                movementId: x.id,
                kind: 'shipment reversal',
                quantity: format(-x.quantity),
                revenue: allocations.get(x.id)?.usdAmount ?? format(times(-x.quantity, d(original.unitPrice))),
                customerAmount: allocations.get(x.id)?.amount ?? null,
                cost: format(-valuedAmount(s, x)),
              }))
            const returns = s.returns
              .filter((r) => r.orderId === o.id && r.lineId === l.id)
              .flatMap((r) =>
                (r.sources ?? [])
                  .filter((x: any) => x.shipmentMovementId === m.id)
                  .flatMap((x: any) => {
                    const returned = s.movements.find((v) => v.id === x.returnMovementId)
                    if (!returned) return []
                    const base = {
                      movementId: returned.id,
                      shipmentId: m.documentId,
                      returnId: r.id,
                      kind: 'return',
                      quantity: format(-returned.quantity),
                      unitPrice: x.unitPrice,
                      unitCost: format(valuedRate(s, m)),
                      revenue: allocations.get(returned.id)?.usdAmount ?? format(-times(returned.quantity, d(x.unitPrice))),
                      customerAmount: allocations.get(returned.id)?.amount ?? null,
                      currency: allocations.get(returned.id)?.currency ?? 'USD',
                      usdRate: allocations.get(returned.id)?.usdRate ?? '1',
                      cost: format(-valuedAmount(s, returned)),
                    }
                    return [
                      base,
                      ...s.movements
                        .filter((v) => v.reversesId === returned.id)
                        .map((v) => ({
                          ...base,
                          movementId: v.id,
                          kind: 'return reversal',
                          quantity: format(-v.quantity),
                          revenue: allocations.get(v.id)?.usdAmount ?? format(-times(v.quantity, d(x.unitPrice))),
                          customerAmount: allocations.get(v.id)?.amount ?? null,
                          cost: format(-valuedAmount(s, v)),
                        })),
                    ]
                  }),
              )
            return [original, ...reversals, ...returns]
          })
        const legacyMissing =
          shipments.some(
            (sh) => sh.status === 'shipped' && sh.lines.some((x: any) => x.lineId === l.id && !x.movementIds),
          ) || s.returns.some((r) => r.orderId === o.id && r.lineId === l.id && !r.sources)
        const revenue: bigint = sources.reduce((n, x) => n + d(x.revenue), 0n),
          actual: bigint = sources.reduce((n, x) => n + d(x.cost), 0n),
          net: bigint = sources.reduce((n, x) => n + d(x.quantity), 0n)
        let recognizedRevenue = revenue,
          recognizedCost = actual,
          estimatedRevenue = o.currency && o.currency !== 'USD' ? saleExtension(quantity, l.unitPrice, o.usdRate) : times(quantity, d(l.unitPrice)),
          estimatedCost = quoted,
          expectedRevenue = estimatedRevenue
        const charges = s.marginCharges
          .filter((c) => c.orderId === o.id && c.lineId === l.id)
          .map((c) => {
            const amount = d(c.amount),
              fraction = quantity > 0n ? divide(c.refundable ? net : d(l.shipped), quantity) : 0n,
              recognized = times(amount, fraction)
            if (c.kind === 'discount') {
              recognizedRevenue -= recognized
              expectedRevenue -= amount
              if (c.quoted) estimatedRevenue -= amount
            } else if (c.kind === 'freight-revenue') {
              recognizedRevenue += recognized
              expectedRevenue += amount
              if (c.quoted) estimatedRevenue += amount
            } else {
              recognizedCost += recognized
              if (estimatedCost !== null && c.quoted) estimatedCost += amount
            }
            return { ...c, recognizedAmount: cents(recognized), unrecognizedAmount: cents(amount - recognized) }
          })
        const jobs = s.costLinks
          .filter((x) => x.orderId === o.id && x.lineId === l.id)
          .map((x) => {
            const w = s.workOrders.find((w) => w.id === x.workOrderId)!,
              cost = jobCosts(s, w),
              total = costTotal(cost)
            return {
              workOrderId: w.id,
              reference: w.reference,
              quantity: x.quantity,
              cost: total === null ? null : format(times(total, divide(d(x.quantity), d(w.quantity)))),
              sources: cost,
            }
          })
        const allocated = jobs.reduce((n, x) => n + d(x.quantity), 0n),
          commitmentUnit =
            allocated === quantity && jobs.every((x) => x.cost !== null) && quantity > 0n
              ? divide(
                  jobs.reduce((n, x) => n + d(x.cost!), 0n),
                  quantity,
                )
              : l.quotedUnitCost === null || l.quotedUnitCost === undefined
                ? null
                : d(l.quotedUnitCost)
        const futureCharges = charges
          .filter((c: any) => ['fee', 'freight-cost'].includes(c.kind))
          .reduce((n: bigint, c: any) => n + (quantity ? times(d(c.amount), divide(open, quantity)) : 0n), 0n)
        const grossShippedCost = sources
          .filter((x) => x.kind === 'shipment' || x.kind === 'shipment reversal')
          .reduce((n: bigint, x: any) => n + d(x.cost), 0n)
        const committedCost =
          commitmentUnit === null
            ? null
            : (allocated === quantity && jobs.every((x) => x.cost !== null)
                ? max(0n, jobs.reduce((n: bigint, x: any) => n + d(x.cost!), 0n) - grossShippedCost)
                : times(open, commitmentUnit)) + futureCharges
        const unvalued = sources
          .filter((x) => x.kind === 'shipment')
          .filter((x) => {
            const movement = s.movements.find((m) => m.id === x.movementId)!,
              lot = s.lots.find((l) => l.id === movement.lotId)
            return (
              lot?.source === 'production' &&
              !s.costValuations.some((v) => v.status === 'approved' && v.lines.some((l: any) => l.lotId === lot.id))
            )
          })
        const actualMissing = legacyMissing || unvalued.length > 0
        const missing = [
          ...(legacyMissing ? ['Legacy shipment or return lacks exact sources'] : []),
          ...(quoted === null ? ['No pinned quote standard cost'] : []),
          ...(unvalued.length ? ['Production output awaits an approved actual valuation'] : []),
        ]
        const cent = (v: bigint) => d(cents(v))
        const quoteRevenue = cent(estimatedRevenue),
          quoteCost = estimatedCost === null ? null : cent(estimatedCost),
          actualRevenue = cent(recognizedRevenue),
          actualCost = cent(recognizedCost)
        const futureRevenue = cent(quantity ? times(expectedRevenue, divide(open, quantity)) : 0n),
          futureCost = committedCost === null ? null : cent(committedCost)
        return {
          orderId: o.id,
          lineId: l.id,
          itemId: l.itemId,
          sku: item?.sku ?? '',
          customerId: o.customerId,
          customer: s.parties.find((p) => p.id === o.customerId)?.name ?? '',
          channel: o.channel ?? 'legacy channel not recorded',
          reference: o.reference,
          currency: 'USD',
          customerCurrency: o.currency ?? 'USD',
          usdRate: o.usdRate ?? '1',
          customerRevenue: cents(sources.reduce((n, source) => n + d(source.customerAmount ?? source.revenue), 0n)),
          quantity: format(quantity),
          netShipped: format(net),
          remainingQuantity: format(open),
          quotedRevenue: cents(quoteRevenue),
          quotedCost: quoteCost === null ? null : cents(quoteCost),
          quotedMargin: quoteCost === null ? null : cents(quoteRevenue - quoteCost),
          quotedMarginPercent: percent(quoteRevenue, quoteCost),
          recognizedRevenue: legacyMissing ? null : cents(actualRevenue),
          actualCost: actualMissing ? null : cents(actualCost),
          actualMargin: actualMissing ? null : cents(actualRevenue - actualCost),
          actualMarginPercent: actualMissing ? null : percent(actualRevenue, actualCost),
          committedRevenue: cents(futureRevenue),
          committedCost: futureCost === null ? null : cents(futureCost),
          committedMargin: futureCost === null ? null : cents(futureRevenue - futureCost),
          committedMarginPercent: percent(futureRevenue, futureCost),
          costVariance:
            actualMissing || quoted === null || !quantity
              ? null
              : cents(actualCost - cent(times(quoteCost ?? quoted, divide(net, quantity)))),
          missing,
          sources,
          charges,
          jobs,
        }
      }),
    )
    .filter(
      (r) =>
        (!q.get('workOrderId') ||
          s.costLinks.some(
            (l) => l.workOrderId === q.get('workOrderId') && l.orderId === r.orderId && l.lineId === r.lineId,
          )) &&
        (!q.get('customerId') || r.customerId === q.get('customerId')) &&
        (!q.get('channel') || r.channel === q.get('channel')) &&
        (!q.get('itemId') || r.itemId === q.get('itemId')),
    )
  const group = (key: string) =>
    [...new Set(rows.map((r) => (r as any)[key]))].map((id) => {
      const found = rows.filter((r) => (r as any)[key] === id),
        revenue = sum(found, 'recognizedRevenue'),
        cost = sum(found, 'actualCost'),
        quoteRevenue = sum(found, 'quotedRevenue'),
        quoteCost = sum(found, 'quotedCost'),
        committedRevenue = sum(found, 'committedRevenue'),
        committedCost = sum(found, 'committedCost')
      return {
        [key]: id,
        recognizedRevenue: revenue === null ? null : cents(revenue),
        actualCost: cost === null ? null : cents(cost),
        actualMargin: cost === null || revenue === null ? null : cents(revenue - cost),
        quotedRevenue: quoteRevenue === null ? null : cents(quoteRevenue),
        quotedCost: quoteCost === null ? null : cents(quoteCost),
        quotedMargin: quoteRevenue === null || quoteCost === null ? null : cents(quoteRevenue - quoteCost),
        quotedMarginPercent: quoteRevenue === null ? null : percent(quoteRevenue, quoteCost),
        committedRevenue: committedRevenue === null ? null : cents(committedRevenue),
        committedCost: committedCost === null ? null : cents(committedCost),
        committedMargin:
          committedRevenue === null || committedCost === null ? null : cents(committedRevenue - committedCost),
        committedMarginPercent: committedRevenue === null ? null : percent(committedRevenue, committedCost),
        costVariance: sum(found, 'costVariance') === null ? null : cents(sum(found, 'costVariance')!),
        actualMarginPercent: revenue === null ? null : percent(revenue, cost),
        lineIds: found.map((r) => r.lineId),
      }
    })
  return {
    currency: 'USD',
    filters: Object.fromEntries(q),
    basis:
      'Issued shipment prices and quantities, exact source returns/reversals and approved output valuations. Open commitments never count as recognized sales. Charges allocate by line units; refunds only when explicitly marked. USD rounded half away from zero to cents per line.',
    rows,
    orders: group('orderId'),
    products: group('itemId'),
    customers: group('customerId'),
    channels: group('channel'),
  }
}

// CSV serializes the same filtered report, including every source, nested drill
// and missing-data disclosure. Formula prefixes are neutralised.
export function reportCsv(report: any) {
  const cell = (v: any) => {
    let s = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? 'unknown')
    if (/^[=+@\t\r]/.test(s) || /^-(?!\d)/.test(s)) s = "'" + s
    return '"' + s.replaceAll('"', '""') + '"'
  }
  return (
    'section,index,data\r\n' +
    Object.entries(report)
      .flatMap(([key, value]) =>
        Array.isArray(value)
          ? value.map((r, i) => [key, i, r].map(cell).join(','))
          : [[key, '', value].map(cell).join(',')],
      )
      .join('\r\n') +
    '\r\n'
  )
}
export function varianceReport(s: State, q = new URLSearchParams()) {
  const margins = marginReport(s, q)
  return {
    currency: 'USD',
    filters: Object.fromEntries(q),
    jobs: s.workOrders
      .filter(
        (w) =>
          w.status !== 'draft' &&
          (!q.get('orderId') || s.costLinks.some((l) => l.workOrderId === w.id && l.orderId === q.get('orderId'))) &&
          (!q.get('workOrderId') || w.id === q.get('workOrderId')) &&
          (!q.get('channel') ||
            s.costLinks.some(
              (l) =>
                l.workOrderId === w.id &&
                s.salesOrders.some((o) => o.id === l.orderId && o.channel === q.get('channel')),
            )) &&
          (!q.get('itemId') || w.itemId === q.get('itemId')) &&
          (!q.get('customerId') ||
            s.costLinks.some(
              (l) =>
                l.workOrderId === w.id &&
                s.salesOrders.some((o) => o.id === l.orderId && o.customerId === q.get('customerId')),
            )),
      )
      .map((w) => jobCosts(s, w)),
    orders: margins.orders,
    lines: margins.rows,
  }
}
