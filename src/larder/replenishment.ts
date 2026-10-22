// Deterministic, dated replenishment. Confidence is a recorded planning
// assumption, not a calibrated probability or an automatic inventory policy.
import { materialDates } from './material-dates'
import { supplierQuote } from './supplier-terms'
import { planningDigest } from './scheduling/recovery'
import { integer } from './scheduling/calendars'
import { decimal, format, max } from './decimal'
import { allow, approver } from './roles'
import { bump, fresh, get, list, row, text, type Context, type Row } from './model'
import { fail } from './problem'
import { draftPurchase, purchasing } from './purchasing'

export function replenishment(c:Context,type:string,p:any):Row|undefined {
  if(type==='replenishment.preview') {
    allow(c,['manager','planner','buyer','agent'])
    const horizonDays=integer(p.horizonDays??60,'replenishment horizon',1,365), historyDays=integer(p.historyDays??90,'demand history days',1,365)
    const confidence=integer(p.confidence,'planner forecast confidence percent',0,100), confidenceBasis=text(p.confidenceBasis,'forecast confidence basis',1000)
    const asOf=c.now.slice(0,10), until=new Date(Date.parse(asOf+'T00:00Z')+horizonDays*86400000).toISOString().slice(0,10)
    const since=new Date(Date.parse(asOf+'T00:00Z')-historyDays*86400000).toISOString().slice(0,10), dated=materialDates(c.s)
    const itemIds=p.itemIds===undefined?c.s.items.filter(i=>!i.archived).map(i=>i.id):list<string>(p.itemIds,'replenishment items',100).map(id=>get(c.s,'items',id).id)
    if(new Set(itemIds).size!==itemIds.length)fail('INPUT','Choose each item once.')
    const rows=itemIds.flatMap(itemId=>{
      const requirements=dated.requirements.filter(r=>r.itemId===itemId&&r.supply==='buy'&&r.requiredBy<=until&&decimal(r.shortage)>0n)
      const shortage=requirements.reduce((n,r)=>n+decimal(r.shortage),0n)
      if(!shortage)return []
      const requiredBy=requirements.map(r=>r.requiredBy).sort()[0]!
      const quotes=c.s.partyItems.filter(r=>r.itemId===itemId&&r.supplierTerms&&c.s.parties.some(s=>s.id===r.partyId&&s.kind!=='customer')).map(ref=>{
        const q=supplierQuote(ref,format(shortage),requiredBy,asOf)
        const upper=ref.supplierTerms.leadDaysMax??ref.supplierTerms.leadDays
        const worst=supplierQuote({...ref,supplierTerms:{...ref.supplierTerms,leadDays:upper}},format(shortage),requiredBy,asOf)
        // All requirements are dated; coverage counts only requirements whose
        // dates follow the supplier's conservative/latest calendar arrival.
        const atRisk=requirements.filter(r=>r.requiredBy<worst.earliestDate).reduce((n,r)=>n+decimal(r.shortage),0n)
        return {...q,latestDate:worst.earliestDate,leadDaysMax:upper,robustFeasible:worst.feasible,covered:format(shortage-atRisk),atRisk:format(atRisk),surplus:format(max(0n,decimal(q.quantity)-shortage)),coverageBasis:'Declared lead-time bounds, not a service probability. Shared dated shortages are counted once; no stock reservation or supplier acceptance.'}
      })
      const history=c.s.shipments.filter(s=>s.status==='shipped'&&s.shippedAt?.slice(0,10)>=since).flatMap(s=>s.lines.filter((l:any)=>l.itemId===itemId).map((l:any)=>{
        const shipped=c.s.movements.filter(m=>m.documentKind==='shipments'&&m.documentId===s.id&&m.itemId===itemId&&m.quantity<0n&&!m.reversesId).reduce((n,m)=>n-m.quantity,0n)
        return {shipmentId:s.id,reference:s.reference,on:s.shippedAt.slice(0,10),quantity:l.quantity,ledgerShippedQuantity:format(shipped)}
      }))
      return [{itemId,shortage:format(shortage),requiredBy,requirements,history,forecasts:c.s.forecasts.filter(f=>f.itemId===itemId),safetyRequirements:requirements.filter(r=>r.kind==='safety'),quotes}]
    })
    return row(c,'replenishmentPlans',{status:'review',preparedBy:c.actor.id,asOf,until,horizonDays,historyDays,since,confidence,confidenceBasis,rows,reason:text(p.reason,'replenishment reason'),inputDigest:planningDigest(c.s,c.people)})
  }
  if(type!=='replenishment.approve')return
  const plan=get(c.s,'replenishmentPlans',p.planId);fresh(plan,p.version)
  approver(c,['manager','buyer'],plan.preparedBy)
  if(plan.status!=='review')fail('STATE','This replenishment review was already decided.')
  if(plan.inputDigest!==planningDigest(c.s,c.people)||plan.asOf!==c.now.slice(0,10))fail('STALE','Demand, stock, supplier terms, planning inputs or the UTC day changed. Run replenishment again.')
  const decisions=list<any>(p.decisions,'selected or rejected suggestions',100)
  if(decisions.length!==plan.rows.length||new Set(decisions.map(d=>d.itemId)).size!==decisions.length||decisions.some(d=>!plan.rows.some((r:any)=>r.itemId===d.itemId)))fail('INPUT','Decide each displayed item exactly once, with a reason.')
  const documents:any[]=[]
  const reviewed=decisions.map(d=>{
    const suggestion=plan.rows.find((r:any)=>r.itemId===d.itemId),reason=text(d.reason,'selection or rejection reason',1000)
    if(!d.partyItemId)return {itemId:d.itemId,decision:'rejected',reason}
    const q=suggestion.quotes.find((q:any)=>q.partyItemId===d.partyItemId)??fail('INPUT','Choose a displayed supplier suggestion.')
    if(!q.robustFeasible)fail('INFEASIBLE_QUOTE','The uncertain supplier lead-time bound leaves dated demand at risk. Reject it or replan; no order was approved.')
    return {itemId:d.itemId,decision:'approved',reason,quote:q}
  })
  // Validate all choices before building any document. The enclosing storage
  // batch guards both approval authority and the exact business state version.
  for(const d of reviewed)if(d.quote){
    const q=d.quote
    let po=draftPurchase(c,{supplierId:q.supplierId,requiredBy:q.requiredBy,expectedDate:q.latestDate,reason:`${plan.reason}: ${d.reason}`,lines:[{itemId:d.itemId,quantity:q.quantity,unitPrice:q.unitPrice}]},plan.preparedBy)
    po.replenishment={planId:plan.id,confidence:plan.confidence,confidenceBasis:plan.confidenceBasis,quote:q,requirements:plan.rows.find((r:any)=>r.itemId===d.itemId).requirements}
    po=purchasing(c,'po.approve',{poId:po.id,version:po.version,note:d.reason})!
    documents.push({itemId:d.itemId,poId:po.id,reference:po.reference,quantity:q.quantity,exposure:q.exposure,expectedDate:q.latestDate})
  }
  return bump(plan,{status:'approved',decisions:reviewed,documents,approvedBy:c.actor.id,approvedAt:c.now,approvedCashExposure:format(documents.reduce((n,d)=>n+decimal(d.exposure),0n))})
}
