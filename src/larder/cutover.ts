// MOVE-007: rehearse a migration, compare a day's totals while both systems run,
// approve the opening totals and one cutover time, then route each channel to one
// system. A nonzero stock-valuation difference blocks approval until it is
// reconciled by a person who accepts that exact difference.
import { cents, decimal, format } from './decimal'
import { dayTotals, currentMetrics, metrics, type Metric } from './day-totals'
import { channels } from './cutover-guard'
import { stagePlan } from './odoo/imports'
import { fail, forbidden } from './problem'
import { allow, approver } from './roles'
import { bump, date, fresh, get, list, oneOf, optionalText, row, text, type Context, type Row } from './model'

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x))
const centsOf = (usd: string) => cents(decimal(usd, 'amount')).replace('.', '')

function stagedImports(c: Context, ids: unknown, plan?: Row) {
  const importIds = list<string>(ids, 'importIds', 20)
  if (new Set(importIds).size !== importIds.length) fail('INPUT', 'Name each move-in once.', { field: 'importIds' })
  for (const id of importIds) {
    const batch = get(c.s, 'imports', id, 'move-in')
    if (!['previewed', 'committed'].includes(batch.status)) fail('STATE', `${batch.label} is ${batch.status}; only a previewed or committed move-in joins a cutover.`)
    const other = c.s.cutovers.find(p => p.id !== plan?.id && ['draft', 'approved'].includes(p.status) && p.importIds.includes(id))
    if (other) fail('STATE', `${batch.label} already belongs to the cutover “${other.label}”.`)
  }
  return importIds
}
const openPlan = (c: Context, id: unknown, version: unknown, status = ['draft']) => {
  const plan = get(c.s, 'cutovers', id, 'cutover'); fresh(plan, version)
  if (!status.includes(plan.status)) fail('STATE', `This cutover is ${plan.status}.`)
  return plan
}

export function cutover(c: Context, type: string, p: any): Row | undefined {
  if (!type.startsWith('cutover.')) return
  switch (type) {
    case 'cutover.plan': {
      allow(c, ['manager', 'agent'])
      if (c.s.cutovers.some(x => ['draft', 'approved'].includes(x.status))) fail('STATE', 'One cutover is already planned. Cancel it before planning another.')
      return row(c, 'cutovers', { label: text(p.label, 'label', 200), importIds: stagedImports(c, p.importIds), status: 'draft', channels: Object.fromEntries(channels.map(x => [x, 'larder'])), rehearsals: [], comparisons: [], reconciliations: [], history: [] })
    }
    case 'cutover.rehearse': {
      allow(c, ['manager', 'agent'])
      const plan = openPlan(c, p.cutoverId, p.version)
      const importIds = p.importIds === undefined ? plan.importIds : stagedImports(c, p.importIds, plan)
      const results = importIds.map((id: string) => {
        const batch = get(c.s, 'imports', id, 'move-in')
        if (batch.status === 'committed') return { importId: id, committed: true, fingerprint: batch.fingerprint }
        const staged = stagePlan(c.s, batch)
        return { importId: id, committed: false, fingerprint: staged.fingerprint, stagedFingerprint: batch.fingerprint, counts: Object.fromEntries(Object.entries(staged.plan).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).length])), rejected: staged.plan.rejected.length, differenceUsd: staged.valuation?.differenceUsd ?? '0.00', reviewCount: staged.valuation?.reviewCount ?? 0 }
      })
      const previous = plan.rehearsals.at(-1), key = (r: any[]) => JSON.stringify(r.map(x => [x.importId, x.fingerprint]).sort())
      const identical = previous ? key(previous.results) === key(results) : null
      return bump(plan, { importIds, rehearsals: [...plan.rehearsals, { at: c.now, by: c.actor.id, results, identical }] })
    }
    case 'cutover.compare': {
      allow(c, ['manager', 'accounts', 'agent'])
      const plan = openPlan(c, p.cutoverId, p.version, ['draft', 'approved'])
      const day = date(p.day, 'day')
      if (day > c.now.slice(0, 10)) fail('INPUT', 'Compare a day that has begun.', { field: 'day' })
      const given = Object.entries(p.source ?? {}).filter(([k]) => (metrics as readonly string[]).includes(k))
      if (given.length === 0 || given.length !== Object.keys(p.source ?? {}).length) fail('INPUT', `Give the source totals by name: ${metrics.join(', ')}.`, { field: 'source' })
      if (day < c.now.slice(0, 10) && given.some(([k]) => (currentMetrics as readonly string[]).includes(k))) fail('INPUT', `Only stock is dated. Compare ${currentMetrics.join(', ')} on the day itself.`, { field: 'source' })
      const larder = dayTotals(c.s, day), source = Object.fromEntries(given.map(([k, v]) => [k, format(decimal(String(v), k))]))
      const differences = given.map(([k]) => ({ metric: k, source: source[k], larder: format(decimal(larder[k as Metric], k)), difference: format(decimal(larder[k as Metric], k) - decimal(source[k], k)) }))
      const entry = { id: crypto.randomUUID(), day, at: c.now, by: c.actor.id, note: optionalText(p.note, 'note', 400), source, larder, differences, unmatched: differences.filter(d => d.difference !== '0').map(d => d.metric), matched: differences.every(d => d.difference === '0') }
      return bump(plan, { comparisons: [...plan.comparisons, entry] })
    }
    case 'cutover.reconcile': {
      approver(c, ['manager', 'accounts'])
      const plan = openPlan(c, p.cutoverId, p.version)
      const batch = get(c.s, 'imports', p.importId, 'move-in')
      if (!plan.importIds.includes(batch.id)) fail('INPUT', 'That move-in is not part of this cutover.')
      if (!batch.valuation || batch.valuation.matched) fail('STATE', 'Nothing to reconcile: this move-in matches to the cent.')
      if (p.differenceUsd !== batch.valuation.differenceUsd) fail('STALE', `The difference is ${batch.valuation.differenceUsd} USD. Accept exactly that figure.`, { differenceUsd: batch.valuation.differenceUsd })
      const entry = { importId: batch.id, fingerprint: batch.fingerprint, differenceUsd: batch.valuation.differenceUsd, reviewCount: batch.valuation.reviewCount, note: text(p.note, 'reconciliation note', 400), by: c.actor.id, at: c.now }
      return bump(plan, { reconciliations: [...plan.reconciliations.filter((x: any) => x.importId !== batch.id), entry] })
    }
    case 'cutover.approve': {
      // The owner chooses the cutover boundary: the opening totals and the one cutover time.
      if (c.actor.role !== 'owner') forbidden('Only the owner approves the opening totals and the cutover time.')
      const plan = openPlan(c, p.cutoverId, p.version)
      const blocking: Record<string, unknown>[] = [], batches = plan.importIds.map((id: string) => get(c.s, 'imports', id, 'move-in'))
      for (const b of batches) if (b.status !== 'committed') blocking.push({ reason: 'MOVE_IN_NOT_COMMITTED', importId: b.id, label: b.label, status: b.status })
      const [last, before] = [plan.rehearsals.at(-1), plan.rehearsals.at(-2)]
      if (!before || !last.identical) blocking.push({ reason: 'REHEARSAL', rehearsals: plan.rehearsals.length, message: 'Rehearse the migration twice with identical results.' })
      else for (const b of batches) if (!last.results.some((r: any) => r.importId === b.id && r.fingerprint === b.fingerprint)) blocking.push({ reason: 'REHEARSAL_DIFFERS', importId: b.id, label: b.label, message: 'The committed move-in is not what was rehearsed.' })
      for (const b of batches) {
        const v = b.valuation
        if (v && !v.matched && !plan.reconciliations.some((r: any) => r.importId === b.id && r.fingerprint === b.fingerprint && r.differenceUsd === v.differenceUsd)) blocking.push({ reason: 'VALUATION_DIFFERENCE', importId: b.id, label: b.label, sourceTotalUsd: v.source.totalUsd, larderTotalUsd: v.larder.totalUsd, differenceUsd: v.differenceUsd, reviewCount: v.reviewCount })
      }
      const openingTotal = batches.reduce((n: bigint, b: Row) => n + BigInt(b.valuation ? centsOf(b.valuation.larder.totalUsd) : '0'), 0n), asked = BigInt(centsOf(text(p.openingTotalUsd, 'opening total (USD)', 20)))
      if (asked !== openingTotal) blocking.push({ reason: 'OPENING_TOTAL', message: 'Approve the opening total exactly as Larder shows it.', openingTotalUsd: `${openingTotal / 100n}.${(openingTotal % 100n).toString().padStart(2, '0')}` })
      const compared = plan.comparisons.at(-1), accepted: string[] = Array.isArray(p.acceptDifferences) ? p.acceptDifferences : []
      if (!compared) blocking.push({ reason: 'COMPARISON', message: 'Compare at least one day of source and Larder totals first.' })
      else if (!sameSet(compared.unmatched, accepted)) blocking.push({ reason: 'COMPARISON_DIFFERENCES', unmatched: compared.unmatched, message: 'Accept exactly the metrics that differ, or compare again.' })
      const cutoverAt = typeof p.cutoverAt === 'string' && !Number.isNaN(Date.parse(p.cutoverAt)) ? new Date(p.cutoverAt).toISOString() : fail('INPUT', 'Give one cutover time.', { field: 'cutoverAt' })
      if (cutoverAt < c.now) fail('INPUT', 'The cutover time cannot be in the past.', { field: 'cutoverAt' })
      if (blocking.length) fail('CUTOVER_BLOCKED', 'The cutover cannot be approved yet.', { blocking })
      const approval = row(c, 'approvals', { subjectKind: 'cutovers', subjectId: plan.id, subjectVersion: plan.version, decision: 'approved', role: c.actor.role, note: text(p.reason, 'reason', 400), openingTotalUsd: p.openingTotalUsd, cutoverAt })
      return bump(plan, { status: 'approved', cutoverAt, openingTotalUsd: p.openingTotalUsd, acceptedDifferences: accepted, approvalId: approval.id, approvedBy: c.actor.id, approvedAt: c.now })
    }
    case 'cutover.route': {
      if (c.actor.role !== 'owner') forbidden('Only the owner chooses which system writes a channel.')
      const plan = openPlan(c, p.cutoverId, p.version, ['draft', 'approved'])
      const channel = oneOf(p.channel, channels, 'channel'), authority = oneOf(p.authority, ['larder', 'source'] as const, 'authority')
      return bump(plan, { channels: { ...plan.channels, [channel]: authority }, history: [...plan.history, { at: c.now, by: c.actor.id, change: 'route', channel, authority, reason: text(p.reason, 'reason', 400) }] })
    }
    case 'cutover.cancel': {
      if (c.actor.role !== 'owner') forbidden('Only the owner cancels a cutover.')
      const plan = openPlan(c, p.cutoverId, p.version, ['draft', 'approved'])
      if (plan.status === 'approved' && plan.cutoverAt <= c.now) fail('STATE', 'The cutover has taken effect; route channels instead.')
      return bump(plan, { status: 'cancelled', history: [...plan.history, { at: c.now, by: c.actor.id, change: 'cancelled', reason: text(p.reason, 'reason', 400) }] })
    }
  }
}
