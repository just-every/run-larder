// FLOOR-008 GS1 element strings: a scanned GS1-128, DataMatrix or QR code (raw,
// with FNC1 sent as GS, or human-readable "(01)…(17)…(10)…") split into its
// identifier, lot, expiry and serial. A plain GTIN or any other code is not GS1.
import { fail } from './problem'

const GS = '\u001d'
const fixed: Record<string, number> = { '00': 18, '01': 14, '02': 14, '11': 6, '13': 6, '15': 6, '17': 6 }
const variable: Record<string, number> = { '10': 20, '21': 20, '30': 8, '37': 8 }
const symbology = /^\](C1|e0|d2|Q3|J1)/

export type Gs1 = { gtin?: string; lot?: string; expiresOn?: string; bestBefore?: string; producedOn?: string; serial?: string; count?: string; sscc?: string }

export const isGs1 = (raw: string) => symbology.test(raw) || /^\(\d{2}\)/.test(raw) || /^(01|02)\d{14}(1[01357]|21|10|30|37)/.test(raw)

// GS1 general specification: the year is within 49 years behind and 50 ahead of
// this year; day 00 means the last day of the month.
function day(yymmdd: string, ai: string, today: string) {
  if (!/^\d{6}$/.test(yymmdd)) fail('SCAN_GS1', `(${ai}) needs a YYMMDD date.`, { ai })
  const yy = Number(yymmdd.slice(0, 2)), mm = Number(yymmdd.slice(2, 4)), dd = Number(yymmdd.slice(4, 6)), now = Number(today.slice(0, 4))
  let year = Math.floor(now / 100) * 100 + yy
  if (year - now >= 51) year -= 100
  if (year - now <= -50) year += 100
  const last = new Date(Date.UTC(year, mm, 0)).getUTCDate()
  if (mm < 1 || mm > 12 || dd > last) fail('SCAN_GS1', `(${ai}) ${yymmdd} is not a date.`, { ai })
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd || last).padStart(2, '0')}`
}

export function checkDigitOk(digits: string) {
  const body = digits.slice(0, -1).split('').reverse().map(Number)
  const sum = body.reduce((n, d, i) => n + d * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1))
}

export function parseGs1(raw: string, today: string): Gs1 {
  const out: Gs1 = {}
  const set = (ai: string, value: string) => {
    if (!value) fail('SCAN_GS1', `(${ai}) is empty.`, { ai })
    if (fixed[ai] && (value.length !== fixed[ai] || !/^\d+$/.test(value))) fail('SCAN_GS1', `(${ai}) needs ${fixed[ai]} digits.`, { ai })
    if (variable[ai] && value.length > variable[ai]) fail('SCAN_GS1', `(${ai}) is longer than ${variable[ai]} characters.`, { ai })
    if (['00', '01', '02'].includes(ai) && !checkDigitOk(value)) fail('SCAN_GS1', `(${ai}) ${value} has a wrong check digit.`, { ai })
    if (ai === '00') out.sscc = value
    if (ai === '01' || ai === '02') out.gtin = value
    if (ai === '10') out.lot = value
    if (ai === '21') out.serial = value
    if (ai === '30' || ai === '37') out.count = String(Number(value))
    if (ai === '11') out.producedOn = day(value, ai, today)
    if (ai === '15') out.bestBefore = day(value, ai, today)
    if (ai === '17') out.expiresOn = day(value, ai, today)
  }
  const known = (ai: string) => ai in fixed || ai in variable
  if (raw.startsWith('(')) {
    const parts = [...raw.matchAll(/\((\d{2,4})\)([^(]*)/g)]
    if (parts.map(p => p[0]).join('') !== raw) fail('SCAN_GS1', 'This GS1 code is not a sequence of (AI)value pairs.')
    for (const [, ai, value] of parts) { if (!known(ai)) fail('SCAN_GS1', `(${ai}) is not a supported GS1 identifier.`, { ai }); set(ai, value) }
    return out
  }
  let rest = raw.replace(symbology, '')
  while (rest) {
    const ai = rest.slice(0, 2)
    if (!known(ai)) fail('SCAN_GS1', `(${ai}) is not a supported GS1 identifier.`, { ai })
    rest = rest.slice(2)
    if (fixed[ai]) { set(ai, rest.slice(0, fixed[ai])); rest = rest.slice(fixed[ai]) }
    else { const end = rest.indexOf(GS); set(ai, end < 0 ? rest : rest.slice(0, end)); rest = end < 0 ? '' : rest.slice(end + 1) }
    if (rest.startsWith(GS)) rest = rest.slice(1)
  }
  return out
}
