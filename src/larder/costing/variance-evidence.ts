import { canonicalJson, sha256 } from '../../modules/import-kit/src/d1/index'
import { decimal, format } from '../decimal'
import { get, type Row, type State } from '../model'
import { fail } from '../problem'
import { jobCosts } from './jobs'
import { varianceReport } from './margins'

export type Source = { key: string; kind: string; id: string; values: Record<string, unknown> }
export type Fact = { id: string; label: string; values: Record<string, unknown>; sourceKeys: string[] }
const pick = (r: any, keys: string[]) => Object.fromEntries(keys.map(k => [k, r[k] ?? null]))
const jobFields = ['status', 'quantity', 'output', 'scrap', 'bomRevision']
const costFields = ['standardCost', 'actualCost', 'costVariance', 'materialCost', 'laborCost', 'machineCost', 'overheadCost', 'serviceCost', 'scrapCost', 'hours', 'laborPriceVariance', 'laborEfficiencyVariance', 'overheadVariance', 'goodCost', 'wipCost', 'actualUnitCost']
export const jobDigest = (s: State, w: Row) => sha256(canonicalJson(jobCosts(s, w)))

// Only identifiers, numeric measures and fixed labels leave this module. Names,
// customer identities, notes, drawings, attachments and operator IDs never do.
export function varianceEvidence(s: State, orderId: string) {
  const order = get(s, 'salesOrders', orderId), report = varianceReport(s, new URLSearchParams({ orderId }))
  const links = s.costLinks.filter(l => l.orderId === order.id)
  if (!links.length) fail('COST_INCOMPLETE', 'Link a production job to this order before explaining its variance.')
  const itemIds = new Set(links.map(l => l.itemId))
  const work = s.workOrders.filter(w => w.status !== 'draft' && itemIds.has(w.itemId))
    .sort((a, b) => Number(links.some(l => l.workOrderId === b.id)) - Number(links.some(l => l.workOrderId === a.id)) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
  if (links.some(l => !work.slice(0, 10).some(w => w.id === l.workOrderId))) fail('SIZE', 'Explain an order linked to at most ten recent jobs.')
  const sources: Source[] = [], facts: Fact[] = [], missing = new Set<string>()
  const source = (kind: string, id: string, values: Record<string, unknown>) => {
    const key = `${kind}:${id}`
    const existing = sources.find(x => x.key === key)
    if (existing) Object.assign(existing.values, values)
    else sources.push({ key, kind, id, values })
    return key
  }
  const fact = (label: string, values: Record<string, unknown>, sourceKeys: string[]) => {
    facts.push({ id: `F${facts.length + 1}`, label, values, sourceKeys: [...new Set(sourceKeys)] })
  }
  const orderKey = source('salesOrders', order.id, { lines: order.lines.map((l: any) => pick(l, ['id', 'quantity', 'shipped', 'quotedUnitCost', 'unitPrice'])) })
  const orderKeys = [orderKey]
  for (const l of links) orderKeys.push(source('costLinks', l.id, pick(l, ['workOrderId', 'lineId', 'quantity'])))
  for (const m of report.lines.flatMap((l: any) => l.sources)) orderKeys.push(source('movements', m.movementId, pick(m, ['quantity', 'unitPrice', 'unitCost', 'revenue', 'cost'])))
  for (const c of s.marginCharges.filter(c => c.orderId === order.id)) orderKeys.push(source('marginCharges', c.id, pick(c, ['kind', 'amount', 'quoted', 'refundable'])))
  for (const v of s.costValuations.filter(v => v.status === 'approved' && links.some(l => l.workOrderId === v.workOrderId))) orderKeys.push(source('costValuations', v.id, { workOrderId: v.workOrderId, lines: v.lines.map((l: any) => pick(l, ['movementId', 'quantity', 'unitCost', 'targetValue'])) }))
  for (const l of report.lines) {
    fact('Order line quoted to actual', pick(l, ['lineId', 'quantity', 'netShipped', 'quotedRevenue', 'quotedCost', 'quotedMargin', 'recognizedRevenue', 'actualCost', 'actualMargin', 'costVariance', 'committedCost']), orderKeys)
    for (const m of l.missing) missing.add(m)
  }
  const baselines: Record<string, any>[] = work.slice(0, 10).map(w => {
    const cost = jobCosts(s, w), keys = [source('workOrders', w.id, { ...pick(w, jobFields), ...pick(cost, costFields) })]
    const bom = s.boms.find(b => b.itemId === w.itemId && b.revision === w.bomRevision)
    if (bom) keys.push(source('boms', bom.id, { revision: bom.revision, yield: bom.yield, components: bom.components.map((x: any) => pick(x, ['itemId', 'quantity'])), routing: bom.routing.map((x: any) => pick(x, ['sequence', 'setupMinutes', 'runMinutes', 'minutes'])) }))
    else missing.add('Pinned BOM source record unavailable')
    if (cost.policyId) {
      const p = s.costPolicies.find(p => p.id === cost.policyId)
      if (p) keys.push(source('costPolicies', p.id, pick(p, ['standardLaborRate', 'machineRate', 'overheadRate', 'overtimeAfterHours', 'overtimeMultiplier'])))
    }
    for (const component of cost.components) {
      const materialKeys = component.sources.map((m: any) => source('movements', m.movementId, pick(m, ['quantity', 'unitCost', 'cost'])))
      for (const m of component.sources) {
        for (const v of s.costValuations.filter(v => v.status === 'approved' && v.lines.some((l: any) => l.lotId === m.lotId))) {
          materialKeys.push(source('costValuations', v.id, { workOrderId: v.workOrderId, lines: v.lines.map((l: any) => pick(l, ['movementId', 'quantity', 'unitCost', 'targetValue'])) }))
        }
      }
      fact('Material usage and price', { workOrderId: w.id, ...pick(component, ['required', 'issued', 'standardUnitCost', 'actualCost', 'usageVariance', 'priceVariance']) }, [...keys, ...materialKeys])
    }
    const timeKeys = cost.laborSources.flatMap((e: any) => {
      const keys = [source(e.entryId ? 'timeEntries' : 'workOrders', e.entryId ?? w.id, { workOrderId: w.id, ...pick(e, ['sequence', 'rateVersion', 'hours', 'hourlyRate', 'burdenRate', 'laborCost', 'burdenCost', 'overtimeHours', 'overtimeCost', 'cost']) })]
      const current = s.laborRates.find(r => r.id === e.rateId)
      const rate = current && [...(current.history ?? []), current].find(r => r.version === e.rateVersion)
      if (rate) {
        const existing = sources.find(r => r.kind === 'laborRates' && r.id === rate.id)
        const versions = (existing?.values.retainedVersions ?? []) as any[]
        if (!versions.some(r => r.version === rate.version)) versions.push(pick(rate, ['version', 'hourlyRate', 'burdenRate']))
        keys.push(source('laborRates', rate.id, { retainedVersions: versions }))
      }
      return keys
    })
    const chargeKeys = cost.serviceSources.map((e: any) => source('jobCharges', e.id, pick(e, ['workOrderId', 'amount', 'status'])))
    fact('Job actual cost and pinned standard', { workOrderId: w.id, ...pick(w, jobFields), ...pick(cost, costFields), standardHours: w.costingStandard?.hours ?? null, standardLaborCost: w.costingStandard?.laborCost ?? null, standardMachineCost: w.costingStandard?.machineCost ?? null, standardOverheadCost: w.costingStandard?.overheadCost ?? null, overtimeCost: format(cost.laborSources.reduce((total, entry) => total + decimal(entry.overtimeCost), 0n)) }, [...keys, ...timeKeys, ...chargeKeys])
    if (cost.downtime.length) fact('Recorded downtime intervals', { workOrderId: w.id, intervals: cost.downtime.map((d: any) => pick(d, ['sequence', 'startedAt', 'stoppedAt'])) }, keys)
    for (const m of cost.missing) missing.add(m)
    if (w.status !== 'closed') missing.add('Work is not closed; recorded costs are incurred to date and are not final')
    return { workOrderId: w.id, itemId: w.itemId, bomRevision: w.bomRevision, digest: jobDigest(s, w), ...pick(w, ['quantity', 'output', 'scrap']), ...pick(cost, costFields) }
  })
  if (baselines.length < 2) missing.add('Fewer than two comparable jobs; recurring causes are unproven')
  if (work.length > 10) missing.add('Comparison limited to ten recent jobs; older jobs excluded')
  if (work.slice(0, 10).some(w => s.workTransfers.some(t => t.transfers.some((x: any) => x.sourceId === w.id || x.destinationId === w.id)))) missing.add('Transferred WIP cost needs separate transfer evidence; do not attribute its cause')
  const repeated = baselines.filter(w => decimal(w.scrap) > 0n)
  fact('Comparable production observations', { jobCount: baselines.length, jobsWithScrap: repeated.length, overtimeEntries: facts.filter(f => f.label === 'Job actual cost and pinned standard').length ? sources.filter(s => s.kind === 'timeEntries' && decimal(String(s.values.overtimeHours ?? '0')) > 0n).length : 0 }, baselines.map(b => `workOrders:${b.workOrderId}`))
  const value = { orderId, currency: 'USD', facts, sources, missing: [...missing].sort(), baselines }
  return { ...value, sourceCount: sources.length, digest: sha256(canonicalJson(value)) }
}

export const comparison = (before: any, after: any) => ({ before, after, scrapChange: format(decimal(after.scrap) - decimal(before.scrap)), costChange: before.actualCost === null || after.actualCost === null ? null : format(decimal(after.actualCost, 'actual', { signed: true }) - decimal(before.actualCost, 'actual', { signed: true })) })
