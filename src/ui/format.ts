// How saved values read on screen, in US form (Oct 7, 2026; 2:15 PM). Exports keep every exact value.
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function day(value: unknown) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''))
  return m ? `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : '—'
}
// The local calendar day of a recorded moment (saved in UTC).
export function localDay(value: unknown) {
  const d = new Date(String(value))
  return Number.isNaN(d.getTime()) ? '—' : `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}
export const clock = (d: Date) => `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`
// A calendar day with its weekday: Tue Oct 20.
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const dayName = (d: Date) => `${weekdays[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}`
export function when(value: unknown) {
  const d = new Date(String(value))
  return Number.isNaN(d.getTime()) ? '—' : `${months[d.getMonth()]} ${d.getDate()}, ${clock(d)}`
}
export function money(value: unknown) {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value ?? '0'))
  if (!m) return String(value)
  const [, sign, whole, fraction = ''] = m
  const cents = BigInt(whole + fraction.padEnd(2, '0').slice(0, 2)) + ((fraction[2] ?? '0') >= '5' ? 1n : 0n)
  const digits = cents.toString().padStart(3, '0')
  return `${sign && cents ? '−' : ''}$${digits.slice(0, -2).replace(/\B(?=(\d{3})+$)/g, ',')}.${digits.slice(-2)}`
}
// Quantities keep every decimal place they were recorded with; whole parts are grouped (1,200).
export const qty = (value: unknown) => {
  const t = String(value ?? '0'), m = /^(-?)(\d+)(\.\d+)?$/.exec(t)
  return m ? `${m[1] ? '−' : ''}${m[2].replace(/\B(?=(\d{3})+$)/g, ',')}${m[3] ?? ''}` : t
}
export const isZero = (value: unknown) => /^-?0(\.0*)?$/.test(String(value ?? '0'))
export const negative = (value: unknown) => String(value ?? '').startsWith('-')
// A count unit (Odoo's “Units”, pieces) reads as “each”; a measured unit keeps its name: “$89.00 each”, “$12.00 per kg”.
export const unitLabel = (unit: unknown) => /^(each|units?|pieces?|pcs?)$/.test(String(unit ?? '')) ? 'each' : String(unit ?? '')
export const perUnit = (unit: unknown) => unitLabel(unit) === 'each' ? 'each' : `per ${unitLabel(unit)}`
// Saved status words read in US spelling (a saved "cancelled" shows as Canceled).
export const words = (value: unknown) => { const t = String(value ?? '').replace(/[-_.]/g, ' ').replace(/cancelled/g, 'canceled'); return t.charAt(0).toUpperCase() + t.slice(1) }
// Decimal arithmetic for display only (six places), never for posting.
const big = (v: unknown) => { const t = String(v ?? '0'), neg = t.startsWith('-'), [w, f = ''] = t.replace('-', '').split('.'); const n = BigInt(w || '0') * 1000000n + BigInt((f + '000000').slice(0, 6)); return neg ? -n : n }
const out = (n: bigint) => { const neg = n < 0n, a = neg ? -n : n, f = (a % 1000000n).toString().padStart(6, '0').replace(/0+$/, ''); return (neg ? '-' : '') + (a / 1000000n).toString() + (f ? '.' + f : '') }
export const minus = (a: unknown, b: unknown) => out(big(a) - big(b))
export const plus = (...v: unknown[]) => out(v.reduce<bigint>((n, x) => n + big(x), 0n))
export const positive = (v: unknown) => big(v) > 0n
export const timesMoney = (a: unknown, b: unknown) => out((big(a) * big(b)) / 1000000n)
