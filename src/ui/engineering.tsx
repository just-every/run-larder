import { can, itemName, locationName, personName, rows } from './api'
import type { Larder } from './app'
import { Card, Chip, Field, Form, Table, text } from './controls'
import { day, qty, when, words } from './format'
import { EngineeringProposal } from './engineering-form'

export function EngineeringChanges({ larder }: { larder: Larder }) {
  const s = larder.state!, prepare = can(s, ['manager', 'production', 'engineer'])
  return <>{prepare && <EngineeringProposal larder={larder} />}
    {[...rows(s, 'engineeringChanges')].reverse().map(e => <Card key={e.id} title={<>Engineering change · {itemName(s, e.itemId)} <Chip tone={e.status === 'approved' ? 'good' : 'warn'}>{words(e.status)}</Chip></>}>
      <p>{e.reason}</p><p className="meta">{e.safety ? 'Safety-related · ' : ''}Effective {day(e.effectiveOn)} · proposed by {personName(s, e.createdBy)} {when(e.createdAt)}</p>
      <p>Revision {e.sourceBom.revision} → {e.approvedBom?.revision ?? 'proposed'} · yield {qty(e.prospectiveBom.yield)}</p>
      <Table head={['Proposed component', 'Quantity', 'Supply']}>{e.prospectiveBom.components.map((c: any) => <tr key={c.itemId}><td>{itemName(s, c.itemId)}</td><td>{qty(c.quantity)}</td><td>{c.supply}</td></tr>)}</Table>
      {e.substitutes.map((r: any, i: number) => <p key={i}>Eligible replacement: {itemName(s, r.fromItemId)} → {itemName(s, r.toItemId)} · {r.reason}</p>)}
      {(e.attachments ?? []).map((a: any) => <p key={a.id} style={{ overflowWrap: 'anywhere' }}><a href={`/api/larder/attachments/${a.id}`} download>{a.name}</a> · retained evidence, SHA-256 {a.sha256}</p>)}
      <h3>Obsolete stock instructions</h3>{!e.dispositions.length && <p>No removed-component stock required disposition.</p>}
      {e.dispositions.map((d: any, i: number) => <p key={i}>{qty(d.quantity)} {itemName(s, d.itemId)} at {locationName(s, d.locationId)} · {d.status} · {d.lotId ? rows(s, 'lots').find(l => l.id === d.lotId)?.code : 'No lot'} · {words(d.action)}: {d.reason}</p>)}
      <p className="muted">Disposition instructions do not post a stock movement.</p>
      <h3>Work treatment</h3>{e.workTreatments.map((t: any) => <p key={t.workOrderId}><a href={`#make/wo/${t.workOrderId}`}>{rows(s, 'workOrders').find(w => w.id === t.workOrderId)?.reference}</a> · {words(t.action)}: {t.reason}</p>)}
      {e.impact.openWork.filter((w: any) => w.status === 'released').map((w: any) => <p key={w.id}><a href={`#make/wo/${w.id}`}>{w.reference}</a> · released work keeps its pinned revision.</p>)}
      {e.status === 'proposed' && e.stateVersion !== s.version && <p className="warn-text">Records changed. Decline this proposal and prepare a fresh review.</p>}
      {e.status === 'proposed' && can(s, ['manager']) && <div className="actions"><button className="button primary" disabled={larder.busy || e.stateVersion !== s.version || (s.actor.role !== 'owner' && e.createdBy === s.actor.id)} onClick={() => larder.run('engineering.approve', { changeId: e.id, version: e.version })}>Approve engineering change</button></div>}
      {e.status === 'proposed' && can(s, ['manager']) && <Form submit="Decline engineering change" quiet busy={larder.busy} onSubmit={d => larder.run('engineering.decline', { changeId: e.id, version: e.version, reason: text(d, 'reason') })}><Field label="Decline reason" name="reason" /></Form>}
      {e.status === 'approved' && <><p>Approved by {personName(s, e.approvedBy)} {when(e.approvedAt)} · revision {e.approvedBom.revision}</p>
        {(e.acknowledgments ?? []).map((a: any, i: number) => <p key={i}>Acknowledged by {personName(s, a.actorId)} {when(a.at)}: {a.note}</p>)}
        {prepare && !e.acknowledgments.some((a: any) => a.actorId === s.actor.id) && <Form submit="Acknowledge approved change" busy={larder.busy} onSubmit={d => larder.run('engineering.acknowledge', { changeId: e.id, version: e.version, bomId: e.bomId, note: text(d, 'note') })}><Field label="Acknowledgment note" name="note" /></Form>}
      </>}
      {e.status === 'declined' && <p>Declined: {e.declineReason}</p>}
    </Card>)}
  </>
}
