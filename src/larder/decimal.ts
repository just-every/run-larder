// Fixed-point decimals for quantities and money: six places, stored as
// integers (1 unit = 1000000). Inputs are decimal strings; arithmetic is bigint.
import { fail } from './problem'

export const SCALE = 1000000n
export const MAX = 9000000000000000n

export function decimal(value: unknown, name = 'quantity', { positive = false, signed = false } = {}): bigint {
  const pattern = signed ? /^-?\d{1,10}(\.\d{1,6})?$/ : /^\d{1,10}(\.\d{1,6})?$/
  if (typeof value !== 'string' || !pattern.test(value)) return fail('DECIMAL', `${name} must be a decimal with at most 6 decimal places and 10 whole digits.`, { field: name })
  const negative = value.startsWith('-'), [whole, part = ''] = value.replace('-', '').split('.')
  const n = BigInt(whole) * SCALE + BigInt(part.padEnd(6, '0'))
  if (n > MAX || (positive && n === 0n)) return fail('DECIMAL', `${name} must be ${positive ? 'positive and ' : ''}within the supported range.`, { field: name })
  return negative ? -n : n
}

export function format(n: bigint): string {
  const sign = n < 0n ? '-' : '', a = n < 0n ? -n : n, part = a % SCALE
  return sign + (a / SCALE).toString() + (part ? '.' + part.toString().padStart(6, '0').replace(/0+$/, '') : '')
}

// quantity × rate, rounded half away from zero to six places.
export function times(a: bigint, b: bigint): bigint {
  const p = a * b, sign = p < 0n ? -1n : 1n, abs = p < 0n ? -p : p
  return sign * ((abs + SCALE / 2n) / SCALE)
}

// a ÷ b at six places, or null when the result is not exact.
export function exactDivide(a: bigint, b: bigint): bigint | null {
  if (b === 0n) return null
  return (a * SCALE) % b === 0n ? (a * SCALE) / b : null
}

export function divide(a: bigint, b: bigint): bigint {
  if (b === 0n) return 0n
  const p = a * SCALE, sign = (p < 0n) !== (b < 0n) ? -1n : 1n, n = p < 0n ? -p : p, d = b < 0n ? -b : b
  return sign * ((n + d / 2n) / d)
}

// Money to cents for the accountant's files, rounded half away from zero.
export function cents(n: bigint): string {
  const sign = n < 0n ? '-' : '', a = n < 0n ? -n : n, c = (a + 5000n) / 10000n
  return `${sign}${c / 100n}.${(c % 100n).toString().padStart(2, '0')}`
}

export const min = (a: bigint, b: bigint) => (a < b ? a : b)
export const max = (a: bigint, b: bigint) => (a > b ? a : b)
export const sum = (values: bigint[]) => values.reduce((n, v) => n + v, 0n)
