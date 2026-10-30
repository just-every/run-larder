import type { Bindings } from '../auth.server'
import { write, object, string } from './definition'
import { readRecord } from './resources'
import { ToolRefusal } from '../modules/agent-door/index.ts'

const integer = { type:'integer' }
const strings = { type:'array',items:string,maxItems:100 }
const component = object({itemId:string,quantity:string,unit:string},['itemId','quantity'])
const reason = {reason:string}
export function plannerDrafts(env: Bindings) {
  const tools = [
    write(env,'purchases.select_quote','po.selectQuote',['BUY-001','AGENT-002'],object({partyItemId:string,version:integer,quantity:string,requiredBy:string,reason:string,deliveries:{type:'array',items:object({quantity:string,expectedDate:string},['quantity','expectedDate'])}},['partyItemId','version','quantity','requiredBy','reason']),'purchases'),
    write(env,'subcontract.draft','subcontract.draft',['BUY-004'],object({supplierId:string,itemId:string,vendorLocationId:string,customerId:string,quantity:string,serviceRate:string,expectedDate:string,operation:string},['supplierId','itemId','vendorLocationId','quantity','serviceRate','expectedDate','operation']),'subcontracts'),
    write(env,'kits.prepare','kit.save',['ENG-006'],object({itemId:string,mode:{type:'string',enum:['assemble','pick']},components:{type:'array',minItems:1,maxItems:100,items:component},note:string},['itemId','mode','components']),'kits'),
    write(env,'certificates.prepare','certificate.prepare',['TRACE-007'],object({itemId:string,lotId:string,type:{type:'string',enum:['coa','sds','test-report','specification','coc']},documentVersion:string,declaredLot:string,issuer:string,expiresOn:string,evidence:object({name:string,contentType:string,base64:string},['name','contentType','base64'])},['itemId','lotId','type','documentVersion','declaredLot','issuer','expiresOn','evidence']),'certificates'),
    write(env,'replenishment.preview','replenishment.preview',['MRP-003','AGENT-002'],object({itemIds:strings,horizonDays:integer,historyDays:integer,confidence:integer,confidenceBasis:string,reason:string},['confidence','confidenceBasis','reason']),'replenishment'),
    write(env,'inventory.preview','inventory.preview',['DEMAND-004'],object({policyId:string,orderIds:strings,reason:string},['policyId','orderIds','reason']),'inventory_plans'),
    write(env,'production_schedule.preview','mps.preview',['DEMAND-003'],object(reason,['reason']),'production_plans'),
    write(env,'schedule.scenario','schedule.scenario',['CAP-004','MRP-004','AGENT-001'],object({asOf:string,days:integer,name:string,reason:string,changes:{type:'array',items:{type:'object'}},outages:{type:'array',items:object({machineId:string,startsAt:string,endsAt:string},['machineId','startsAt','endsAt'])},extraWork:{type:'array',items:{type:'object'}},inventoryUnavailable:{type:'array',items:{type:'object'}},alternateSuppliers:{type:'array',items:{type:'object'}},overtime:{type:'array',items:{type:'object'}}},['asOf','days','name','reason']),'schedule_plans'),
    write(env,'schedule.prepare_grant','schedule.grant.prepare',['CAP-007'],object({eventTypes:strings,machineIds:strings,workOrderIds:strings,maxDelayMinutes:integer,maxDisplacementMinutes:integer,expiresAt:string,reason:string},['eventTypes','machineIds','workOrderIds','maxDelayMinutes','maxDisplacementMinutes','expiresAt','reason']),'schedule_grants'),
    write(env,'nesting.prepare','nest.prepare',['CAP-008'],object({materialItemId:string,members:{type:'array',minItems:2,maxItems:50,items:object({workOrderId:string,version:integer,sequence:integer},['workOrderId','version','sequence'])},reason:string},['materialItemId','members','reason']),'work_groups'),
    write(env,'nesting.cancel','nest.cancel',['CAP-008'],object({groupId:string,version:integer,reason:string},['groupId','version','reason']),'work_groups'),
  ]
  const cancel=tools.find(tool=>tool.name==='larder.nesting.cancel')!
  cancel.revision=async(args,ctx)=>{const record=await readRecord(env,'work_groups',String(args.groupId),ctx);if(!record)throw new ToolRefusal('resource_unavailable');return (record.json as {version:number}).version}
  return tools
}
