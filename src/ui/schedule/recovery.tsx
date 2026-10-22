import { ScheduleGrants } from './grants'
import { can, rows } from '../api'
import type { Larder } from '../app'
import { Area, Card, Choose, Field, Form, Table, text } from '../controls'

export function ScheduleRecovery({larder,plan}:{larder:Larder;plan:any}) {
  const s=larder.state!, policy=rows(s,'schedulePolicies')[0], plans=[...rows(s,'schedulePlans')].reverse()
  const protectors=can(s,['manager','planner']), approvers=can(s,['manager','production','planner']), preparers=can(s,['manager','planner','agent'])
  return <>
    <Card title="Frozen work and manual locks">
      <p>Frozen and manually locked intervals keep their named machine and person. An outage on a protected interval stays an explicit conflict. Automatic sequencing needs a separately approved bounded grant; protection changes need an owner, manager or planner and a recorded reason. Adoption needs an independent schedule approver; overtime and draft work keep their own authority. Customer promises and spending keep their separate approvals.</p>
      {policy&&<p>Frozen through {policy.freezeUntil}; {policy.manualLocks.length} manual locks; {policy.protectedOperations.length} protected operations. {policy.reason}</p>}
      {protectors&&<Form submit="Save schedule protections" busy={larder.busy} onSubmit={d=>larder.run('schedule.protect',{...(policy?{version:policy.version}:{}),asOf:plan.asOf,days:plan.horizonDays,freezeUntil:new Date(text(d,'fence')).toISOString(),manualLocks:text(d,'lock')?[{workOrderId:text(d,'lock').split(':')[0],sequence:Number(text(d,'lock').split(':')[1])}]:[],automatic:false,reason:text(d,'reason')})}>
        <Field label="Freeze schedule through (local time)" name="fence" type="datetime-local" /><Choose label="Manual operation lock" name="lock" required={false} options={plan.operations.map((o:any)=>({value:o.key,label:`${o.reference} · ${o.name} · ${o.machine}`}))}/><Area label="Protection reason" name="reason" />
      </Form>}
    </Card>
    <ScheduleGrants larder={larder} plan={plan}/>
    <Card title="Planning scenarios and event recovery">
      <p>Compare isolated outages against the current plan. Preparation books nothing. Adoption rechecks the entire business input and live people, then books all reviewed intervals in one transaction. Compare additional draft demand, unavailable free inventory, alternate supplier quotes and bounded overtime. Material ETA effects use the shared allocation; uncovered inputs stay explicit. Speculative inventory or supplier assumptions need their existing physical/spend approvals before adoption; every execution gate still applies.</p>
      {preparers&&<Form submit="Compare outage scenario" busy={larder.busy} onSubmit={d=>larder.run('schedule.scenario',{asOf:plan.asOf,days:plan.horizonDays,name:text(d,'name'),reason:text(d,'reason'),outages:text(d,'machine')?[{machineId:text(d,'machine'),startsAt:new Date(text(d,'start')).toISOString(),endsAt:new Date(text(d,'end')).toISOString()}]:undefined,
        extraWork:text(d,'demandItem')?[{itemId:text(d,'demandItem'),quantity:text(d,'demandQuantity'),requiredBy:text(d,'demandDue'),plannedStart:text(d,'demandStart'),reason:text(d,'reason')}]:undefined,
        inventoryUnavailable:text(d,'inventoryItem')?[{itemId:text(d,'inventoryItem'),locationId:text(d,'inventoryBin'),quantity:text(d,'inventoryQuantity'),reason:text(d,'reason')}]:undefined,
        alternateSuppliers:text(d,'supplier')?[{partyItemId:text(d,'supplier'),quantity:text(d,'supplierQuantity'),requiredBy:text(d,'supplierDue')}]:undefined,
        overtime:text(d,'overtime')?[{kind:text(d,'overtime').split(':')[0],id:text(d,'overtime').split(':')[1],startsAt:new Date(text(d,'overtimeStart')).toISOString(),endsAt:new Date(text(d,'overtimeEnd')).toISOString(),reason:text(d,'reason')}]:undefined})}>
        <Field label="Scenario name" name="name"/><Choose label="Scenario unavailable machine" name="machine" required={false} options={rows(s,'machineCalendars').map(m=>({value:m.id,label:m.name}))}/><Field label="Scenario outage starts (local time)" name="start" type="datetime-local" required={false}/><Field label="Scenario outage ends (local time)" name="end" type="datetime-local" required={false}/><details className="wide"><summary>Additional scenario assumptions</summary><div className="form-grid">
          <Choose label="Scenario additional demand item" name="demandItem" required={false} options={rows(s,'items').filter(i=>i.kind==='make'&&!i.archived).map(i=>({value:i.id,label:i.name}))}/><Field label="Scenario additional demand quantity" name="demandQuantity" required={false}/><Field label="Scenario demand due" name="demandDue" type="date" required={false}/><Field label="Scenario demand not before" name="demandStart" type="date" required={false}/>
          <Choose label="Scenario unavailable inventory item" name="inventoryItem" required={false} options={rows(s,'items').filter(i=>!i.archived).map(i=>({value:i.id,label:i.name}))}/><Choose label="Scenario inventory bin" name="inventoryBin" required={false} options={rows(s,'locations').map(l=>({value:l.id,label:l.name}))}/><Field label="Scenario unavailable inventory quantity" name="inventoryQuantity" required={false}/>
          <Choose label="Scenario alternate supplier quote" name="supplier" required={false} options={rows(s,'partyItems').filter(r=>r.supplierTerms).map(r=>({value:r.id,label:`${rows(s,'parties').find(v=>v.id===r.partyId)?.name} · ${rows(s,'items').find(i=>i.id===r.itemId)?.name}`}))}/><Field label="Scenario supplier quantity" name="supplierQuantity" required={false}/><Field label="Scenario supplier required by" name="supplierDue" type="date" required={false}/>
          <Choose label="Scenario overtime resource" name="overtime" required={false} options={[...rows(s,'machineCalendars').map(m=>({value:'machine:'+m.id,label:'Machine · '+m.name})),...rows(s,'laborCalendars').map(l=>({value:'labor:'+l.id,label:'Labor · '+l.name}))]}/><Field label="Scenario overtime starts (local time)" name="overtimeStart" type="datetime-local" required={false}/><Field label="Scenario overtime ends (local time)" name="overtimeEnd" type="datetime-local" required={false}/>
        </div><p>Only explicit adoption creates added draft work or calendar overtime. It releases no work, pays no wages, changes no stock and sends no purchase. Speculative inventory or supplier assumptions require their existing approved doors.</p></details>
        <Area label="Scenario reason" name="reason" />
      </Form>}
      {plans.length===0?<p>No scenario or event proposal yet. After protections are saved, progress, material ETA, machine breakdown and priority events record a durable reflow proposal.</p>:plans.map(p=><details key={p.id} open={p.status==='review'} aria-label={`Schedule review ${p.name}`}><summary>{p.name} · {p.kind} · {p.status}</summary>
        <p>{p.reason} · Changed customer promises: {p.changedPromiseCount}. Frozen/manual conflicts: {p.protectionConflicts.length}. Unscheduled operations: {p.after.unscheduled.length}.</p>
        <p>Additional draft jobs: {p.extraWork?.length??0}; inventory assumptions: {p.inventoryUnavailable?.length??0}; supplier assumptions: {p.alternateSuppliers?.length??0}; bounded overtime windows: {p.overtime?.length??0}.</p>
        {p.alternateSuppliers?.map((q:any,i:number)=><p key={i}>Supplier estimate: {q.quantity} base units · {q.exposure} USD · latest {q.latestDate} · {q.robustFeasible?'within bound':'late at bound'} · speculative; no order sent.</p>)}
        {p.materialEffects?.map((m:any)=><p key={m.workOrderId}>{m.reference} · material not before {m.notBefore??'current stock / unknown'} · {m.missing.length} uncovered input lines. {m.basis}</p>)}
        {p.automation&&<p>Automatic booking: {p.automation.status==='applied'?'applied under approved grant':p.automation.reason}. {p.autoApplication&&`Grant version ${p.autoApplication.grantVersion}; accountable approver ${rows(s,'people').find(x=>x.id===p.autoApplication.approverId)?.name??p.autoApplication.approverId}.`}</p>}
        {p.event&&<p>Event: {p.event.type} at {p.event.at}; one durable proposal per recorded event.</p>}
        <Table head={['Displaced job','Before finish','After finish','Risk']}>{p.effects.map((e:any)=><tr key={e.workOrderId}><td>{e.reference}</td><td>{e.before??'Unscheduled'}</td><td>{e.after??'Unscheduled'}</td><td>{e.unscheduled?'Unscheduled':e.lateAfter?'Late':'On time'}</td></tr>)}</Table>
        {p.after.unscheduled.map((u:any,i:number)=><p key={i}>{u.reference}: {u.reason}</p>)}
        {p.status==='review'&&approvers&&(s.actor.role==='owner'||s.actor.id!==p.preparedBy)&&<Form submit={`Adopt ${p.name}`} busy={larder.busy} onSubmit={d=>larder.run('schedule.adopt',{planId:p.id,version:p.version,reason:text(d,'reason')})}><Area label={`Decision reason for ${p.name}`} name="reason" /></Form>}
        {p.status==='review'&&approvers&&s.actor.role!=='owner'&&s.actor.id===p.preparedBy&&<p>A different person must approve or decline what you prepared.</p>}
        {p.status==='review'&&approvers&&(s.actor.role==='owner'||s.actor.id!==p.preparedBy)&&<Form submit={`Decline ${p.name}`} busy={larder.busy} onSubmit={d=>larder.run('schedule.reject',{planId:p.id,version:p.version,reason:text(d,'reason')})}><Area label={`Decline reason for ${p.name}`} name="reason" /></Form>}
        {p.status==='adopted'&&<p>{p.after.operations.length} named resource bookings retained. Customer dates, spend and stock unchanged.</p>}
      </details>)}
    </Card>
  </>
}
