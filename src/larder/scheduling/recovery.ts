import { scheduleGrant, grantLapsed, grantRefusal, suspendGrant } from './grants'
import { adoptionProblem, bookIntervals } from './booking'
import { planningDigest } from './fingerprint'
import { recoveryClassification, recoveryOptionDigest, refuseRecoveryFacts } from './recovery-classification'
export { planningDigest } from './fingerprint'
import { draftWork } from '../production'
import { supplierQuote } from '../supplier-terms'
import { draftPurchase } from '../purchasing'
import { decimal, format } from '../decimal'
import { move, balance } from '../stock'
// Durable event proposals and isolated schedule scenarios. No observer may
// approve execution, change a customer date, buy, or perform an external action.
// Internal interval booking alone may be delegated by a bounded human grant.
import { canonicalJson } from '../../modules/import-kit/src/d1/index'
import { bump, fresh, get, list, row, text, type Context, type State, type Row } from '../model'
import { allow, approver } from '../roles'
import { authorize, gate } from '../approval-policy'
import { largestJobDelay } from './delay'
import { fail } from '../problem'
import { finitePlan } from './finite'
import { instant, integer } from './calendars'
import { capacityPreview } from './reschedule'
import { recoveryProjection, recoveryOptions, recoveryEffects, protectedConflicts, recoveryInputsChanged } from './recovery-options'

const policy = (s:State) => s.schedulePolicies[0]
const currentWindow = (c:Context,p:any) => {
  const asOf=instant(p.asOf ?? c.now,'planning start'),days=integer(p.days ?? 14,'planning horizon',1,60)
  if(Date.parse(asOf)<Math.floor(Date.parse(c.now)/60000)*60000) fail('INPUT','Choose a current or future planning window.')
  return {asOf,days}
}

function scenario(c:Context,p:any,kind='scenario',event?:any) {
  // The observer uses the configured, bounded planning window; expired windows
  // yield a visible pending proposal rather than an implicit approval.
  const window=event ? {asOf:policy(c.s).asOf,days:policy(c.s).days} : currentWindow(c,p)
  const prior=recoveryProjection(event?.before??c.s,c.people,window.asOf,window.days)
  const before=finitePlan(prior.state,c.people??[],window.asOf,window.days)
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
  const projection = recoveryProjection(clone,c.people,window.asOf,window.days)
  const after=projection.plan
  const protectionConflicts=protectedConflicts(c.s,after)
  const computed=event ? recoveryOptions(c,before,projection,event,window.asOf,window.days) : null
  const inputDigest=planningDigest(c.s,c.people)
  if(computed)for(const option of computed.options)option.classification=recoveryClassification(c,option,inputDigest,'compare')
  return row(c,'schedulePlans',{kind,status:'review',name:text(p.name??`${event?.type} recovery`,'plan name',200),reason:text(p.reason??'Event-driven review; explicit human approval required.','plan reason'),
    preparedBy:c.actor.id,preparedRole:c.actor.role,...window,before,after,changes,outages,extraWork,inventoryUnavailable,alternateSuppliers,overtime,materialEffects:projection.materialEffects,effects:recoveryEffects(before,after),protectionConflicts,
    ...(computed ? {recoveryOptions:computed.options,recoverySearch:computed.search} : {}),
    event:event?{type:event.type,commandId:c.commandId,at:c.now,version:c.s.version+1}:null,changedPromiseCount:0,
    inputDigest,day:c.now.slice(0,10),semantics:'Proposal only. Customer dates, purchases, stock and execution remain unchanged. No automatic sequencing or outbound effects.'})
}

export function recovery(c:Context,type:string,p:any):Row|undefined {
  if(['schedule.scenario','schedule.adopt','schedule.reject'].includes(type))refuseRecoveryFacts(p)
  if(type.startsWith('schedule.grant.'))return scheduleGrant(c,type,p)
  if(type==='schedule.protect') {
    allow(c,['manager','planner'])
    const window=currentWindow(c,p),freezeUntil=instant(p.freezeUntil,'freeze until')
    if(freezeUntil<window.asOf||Date.parse(freezeUntil)>Date.parse(window.asOf)+window.days*86400000)fail('INPUT','The frozen fence must be inside the planning window.')
    if(p.automatic!==undefined&&p.automatic!==false)fail('POLICY','Use a separately prepared and independently approved bounded grant; this flag cannot enable automation.')
    const before=recoveryProjection(c.s,c.people,window.asOf,window.days,false).plan
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
  // A deputy may stand in for a manager, production or planner principal when adopting (GOV-002).
  if(type==='schedule.adopt')authorize(c,['manager','production','planner'],'schedule',plan.preparedBy)
  else approver(c,['manager','production','planner'],plan.preparedBy)
  if(plan.status!=='review')fail('STATE','This plan was already decided.')
  if(['promises','spend','automatic'].some(k=>p[k]!==undefined))fail('AUTHORITY','Customer dates and spending require their separate recorded authority.')
  const note=text(p.reason,'decision reason')
  const option=p.optionId===undefined?undefined:plan.recoveryOptions?.find((o:any)=>o.id===p.optionId)
  if(p.optionId!==undefined&&!option)fail('INPUT','Choose an exact retained recovery option.')
  if(type==='schedule.reject') {
    const options=option?[option]:plan.recoveryOptions??[]
    const current=planningDigest(c.s,c.people)
    if(options.length&&plan.inputDigest!==current)fail('STALE','Planning inputs changed. Prepare a fresh comparison.')
    const classifications=options.map((o:any)=>{
      if(canonicalJson(recoveryClassification(c,o,current,'compare'))!==canonicalJson(o.classification??null))fail('STALE','Recovery facts changed. Prepare a fresh comparison.')
      return recoveryClassification(c,o,current,'reject')
    })
    const classification=option?classifications[0]:classifications.length?{action:'reject',classes:['standard'],effect:'informational',inputDigest:current,options:classifications}:undefined
    return bump(plan,{status:'rejected',decidedBy:c.actor.id,decidedAt:c.now,note,...(classification?{decisionClassification:classification,personDecision:{actorId:c.actor.id,role:c.actor.role,commandId:c.commandId,at:c.now}}:{})})
  }
  const reviewed=option?{...plan,after:option.after,changes:option.changes,effects:option.effects,protectionConflicts:option.protectionConflicts}:plan
  const problem=adoptionProblem(c,reviewed)
  if(problem)fail(problem.code,problem.message)
  let classification
  if(option) {
    const comparison=recoveryClassification(c,option,planningDigest(c.s,c.people),'compare')
    if(canonicalJson(comparison)!==canonicalJson(option.classification??null))fail('STALE','Recovery facts changed. Prepare a fresh comparison.')
    classification=recoveryClassification(c,option,comparison.inputDigest,'adopt')
  }
  // GOV-009: a plan whose largest per-job delay is at or above the schedule threshold needs the policy signatures on its exact changes.
  const signed=gate(c,{category:'schedule',subjectKind:'schedulePlans',subject:plan,measure:()=>largestJobDelay(reviewed.effects),permitted:['manager','production','planner'],preparedBy:plan.preparedBy,...(option?{terms:{optionId:option.id,optionDigest:recoveryOptionDigest(option),classification}}:{}),p})
  if(signed&&'pending' in signed)return signed.pending
  signed?.consume(plan.id)
  if(option)Object.assign(plan,{after:option.after,changes:option.changes,effects:option.effects,protectionConflicts:option.protectionConflicts,selectedOptionId:option.id,promiseEffects:option.promiseEffects,decisionClassification:classification,personDecision:{actorId:c.actor.id,role:c.actor.role,commandId:c.commandId,at:c.now}})
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
  const booked=bookIntervals(c,plan,note,c.actor.id)
  return signed?bump(booked,{signatureIds:signed.signatureIds,override:signed.override}):booked
}

const events=['maintenance.create','maintenance.update','maintenance.release','wo.operation.pause','wo.operation.resume','wo.operation.progress','wo.operation.complete','po.revise','po.confirm','order.rank','work.expected']
export function observeRecovery(c:Context,before:State,type:string,payload:any) {
  if(type==='schedule.adopt'||(type==='proposal.approve'&&c.s.proposals.find(p=>p.id===payload.proposalId)?.kind==='reschedule'))return
  if((!events.includes(type)&&!recoveryInputsChanged(before,c.s))||!policy(c.s)||c.s.schedulePlans.some(p=>p.event?.commandId===c.commandId))return
  const plan=scenario(c,{name:`${type} recovery`,reason:'Recorded event; preserve frozen/manual intervals and review displacement.'},'reflow',{type,before,payload})
  if(!events.includes(type)){plan.automation={status:'review',reason:'Changed demand, stock or capacity requires a new exact human review.'};return}
  const grants=c.s.scheduleGrants.filter(g=>g.status==='active')
  const grant=grants.at(-1)
  if(!grant){plan.automation={status:'review',reason:'No active automatic booking grant.'};return}
  const alternateChange=plan.after.operations.some((op:any)=>{
    const previous=plan.before.operations.find((old:any)=>old.key===op.key)
    const work=c.s.workOrders.find(w=>w.id===op.workOrderId)
    const original=previous?.machine??work?.scheduleChoices?.[op.sequence]??work?.routing?.find((step:any)=>step.sequence===op.sequence)?.workCentre
    return original&&original!==op.machine
  })
  const refusal=adoptionProblem(c,plan)?.message??(alternateChange?'Alternate-machine changes require exact human approval.':grantRefusal(c,grant,plan))
  if(refusal){
    plan.automation={status:'review',grantId:grant.id,grantVersion:grant.version,reason:refusal}
    if(grantLapsed(c,grant))suspendGrant(c,grant,refusal)
    return
  }
  plan.automation={status:'applied',grantId:grant.id,grantVersion:grant.version}
  bookIntervals(c,plan,'Bounded internal event booking under independently approved grant.',grant.approvedBy,{grantId:grant.id,grantVersion:grant.version})
}
