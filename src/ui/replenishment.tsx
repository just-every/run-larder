import { can, itemName, partyName, rows } from './api'
import type { Larder } from './app'
import { Area, Card, Choose, Field, Form, Table, text } from './controls'

export function Replenishment({larder}:{larder:Larder}) {
  const s=larder.state!, latest=[...rows(s,'replenishmentPlans')].reverse().find(p=>p.status==='review'), approved=[...rows(s,'replenishmentPlans')].reverse().find(p=>p.status==='approved')
  return <Card title="Replenishment forecast review">
    <p>Compare dated shortages using supplier calendars, packs, MOQ, price breaks and conservative lead-time bounds. Confidence is your recorded forecast assumption; coverage is dated quantity, never a service probability. <a href="#make/policies">Review safety stock and inventory policies</a>. <a href="#make/po">Revise supplier constraints</a>.</p>
    {can(s,['manager','planner','buyer','agent'])&&<Form submit="Run replenishment" busy={larder.busy} onSubmit={d=>larder.run('replenishment.preview',{horizonDays:Number(text(d,'horizon')),historyDays:Number(text(d,'history')),confidence:Number(text(d,'confidence')),confidenceBasis:text(d,'basis'),reason:text(d,'reason')})}>
      <Field label="Replenishment horizon days" name="horizon" type="number" min="1" max="365" defaultValue="60"/><Field label="Demand history days" name="history" type="number" min="1" max="365" defaultValue="90"/><Field label="Planner forecast confidence percent" name="confidence" type="number" min="0" max="100"/><Area label="Forecast confidence basis" name="basis"/><Area label="Replenishment reason" name="reason"/>
    </Form>}
    {latest&&<section aria-label="Replenishment comparison"><h3>{latest.reason}</h3><p>{latest.confidence}% planner confidence · {latest.confidenceBasis}. History since {latest.since}; planning through {latest.until}.</p>
      {!latest.rows.length?<p>No uncovered dated purchase demand in this window.</p>:<Form submit="Approve selected replenishment" busy={larder.busy||!can(s,['manager','buyer'])} onSubmit={d=>larder.run('replenishment.approve',{planId:latest.id,version:latest.version,decisions:latest.rows.map((r:any)=>({itemId:r.itemId,partyItemId:text(d,r.itemId+'.supplier')||null,reason:text(d,r.itemId+'.reason')}))})}>
        {latest.rows.map((r:any)=><fieldset className="wide lines" key={r.itemId}><legend>{itemName(s,r.itemId)}</legend><p>{r.shortage} uncovered base units; earliest need {r.requiredBy}. {r.safetyRequirements.length} safety-stock requirements, counted once. {r.history.length} shipment history lines; {r.forecasts.length} forecast buckets.</p>
          <details><summary>Demand history, forecasts and dated sources</summary>{r.history.map((h:any,i:number)=><p key={i}>{h.reference} · {h.on} · {h.quantity} shipped</p>)}{r.forecasts.map((f:any)=><p key={f.id}>Week {f.week}: {f.quantity} · seasonality {f.seasonality} · override {f.overrideQuantity??'none'}</p>)}{r.requirements.map((q:any)=><p key={q.key}>{q.reference} · {q.shortage} units by {q.requiredBy} · {q.kind}</p>)}</details>
          <Table head={['Supplier','Rounded quantity and terms','Arrival / coverage','USD cash']}>
            {r.quotes.map((q:any)=><tr key={q.partyItemId}><td>{partyName(s,q.supplierId)}</td><td>{q.quantity} · MOQ {q.terms.moq} · pack {q.terms.packQuantity} · {q.currency} {q.price} per unit</td><td>{q.earliestDate} – {q.latestDate} · {q.covered} covered / {q.atRisk} at risk · {q.surplus} surplus · {q.robustFeasible?'Within conservative bound':'Too late at uncertain bound'}</td><td>{q.exposure} USD · rate {q.terms.usdRate} · {q.terms.rateSource}</td></tr>)}
          </Table><Choose label={`Approve supplier for ${itemName(s,r.itemId)}`} name={r.itemId+'.supplier'} required={false} options={r.quotes.filter((q:any)=>q.robustFeasible).map((q:any)=>({value:q.partyItemId,label:partyName(s,q.supplierId)+' · '+q.exposure+' USD'}))}/><Area label={`Selection or rejection reason for ${itemName(s,r.itemId)}`} name={r.itemId+'.reason'} />
          <p>Leave supplier blank to reject this suggestion. A reason is retained for every choice. A different buyer/manager approves, except the owner; agents never approve.</p>
        </fieldset>)}
      </Form>}
    </section>}
    {approved&&<details open><summary>Approved replenishment decisions</summary><p>{approved.approvedCashExposure} USD approved; {approved.documents.length} purchase orders. Nothing was sent to a supplier.</p>{approved.decisions.map((d:any)=><p key={d.itemId}>{itemName(s,d.itemId)} · {d.decision} · {d.reason}</p>)}</details>}
  </Card>
}
