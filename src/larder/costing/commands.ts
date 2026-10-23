import { canonicalJson, sha256 } from '../../modules/import-kit/src/d1/index'
import { decimal, format, times, min } from '../decimal'
import { fail, forbidden } from '../problem'
import { allow, approver } from '../roles'
import { attach } from '../attachments'
import { bump, fresh, get, oneOf, row, text, type Context, type Row, type State } from '../model'
import { jobCosts } from './jobs'
import { valuedRate } from './valuation'

export const costingReaders=['owner','manager','accounts']
export const costFingerprint=(s:State,w:Row)=>sha256(canonicalJson(jobCosts(s,w)))
export function costing(c:Context,type:string,p:any):Row|undefined {
  if(!type.startsWith('costing.'))return
  allow(c,['manager','accounts'])
  if(c.actor.scope?.costs)forbidden('Costs and wages are restricted.')
  const reason=text(p.reason,'costing reason',400)
  if(type==='costing.policy.prepare') {
    const data=Object.fromEntries(['standardLaborRate','machineRate','overheadRate','overtimeAfterHours','overtimeMultiplier'].map(k=>[k,format(decimal(p[k],k))]))
    if(decimal(data.overtimeAfterHours)<=0n || decimal(data.overtimeMultiplier)<decimal('1'))fail('INPUT','Overtime threshold must be positive and multiplier at least one.')
    return row(c,'costPolicies',{...data,currency:'USD',status:'draft',reason,preparedBy:c.actor.id,basis:'Six-place half-away rounding; machine and overhead per active labor hour; overtime per clock entry; equal cost per good/scrap unit; no payroll or journals.'})
  }
  if(type==='costing.policy.approve') {
    const r=get(c.s,'costPolicies',p.policyId);fresh(r,p.version);approver(c,['manager','accounts'],r.preparedBy)
    if(r.status!=='draft')fail('STATE','Approve a draft policy once.')
    return bump(r,{status:'approved',approvedBy:c.actor.id,approvedAt:c.now,approvalReason:reason})
  }
  if(type==='costing.charge.prepare') {
    const w=get(c.s,'workOrders',p.workOrderId)
    if(!['released','closed'].includes(w.status))fail('STATE','Charge released or closed work.')
    return row(c,'jobCharges',{workOrderId:w.id,amount:format(decimal(p.amount,'service charge',{positive:true})),reference:text(p.reference,'service reference',120),evidence:attach(c,p.evidence),status:'draft',reason,preparedBy:c.actor.id,currency:'USD'})
  }
  if(type==='costing.charge.approve') {
    const r=get(c.s,'jobCharges',p.chargeId);fresh(r,p.version);approver(c,['manager','accounts'],r.preparedBy)
    if(r.status!=='draft')fail('STATE','Approve a draft charge once.')
    return bump(r,{status:'approved',approvedBy:c.actor.id,approvedAt:c.now,approvalReason:reason})
  }
  if(type==='costing.link') {
    const w=get(c.s,'workOrders',p.workOrderId),o=get(c.s,'salesOrders',p.orderId),l=o.lines.find((l:any)=>l.id===p.lineId)
    if(!l || l.itemId!==w.itemId)fail('INPUT','Link matching job and sales line products.')
    const quantity=decimal(p.quantity,'allocation quantity',{positive:true}),others=c.s.costLinks
    if(others.filter(x=>x.workOrderId===w.id).reduce((n,x)=>n+decimal(x.quantity),0n)+quantity>decimal(w.quantity) || others.filter(x=>x.orderId===o.id&&x.lineId===l.id).reduce((n,x)=>n+decimal(x.quantity),0n)+quantity>decimal(l.quantity)-decimal(l.cancelled??'0'))fail('ALLOCATION','Allocations cannot exceed either job or sales line quantity.')
    return row(c,'costLinks',{workOrderId:w.id,orderId:o.id,lineId:l.id,itemId:w.itemId,quantity:format(quantity),reason})
  }
  if(type==='costing.orderCharge') {
    const o=get(c.s,'salesOrders',p.orderId),l=o.lines.find((l:any)=>l.id===p.lineId)
    if(!l)fail('INPUT','Choose a sales line.')
    const kind=oneOf(p.kind,['discount','freight-revenue','freight-cost','fee'] as const,'charge kind'),amount=decimal(p.amount,'charge amount',{positive:true})
    if(typeof p.refundable!=='boolean')fail('INPUT','Explicitly choose whether a returned unit refunds this charge.')
    return row(c,'marginCharges',{orderId:o.id,lineId:l.id,kind,amount:format(amount),refundable:p.refundable,currency:'USD',reason,evidence:attach(c,p.evidence)})
  }
  if(type==='costing.valuation.prepare') {
    const w=get(c.s,'workOrders',p.workOrderId),report=jobCosts(c.s,w)
    if(w.status!=='closed'||report.actualUnitCost===null)fail('COST_INCOMPLETE','Close the job and resolve missing cost evidence before reviewing valuation.')
    const output=c.s.movements.filter(m=>m.documentKind==='workOrders'&&m.documentId===w.id&&m.kind==='output')
    if(!output.length||output.some(m=>!m.lotId))fail('COST_TRACE','Valuation requires exact output lots; legacy unlotted output is never guessed.')
    const lines=output.map(m=>{
      const previous=valuedRate(c.s,m),rate=decimal(report.actualUnitCost!),delta=rate-previous
      const onHand=c.s.movements.filter(x=>x.itemId===m.itemId&&x.lotId===m.lotId).reduce((n,x)=>n+x.quantity,0n)
      return {movementId:m.id,itemId:m.itemId,lotId:m.lotId,quantity:format(m.quantity),previousUnitCost:format(previous),unitCost:format(rate),valueChange:format(times(m.quantity,delta)),stockValueChange:format(times(min(onHand,m.quantity),delta)),consumedValueChange:format(times(m.quantity-min(onHand,m.quantity),delta))}
    })
    return row(c,'costValuations',{workOrderId:w.id,currency:'USD',status:'draft',preparedBy:c.actor.id,stateVersion:c.s.version+1,digest:costFingerprint(c.s,w),report,lines,reason})
  }
  if(type==='costing.valuation.approve') {
    const r=get(c.s,'costValuations',p.valuationId);fresh(r,p.version);approver(c,['manager','accounts'],r.preparedBy)
    const w=get(c.s,'workOrders',r.workOrderId)
    if(r.status!=='draft')fail('STATE','Approve a draft valuation once.')
    if(c.s.version!==r.stateVersion||costFingerprint(c.s,w)!==r.digest)fail('STALE','Cost or stock evidence changed; prepare a new valuation.')
    return bump(r,{status:'approved',approvedBy:c.actor.id,approvedAt:c.now,approvalReason:reason})
  }
}
