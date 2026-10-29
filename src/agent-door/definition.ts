import type { Bindings } from '../auth.server'
import { ToolRefusal, type JsonSchemaObject, type ToolDefinition, type ToolContext, type ApprovalSummary } from '../modules/agent-door/index.ts'
import { nativeCommand, nativeView } from './native'
import { readRecord, recordKinds } from './resources'
export const string = { type: 'string', minLength: 1 }
export const object = (properties: Record<string, any>, required: string[] = []): JsonSchemaObject => ({ type: 'object', properties, required, additionalProperties: false })
export const line = object({ itemId: string, quantity: string, unit: string, unitPrice: string }, ['itemId','quantity','unitPrice'])
export const output = { type: 'object' }
export const standard = () => [{ class: 'standard' as const, facts: { measure: 1 } }]
const core = ['SURFACE-001','SURFACE-006','SURFACE-013']

async function summary(env: Bindings, command: string, args: Record<string, any>, ctx: ToolContext): Promise<ApprovalSummary> {
  const { view } = await nativeView(env, ctx.person)
  const ids = new Set([args.itemId,args.materialItemId,...(args.itemIds??[]),...['lines','components'].flatMap(key=>(args[key]??[]).map((line:any)=>line.itemId))].filter(Boolean))
  const items = (view.items ?? []).filter((record: any) => ids.has(record.id)).map((record: any) => record.name)
  const party = (view.parties ?? []).find((record: any) => record.id === args.supplierId || record.id === args.customerId)
  const targets=[args.poId,args.groupId,args.planId,args.grantId,args.policyId,args.lotId,args.partyItemId].filter(Boolean)
  const target=Object.values(recordKinds).flatMap(kind=>Array.isArray(view[kind])?view[kind]:[]).find((record:any)=>targets.includes(record.id))
  const jobs=(args.members??args.plan?.changes??[]).flatMap((member:any)=>(view.workOrders??[]).filter((record:any)=>record.id===member.workOrderId).map((record:any)=>record.reference))
  items.push(...jobs)
  return { items, ...(party ? { payee: party.name, target: { id: party.id, name: party.name } } : target ? { target: { id: target.id, name: target.reference ?? target.name ?? target.id } } : { target: { name: `Internal ${command}` } }) }
}
export function write(env: Bindings, name: string, command: string, clauses: string[], inputSchema: JsonSchemaObject, resource?: keyof typeof recordKinds): ToolDefinition {
  return { name: `larder.${name}`, title: command, description: `Prepare internal work with native ${command}. Native roles, scope, state and exact command replay apply. No physical evidence, person signature, supplier send or payment is created.`,
    scope: 'manufacturing:write', readOnly: false, inputSchema, outputSchema: {type:'object',properties:{id:string,version:{type:'integer'}},required:['id','version']}, classes: ['standard'], clauses: [...core,...clauses], classify: standard,
    summary: (args, ctx) => summary(env, command, args, ctx),
    async run(args, ctx) {
      const result = await nativeCommand(env, command, args, ctx) as Record<string, any>
      return { result, ...(resource && result.id ? { resources: [{ uri: `larder://${resource}/${encodeURIComponent(result.id)}`, name: String(result.reference ?? result.name ?? result.id) }] } : {}) }
    },
  }
}
