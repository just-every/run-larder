// MRP-006: convert one reviewed dated suggestion to an ordinary draft. The
// existing plan.draft role/policy checks and atomic storage guard still apply.
import { materialDates } from './material-dates'
import { fail } from './problem'
import { draftPurchase } from './purchasing'
import { draftWork } from './production'
import { text, type Context, type Row } from './model'

export function datedDraft(c: Context, p: any, item: Row): Row {
  const reviewed = p.dated
  if (!reviewed || typeof reviewed !== 'object' || Array.isArray(reviewed)) fail('INPUT', 'Choose a dated requirement from the material projection.')
  if (reviewed.version !== c.s.version || reviewed.asOf !== c.now.slice(0, 10)) fail('STALE', 'Planning inputs or the UTC day changed. Read and review the dated projection again.')
  const plan = materialDates(c.s)
  if (plan.asOf !== reviewed.asOf) fail('STALE', 'The UTC day changed. Read and review the dated projection again.')
  const requirement = plan.requirements.find(r => r.key === reviewed.key && r.itemId === item.id)
    ?? fail('NOT_FOUND', 'That dated requirement is no longer in the projection.')
  if (requirement.linkedSupply.length) fail('DRAFT_EXISTS', 'Review the supply already linked to this dated requirement before preparing more.', requirement.linkedSupply)
  if (plan.blockedExplosions.some(b => b.itemId === item.id && b.documentId === requirement.documentId && b.lineId === requirement.lineId)) fail('NO_SUGGESTION', 'Reconcile the blocked work or timing before drafting this requirement.')
  const suggestion = requirement.suggestion ?? fail('NO_SUGGESTION', 'This requirement has no dated draft suggestion. Review its coverage and timing diagnostics.')
  // Quantity, supply mode, supplier and receipt/release dates come from the
  // current projection; callers cannot substitute aggregate/undated values.
  if (['quantity', 'supply', 'supplierId', 'expectedDate'].some(k => p[k] !== undefined)) fail('INPUT', 'Dated drafts use the exact suggested quantity, supply, supplier and dates; read a new projection to change them.')
  const reason = `${text(p.reason, 'draft reason', 400)}: ${requirement.reference} needs ${requirement.shortage} ${item.baseUnit} by ${requirement.requiredBy}`
  let draft: Row
  if (suggestion.kind === 'make') {
    draft = draftWork(c, { itemId: item.id, quantity: suggestion.quantity, requiredBy: suggestion.receiptOn, plannedStart: suggestion.releaseOn, reason })
    draft.demandSources = [{ documentId: requirement.documentId, documentKind: requirement.kind, reference: requirement.reference,
      quantity: suggestion.quantity, requiredBy: requirement.requiredBy, reason, path: requirement.path }]
  } else {
    const supplierId = suggestion.supplierId ?? fail('NO_SUPPLIER', 'Record supplier/item terms, then review a new dated projection.')
    // The preparer enters a price explicitly. This is a draft, never an
    // approval, supplier acceptance or a promise of material feasibility.
    draft = draftPurchase(c, { supplierId, expectedDate: suggestion.receiptOn, requiredBy: requirement.requiredBy, reason,
      lines: [{ itemId: item.id, quantity: suggestion.quantity, unitPrice: p.unitPrice }] })
  }
  draft.datedPlan = { stateVersion: reviewed.version, asOf: plan.asOf, requirement: structuredClone(requirement), suggestion: structuredClone(suggestion) }
  return draft
}
