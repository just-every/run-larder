// Reuses the quality desk's cards/forms and existing design tokens.
import { byId, can, itemName, personName, rows } from './api'
import type { Larder } from './app'
import { Card, Choose, Empty, Field, Form, fileBase64, options, text } from './controls'
import { InspectForm, InspectionResults } from './quality'

const file = <label className="field wide"><span>Evidence</span><input name="evidence" type="file" required /></label>
const evidence = async (d: FormData) => {
  const f = d.get('evidence') as File
  return [{ name: f.name, contentType: f.type || 'application/octet-stream', base64: await fileBase64(f) }]
}
export function Nonconformances({ larder }: { larder: Larder }) {
  const s = larder.state!, cases = [...rows(s, 'nonconformances')].reverse(), qualified = can(s, ['manager'])
  return <>
    <Card title="Nonconformances"><p className="meta">Contain only the affected quantity. Supplier actions and repair routing are recorded in app. A case release needs a current passing inspection of exactly the released units and an independent owner or manager approval; closing also needs an evidenced effectiveness check.</p>
      {!cases.length && <Empty>No nonconformances yet.</Empty>}
      {cases.map(n => <section key={n.id} aria-label={`Nonconformance ${n.reference}`}>
        <h3>{n.reference} · {itemName(s, n.itemId)} · {n.status}</h3>
        <p>Lot {byId(s, 'lots', n.lotId)?.code} · affected {n.quantity} · still held {n.remaining} · owner {personName(s, n.ownerId)} · due {n.dueOn}</p>
        <p>Complaint: {n.complaint}</p><p>Root cause: {n.rootCause || 'Not recorded'} · Corrective action: {n.correctiveAction || 'Not recorded'}</p>
        <p>Evidence: {n.evidence.map((e: any) => e.name).join(', ')}</p>
        {n.actions.map((a: any, i: number) => <p key={i}>{a.nextAction} · {a.delivery}{a.supplierId && ` · supplier ${byId(s, 'parties', a.supplierId)?.name}`}{a.reworkOrderId && ` · repair ${byId(s, 'reworkOrders', a.reworkOrderId)?.reference}`} · evidence {a.evidence.map((e: any) => e.name).join(', ')}</p>)}
        {n.decisions.map((d: any, i: number) => <p key={i}>{d.decision} {d.quantity} · {d.reason} · approved by {personName(s, d.by)} · evidence {d.evidence.map((e: any) => e.name).join(', ')}</p>)}
        <InspectionResults s={s} subjectId={n.id} title={n.reference} />
        {n.effectiveness && <p>Effectiveness verified: {n.effectiveness.check} · evidence {n.effectiveness.evidence.map((e: any) => e.name).join(', ')}</p>}
        {qualified && n.status === 'open' && <>
          <Form title={`Follow up ${n.reference}`} submit="Record corrective action" busy={larder.busy} onSubmit={async d => larder.run('nonconformance.update', { caseId: n.id, version: n.version, rootCause: text(d, 'rootCause'), correctiveAction: text(d, 'correctiveAction'), nextAction: text(d, 'nextAction'), dueOn: text(d, 'dueOn'), supplierId: text(d, 'supplierId') || undefined, reworkOrderId: text(d, 'reworkOrderId') || undefined, evidence: await evidence(d) })}>
            <Field label="Root cause" name="rootCause" defaultValue={n.rootCause} /><Field label="Corrective action" name="correctiveAction" defaultValue={n.correctiveAction} /><Field label="Next action" name="nextAction" /><Field label="Action due date" name="dueOn" type="date" defaultValue={n.dueOn} />
            <Choose label="Supplier action" name="supplierId" required={false} options={[{ value: '', label: 'No supplier action' }, ...options(rows(s, 'parties').filter(p => p.kind !== 'customer'), p => p.name)]} />
            <Choose label="Repair order" name="reworkOrderId" required={false} options={[{ value: '', label: 'No repair routing' }, ...options(rows(s, 'reworkOrders').filter(w => w.sourceLotId === n.lotId), w => w.reference)]} />{file}
          </Form>
          {Number(n.remaining) > 0 && <>
            {rows(s, 'inspectionPlans').filter(p => p.status === 'approved' && p.itemId === n.itemId).map(p => <InspectForm key={p.id} larder={larder} plan={p} nonconformanceId={n.id} />)}
            <Form title={`Disposition ${n.reference}`} submit="Approve disposition" busy={larder.busy} onSubmit={async d => larder.run(`nonconformance.${text(d, 'decision')}`, { caseId: n.id, version: n.version, quantity: text(d, 'quantity'), inspectionId: text(d, 'inspectionId') || undefined, reason: text(d, 'reason'), evidence: await evidence(d) })}>
              <Choose label="Decision" name="decision" options={[{ value: 'release', label: 'Release passing units' }, { value: 'reject', label: 'Reject units' }]} /><Field label="Disposition quantity" name="quantity" inputMode="decimal" />
              <Choose label="Passing case inspection" name="inspectionId" required={false} options={[{ value: '', label: 'Not applicable for rejection' }, ...options(rows(s, 'inspections').filter(i => i.subjectId === n.id && i.passed), i => `${i.planName} · ${i.quantity} units · ${i.inspectedAt}`)]} />
              <Field label="Disposition reason" name="reason" />{file}
            </Form>
          </>}
          {n.remaining === '0' && <Form title={`Close ${n.reference}`} submit="Verify effectiveness and close" busy={larder.busy} onSubmit={async d => larder.run('nonconformance.close', { caseId: n.id, version: n.version, effective: true, check: text(d, 'check'), evidence: await evidence(d) })}>
            <Field label="Effectiveness check" name="check" />{file}
          </Form>}
        </>}
      </section>)}
    </Card>
    {qualified && <Card title="Open nonconformance"><Form submit="Contain affected units" busy={larder.busy} onSubmit={async d => larder.run('nonconformance.open', { lotId: text(d, 'lotId'), locationId: text(d, 'locationId'), quantity: text(d, 'quantity'), complaint: text(d, 'complaint'), dueOn: text(d, 'dueOn'), evidence: await evidence(d) })}>
      <Choose label="Affected lot" name="lotId" options={options(rows(s, 'lots'), l => `${l.code} · ${itemName(s, l.itemId)}`)} /><Choose label="Containment location" name="locationId" options={options(rows(s, 'locations'), l => l.name)} />
      <Field label="Affected quantity" name="quantity" inputMode="decimal" /><Field label="Supplier or customer complaint" name="complaint" /><Field label="Case due date" name="dueOn" type="date" />{file}
    </Form></Card>}
  </>
}
