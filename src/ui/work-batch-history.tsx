import { byId, can, itemName, type Rec } from './api'
import type { Larder } from './app'
import { Card, Field, Form, fileBase64, text } from './controls'
import { when } from './format'
export function WorkBatchHistory({ larder, w }: { larder: Larder; w: Rec }) {
  const s = larder.state!, missing = (w.outputs ?? []).map((b: Rec, index: number) => ({ ...b, index })).filter((b: Rec) => !b.allocations)
  if (!missing.length) return null
  return <Card title="Historical output allocations"><p>Job-level ancestry; component lots per output batch were not recorded. Before more output or closure, record the actual historical batch inputs with evidence. This adds a dated allocation record; original output quantities and movements remain intact.</p>
    {missing.map((b: Rec) => <div key={b.index}><h3>Report {b.index + 1} · {when(b.at)} · good {b.good} · scrap {b.scrap}</h3>
      {can(s, ['manager', 'production']) && <Form submit="Record historical batch inputs" busy={larder.busy} onSubmit={async d => { const f = d.get('evidence') as File; return larder.run('wo.batch.allocate', { workOrderId: w.id, version: w.version, batchIndex: b.index, allocations: (s.workMaterialPools?.[w.id] ?? []).filter((a: Rec) => text(d, a.movementId)).map((a: Rec) => ({ movementId: a.movementId, quantity: text(d, a.movementId) })), reason: text(d, 'reason'), evidence: { name: f.name, contentType: f.type || 'application/octet-stream', base64: await fileBase64(f) } }) }}>
        {(s.workMaterialPools?.[w.id] ?? []).map((a: Rec) => <Field key={a.movementId} label={`${itemName(s, a.itemId)} · lot ${byId(s, 'lots', a.lotId)?.code ?? 'unlotted'} · source ${byId(s, 'workOrders', a.workOrderId)?.reference}`} name={a.movementId} required={false} hint={`Source unallocated ${a.quantity}; this job remaining ${a.jobRemaining}`} />)}
        <Field label="Historical allocation reason" name="reason" /><label className="field"><span>Original batch evidence</span><input type="file" name="evidence" required /></label>
      </Form>}
    </div>)}
  </Card>
}
