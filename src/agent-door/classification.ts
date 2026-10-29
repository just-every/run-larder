import type { Bindings } from '../auth.server'
import { ToolRefusal, type ClassAndFacts, type ToolContext } from '../modules/agent-door/index.ts'
import { gateCommand } from '../larder/scope-gate'
import { Problem } from '../larder/problem'
import { nativeView } from './native'

// These registered verbs prepare one native document or item revision. Units,
// price estimates and imported instructions never turn preparation into a send,
// payment, signature, booking or standing grant. Resolve current native targets
// before returning that effect's class; execution repeats the native guards.
export async function draftClasses(env: Bindings, command: string, args: Record<string,unknown>, ctx: ToolContext): Promise<ClassAndFacts[]> {
  const {actor,view}=await nativeView(env,ctx.person)
  try {gateCommand(actor,command,args)}
  catch(error){if(error instanceof Problem)throw new ToolRefusal(error.code.toLowerCase());throw error}
  const references: Record<string,string>={itemId:'items',materialItemId:'items',supplierId:'parties',customerId:'parties',partyItemId:'partyItems',policyId:'inventoryPolicies',groupId:'workGroups',poId:'purchaseOrders',lotId:'lots'}
  for(const [key,kind] of Object.entries(references))if(typeof args[key]==='string' && !(view[kind]??[]).some((record:any)=>record.id===args[key]))throw new ToolRefusal('resource_unavailable')
  if(command==='po.amend' && !(view.purchaseOrders??[]).some((record:any)=>record.id===args.poId&&record.status==='draft'))throw new ToolRefusal('state')
  if(command==='nest.cancel' && !(view.workGroups??[]).some((record:any)=>record.id===args.groupId&&['draft','review'].includes(record.status)))throw new ToolRefusal('state')
  // Grant revision can suspend standing authority, so this preparation tool
  // accepts only a new draft. Standing changes require a separate access tool.
  if(command==='schedule.grant.prepare' && args.id!==undefined)throw new ToolRefusal('unsupported_effect')
  return [{class:'standard',facts:{measure:1}}]
}
