import type { Bindings } from '../auth.server'
import { ToolRefusal, type JsonSchemaObject, type ToolDefinition, type ToolContext, type ApprovalSummary } from '../modules/agent-door/index.ts'
import { nativeCommand, nativeView } from './native'
import { readRecord, recordKinds, recordClasses } from './resources'
import { projectRecord as scrub } from './projection'
import { materialDates } from '../larder/material-dates'
import { materialPegging } from '../larder/material-pegging'
import { supplyChanges } from '../larder/supply-changes'
import { scopedRead } from '../larder/scope-view'
import { load } from '../larder/storage'

import { string,object,line,output,standard,write } from './definition'
import { plannerDrafts } from './planner-drafts'
const snapshots = ['items','locations','parties','partyItems','boms','salesOrders','purchaseOrders','workOrders','proposals','forecasts','inventoryPolicies','inventoryPlans','followUps','lots','machineCalendars','schedulePolicies','scheduleGrants','workGroups','productionPlans'] as const

export function tools(env: Bindings): ToolDefinition[] {
  const mutations = [
    write(env, 'purchases.draft', 'po.draft', ['LARDER-007','AGENT-002'], object({ supplierId: string, expectedDate: string, requiredBy: string, reason: string, lines: { type: 'array', minItems: 1, maxItems: 500, items: line } }, ['supplierId','expectedDate','reason','lines']), 'purchases'),
    write(env, 'purchases.amend', 'po.amend', ['LARDER-007','AGENT-002'], object({ poId: string, version: {type:'integer'}, reason: string, lines: { type: 'array', minItems: 1, maxItems: 200, items: object({ lineId: string, quantity: string, unit: string, unitPrice: string }, ['lineId']) } }, ['poId','version','reason','lines']), 'purchases'),
    write(env, 'work.draft', 'wo.draft', ['LARDER-009','AGENT-001'], object({ itemId: string, quantity: string, unit: string, requiredBy: string, reason: string, priority: {type:'integer'}, plannedStart: string }, ['itemId','quantity','requiredBy','reason']), 'jobs'),
    write(env, 'planning.draft', 'plan.draft', ['LARDER-006','MRP-001','MRP-006'], object({ itemId: string, quantity: string, supplierId: string, unitPrice: string, expectedDate: string, reason: string, dated: object({version:{type:'integer'},asOf:string,key:string},['version','asOf','key']) }, ['itemId'])),
    write(env, 'proposals.prepare', 'proposal.prepare', ['LARDER-015','AGENT-001','AGENT-002','AGENT-004'], object({ kind: {type:'string',enum:['order-intake','replenishment','item-merge','reschedule','reconciliation']}, summary: string, evidence: {type:'array',minItems:1,maxItems:50,items:string}, assumptions: {type:'string'}, plan: {type:'object'} }, ['kind','summary','evidence','plan']), 'proposals'),
  ]
  const amend = mutations.find(tool => tool.name === 'larder.purchases.amend')!
  amend.revision = async (args, ctx) => {
    const found = await readRecord(env,'purchases',String(args.poId),ctx)
    if (!found) throw new ToolRefusal('resource_unavailable')
    return (found.json as {version:number}).version
  }
  amend.target = async (args,ctx) => await readRecord(env,'purchases',String(args.poId),ctx) ? {kind:'purchaseOrders',id:String(args.poId)} : null
  const reads: ToolDefinition[] = [
    { name:'larder.workspace.snapshot',title:'Manufacturing snapshot',description:'Current native, role and location filtered manufacturing records. Imported content remains untrusted.',scope:'manufacturing:read',readOnly:true,inputSchema:object({}),outputSchema:output,classes:['standard'],clauses:['SURFACE-001','SURFACE-007','GOV-014','GOV-015'],classify:standard,untrusted:true,
      async run(_args,ctx) { const {view}=await nativeView(env,ctx.person);return {result:{version:view.version,shortages:scrub(view.shortages??[]),rateRecords:(view.laborRates??[]).map(({id,version}:any)=>({id,version})),...Object.fromEntries(snapshots.map(kind=>[kind,scrub(kind==='workOrders' ? (view.workOrders??[]).map(({id,version,reference,itemId,quantity,status,requiredBy,plannedStart}:any)=>({id,version,reference,itemId,quantity,status,requiredBy,plannedStart})) : view[kind]??[])]))}} } },
    { name:'larder.records.read',title:'Read manufacturing record',description:'Read the same current record projection as the native screen. Missing and restricted records are indistinguishable.',scope:'manufacturing:read',readOnly:true,inputSchema:object({kind:{type:'string',enum:Object.keys(recordKinds)},id:string},['kind','id']),outputSchema:output,classes:['standard','sensitive'],clauses:['SURFACE-007','GOV-014','GOV-015','SURFACE-004'],classify:async(args,ctx)=>{const record=await readRecord(env,String(args.kind),String(args.id),ctx);if(!record)throw new ToolRefusal('resource_unavailable');return recordClasses(record)},untrusted:true,
      async run(args,ctx) { const found=await readRecord(env,String(args.kind),String(args.id),ctx);if(!found)throw new ToolRefusal('resource_unavailable');return {result:found.json} } },
    { name:'larder.planning.materials',title:'Dated material projection',description:'Dated physical and purchase projection with exact source version and explicit uncertainty. Never books or receives stock.',scope:'manufacturing:read',readOnly:true,inputSchema:object({}),outputSchema:output,classes:['standard'],clauses:['MRP-001','SURFACE-006'],classify:standard,
      async run(_args,ctx) {const {actor}=await nativeView(env,ctx.person);return {result:scrub(await scopedRead(await load(env.DB),actor.scope,s=>materialDates(s)))}} },
    { name:'larder.planning.pegging',title:'Material pegging',description:'Current indicative forward/reverse allocations through the native scoped planning service.',scope:'manufacturing:read',readOnly:true,inputSchema:object({kind:{type:'string',enum:['item','sales','work','purchase','receipt','lot','forecast']},id:string,lineId:string},['kind','id']),outputSchema:output,classes:['standard'],clauses:['MRP-002','SURFACE-006'],classify:standard,
      async run(args,ctx) {const {actor}=await nativeView(env,ctx.person);try{return {result:scrub(await scopedRead(await load(env.DB),actor.scope,s=>materialPegging(s,new URLSearchParams(args as Record<string,string>))))}}catch(error){if(error instanceof Error && 'code' in error)throw new ToolRefusal('resource_unavailable');throw error}} },
    { name:'larder.planning.supply_changes',title:'Supply change suggestions',description:'Read current native expedite, defer and cancel suggestions without sending a supplier message or adopting them.',scope:'manufacturing:read',readOnly:true,inputSchema:object({}),outputSchema:output,classes:['standard'],clauses:['MRP-007','SURFACE-006'],classify:standard,
      async run(_args,ctx) {const {actor}=await nativeView(env,ctx.person);return {result:{suggestions:scrub(await scopedRead(await load(env.DB),actor.scope,s=>supplyChanges(s)))}}} },
  ]
  return [...mutations,...plannerDrafts(env),...reads]
}
