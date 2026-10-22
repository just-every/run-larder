import { can, rows } from '../api'
import type { Larder } from '../app'
import { Area, Card, Choose, Field, Form, Table, text } from '../controls'

export function ScheduleRecovery({larder,plan}:{larder:Larder;plan:any}) {
  const s=larder.state!, policy=rows(s,'schedulePolicies')[0], plans=[...rows(s,'schedulePlans')].reverse()
  const managers=can(s,['manager']), preparers=can(s,['manager','planner','agent'])
  return <>
    <Card title="Frozen work and manual locks">
      <p>Frozen and manually locked intervals keep their named machine and person. An outage on a protected interval stays an explicit conflict. Automatic sequencing is disabled; every internal adoption needs an owner or manager and a recorded reason. Customer promises and spending keep their separate approvals.</p>
      {policy&&<p>Frozen through {policy.freezeUntil}; {policy.manualLocks.length} manual locks; {policy.protectedOperations.length} protected operations. {policy.reason}</p>}
      {managers&&<Form submit="Save schedule protections" busy={larder.busy} onSubmit={d=>larder.run('schedule.protect',{...(policy?{version:policy.version}:{}),asOf:plan.asOf,days:plan.horizonDays,freezeUntil:new Date(text(d,'fence')).toISOString(),manualLocks:text(d,'lock')?[{workOrderId:text(d,'lock').split(':')[0],sequence:Number(text(d,'lock').split(':')[1])}]:[],automatic:false,reason:text(d,'reason')})}>
        <Field label="Freeze schedule through (local time)" name="fence" type="datetime-local" /><Choose label="Manual operation lock" name="lock" required={false} options={plan.operations.map((o:any)=>({value:o.key,label:`${o.reference} · ${o.name} · ${o.machine}`}))}/><Area label="Protection reason" name="reason" />
      </Form>}
    </Card>
    <Card title="Planning scenarios and event recovery">
      <p>Compare isolated outages against the current plan. Preparation books nothing. Adoption rechecks the entire business input and live people, then books all reviewed intervals in one transaction. Material feasibility is still subject to the material projection and execution gates. Demand, inventory, supplier and overtime scenario adoption remain unavailable.</p>
      {preparers&&<Form submit="Compare outage scenario" busy={larder.busy} onSubmit={d=>larder.run('schedule.scenario',{asOf:plan.asOf,days:plan.horizonDays,name:text(d,'name'),reason:text(d,'reason'),outages:text(d,'machine')?[{machineId:text(d,'machine'),startsAt:new Date(text(d,'start')).toISOString(),endsAt:new Date(text(d,'end')).toISOString()}]:undefined})}>
        <Field label="Scenario name" name="name"/><Choose label="Scenario unavailable machine" name="machine" required={false} options={rows(s,'machineCalendars').map(m=>({value:m.id,label:m.name}))}/><Field label="Scenario outage starts (local time)" name="start" type="datetime-local" required={false}/><Field label="Scenario outage ends (local time)" name="end" type="datetime-local" required={false}/><Area label="Scenario reason" name="reason" />
      </Form>}
      {plans.length===0?<p>No scenario or event proposal yet. After protections are saved, progress, material ETA, machine breakdown and priority events record a durable reflow proposal.</p>:plans.map(p=><details key={p.id} open={p.status==='review'} aria-label={`Schedule review ${p.name}`}><summary>{p.name} · {p.kind} · {p.status}</summary>
        <p>{p.reason} · Changed customer promises: {p.changedPromiseCount}. Frozen/manual conflicts: {p.protectionConflicts.length}. Unscheduled operations: {p.after.unscheduled.length}.</p>
        {p.event&&<p>Event: {p.event.type} at {p.event.at}; one durable proposal per recorded event.</p>}
        <Table head={['Displaced job','Before finish','After finish','Risk']}>{p.effects.map((e:any)=><tr key={e.workOrderId}><td>{e.reference}</td><td>{e.before??'Unscheduled'}</td><td>{e.after??'Unscheduled'}</td><td>{e.unscheduled?'Unscheduled':e.lateAfter?'Late':'On time'}</td></tr>)}</Table>
        {p.after.unscheduled.map((u:any,i:number)=><p key={i}>{u.reference}: {u.reason}</p>)}
        {p.status==='review'&&managers&&<Form submit={`Adopt ${p.name}`} busy={larder.busy} onSubmit={d=>larder.run('schedule.adopt',{planId:p.id,version:p.version,reason:text(d,'reason')})}><Area label={`Decision reason for ${p.name}`} name="reason" /></Form>}
        {p.status==='adopted'&&<p>{p.after.operations.length} named resource bookings retained. Customer dates, spend and stock unchanged.</p>}
      </details>)}
    </Card>
  </>
}
