// Durable event proposals and isolated schedule scenarios. No observer may
// approve work, change a customer date, buy, or perform an external action.
import { canonicalJson, sha256 } from '../../modules/import-kit/src/d1/index'
import { collections, bump, fresh, get, list, row, text, type Context, type State, type Row } from '../model'
import { allow } from '../roles'
import { fail } from '../problem'
import { finitePlan } from './finite'
import { instant, integer } from './calendars'
import { capacityPreview } from './reschedule'

export function planningDigest(s: State, people: Context['people']) {
  return sha256(canonicalJson({ records: Object.fromEntries(collections.filter(k => k !== 'schedulePlans').map(k => [k,s[k]])),
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
  let changes:any[]=[]
  if(p.changes?.length) {
    changes=capacityPreview({...c,s:clone},{changes:p.changes,capacity:{asOf:window.asOf,days:window.days}}).changes
    for(const ch of changes)Object.assign(get(clone,'workOrders',ch.workOrderId),ch)
  }
  const after=finitePlan(clone,c.people??[],window.asOf,window.days,{releaseBookings:true})
  const protections=policy(c.s)?.protectedOperations ?? []
  const protectionConflicts=protections.filter((old:any)=>{
    const next=after.operations.find((o:any)=>o.key===old.key)
    return !next||canonicalJson(next.intervals)!==canonicalJson(old.intervals)||next.machineId!==old.machineId||next.operatorId!==old.operatorId
  }).map((o:any)=>o.key)
  return row(c,'schedulePlans',{kind,status:'review',name:text(p.name??`${event?.type} recovery`,'plan name',200),reason:text(p.reason??'Event-driven review; explicit human approval required.','plan reason'),
    preparedBy:c.actor.id,preparedRole:c.actor.role,...window,before,after,changes,outages,effects:consequences(before,after),protectionConflicts,
    event:event?{type:event.type,commandId:c.commandId,at:c.now,version:c.s.version+1}:null,changedPromiseCount:0,
    inputDigest:planningDigest(c.s,c.people),day:c.now.slice(0,10),semantics:'Proposal only. Customer dates, purchases, stock and execution remain unchanged. No automatic sequencing or outbound effects.'})
}

export function recovery(c:Context,type:string,p:any):Row|undefined {
  if(type==='schedule.protect') {
    allow(c,['manager'])
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
  // Conservative new-policy default: only owner/manager and an explicit audit
  // reason; no automatic internal changes. Existing planner preparation remains.
  allow(c,['manager'])
  const plan=get(c.s,'schedulePlans',p.planId);fresh(plan,p.version)
  if(plan.status!=='review')fail('STATE','This plan was already decided.')
  if(['promises','spend','automatic'].some(k=>p[k]!==undefined))fail('AUTHORITY','Customer dates and spending require their separate recorded authority.')
  const note=text(p.reason,'decision reason')
  if(type==='schedule.reject')return bump(plan,{status:'rejected',decidedBy:c.actor.id,decidedAt:c.now,note})
  if(plan.inputDigest!==planningDigest(c.s,c.people)||plan.day!==c.now.slice(0,10)||Date.parse(plan.after.startsAt)<Date.parse(c.now))fail('STALE','Planning inputs, live people or planning window changed. Prepare a fresh scenario.')
  if(plan.after.unscheduled.length||plan.after.protectionConflicts?.length||plan.protectionConflicts.length)fail('CAPACITY','An infeasible or protected operation prevents adoption; nothing was booked.')
  // An outage is hypothetical: adoption books around it, never clears a real
  // hold or edits the underlying maintenance/calendar record.
  for(const ch of plan.changes)bump(get(c.s,'workOrders',ch.workOrderId),ch)
  for(const old of c.s.scheduleBookings.filter(b=>b.status==='active'))bump(old,{status:'superseded',supersededBy:plan.id})
  const booking=row(c,'scheduleBookings',{status:'active',planId:plan.id,asOf:plan.asOf,days:plan.days,operations:plan.after.operations,approvedBy:c.actor.id,approvedAt:c.now,reason:note})
  return bump(plan,{status:'adopted',bookingId:booking.id,decidedBy:c.actor.id,decidedAt:c.now,note})
}

const events=['maintenance.create','maintenance.update','maintenance.release','wo.operation.pause','wo.operation.resume','wo.operation.progress','wo.operation.complete','po.revise','po.confirm','order.rank','work.expected']
export function observeRecovery(c:Context,before:State,type:string) {
  if(!events.includes(type)||!policy(c.s)||c.s.schedulePlans.some(p=>p.event?.commandId===c.commandId))return
  scenario(c,{name:`${type} recovery`,reason:'Recorded event; preserve frozen/manual intervals and review displacement.'},'reflow',{type,before})
}
