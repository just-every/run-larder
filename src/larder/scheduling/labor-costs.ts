// Recorded operation time is costing evidence, never payroll or a financial
// posting. Rates are selected from the retained definition in force at start;
// absent historical rates stay unknown rather than using today's wage.
import { decimal, format, SCALE } from '../decimal'
import type { State } from '../model'

export function laborCosts(s: State) {
  return s.workOrders.flatMap(w => (w.operationStates ?? []).filter((t: any) => t.startedAt && t.completedAt && !t.inheritedFrom?.length).map((t: any) => {
    const from = Date.parse(t.startedAt), to = Date.parse(t.completedAt)
    const stops = (t.downtime ?? []).map((d: any) => [Math.max(from, Date.parse(d.startedAt)), Math.min(to, Date.parse(d.stoppedAt ?? t.completedAt))]).filter(([a, b]: number[]) => b! > a!).sort((a: number[], b: number[]) => a[0]! - b[0]!)
    let paused = 0, previous = from
    for (const [a, b] of stops) { paused += Math.max(0, b - Math.max(a, previous)); previous = Math.max(previous, b) }
    const milliseconds = Math.max(0, to - from - paused)
    const calendar = s.laborCalendars.find(l => [...(l.history ?? []), l].filter((v: any) => (v.updatedAt ?? v.createdAt) <= t.startedAt).sort((a: any, b: any) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt) || b.version - a.version)[0]?.operatorIds.includes(t.startedBy))
    const rates = s.laborRates.filter(r => r.laborId === calendar?.id).flatMap(r => [...(r.history ?? []), r]).filter(r => (r.updatedAt ?? r.createdAt) <= t.startedAt).sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt) || b.version - a.version)
    const rate = rates[0]
    const value = (r: string) => format((BigInt(milliseconds) * decimal(r) + 1800000n) / 3600000n)
    return { workOrderId: w.id, reference: w.reference, sequence: t.sequence, operatorId: t.startedBy, startedAt: t.startedAt, completedAt: t.completedAt, activeMilliseconds: milliseconds, hours: format((BigInt(milliseconds) * SCALE + 1800000n) / 3600000n), rateVersion: rate?.version ?? null, hourlyRate: rate?.hourlyRate ?? null, burdenRate: rate?.burdenRate ?? null, laborCost: rate ? value(rate.hourlyRate) : null, burdenCost: rate ? value(rate.burdenRate) : null, currency: 'USD', basis: rate ? 'Recorded elapsed operation time minus recorded pauses at the retained rate in force at start; six-place half-up rounding. Costing evidence only; no payroll or ledger posting.' : 'No retained rate in force at operation start; cost unknown.' }
  }))
}
