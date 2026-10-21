// Informational full-batch routing offsets; no machine/labor calendar is booked.
import { SCALE, max } from './decimal'
import { addDays } from './forecast-plan'
import type { Row } from './model'

export type MaterialTiming = {
  bomId: string | null; receiptOn: string; releaseOn: string | null; leadDays: number | null
  requiresPastRelease: boolean | null; basis: string
}

export const impossibleTiming = (timing: MaterialTiming) => timing.leadDays !== null && timing.releaseOn === null

// Match the existing public YYYY-MM-DD date shape, including year 0000.
export function materialReleaseOn(receiptOn: string, days: number): string | null {
  const availableDays = Math.floor((Date.parse(receiptOn + 'T00:00:00Z') - Date.parse('0000-01-01T00:00:00Z')) / 86400000)
  return days > availableDays ? null : addDays(receiptOn, -days)
}

// Routing minutes are numbers (including scientific notation). Use their stored
// decimal representation exactly, then round only the final duration to days.
function parts(value: number): [bigint, number] {
  const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e')
  const [whole, fraction = ''] = mantissa.split('.')
  return [BigInt(whole + fraction), Number(exponent) - fraction.length]
}

export function materialTiming(bom: Row | undefined, quantity: bigint, receiptOn: string, today: string, phantom = false): MaterialTiming {
  const timing: MaterialTiming = { bomId: bom?.id ?? null, receiptOn, releaseOn: null, leadDays: null,
    requiresPastRelease: null, basis: 'routing not recorded; component dates are not lead-offset' }
  if (!phantom && !bom?.routing?.length) return timing
  let duration = 0n, scale = 1n
  if (!phantom) {
    const values = bom!.routing.flatMap((r: any) => [r.setupMinutes ?? 0, r.queueMinutes ?? 0, r.runMinutes ?? r.minutes ?? 0])
    const exponent = Math.min(0, ...values.map((v: number) => parts(v)[1])) - 6
    scale = 10n ** BigInt(-exponent)
    const units = (value: number) => { const [n, p] = parts(value); return n * 10n ** BigInt(p - exponent) }
    const ends = new Map<number, bigint>()
    for (const [index, r] of bom!.routing.entries()) {
      const predecessors = r.dependsOn ?? (index ? [index] : [])
      const start = predecessors.reduce((n: bigint, id: number) => max(n, ends.get(id) ?? 0n), 0n)
      const end = start + units(r.setupMinutes ?? 0) + units(r.queueMinutes ?? 0) + units(r.runMinutes ?? r.minutes ?? 0) * quantity / SCALE
      ends.set(r.sequence ?? index + 1, end); duration = max(duration, end)
    }
  }
  const day = 1440n * scale, days = (duration + day - 1n) / day
  timing.leadDays = Number(days)
  timing.basis = phantom ? 'phantom; no separate manufacturing operation' : 'full-batch routing critical path; calendar and transfer overlap not applied'
  // A supported quantity can imply millennia of work. Keep the planning API
  // usable, exposing the impossible date rather than overflowing Date or lying.
  timing.releaseOn = materialReleaseOn(receiptOn, Number(days))
  if (timing.releaseOn === null) { timing.basis += '; release outside the four-digit calendar'; return timing }
  timing.requiresPastRelease = timing.releaseOn < today
  return timing
}
