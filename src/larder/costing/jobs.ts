import { decimal, divide, format, max, min, times, SCALE } from '../decimal'
import { materialCost } from '../production-cost'
import { timeCosts } from '../time-entries'
import { laborCosts } from '../scheduling/labor-costs'
import { averageCost } from '../stock'
import { valuedRate, valuedAmount } from './valuation'
import type { Row, State } from '../model'

export const activePolicy = (s: State) => s.costPolicies.filter((p) => p.status === 'approved').at(-1)
const d = (v: string) => decimal(v, 'cost', { signed: true })
const total = (values: bigint[]) => values.reduce((a, b) => a + b, 0n)
export function pinCosts(s: State, w: Row) {
  const p = activePolicy(s),
    hours = w.routing.reduce(
      (n: bigint, r: any) =>
        n +
        divide(
          d(String(r.setupMinutes ?? 0)) + times(d(String(r.runMinutes ?? r.minutes ?? 0)), d(w.quantity)),
          d('60'),
        ),
      0n,
    )
  return {
    currency: 'USD',
    policy: p ? structuredClone(p) : null,
    hours: format(hours),
    components: w.components.map((l: any) => ({
      itemId: l.itemId,
      quantity: l.required,
      unitCost: format(averageCost(s, l.itemId)),
    })),
    laborCost: p ? format(times(hours, d(p.standardLaborRate))) : null,
    machineCost: p ? format(times(hours, d(p.machineRate))) : null,
    overheadCost: p ? format(times(hours, d(p.overheadRate))) : null,
  }
}

export function jobCosts(s: State, w: Row) {
  const pinned = w.costingStandard,
    policy = pinned?.policy
  const movements = s.movements.filter(
    (m) =>
      (m.documentKind === 'workOrders' && m.documentId === w.id && m.kind === 'issue') ||
      (m.kind === 'issue-reversal' && s.reversals.some((r) => r.id === m.documentId && r.targetId === w.id)),
  )
  const components = w.components.map((l: any) => {
    const sources = movements
      .filter((m) => m.itemId === l.itemId)
      .map((m) => ({
        movementId: m.id,
        lotId: m.lotId,
        sourceDocumentKind: s.lots.find((l) => l.id === m.lotId)?.source ?? 'stock',
        sourceDocumentId: s.lots.find((l) => l.id === m.lotId)?.documentId ?? m.documentId,
        quantity: format(-m.quantity),
        unitCost: format(valuedRate(s, m)),
        originalUnitCost: format(m.unitCost),
        cost: format(-valuedAmount(s, m)),
      }))
    const q = total(sources.map((x) => d(x.quantity))),
      actual = total(sources.map((x) => d(x.cost))),
      standard = pinned?.components.find((x: any) => x.itemId === l.itemId),
      rate = standard ? d(standard.unitCost) : null
    return {
      itemId: l.itemId,
      sku: s.items.find((i) => i.id === l.itemId)?.sku,
      required: l.required,
      issued: format(q),
      standardUnitCost: rate === null ? null : format(rate),
      actualCost: format(actual),
      priceVariance: rate === null ? null : format(actual - times(q, rate)),
      usageVariance: rate === null ? null : format(times(q - d(l.required), rate)),
      sources,
    }
  })
  const transferred = materialCost(s, w) - total(movements.map((m) => -times(m.quantity, m.unitCost)))
  const materials = total(components.map((x: any) => d(x.actualCost))) + transferred
  const entries = [...timeCosts(s), ...laborCosts(s)].filter((e) => e.workOrderId === w.id)
  const pending = s.timeEntries.filter(
    (e) => e.workOrderId === w.id && e.status !== 'closed' && e.status !== 'withdrawn',
  )
  const missing: string[] = []
  if (!policy) missing.push('No approved allocation policy pinned at release')
  if (w.routing.length && !entries.length) missing.push('No completed labor or operation time')
  if (pending.length || entries.some((e) => e.laborCost === null))
    missing.push('Open time or missing historical labor rate')
  const hours = total(entries.map((e) => d(e.hours)))
  const laborSources = entries.map((e) => {
    const overtime = policy ? max(0n, d(e.hours) - d(policy.overtimeAfterHours)) : 0n
    const premium =
      e.hourlyRate && policy ? times(times(overtime, d(e.hourlyRate)), d(policy.overtimeMultiplier) - SCALE) : 0n
    return {
      ...e,
      overtimeHours: format(overtime),
      overtimeCost: format(premium),
      cost: e.laborCost === null ? null : format(d(e.laborCost) + d(e.burdenCost ?? '0') + premium),
    }
  })
  const labor = total(laborSources.map((e) => d(e.cost ?? '0'))),
    machine = policy ? times(hours, d(policy.machineRate)) : 0n,
    overhead = policy ? times(hours, d(policy.overheadRate)) : 0n
  const serviceSources = s.jobCharges.filter((c) => c.workOrderId === w.id && c.status === 'approved'),
    service = total(serviceSources.map((c) => d(c.amount)))
  const value = materials + labor + machine + overhead + service,
    good = d(w.output),
    scrap = d(w.scrap),
    completed = good + scrap
  // Every good and scrap unit carries its share. Unfinished units stay WIP.
  const processed = min(d(w.quantity), completed),
    allocated = w.status === 'closed' ? value : times(value, divide(processed, d(w.quantity))),
    scrapCost = completed ? times(allocated, divide(scrap, completed)) : 0n,
    goodCost = allocated - scrapCost
  const standardMaterial = pinned ? total(pinned.components.map((x: any) => times(d(x.quantity), d(x.unitCost)))) : null
  const standard =
    standardMaterial !== null && policy
      ? standardMaterial + d(pinned.laborCost) + d(pinned.machineCost) + d(pinned.overheadCost)
      : null
  return {
    workOrderId: w.id,
    reference: w.reference,
    itemId: w.itemId,
    sku: s.items.find((i) => i.id === w.itemId)?.sku,
    bomRevision: w.bomRevision,
    status: w.status,
    currency: 'USD',
    policyId: policy?.id ?? null,
    missing,
    components,
    transferCost: format(transferred),
    laborSources,
    serviceSources,
    hours: format(hours),
    materialCost: format(materials),
    laborCost: missing.length ? null : format(labor),
    machineCost: policy ? format(machine) : null,
    overheadCost: policy ? format(overhead) : null,
    serviceCost: format(service),
    actualCost: missing.length ? null : format(value),
    goodCost: missing.length ? null : format(goodCost),
    scrapCost: missing.length ? null : format(scrapCost),
    wipCost: missing.length ? null : format(value - allocated),
    actualUnitCost: missing.length || !good ? null : format(divide(goodCost, good)),
    standardCost: standard === null ? null : format(standard),
    costVariance: missing.length || standard === null ? null : format(value - standard),
    laborPriceVariance: missing.length ? null : format(labor - times(hours, d(policy.standardLaborRate))),
    laborEfficiencyVariance: policy ? format(times(hours - d(pinned.hours), d(policy.standardLaborRate))) : null,
    overheadVariance: policy ? format(overhead - d(pinned.overheadCost)) : null,
    volumeVariance:
      standard === null ? null : format(times(standard, divide(d(w.quantity) - completed, d(w.quantity)))),
    downtime: s.workOrders
      .filter((x) => x.id === w.id)
      .flatMap((x) =>
        (x.operationStates ?? []).flatMap((t: any) =>
          (t.downtime ?? []).map((x: any) => ({ ...x, sequence: t.sequence })),
        ),
      ),
  }
}
