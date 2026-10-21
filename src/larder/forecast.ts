import { canonicalJson } from '../modules/import-kit/src/d1/index'
import { mpsPolicyWarnings } from './inventory-policy-warnings'
import { attach } from './attachments'
import { decimal, format, times } from './decimal'
import { parseForecast } from './forecast-csv'
import { addDays, masterSchedule } from './forecast-plan'
import { fail } from './problem'
import { draftWork } from './production'
import { draftPurchase } from './purchasing'
import { allow, approver } from './roles'
import { bump, fresh, get, newId, row, text, type Context, type Row } from './model'

const settings = (f: Row) => ({ quantity: f.quantity, seasonality: f.seasonality, overrideQuantity: f.overrideQuantity })
function change(c: Context, f: Row, next: any, reason: string, extra: any = {}) {
  const entry = { id: newId(), before: settings(f), after: next, reason, by: c.actor.id, at: c.now, ...extra }
  return bump(f, { ...next, history: [...(f.history ?? []), entry] })
}

export function forecasts(c: Context, type: string, p: any): Row | undefined {
  if (!type.startsWith('forecast.') && !type.startsWith('mps.')) return
  if (type === 'forecast.import') {
    allow(c, ['manager', 'buyer', 'production', 'planner', 'agent'])
    if (p.stateVersion !== c.s.version) fail('STALE', 'Records changed. Review the forecast import again.')
    const name = text(p.file?.name, 'file name', 200), reason = text(p.reason, 'reason', 400)
    const buckets = parseForecast(c.s, p.file?.content, name)
    const attachment = attach(c, { name, contentType: 'text/csv', base64: btoa(unescape(encodeURIComponent(p.file.content))) })
    const ids = buckets.map(b => {
      const f = c.s.forecasts.find(f => f.itemId === b.itemId && f.week === b.week)
      if (f) { change(c, f, b, reason, { kind: 'import', attachmentId: attachment.id }); return f.id }
      return row(c, 'forecasts', { ...b, history: [{ id: newId(), kind: 'import', before: null, after: b, reason, by: c.actor.id, at: c.now, attachmentId: attachment.id }] }).id
    })
    return { id: newId(), version: 1, forecastIds: ids, attachmentId: attachment.id, rows: ids.length }
  }
  if (type === 'forecast.adjust' || type === 'forecast.undo') {
    allow(c, ['manager', 'production', 'planner'])
    const f = get(c.s, 'forecasts', p.forecastId, 'forecast'); fresh(f, p.version)
    const reason = text(p.reason, 'reason', 400)
    if (type === 'forecast.undo') {
      const entry = f.history.at(-1)
      if (!entry?.before || entry.id !== p.historyId || entry.kind === 'undo') fail('STATE', 'Undo only the latest change with an earlier forecast basis.')
      return change(c, f, entry.before, reason, { kind: 'undo', reversesId: entry.id })
    }
    const next = { quantity: f.quantity, seasonality: format(decimal(p.seasonality ?? f.seasonality, 'seasonality factor')),
      overrideQuantity: p.overrideQuantity === undefined ? f.overrideQuantity : p.overrideQuantity === null ? null : format(decimal(p.overrideQuantity, 'override quantity')) }
    if (next.overrideQuantity === null) decimal(format(times(decimal(next.quantity), decimal(next.seasonality))), 'adjusted forecast')
    return change(c, f, next, reason, { kind: 'adjustment' })
  }
  if (type === 'mps.preview') {
    allow(c, ['manager', 'buyer', 'production', 'planner', 'agent'])
    if (!c.s.forecasts.length) fail('INPUT', 'Import a forecast before preparing the master production schedule.')
    const rows = masterSchedule(c.s)
    if (rows.some(r => decimal(r.undatedShipped) > 0n)) fail('HISTORICAL_DEMAND', 'Historical shipped demand has no issued delivery dates. Reconcile the source documents before releasing this item’s MPS.', rows.filter(r => decimal(r.undatedShipped) > 0n).map(r => ({ itemId: r.itemId, sources: r.undatedSources })))
    return row(c, 'productionPlans', { status: 'preview', stateVersion: c.s.version + 1, preparedBy: c.actor.id, reason: text(p.reason, 'reason', 400), rows, policyWarnings: mpsPolicyWarnings(c.s, rows.filter(r => decimal(r.proposed) > 0n).map(r => r.itemId), c.now.slice(0, 10)) })
  }
  if (type === 'mps.release') {
    const plan = get(c.s, 'productionPlans', p.planId, 'master production schedule'); fresh(plan, p.version)
    approver(c, ['manager', 'production', 'planner'], plan.preparedBy)
    if (plan.status !== 'preview') fail('STATE', 'Only an unreleased MPS preview can be released.')
    if (plan.stateVersion !== c.s.version) fail('STALE', 'Business records changed. Prepare and review a new MPS.')
    const policies = mpsPolicyWarnings(c.s, plan.rows.filter((r: any) => decimal(r.proposed) > 0n).map((r: any) => r.itemId), c.now.slice(0, 10))
    if (canonicalJson(policies) !== canonicalJson(plan.policyWarnings ?? [])) fail('STALE', 'Effective location policies changed. Prepare and review a new MPS.')
    if (policies.length && p.manualPolicyOverride !== true) fail('INVENTORY_POLICY', 'Use the location policy planner, or explicitly acknowledge a manual global MPS override with a reason.')
    const policyOverride = policies.length ? { by: c.actor.id, at: c.now, reason: text(p.policyOverrideReason, 'manual policy override reason', 400), policies } : null
    const documents = plan.rows.filter((r: any) => decimal(r.proposed) > 0n).map((r: any) => {
      const item = get(c.s, 'items', r.itemId)
      if (item.archived) fail('ARCHIVED', `${item.name} is archived; revise its forecast before releasing supply.`)
      const reason = `${plan.reason}; MPS week ${r.week}`
      const due = addDays(r.week, 6)
      let doc: Row
      if (item.kind === 'make') doc = draftWork(c, { itemId: item.id, quantity: r.proposed, requiredBy: due, reason }, plan.preparedBy)
      else {
        const terms = c.s.partyItems.filter(t => t.itemId === item.id && c.s.parties.some(p => p.id === t.partyId && p.kind !== 'customer'))
        const supplier = terms.find(t => t.preferred) ?? terms[0] ?? fail('NO_SUPPLIER', `Choose a supplier for ${item.name} before releasing the MPS.`)
        doc = draftPurchase(c, { supplierId: supplier.partyId, lines: [{ itemId: item.id, quantity: r.proposed, unitPrice: supplier.price }], expectedDate: due, requiredBy: due, reason }, plan.preparedBy)
      }
      doc.masterSchedule = { planId: plan.id, week: r.week, forecastId: r.forecastId, sources: r.sources, policyOverride }
      return { kind: item.kind === 'make' ? 'workOrders' : 'purchaseOrders', id: doc.id, itemId: item.id, reference: doc.reference, quantity: r.proposed, week: r.week }
    })
    return bump(plan, { status: 'released', releasedAt: c.now, releasedBy: c.actor.id, documents, policyOverride })
  }
}
