import { useState } from 'react'
import { byId, itemName, locationName, rows, type Rec } from './api'
import type { Larder } from './app'
import { Card, Choose, Field, Form, fileBase64, options, text } from './controls'
import { qty } from './format'
import { RoutingEditor, routingFromForm } from './routing-editor'

export function EngineeringProposal({ larder }: { larder: Larder }) {
  const s = larder.state!, today = new Date().toISOString().slice(0, 10)
  const sources = rows(s, 'items').filter(i => i.kind === 'make').map(i => rows(s, 'boms').filter(b => b.itemId === i.id && ['active', 'scheduled'].includes(b.status) && b.effectiveOn <= today).sort((a, b) => b.effectiveOn.localeCompare(a.effectiveOn) || b.revision - a.revision)[0]).filter(Boolean)
  const [selected, setSelected] = useState('')
  const source = sources.find(b => b.id === selected) ?? sources[0]
  return <Card title="Propose engineering change">
    <p className="muted">Review a replacement, its effective date, obsolete stock and every unreleased job. A safety change pauses new releases until the review is decided. Released work retains its pinned revision.</p>
    <Choose label="Engineering item" name="engineeringItem" value={source?.id ?? ''} onChange={(e: any) => setSelected(e.target.value)} options={sources.map(b => ({ value: b.id, label: `${itemName(s, b.itemId)} · revision ${b.revision}` }))} />
    {source && <ProposalFields key={source.id} larder={larder} source={source} />}
  </Card>
}

function ProposalFields({ larder, source }: { larder: Larder; source: Rec }) {
  const s = larder.state!, [replacement, setReplacement] = useState<Record<string, string>>({})
  const nextIds = new Set(source.components.map((c: any) => replacement[c.itemId] || c.itemId))
  const removed = source.components.filter((c: any) => !nextIds.has(c.itemId)).map((c: any) => c.itemId)
  const positions = s.positions.filter((p: any) => removed.includes(p.itemId) && Number(p.quantity) > 0)
  const work = (s.engineeringImpacts?.[source.itemId] ?? []).filter((w: any) => w.status === 'draft')
  return <Form submit="Submit engineering proposal" busy={larder.busy} onSubmit={async d => {
    const attachment = d.get('attachment') as File
    const components = source.components.map((c: any, index: number) => ({ ...c, itemId: text(d, `component.${index}`), quantity: text(d, `quantity.${index}`), supply: text(d, `supply.${index}`) }))
    return larder.run('engineering.propose', {
      itemId: source.itemId, sourceBomId: source.id, reason: text(d, 'reason'), safety: d.get('safety') === 'on', effectiveOn: text(d, 'effectiveOn'), yield: text(d, 'yield'),
      components, routing: d.get('replaceRouting') === 'on' ? await routingFromForm(d) : source.routing,
      attachments: attachment?.size ? [{ name: attachment.name, contentType: attachment.type || 'text/plain', base64: await fileBase64(attachment) }] : [],
      substitutes: source.components.flatMap((c: any, index: number) => c.itemId !== components[index].itemId ? [{ fromItemId: c.itemId, toItemId: components[index].itemId, reason: text(d, `eligibility.${index}`) }] : []),
      dispositions: positions.map((p: any, index: number) => ({ ...p, action: text(d, `action.${index}`), reason: text(d, `dispositionReason.${index}`) })),
      workTreatments: work.map((w: any) => ({ workOrderId: w.id, version: w.version, action: text(d, `work.${w.id}`), reason: text(d, `workReason.${w.id}`) })),
    })
  }}>
    <Field label="Engineering reason" name="reason" /><Field label="Change effective on (UTC)" name="effectiveOn" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
    <Field label="Change yield fraction" name="yield" defaultValue={source.yield ?? '1'} inputMode="decimal" />
    <label className="check"><input name="safety" type="checkbox" /> Safety-related change</label>
    <Field label="Change evidence file" name="attachment" type="file" required={false} />
    <fieldset className="lines wide"><legend>Proposed components and substitute eligibility</legend>
      {source.components.map((c: any, index: number) => <div className="form-grid" key={c.itemId}>
        <Choose label={`Replace ${itemName(s, c.itemId)}`} name={`component.${index}`} value={replacement[c.itemId] || c.itemId} onChange={(e: any) => setReplacement({ ...replacement, [c.itemId]: e.target.value })} options={options(rows(s, 'items').filter(i => !i.archived && i.id !== source.itemId), i => `${i.name} · ${i.sku}`)} />
        <Field label={`Component ${index + 1} quantity`} name={`quantity.${index}`} defaultValue={c.quantity} inputMode="decimal" />
        <Choose label={`Component ${index + 1} supply`} name={`supply.${index}`} defaultValue={c.supply} options={['buy', 'make', 'phantom'].map(value => ({ value, label: value }))} />
        <Field label={`Component ${index + 1} eligibility reason`} name={`eligibility.${index}`} required={nextIds.has(c.itemId) ? false : true} hint="Explain why the replacement is eligible for this revision." />
      </div>)}
    </fieldset>
    {positions.length > 0 && <fieldset className="lines wide"><legend>Obsolete stock instructions</legend><p>These are recorded disposition instructions. Actual returns, rework or scrap require their own stock transaction.</p>
      {positions.map((p: any, index: number) => <div className="form-grid" key={index}><p>{qty(p.quantity)} {itemName(s, p.itemId)} · {locationName(s, p.locationId)} · {p.status} · {byId(s, 'lots', p.lotId)?.code || 'No lot'}</p>
        <Choose label={`Stock ${index + 1} disposition`} name={`action.${index}`} options={['retain', 'return', 'rework', 'scrap'].map(value => ({ value, label: value }))} /><Field label={`Stock ${index + 1} reason`} name={`dispositionReason.${index}`} />
      </div>)}
    </fieldset>}
    {work.length > 0 && <fieldset className="lines wide"><legend>Unreleased work treatment</legend>{work.map((w: any) => <div className="form-grid" key={w.id}><p><a href={`#make/wo/${w.id}`}>{w.reference}</a> · {itemName(s, w.itemId)} · {qty(w.quantity)}</p>
      <Choose label={`${w.reference} treatment`} name={`work.${w.id}`} options={[{ value: 'keep', label: 'Keep previous revision' }, { value: 'adopt', label: 'Adopt approved revision on its effective date' }, { value: 'cancel', label: 'Cancel draft' }]} /><Field label={`${w.reference} reason`} name={`workReason.${w.id}`} />
    </div>)}</fieldset>}
    <details className="wide"><summary>Change routing and instructions</summary><label className="check"><input name="replaceRouting" type="checkbox" /> Replace existing routing with the steps below</label><RoutingEditor /></details>
  </Form>
}
