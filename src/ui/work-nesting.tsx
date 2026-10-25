import type { Larder } from './app'
import { byId, can, itemName, locationName, rows, type Rec } from './api'
import { Card, Choose, Field, Form, Table, text } from './controls'
import { day, money, qty, words } from './format'

export function WorkNesting({ larder, w }: { larder: Larder; w: Rec }) {
  const s = larder.state!
  if (!can(s, ['manager', 'planner', 'agent'])) return null
  const pending = (job: Rec) => job.status === 'released' && Number(job.output) === 0 && Number(job.scrap) === 0 && job.components.every((c: Rec) => Number(c.issued) === 0) && job.operationStates?.every((o: Rec) => o.status === 'pending')
  const others = rows(s, 'workOrders').filter(job => job.id !== w.id && pending(job))
  const groups = rows(s, 'workGroups').filter(g => g.members.some((m: Rec) => m.workOrderId === w.id))
  return <Card title="Grouped nesting">
    <p>Keep each original job, customer, revision and due date. Setup shares describe the imported result; they do not combine or change finite bookings.</p>
    {pending(w) && others.length > 0 && <Form title="Group pending operations" submit="Prepare nesting group" busy={larder.busy} onSubmit={d => larder.run('nest.prepare', {
      materialItemId: text(d, 'material'), reason: text(d, 'reason'),
      members: [w, ...others.filter(job => d.has(`include.${job.id}`))].map(job => ({ workOrderId: job.id, version: job.version, sequence: Number(text(d, `sequence.${job.id}`)) })),
    })}>
      <Choose label="Group material" name="material" options={w.components.map((c: Rec) => ({ value: c.itemId, label: itemName(s, c.itemId) }))} />
      {[w, ...others].map(job => <fieldset className="lines wide" key={job.id}><legend>{job.reference}</legend>
        {job.id !== w.id && <label><input type="checkbox" name={`include.${job.id}`} /> Include {job.reference}</label>}
        <p>{itemName(s, job.itemId)} · revision {job.bomRevision} · due {day(job.requiredBy)} · {job.reason}</p>
        <Choose label={`Operation for ${job.reference}`} name={`sequence.${job.id}`} required={job.id === w.id} options={job.routing.map((r: Rec) => ({ value: String(r.sequence), label: `${r.sequence}: ${r.name} · ${r.workCentre}` }))} defaultValue={String(job.routing[0]?.sequence ?? '')} />
      </fieldset>)}
      <Field label="Grouping reason" name="reason" />
    </Form>}
    {groups.map(g => <section key={g.id} aria-label={`Nesting ${g.reference}`}>
      <h3>{g.reference} · {words(g.status)}</h3><p>{g.reason}</p>
      <Table head={['Original job', 'Revision', 'Due', 'Demand']} >{g.members.map((m: Rec) => <tr key={m.workOrderId}><td><a href={`#make/wo/${m.workOrderId}`}>{m.reference}</a></td><td>{m.bomRevision}</td><td>{day(m.requiredBy)}</td><td>{m.reason}{m.demandSources?.map((d: Rec, i: number) => <p key={i}>{d.reference} · {qty(d.quantity)}</p>)}</td></tr>)}</Table>
      {g.status === 'draft' && <Form submit="Import nesting result" busy={larder.busy} note="Choose the documented Larder nesting JSON file. Import reviews allocations without posting stock or booking setup." onSubmit={async d => { const file = d.get('result') as File; return larder.run('nest.import', { groupId: g.id, version: g.version, file: { name: file.name, content: await file.text() } }) }}>
        <Field label="Nesting result file" name="result" type="file" accept=".json" />
      </Form>}
      {g.review && <>
        <p>Original file: <a href={`/api/larder/attachments/${g.original.id}`}>{g.original.name}</a></p>
        <p>Source: {itemName(s, g.review.source.itemId)} · {byId(s, 'lots', g.review.source.lotId)?.code} · {locationName(s, g.review.source.locationId)} · {qty(g.review.source.quantity)} · {money(g.review.source.materialCost)}</p>
        <p>Material yield {qty(g.review.materialYield)} · scrap {qty(g.review.scrapQuantity)} · recoverable offcut {qty(g.review.offcut.quantity)} ({money(g.review.offcut.materialCost)})</p>
        <p>Recorded setup: {qty(g.review.sharedSetupMinutes)} minutes; separate-job baseline {qty(g.review.baselineSetupMinutes)} minutes. Finite bookings remain unchanged.</p>
        <Table head={['Job', 'Output', 'Material', 'Material cost', 'Setup minutes']} numeric={[1, 2, 3, 4]}>{g.review.jobs.map((j: Rec) => <tr key={j.workOrderId}><td>{j.reference}</td><td>{qty(j.quantity)}</td><td>{qty(j.materialQuantity)}</td><td>{money(j.materialCost)}</td><td>{qty(j.setupMinutes)}</td></tr>)}</Table>
        {g.status === 'review' && <>
          <p>The owner approves this exact physical nest. A changed nest or changed business inputs require a fresh group, import and approval. Original output and quality gates still apply.</p>
          {s.actor.role === 'owner' && <Form submit="Approve exact nesting" busy={larder.busy} onSubmit={d => larder.run('nest.approve', { groupId: g.id, version: g.version, reason: text(d, 'reason') })}><Field label="Nesting approval reason" name="reason" /></Form>}
        </>}
        {g.status === 'posted' && <p>Physical nest approved · {g.approvalReason}. Material issued to original jobs; output remains on each job.</p>}
      </>}
      {['draft', 'review'].includes(g.status) && (s.actor.role === 'owner' || s.actor.id === g.preparedBy) && <Form submit="Cancel nesting review" busy={larder.busy} quiet onSubmit={d => larder.run('nest.cancel', { groupId: g.id, version: g.version, reason: text(d, 'reason') })}><Field label="Nesting cancellation reason" name="reason" /></Form>}
    </section>)}
  </Card>
}
