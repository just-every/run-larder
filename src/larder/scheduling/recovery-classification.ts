// Classification describes the bounded native recovery action; it grants no
// authority. Company-policy execution remains a separate, unqualified door.
import { activeBom } from '../bom'
import { fail } from '../problem'
import { type Context } from '../model'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/d1/index'

export function recoveryOptionDigest(option: any) {
  const { classification, ...retained } = option
  return sha256(canonicalJson(retained))
}

export function recoveryClassification(c: Context, option: any, inputDigest: string, action: 'compare' | 'adopt' | 'reject') {
  if (option.changedPromiseCount !== 0 || option.cashExposureUsd !== '0' || option.promiseEffects.some((p: any) => p.beforeDate !== p.afterDate)) fail('AUTHORITY', 'Recovery sequencing cannot authorize purchasing or changed customer promises.')
  const operations = option.after.operations.map((op: any) => {
    const work = c.s.workOrders.find(w => w.id === op.workOrderId)
    const step = (work?.status === 'released' ? work.routing : activeBom(c.s, work?.itemId)?.routing)?.find((r: any) => r.sequence === op.sequence)
    const person = c.people?.find(p => p.id === op.operatorId)
    const labor = c.s.laborCalendars.find(l => l.id === op.laborId)
    const requiredSkills = step?.requiredSkills ?? []
    if (!step || !person || !['owner', 'manager', 'production', 'operator'].includes(person.role) || !labor?.operatorIds.includes(person.id) || !requiredSkills.every((skill: string) => labor.skills.includes(skill))) fail('STALE', 'Recovery qualifications changed. Prepare a fresh comparison.')
    const { person: historicalLabel, ...interval } = op
    return { ...interval, position: option.sequence.find((o: any) => o.key === op.key)?.position, requiredSkills, qualifiedPersonRole: person!.role }
  })
  return {
    action, classes: ['standard'], effect: action === 'adopt' ? 'reversible-internal-sequencing' : 'informational',
    optionId: option.id, optionDigest: recoveryOptionDigest(option), inputDigest,
    facts: {
      operations, changes: option.changes, displacement: option.effects, unchangedPromises: option.promiseEffects, sources: option.sources, materialEffects: option.materialEffects,
      estimatedCostUsd: option.planningCostUsd, costBasis: 'Projected planning estimate only; no purchase, payroll or customer commitment.',
      cashExposureUsd: '0', purchasingSpendUsd: '0', customerCommitmentsChanged: false, outbound: false, stockChanged: false, executionAssignmentsChanged: false,
    },
  }
}

// Only the command identifiers and reviewed choice come from the caller.
// Reject supplied server facts even when they happen to match the readback.
export function refuseRecoveryFacts(payload: any) {
  const serverFields = new Set(['classification', 'classes', 'riskClass', 'riskClasses', 'facts', 'consequences', 'actionClassification', 'consequenceFacts', 'decisionClassification', 'personDecision', 'optionDigest', 'inputDigest'])
  const supplied = (value: any): boolean => value && typeof value === 'object' && Object.entries(value).some(([key, child]) => serverFields.has(key) || supplied(child))
  if (supplied(payload)) fail('AUTHORITY', 'Recovery classification and consequence facts are computed by the server.')
}
