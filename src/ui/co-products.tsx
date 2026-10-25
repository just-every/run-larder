import { InspectForm, InspectionResults, HoldRelease } from './quality'
import { useState } from 'react'
import type { Larder } from './app'
import { can, rows, itemName, locationName, byId, type Rec } from './api'
import { Card, Choose, Field, Area, Form, Table, Details, options, text, fileBase64 } from './controls'

export function CoProducts({ larder, w }: { larder: Larder; w: Rec }) {
  const s = larder.state!, [count, setCount] = useState(w.coProductPlan?.outputs.length ?? 3), owner = s.actor.role === 'owner'
  const prepare = can(s, ['manager', 'accounts']) && !(s.actor as any).scope?.costs
  if (!prepare && !w.coProductPlan) return null
  const plan = w.coProductPlan, reviews = w.coProductReviews ?? [], latest = reviews.at(-1)
  return <Card title="Co-products and by-products">
    <p>Each output keeps its own lot, destination and exact component consumption. The owner approves the allocation for this batch. Posting places every output in quarantine.</p>
    {w.status === 'draft' && prepare && <Form submit="Save output plan" busy={larder.busy} onSubmit={d => larder.run('batch.plan', { workOrderId: w.id, version: w.version, reason: text(d, 'reason'), outputs: Array.from({ length: count }, (_, i) => ({ itemId: text(d, `item.${i}`), locationId: text(d, `location.${i}`), kind: text(d, `kind.${i}`), quantity: text(d, `quantity.${i}`), lot: text(d, `lot.${i}`) })) })}>
      {Array.from({ length: count }, (_, i) => <fieldset key={i} className="lines wide"><legend>Output {i + 1}</legend><div className="form-grid">
        <Choose label={`Output ${i + 1} item`} name={`item.${i}`} defaultValue={plan?.outputs[i]?.itemId ?? (i === 0 ? w.itemId : '')} options={options(rows(s, 'items').filter(i => !i.archived), i => i.name)} />
        <Choose label={`Output ${i + 1} kind`} name={`kind.${i}`} defaultValue={plan?.outputs[i]?.kind ?? (i < 2 ? 'co-product' : 'by-product')} options={['co-product', 'by-product', 'recoverable-scrap'].map(value => ({ value, label: value }))} />
        <Field label={`Output ${i + 1} planned quantity`} name={`quantity.${i}`} defaultValue={plan?.outputs[i]?.quantity ?? (i === 0 ? w.quantity : '')} inputMode="decimal" />
        <Field label={`Output ${i + 1} lot`} name={`lot.${i}`} defaultValue={plan?.outputs[i]?.lot} />
        <Choose label={`Output ${i + 1} destination`} name={`location.${i}`} defaultValue={plan?.outputs[i]?.locationId} options={options(rows(s, 'locations'), l => l.name)} />
      </div></fieldset>)}
      <button type="button" className="button" onClick={() => setCount(count + 1)} disabled={count >= 20}>Add output</button><Field label="Output plan reason" name="reason" />
    </Form>}
    {plan && <Table head={['Output', 'Planned quantity', 'Lot', 'Destination']}>
      {plan.outputs.map((x: Rec) => <tr key={x.itemId}><td>{itemName(s, x.itemId)}<small>{x.kind}</small></td><td>{x.quantity}</td><td>{x.lot}</td><td>{locationName(s, x.locationId)}</td></tr>)}
    </Table>}
    {plan && w.status === 'released' && prepare && <Form submit="Review batch allocation" busy={larder.busy} onSubmit={d => larder.run('batch.review', { workOrderId: w.id, version: w.version, reason: text(d, 'reason'), policy: text(d, 'policy'), outputs: plan.outputs.map((x: Rec, i: number) => ({ itemId: x.itemId, quantity: text(d, `actual.${i}`), value: text(d, `value.${i}`), allocations: (s.workMaterialPools?.[w.id] ?? []).filter((a: Rec) => text(d, `input.${i}.${a.movementId}`)).map((a: Rec) => ({ movementId: a.movementId, quantity: text(d, `input.${i}.${a.movementId}`) })) })) })}>
      {plan.outputs.map((x: Rec, i: number) => <fieldset className="lines wide" key={x.itemId}><legend>{itemName(s, x.itemId)}</legend><div className="form-grid">
        <Field label={`Output ${i + 1} actual quantity`} name={`actual.${i}`} defaultValue={x.quantity} inputMode="decimal" /><Field label={`Output ${i + 1} allocated USD value`} name={`value.${i}`} inputMode="decimal" />
        {(s.workMaterialPools?.[w.id] ?? []).map((a: Rec) => <Field key={a.movementId} label={`Output ${i + 1} input ${byId(s, 'lots', a.lotId)?.code ?? itemName(s, a.itemId)}`} name={`input.${i}.${a.movementId}`} required={false} inputMode="decimal" hint={`Unallocated ${a.quantity}; enter actual consumption`} />)}
      </div></fieldset>)}<Area label="Batch allocation policy" name="policy" /><Field label="Allocation review reason" name="reason" />
    </Form>}
    {latest && <section aria-label="Exact batch review"><h3>Exact batch review</h3><p>Actual cost USD {latest.actualCost} · {latest.status}</p><p>{latest.policy}</p><Table head={['Output', 'Actual quantity', 'Allocated USD', 'Unit cost']}>
      {latest.outputs.map((x: Rec) => <tr key={x.itemId}><td>{itemName(s, x.itemId)}<small>{x.lot}</small></td><td>{x.quantity}</td><td>{x.value}</td><td>{x.unitCost}</td></tr>)}
    </Table>{latest.outputs.map((x: Rec) => <p key={x.itemId}>{itemName(s, x.itemId)} consumes {x.allocations.map((a: Rec) => `${a.quantity} ${itemName(s, a.itemId)} from ${byId(s, 'lots', a.lotId)?.code ?? 'unlotted issue'}`).join('; ')}</p>)}<Details label="Exact input lots and cost sources" value={latest} s={s} />
      {owner && latest.status === 'review' && <Form submit="Approve and post exact batch" busy={larder.busy} onSubmit={d => larder.run('batch.post', { workOrderId: w.id, version: w.version, reviewId: latest.id, reason: text(d, 'reason') })}><Field label="Batch approval reason" name="reason" /></Form>}
    </section>}
    {w.coProductPosted && (w.outputs ?? []).map((x: Rec) => { const lot = byId(s, 'lots', x.lotId); return <section key={x.id} aria-label={`Batch lot ${lot?.code}`}><h3>{lot?.code} · {lot?.status}</h3><p>{itemName(s, x.itemId)} · {x.good} · {locationName(s, x.locationId)}</p><a href="#stock">Inspect lot links</a>
      {lot && can(s, ['manager', 'production', 'quality']) && rows(s, 'inspectionPlans').filter(p => p.status === 'approved' && p.itemId === x.itemId && (p.revision === null || p.revision === x.bomRevision)).map(p => <InspectForm key={p.id} larder={larder} plan={p} lotId={lot.id} />)}
      <InspectionResults s={s} subjectId={x.lotId} title="Output inspection results" />
      {rows(s, 'qualityHolds').filter(h => h.subjectId === x.lotId && h.status === 'open').map(h => <HoldRelease key={h.id} larder={larder} hold={h} />)}
      {owner && lot?.status === 'quarantined' && <Form submit={`Release ${lot.code}`} busy={larder.busy} onSubmit={async d => { const file = d.get('evidence') as File; return larder.run('batch.release', { workOrderId: w.id, version: w.version, lotId: lot.id, reason: text(d, 'reason'), evidence: [{ name: file.name, contentType: file.type, base64: await fileBase64(file) }] }) }}><Field label={`Release reason for ${lot.code}`} name="reason" /><Field label={`Release evidence for ${lot.code}`} name="evidence" type="file" /></Form>}
    </section> })}
  </Card>
}
