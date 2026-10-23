// Monetary corrections are a separate append-only valuation ledger. Physical
// movements, quantities, custody and original rates are never rewritten.
import type { Movement, State } from '../model'
import { decimal, times } from '../decimal'
function line(s: State, m: Movement) {
  if (!m.lotId) return undefined
  const valuation = s.costValuations
    .filter((v) => v.status === 'approved' && v.lines.some((l: any) => l.lotId === m.lotId && l.itemId === m.itemId))
    .at(-1)
  return valuation?.lines.find((l: any) => l.lotId === m.lotId && l.itemId === m.itemId)
}
export function valuedRate(s: State, m: Movement): bigint {
  const value = line(s, m)
  return value ? decimal(value.unitCost) : m.unitCost
}
// Allocate the at-most-micro-dollar rate residual by cumulative lot balance.
// Differences telescope, so partial issues, transfers, returns and reversals
// conserve the exact approved lot value rather than rounding each leg afresh.
export function residualAt(residual: bigint, balance: bigint, quantity: bigint) {
  const value = residual * balance,
    sign = value < 0n ? -1n : 1n,
    abs = value < 0n ? -value : value
  return quantity ? sign * ((abs + quantity / 2n) / quantity) : 0n
}
export function valuedAmount(s: State, m: Movement): bigint {
  const value = line(s, m)
  if (!value) return times(m.quantity, m.unitCost)
  const before = s.movements
    .filter((x) => x.sequence < m.sequence && x.itemId === m.itemId && x.lotId === m.lotId)
    .reduce((n, x) => n + x.quantity, 0n)
  const residual = decimal(value.roundingResidual ?? '0', 'rounding residual', { signed: true }),
    quantity = decimal(value.quantity)
  return (
    times(m.quantity, decimal(value.unitCost)) +
    residualAt(residual, before + m.quantity, quantity) -
    residualAt(residual, before, quantity)
  )
}
