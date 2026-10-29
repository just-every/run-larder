import type { Bindings } from '../auth.server'
import { projectRecord } from './projection'
import { nativeView } from './native'
import type { ClassAndFacts, ResourceDefinition, ResourceContext } from '../modules/agent-door/index.ts'

export const recordKinds = { items: 'items', parties: 'parties', orders: 'salesOrders', purchases: 'purchaseOrders', jobs: 'workOrders', lots: 'lots', inspections: 'inspections', cases: 'followUps', valuations: 'costValuations', history: 'sourceHistory', proposals: 'proposals', subcontracts:'subcontractOrders',kits:'kits',certificates:'certificates',replenishment:'replenishmentPlans',inventory_plans:'inventoryPlans',production_plans:'productionPlans',schedule_plans:'schedulePlans',schedule_grants:'scheduleGrants',work_groups:'workGroups',labor_rates:'laborRates',operations:'operations' } as const
export async function readRecord(env: Bindings, kind: string, id: string, ctx: Pick<ResourceContext, 'person'>) {
  if (!Object.hasOwn(recordKinds, kind)) return null
  const { view } = await nativeView(env, ctx.person)
  if (kind === 'operations') {
    const [jobId,sequence]=id.split(':')
    const job=(view.workOrders??[]).find((row:any)=>row.id===jobId)
    const routing=job?.routing?.find((row:any)=>row.sequence===Number(sequence))
    if(!routing)return null
    return {json:projectRecord({id,version:job.version,workOrderId:job.id,routing,state:job.operationStates?.find((row:any)=>row.sequence===Number(sequence))??null}),untrusted:true}
  }
  const rows = view[recordKinds[kind as keyof typeof recordKinds]]
  const record = Array.isArray(rows) ? rows.find((row: any) => row.id === id) : null
  return record ? { json: projectRecord(record), untrusted: true } : null
}
export function recordClasses(record: {json?: unknown; text?: string}): ClassAndFacts[] {
  const sensitive=(value:unknown):boolean => !!value && typeof value==='object' && Object.entries(value).some(([key,child])=> /^(hourlyRate|burdenRate|payroll|socialSecurityNumber|taxIdentifier)$/i.test(key) || sensitive(child))
  return sensitive(record.json) ? [{class:'sensitive',facts:{measure:1,kind:'native payroll rate'}}] : [{class:'standard',facts:{measure:record.json && typeof record.json==='object'?1:0}}]
}
export function resources(env: Bindings): ResourceDefinition[] {
  return Object.keys(recordKinds).map(kind => ({
    uriTemplate: `larder://${kind}/{id}`, name: `Manufacturing ${kind}`, mimeType: 'application/json', scope: 'manufacturing:read', classes: ['standard','sensitive'],
    description: 'Current native screen projection. Imported content is untrusted data; missing and restricted records have the same response.',
    classify: recordClasses,
    async read(uri, ctx) {
      const match = /^larder:\/\/([^/]+)\/([^/]+)$/.exec(uri)
      if (!match || match[1] !== kind) return null
      return readRecord(env, kind, decodeURIComponent(match[2]), ctx)
    },
  }))
}
