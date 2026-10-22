import { orderStatuses } from '../order-status'
import { draftWork } from '../production'
import { supplierQuote } from '../supplier-terms'
import { draftPurchase } from '../purchasing'
import { decimal, format } from '../decimal'
import { move, balance } from '../stock'
// Durable event proposals and isolated schedule scenarios. No observer may
// approve work, change a customer date, buy, or perform an external action.
import { canonicalJson, sha256 } from '../../modules/import-kit/src/d1/index'
import { collections, bump, fresh, get, list, row, text, type Context, type State, type Row } from '../model'
import { allow, approver } from '../roles'
import { fail } from '../problem'
import { finitePlan } from './finite'
import { instant, integer } from './calendars'
import { capacityPreview } from './reschedule'

export function planningDigest(s: State, people: Context['people']) {
  return sha256(canonicalJson({ records: Object.fromEntries(collections.filter(k => !['schedulePlans','replenishmentPlans'].includes(k)).map(k => [k,s[k]])),
    movements: s.movements.map(m=>({...m,quantity:String(m.quantity),unitCost:String(m.unitCost)})),
    reservations:s.reservations.map(r=>({...r,quantity:String(r.quantity)})), people }))
}
const policy = (s:State) => s.schedulePolicies[0]
const currentWindow = (c:Context,p:any) => {
  const asOf=instant(p.asOf ?? c.now,'planning start'),days=integer(p.days ?? 14,'planning horizon',1,60)
  if(Date.parse(asOf)<Math.floor(Date.parse(c.now)/60000)*60000) fail('INPUT','Choose a current or future planning window.')
  return {asOf,days}
}
const consequences = (before:any,after:any) => after.jobs.map((j:any)=>{
  const old=before.jobs.find((o:any)=>o.workOrderId===j.workOrderId)
  return {workOrderId:j.workOrderId,reference:j.reference,before:old?.endsAt ?? null,after:j.endsAt,lateBefore:old?.late ?? false,lateAfter:j.late,unscheduled:j.unscheduled}
}).filter((j:any)=>j.before!==j.after||j.unscheduled||j.lateBefore!==j.lateAfter)

function materialProjection(s:State,people:Context['people'],asOf:string,days:number,itemIds?:string[]) {
  const clone=structuredClone(s), statuses=orderStatuses(clone).work
  const materialEffects:any[]=[]
  for(const w of clone.workOrders.filter(w=>['draft','released'].includes(w.status))) {
    const status=statuses.find(o=>o.id===w.id)
    if(itemIds && !status?.lines.some(l=>itemIds.includes(l.itemId)))continue
    const missing=status?.lines.filter(l=>decimal(l.missing)>0n||l.ingredientStatus==='Not available'||l.ingredientStatus==='No BOM')??[]
    const supplies=status?.lines.flatMap(l=>l.supplies)??[]
    const notBefore=supplies.map(p=>p.date).filter(Boolean).sort().at(-1)
    if(missing.length || status?.ingredientStatus==='No BOM')w.planningMaterialBlock='Current shared material allocation has uncovered or unproved inputs; review the dated material sources.'
    if(notBefore)w.planningMaterialReadyAt=notBefore+'T00:00:00.000Z'
    materialEffects.push({workOrderId:w.id,reference:w.reference,notBefore:notBefore??null,missing:missing.map(l=>({itemId:l.itemId,quantity:l.missing})),supplies,basis:'Shared indicative physical/reserved/approved purchase allocations; future work remains subject to its own dependency and execution gates.'})
  }
  return {plan:finitePlan(clone,people??[],asOf,days,{releaseBookings:true}),materialEffects}
}

function scenario(c:Context,p:any,kind='scenario',event?:any) {
  // The observer uses the configured, bounded planning window; expired windows
  // yield a visible pending proposal rather than an implicit approval.
  const window=event ? {asOf:policy(c.s).asOf,days:policy(c.s).days} : currentWindow(c,p)
  const before=event ? finitePlan(event.before,c.people??[],window.asOf,window.days) : finitePlan(c.s,c.people??[],window.asOf,window.days)
  const clone=structuredClone(c.s)
  const outages=(p.outages===undefined?[]:list<any>(p.outages,'scenario outages',20)).map(o=>{
    const machine=get(clone,'machineCalendars',o.machineId),startsAt=instant(o.startsAt,'outage start'),endsAt=instant(o.endsAt,'outage end')
    if(endsAt<=startsAt) fail('INPUT','Outage end must follow start.')
    machine.exceptions.push({startsAt,endsAt,reason:'Isolated planning scenario'})
    return {machineId:machine.id,startsAt,endsAt}
  })
  const extraWork=(p.extraWork===undefined?[]:list<any>(p.extraWork,'scenario draft demand',20)).map(d=>draftWork({...c,s:clone},{...d,reason:text(d.reason??p.reason,'scenario work reason')},c.actor.id))
  const inventoryUnavailable=(p.inventoryUnavailable===undefined?[]:list<any>(p.inventoryUnavailable,'unavailable scenario inventory',20)).map(i=>{
    const item=get(clone,'items',i.itemId),location=get(clone,'locations',i.locationId),quantity=decimal(i.quantity,'unavailable quantity',{positive:true}),reason=text(i.reason,'inventory scenario reason')
    const lotId=i.lotId?get(clone,'lots',i.lotId).id:''
    const reserved=clone.reservations.filter(r=>r.itemId===item.id&&r.locationId===location.id).reduce((n,r)=>n+r.quantity,0n)
    if(balance(clone,item.id,location.id,'available',lotId)-reserved<quantity)fail('DEPENDENCY','Simulate only free physical inventory; hard reservations remain protected.')
    move({...c,s:clone},{itemId:item.id,locationId:location.id,lotId,status:'available',quantity:-quantity,kind:'scenario',documentKind:'schedulePlans',documentId:'isolated',reason})
    return {itemId:item.id,locationId:location.id,lotId,quantity:format(quantity),reason}
  })
  const alternateSuppliers=(p.alternateSuppliers===undefined?[]:list<any>(p.alternateSuppliers,'scenario suppliers',20)).map(a=>{
    const ref=get(clone,'partyItems',a.partyItemId)
    if(!ref.supplierTerms)fail('INPUT','Choose structured supplier terms.')
    const q=supplierQuote(ref,a.quantity,a.requiredBy,c.now.slice(0,10)),worst=supplierQuote({...ref,supplierTerms:{...ref.supplierTerms,leadDays:ref.supplierTerms.leadDaysMax??ref.supplierTerms.leadDays}},a.quantity,a.requiredBy,c.now.slice(0,10))
    const draft=draftPurchase({...c,s:clone},{supplierId:q.supplierId,expectedDate:worst.earliestDate,requiredBy:q.requiredBy,reason:'Isolated supplier assumption',lines:[{itemId:q.itemId,quantity:q.quantity,unitPrice:q.unitPrice}]},c.actor.id)
    // Simulated usable supply is prominently an assumption, never a real PO.
    draft.status='approved'
    return {...q,latestDate:worst.earliestDate,robustFeasible:worst.feasible,assumption:true}
  })
  const overtime=(p.overtime===undefined?[]:list<any>(p.overtime,'scenario overtime windows',20)).map(o=>{
    if(!['machine','labor'].includes(o.kind))fail('INPUT','Overtime needs a machine or labor calendar.')
    const collection=o.kind==='machine'?'machineCalendars':'laborCalendars',calendar=get(clone,collection,o.id)
    const startsAt=instant(o.startsAt,'overtime start'),endsAt=instant(o.endsAt,'overtime end')
    if(startsAt<window.asOf||endsAt<=startsAt||Date.parse(endsAt)>Date.parse(window.asOf)+window.days*86400000)fail('INPUT','Overtime must be bounded inside this planning window.')
    const change={kind:o.kind,id:calendar.id,startsAt,endsAt,reason:text(o.reason??p.reason,'overtime reason')}
    calendar.overtimeWindows=[...(calendar.overtimeWindows??[]),change]
    return change
  })
  let changes:any[]=[]
  if(p.changes?.length) {
    changes=capacityPreview({...c,s:clone},{changes:p.changes,capacity:{asOf:window.asOf,days:window.days}}).changes
    for(const ch of changes)Object.assign(get(clone,'workOrders',ch.workOrderId),ch)
  }
  const changedPo=event&&['po.revise','po.confirm'].includes(event.type)?c.s.purchaseOrders.find(po=>po.id===event.payload?.poId):null
  const projection = (extraWork.length||inventoryUnavailable.length||alternateSuppliers.length||changedPo) ? materialProjection(clone,c.people,window.asOf,window.days,changedPo?.lines.map((l:any)=>l.itemId)) : null
  const after=projection?.plan??finitePlan(clone,c.people??[],window.asOf,window.days,{releaseBookings:true})
  const protections=policy(c.s)?.protectedOperations ?? []
  const protectionConflicts=protections.filter((old:any)=>{
    const next=after.operations.find((o:any)=>o.key===old.key)
    return !next||canonicalJson(next.intervals)!==canonicalJson(old.intervals)||next.machineId!==old.machineId||next.operatorId!==old.operatorId
  }).map((o:any)=>o.key)
  return row(c,'schedulePlans',{kind,status:'review',name:text(p.name??`${event?.type} recovery`,'plan name',200),reason:text(p.reason??'Event-driven review; explicit human approval required.','plan reason'),
    preparedBy:c.actor.id,preparedRole:c.actor.role,...window,before,after,changes,outages,extraWork,inventoryUnavailable,alternateSuppliers,overtime,materialEffects:projection?.materialEffects??[],effects:consequences(before,after),protectionConflicts,
    event:event?{type:event.type,commandId:c.commandId,at:c.now,version:c.s.version+1}:null,changedPromiseCount:0,
    inputDigest:planningDigest(c.s,c.people),day:c.now.slice(0,10),semantics:'Proposal only. Customer dates, purchases, stock and execution remain unchanged. No automatic sequencing or outbound effects.'})
}

export function recovery(c:Context,type:string,p:any):Row|undefined {
  if(type==='schedule.protect') {
    allow(c,['manager','planner'])
    const window=currentWindow(c,p),freezeUntil=instant(p.freezeUntil,'freeze until')
    if(freezeUntil<window.asOf||Date.parse(freezeUntil)>Date.parse(window.asOf)+window.days*86400000)fail('INPUT','The frozen fence must be inside the planning window.')
    if(p.automatic!==undefined&&p.automatic!==false)fail('POLICY','Automatic sequencing is disabled pending policy approval.')
    const before=finitePlan(c.s,c.people??[],window.asOf,window.days)
    const keys=(p.manualLocks??[]).map((x:any)=>{
      const op=before.operations.find((o:any)=>o.key===`${x.workOrderId}:${x.sequence}`)
      if(!op)fail('INPUT','A manual lock needs a currently feasible operation.');return op!.key
    })
    const protectedOperations=before.operations.filter(o=>o.startsAt<freezeUntil||keys.includes(o.key))
    const data={...window,freezeUntil,manualLocks:keys,protectedOperations,automatic:false,reason:text(p.reason,'protection reason'),by:c.actor.id,at:c.now}
    const old=policy(c.s)
    if(old){fresh(old,p.version);return bump(old,{...data,history:[...(old.history??[]),data]})}
    return row(c,'schedulePolicies',{...data,history:[data]})
  }
  if(type==='schedule.scenario') {
    allow(c,['manager','planner','agent'])
    if(['promises','spend','automatic'].some(k=>p[k]!==undefined))fail('AUTHORITY','Scenarios cannot authorize customer dates, spending or automatic actions.')
    return scenario(c,p)
  }
  if(type!=='schedule.adopt'&&type!=='schedule.reject')return
  const plan=get(c.s,'schedulePlans',p.planId);fresh(plan,p.version)
  approver(c,['manager','production','planner'],plan.preparedBy)
  if(plan.status!=='review')fail('STATE','This plan was already decided.')
  if(['promises','spend','automatic'].some(k=>p[k]!==undefined))fail('AUTHORITY','Customer dates and spending require their separate recorded authority.')
  const note=text(p.reason,'decision reason')
  if(type==='schedule.reject')return bump(plan,{status:'rejected',decidedBy:c.actor.id,decidedAt:c.now,note})
  if(plan.inputDigest!==planningDigest(c.s,c.people)||plan.day!==c.now.slice(0,10)||Date.parse(plan.after.startsAt)<Date.parse(c.now))fail('STALE','Planning inputs, live people or planning window changed. Prepare a fresh scenario.')
  if(plan.after.unscheduled.some((u:any)=>!plan.before.unscheduled.some((b:any)=>b.workOrderId===u.workOrderId&&b.sequence===u.sequence&&b.reason===u.reason)||plan.changes.some((ch:any)=>ch.workOrderId===u.workOrderId))||plan.after.protectionConflicts?.length||plan.protectionConflicts.length)fail('CAPACITY','An infeasible or protected operation prevents adoption; nothing was booked.')
  if(plan.inventoryUnavailable?.length||plan.alternateSuppliers?.length)fail('POLICY','Speculative inventory and supplier assumptions cannot authorize stock or spending. Realize them through their existing approved doors, then compare again.')
  // A schedule approval carries no authority to bypass each adopted piece's door.
  if(plan.extraWork?.length)allow(c,['manager','production','planner'])
  for(const change of plan.overtime??[])allow(c,change.kind==='labor'?['manager']:['manager','planner'])
  for(const work of plan.extraWork??[])row(c,'workOrders',{...work,adoptedBy:c.actor.id,adoptedAt:c.now})
  for(const change of plan.overtime??[]){
    const calendar=get(c.s,change.kind==='machine'?'machineCalendars':'laborCalendars',change.id)
    bump(calendar,{overtimeWindows:[...(calendar.overtimeWindows??[]),{...change,by:c.actor.id,at:c.now,planId:plan.id}],overtimeHistory:[...(calendar.overtimeHistory??[]),{...change,by:c.actor.id,at:c.now,planId:plan.id}]})
  }
  // An outage is hypothetical: adoption books around it, never clears a real
  // hold or edits the underlying maintenance/calendar record.
  for(const ch of plan.changes)bump(get(c.s,'workOrders',ch.workOrderId),ch)
  for(const old of c.s.scheduleBookings.filter(b=>b.status==='active'))bump(old,{status:'superseded',supersededBy:plan.id})
  const booking=row(c,'scheduleBookings',{status:'active',planId:plan.id,asOf:plan.asOf,days:plan.days,operations:plan.after.operations,approvedBy:c.actor.id,approvedAt:c.now,reason:note})
  return bump(plan,{status:'adopted',bookingId:booking.id,decidedBy:c.actor.id,decidedAt:c.now,note})
}

const events=['maintenance.create','maintenance.update','maintenance.release','wo.operation.pause','wo.operation.resume','wo.operation.progress','wo.operation.complete','po.revise','po.confirm','order.rank','work.expected']
export function observeRecovery(c:Context,before:State,type:string,payload:any) {
  if(!events.includes(type)||!policy(c.s)||c.s.schedulePlans.some(p=>p.event?.commandId===c.commandId))return
  scenario(c,{name:`${type} recovery`,reason:'Recorded event; preserve frozen/manual intervals and review displacement.'},'reflow',{type,before,payload})
}
