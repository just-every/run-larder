// TRACE-004 inspection plans, measured results on the batch, quality holds and release.
import { Nonconformances } from './nonconformance'
import { byId, can, itemName, personName, rows, type LarderState, type Rec } from './api'
import type { Larder } from './app'
import { Card, Chip, Choose, Empty, Field, Form, Table, fileBase64, options, text } from './controls'
import { when, words } from './format'

const upload = async (d: FormData, name: string) => {
  const file = d.get(name) as File | null
  return file && file.size ? [{ name: file.name, contentType: file.type || 'application/octet-stream', base64: await fileBase64(file) }] : []
}
const fileInput = (label: string, name: string, required = false) => <label className="field wide"><span>{label}</span><input type="file" name={name} required={required} accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,.xlsx" /></label>
const stageLabel = (p: Rec) => p.stage === 'in-process' ? `In-process after operation ${p.operationSequence}` : p.stage === 'receipt' ? 'Receipt' : 'Final'
const limits = (m: Rec) => `target ${m.target} ${m.unit} · limits ${m.lower}–${m.upper}`
const qualified = (s: LarderState) => can(s, ['manager', 'quality'])

export function QualityPlans({ larder }: { larder: Larder }) {
  const s = larder.state!, plans = [...rows(s, 'inspectionPlans')].reverse(), made = rows(s, 'items').filter(i => !i.archived)
  const receipt = plans.filter(p => p.status === 'approved' && p.stage === 'receipt'), holds = rows(s, 'qualityHolds').filter(h => h.status === 'open')
  return <>
    <Nonconformances larder={larder} />
    <Card title="Inspection plans">
      <p className="meta">Plans apply by SKU and BOM revision once an owner or manager approves them. A measurement passes when it has exactly the plan’s sample count and every sample lies within its inclusive limits; the mean is shown to six decimal places. A failed required inspection holds the stock and the job’s operations until an owner or manager releases it after a passing retest.</p>
      {plans.length === 0 ? <Empty>No inspection plans yet.</Empty> : <Table head={['Plan', 'Item and revision', 'Stage', 'Sampling rule', 'Status', '']}>{plans.map(p => <tr key={p.id}>
        <td><strong>{p.name}</strong>{p.attachments?.length > 0 && <small>Spec {p.attachments.map((a: Rec) => a.name).join(', ')}</small>}</td>
        <td>{itemName(s, p.itemId)} · {p.revision === null ? 'every revision' : `revision ${p.revision}`}</td><td>{stageLabel(p)}{!p.required && ' · advisory'}</td>
        <td>{p.sampleSize} sampled · {p.measurements.map((m: Rec) => `${m.name} ${limits(m)}`).join('; ')}</td>
        <td><Chip tone={p.status === 'approved' ? 'good' : p.status === 'draft' ? 'warn' : 'neutral'}>{words(p.status)}</Chip><small>Prepared by {personName(s, p.preparedBy)}{p.approval && ` · approved by ${personName(s, p.approval.by)} ${when(p.approval.at)}`}</small></td>
        <td>{p.status === 'draft' && qualified(s) && <button className="button" disabled={larder.busy} onClick={() => larder.run('quality.plan.approve', { planId: p.id, version: p.version })}>Approve plan {p.name}</button>}</td></tr>)}</Table>}
    </Card>
    {can(s, ['manager', 'production', 'quality']) && <Card title="New inspection plan"><Form submit="Save plan" busy={larder.busy} onSubmit={async d => larder.run('quality.plan.save', {
      itemId: text(d, 'itemId'), revision: text(d, 'revision') || null, stage: text(d, 'stage'), operationSequence: text(d, 'operationSequence') || undefined, name: text(d, 'name'), sampleSize: text(d, 'sampleSize'), required: text(d, 'required') !== 'advisory',
      measurements: [{ name: text(d, 'm.name'), unit: text(d, 'm.unit'), target: text(d, 'm.target'), lower: text(d, 'm.lower'), upper: text(d, 'm.upper') }], attachments: await upload(d, 'spec'),
    })}>
      <Choose label="Item" name="itemId" options={options(made, r => `${r.name} · ${r.sku}`)} /><Field label="BOM revision" name="revision" inputMode="numeric" required={false} hint="Leave empty for every revision" />
      <Choose label="Stage" name="stage" options={[{ value: 'receipt', label: 'Receipt' }, { value: 'in-process', label: 'In-process' }, { value: 'final', label: 'Final' }]} />
      <Field label="After operation" name="operationSequence" inputMode="numeric" required={false} hint="In-process checks only" /><Field label="Plan name" name="name" /><Field label="Sample size" name="sampleSize" inputMode="numeric" />
      <Choose label="Failure effect" name="required" defaultValue="required" options={[{ value: 'required', label: 'Required: a failure holds stock and work' }, { value: 'advisory', label: 'Advisory: record only' }]} />
      <Field label="Measurement" name="m.name" /><Field label="Unit" name="m.unit" /><Field label="Target" name="m.target" inputMode="decimal" /><Field label="Lower limit" name="m.lower" inputMode="decimal" /><Field label="Upper limit" name="m.upper" inputMode="decimal" />
      {fileInput('Specification or drawing', 'spec')}
    </Form></Card>}
    {receipt.length > 0 && <Card title="Receipt inspections">{receipt.map(p => <section key={p.id} aria-label={`Receipt inspection ${p.name}`}>
      <InspectForm larder={larder} plan={p} lots={rows(s, 'lots').filter(l => l.itemId === p.itemId && l.source === 'receipt')} />
      {rows(s, 'lots').filter(l => l.itemId === p.itemId && l.source === 'receipt').map(l => <InspectionResults key={l.id} s={s} subjectId={l.id} title={`Lot ${l.code}`} />)}
    </section>)}</Card>}
    {holds.length > 0 && <Card title="Open quality holds">{holds.map(h => <HoldRelease key={h.id} larder={larder} hold={h} />)}</Card>}
  </>
}

// What the batch shows: applicable approved plans, every result and any open hold.
export function WorkQuality({ larder, w }: { larder: Larder; w: Rec }) {
  const s = larder.state!
  const plans = rows(s, 'inspectionPlans').filter(p => p.status === 'approved' && p.stage !== 'receipt' && p.itemId === w.itemId && (p.revision === null || p.revision === w.bomRevision))
  const results = rows(s, 'inspections').filter(x => x.subjectId === w.id), holds = rows(s, 'qualityHolds').filter(h => h.subjectId === w.id)
  if (!plans.length && !results.length) return null
  const lots = rows(s, 'lots').filter(l => l.source === 'production' && l.documentId === w.id)
  return <Card title="Quality checks">
    {lots.length > 0 && <p className="meta">Batch {lots.map(l => `lot ${l.code} (${words(l.status)})`).join(', ')}</p>}
    <InspectionResults s={s} subjectId={w.id} title={w.reference} />
    {holds.filter(h => h.status === 'open').map(h => <HoldRelease key={h.id} larder={larder} hold={h} />)}
    {holds.filter(h => h.status === 'released').map(h => <p key={h.id}>Hold on {h.planName} released by {personName(s, h.release.by)} {when(h.release.at)} after a passing retest: {h.release.reason} · evidence {h.release.evidence.map((e: Rec) => e.name).join(', ')}</p>)}
    {['released', 'closed'].includes(w.status) && can(s, ['manager', 'production', 'quality']) && plans.map(p => <InspectForm key={p.id} larder={larder} plan={p} workOrderId={w.id} />)}
  </Card>
}

export function InspectForm({ larder, plan, workOrderId, reworkOrderId, nonconformanceId, lots, lotId }: { larder: Larder; plan: Rec; workOrderId?: string; reworkOrderId?: string; nonconformanceId?: string; lots?: Rec[]; lotId?: string }) {
  return <Form title={`Record ${plan.name}`} submit="Record inspection" busy={larder.busy} note={`${stageLabel(plan)} · ${plan.sampleSize} samples per measurement. Separate samples with spaces, commas or new lines.`} onSubmit={async d => larder.run('quality.inspect', {
    planId: plan.id, planVersion: plan.version, workOrderId, reworkOrderId, nonconformanceId, quantity: nonconformanceId ? text(d, 'quantity') : undefined, lotId: lotId ?? (text(d, 'lotId') || undefined), note: text(d, 'note'), evidence: await upload(d, 'evidence'),
    samples: Object.fromEntries(plan.measurements.map((m: Rec, i: number) => [m.name, text(d, `samples.${i}`).split(/[\s,]+/).filter(Boolean)])),
  })}>
    {nonconformanceId && <Field label="Inspected case quantity" name="quantity" inputMode="decimal" />}
    {lots && <Choose label="Received lot" name="lotId" options={options(lots, r => `Lot ${r.code}`)} />}
    {plan.measurements.map((m: Rec, i: number) => <label key={m.name} className="field wide"><span>{`${m.name} samples (${m.unit})`}</span><textarea aria-label={`${m.name} samples (${m.unit})`} name={`samples.${i}`} required rows={3} /><small>{limits(m)}</small></label>)}
    <Field label="Note" name="note" required={false} />{fileInput('Measurement record', 'evidence')}
  </Form>
}

export function InspectionResults({ s, subjectId, title }: { s: LarderState; subjectId: string; title: string }) {
  const results = rows(s, 'inspections').filter(x => x.subjectId === subjectId)
  if (!results.length) return null
  return <section aria-label={`Inspection results for ${title}`}><h3>Inspection results · {title}</h3>
    <Table head={['Inspection', 'Measurement', 'Sampled', 'Mean', 'Limits', 'Result', 'Signed off']}>{results.flatMap(x => x.measurements.map((m: Rec) => <tr key={`${x.id}:${m.name}`}>
      <td>{x.planName}{x.retestOf && <small>Retest</small>}</td><td>{m.name}</td><td>{m.count} sampled</td><td>avg {m.mean} {m.unit}</td><td>limits {m.lower}–{m.upper}</td>
      <td>{m.passed ? <Chip tone="good">Passed</Chip> : <Chip tone="bad">{`Failed · ${m.outside} outside`}</Chip>}</td>
      <td>{personName(s, x.inspectedBy)} {when(x.inspectedAt)}{x.evidence?.length > 0 && <small>Evidence {x.evidence.map((e: Rec) => e.name).join(', ')}</small>}<small>Plan approved by {personName(s, byId(s, 'inspectionPlans', x.planId)?.approval?.by)}</small></td></tr>))}</Table>
    <details><summary>Individual samples</summary><ul>{results.flatMap(x => x.measurements.map((m: Rec) => <li key={`${x.id}:${m.name}`}>{when(x.inspectedAt)} {m.name}: {m.samples.join(', ')} {m.unit}</li>))}</ul></details>
  </section>
}

export function HoldRelease({ larder, hold }: { larder: Larder; hold: Rec }) {
  const s = larder.state!
  return <section aria-label={`Quality hold ${hold.planName}`}><p className="warn-text" role="status">Quality hold: {hold.planName} failed on {String(hold.failedAt).slice(0, 10)} ({hold.failures.join('; ')}). {hold.held.length ? `Held ${hold.held.map((x: Rec) => `${x.quantity} of lot ${byId(s, 'lots', x.lotId)?.code}`).join(', ')} in quarantine.` : 'No available stock was held.'}{hold.unreserved.length > 0 && ` Released ${hold.unreserved.length} reservation(s) the held stock covered.`}</p>
    {qualified(s) && <Form title={`Release hold ${hold.planName}`} submit="Release after passing retest" busy={larder.busy} note="Release needs a later passing result under the same approved plan; both results stay on record." onSubmit={async d => larder.run('quality.release', { holdId: hold.id, version: hold.version, reason: text(d, 'reason'), evidence: await upload(d, 'evidence') })}>
      <Field label="Release reason" name="reason" />{fileInput('Retest or disposition record', 'evidence', true)}
    </Form>}
  </section>
}
