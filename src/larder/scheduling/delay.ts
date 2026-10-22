// GOV-009: the largest per-job delay a schedule decision causes, in minutes scaled like every
// other approval measure. A job left unscheduled has no bounded delay, so it always crosses.
const unbounded = 1_000_000_000
export function largestJobDelay(effects: any[] = []): bigint {
  let most = 0
  for (const e of effects) {
    const minutes = e.unscheduled ?? e.unscheduledAfter ? unbounded : e.before && e.after ? Math.max(0, Math.round((Date.parse(e.after) - Date.parse(e.before)) / 60000)) : 0
    most = Math.max(most, minutes)
  }
  return BigInt(most) * 1_000_000n
}
// A grant may delay or displace each job up to its larger limit.
export const grantReach = (g: { maxDelayMinutes: number; maxDisplacementMinutes: number }) => BigInt(Math.max(g.maxDelayMinutes, g.maxDisplacementMinutes)) * 1_000_000n
