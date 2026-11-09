// Descriptions of existing native commercial actions, never authority grants.
import { canonicalJson } from '../modules/import-kit/src/d1/index'
import { decimal, format, times } from './decimal'
import { type Context, type Row, get } from './model'
import { fail } from './problem'
import { commercialSnapshot } from './sales-schedules'

const doors = new Set(['po.draft', 'po.selectQuote', 'po.amend', 'po.approve', 'so.changePreview', 'so.changeApprove'])
const serverFields = new Set(['classification', 'classes', 'actionClasses', 'preparationClasses', 'riskClass', 'riskClasses', 'facts', 'consequences', 'actionClassification', 'consequenceFacts', 'decisionClassification', 'commercialClassification', 'decision', 'recordedDecision', 'personDecision', 'actor', 'approvedBy', 'approvedAt', 'recordedBy', 'recordedAt', 'signerId', 'signerRole', 'onBehalfOf'])

export function refuseCommercialFacts(type: string, payload: unknown) {
  const supplied = (value: any): boolean => value && typeof value === 'object' && Object.entries(value).some(([key, child]) => serverFields.has(key) || supplied(child))
  if (doors.has(type) && supplied(payload)) fail('INPUT', 'Commercial classes, consequences and decision attribution are computed by the server.')
}

export function commercialClassification(c: Context, subject: Row, effect: 'prepared' | 'pending' | 'applied', actionClasses: string[], terms: unknown) {
  return {
    version: 1, classes: effect === 'applied' ? actionClasses : ['standard'], actionClasses, effect,
    commandId: c.commandId, action: c.type, at: c.now,
    actor: { id: c.actor.id, role: c.actor.role, source: c.actor.agentDoor || c.actor.role === 'agent' ? 'agent' : 'person' },
    basis: { stateVersion: c.s.version, subjectId: subject.id, subjectVersion: subject.version },
    facts: {
      terms: structuredClone(terms), purchaseCommitment: effect === 'applied' && c.type === 'po.approve',
      customerCommitment: effect === 'applied' && c.type === 'so.changeApprove',
      paymentPosted: false, providerCharge: false, providerAcceptance: false, externalDelivery: false, audienceChanged: false,
    },
  }
}

export function purchaseTerms(po: Row) {
  const amount = po.lines.reduce((n: bigint, line: any) => n + times(decimal(line.quantity), decimal(line.unitPrice)), 0n)
  if (amount !== decimal(po.exposure)) fail('STALE', 'The stored purchase amount does not match its lines. Review the draft again.')
  return {
    poId: po.id, version: po.version, reference: po.reference, supplierId: po.supplierId,
    supplier: JSON.parse(JSON.stringify(po.supplierSnapshot)), amount: format(amount), currency: po.currency,
    expectedDate: po.expectedDate, requiredBy: po.requiredBy, lines: structuredClone(po.lines),
  }
}

export function amendmentTerms(c: Context, order: Row, after: any, customerApproval: unknown) {
  const customer = get(c.s, 'parties', order.customerId, 'customer')
  const revision = order.commercialRevision ?? 1
  const before = { ...commercialSnapshot(order), commercialRevision: revision }
  const next = { ...structuredClone(after), version: order.version + 1, commercialRevision: revision + 1 }
  const value = (snapshot: any) => format(snapshot.lines.reduce((n: bigint, line: any) => {
    const outstanding = line.schedules.reduce((q: bigint, schedule: any) => q + decimal(schedule.quantity), 0n)
    return n + times(outstanding, decimal(line.unitPrice))
  }, 0n))
  return {
    orderId: order.id, customerId: customer.id, customer: { id: customer.id, version: customer.version, name: customer.name },
    before, after: next, beforeValue: value(before), afterValue: value(next), currency: before.currency,
    valueBasis: 'Outstanding dated promises only; issued shipment terms remain unchanged.',
    customerApproval: structuredClone(customerApproval), attestationBasis: 'locally recorded customer attestation',
  }
}

export function reviewedAmendment(c: Context, order: Row, preview: Row) {
  const terms = amendmentTerms(c, order, preview.after, preview.customerApproval)
  if (!preview.classification || canonicalJson(terms) !== canonicalJson(preview.classification.facts.terms))
    fail('STALE', 'The reviewed commercial facts changed. Prepare a fresh amendment preview.')
  return terms
}
