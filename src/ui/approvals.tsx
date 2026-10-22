import { personName, rows, can } from './api'
import type { Larder } from './app'
import { Card, Chip, Choose, Empty, Field, Form, Table, text } from './controls'
import { money, when, words } from './format'

const categories = [{ value: 'spend', label: 'Purchase orders (spend)' }, { value: 'inventoryAdjustment', label: 'Stock adjustments (counts)' }]
const tone: Record<string, 'good' | 'warn' | 'bad' | 'neutral'> = { valid: 'good', used: 'neutral', invalidated: 'bad', expired: 'warn', withdrawn: 'warn' }

// GOV-002: who must sign what, the signatures given and what became of them, and who stands in for whom.
export function Approvals({ larder }: { larder: Larder }) {
  const s = larder.state!, owner = s.actor.role === 'owner'
  const subject = (x: any) => { const r = rows(s, x.subjectKind === 'purchaseOrders' ? 'purchaseOrders' : 'counts').find(y => y.id === x.subjectId); return `${x.subjectKind === 'purchaseOrders' ? 'Purchase order' : 'Count'} ${r?.reference ?? ''}`.trim() }
  const policies = rows(s, 'approvalPolicies'), signatures = [...rows(s, 'approvalSignatures')].reverse(), delegations = [...rows(s, 'approvalDelegations')].reverse()
  const people = rows(s, 'people').filter(p => p.id !== s.actor.id && !['agent', 'viewer', 'operator'].includes(p.role))
  return <>
    <Card title="Approval policies">
      {policies.length === 0 ? <Empty>No thresholds set: every approval needs one person with authority.</Empty> :
        <Table head={['Approval', 'From (USD)', 'Signatures', 'Each signature lasts', 'In force']}>{policies.map(p => <tr key={p.id}><td>{categories.find(c => c.value === p.category)?.label ?? words(p.category)}</td><td>{money(p.threshold)}</td><td>{p.signatures}</td><td>{p.expiryMinutes} min</td><td>{p.enabled ? 'Yes' : 'No'}</td></tr>)}</Table>}
      <p className="muted">Above its threshold an approval needs the stated number of different people, each signing the exact current inputs. If the inputs change, or a signature expires, it stops counting. Agents never sign. Only the owner can override, naming an accountable manager and a reason.</p>
      {owner && <Form submit="Save policy" busy={larder.busy} onSubmit={d => larder.run('approval.policy', { category: text(d, 'category'), thresholdUsd: text(d, 'threshold'), signatures: Number(text(d, 'signatures')), expiryMinutes: Number(text(d, 'expiry')), reason: text(d, 'reason') })}>
        <Choose label="Approval" name="category" options={categories} /><Field label="Threshold (USD)" name="threshold" inputMode="decimal" />
        <Choose label="Signatures needed" name="signatures" options={[{ value: '1', label: '1 person' }, { value: '2', label: '2 different people' }]} />
        <Field label="Signature lasts (minutes)" name="expiry" type="number" min="1" max="43200" defaultValue="1440" /><Field label="Reason" name="reason" /></Form>}
    </Card>
    <Card title="Signatures">{signatures.length === 0 ? <Empty>No signatures yet.</Empty> :
      <Table head={['Approval', 'Signed by', 'Value', 'When', 'Status']}>{signatures.map(x => <tr key={x.id}><td>{subject(x)}</td><td>{x.signerName}{x.onBehalfOf && <small>for {personName(s, x.onBehalfOf)}</small>}{x.override && <small>Owner override: {x.override.reason} (accountable: {x.override.accountableName})</small>}</td><td>{money(x.valueUsd)}</td><td>{when(x.signedAt)}</td><td><Chip tone={tone[x.status] ?? 'neutral'}>{words(x.status)}</Chip></td></tr>)}</Table>}</Card>
    <Card title="Deputies">
      {delegations.length === 0 ? <Empty>No deputies named.</Empty> :
        <Table head={['Principal', 'Deputy', 'Until', 'Status', '']}>{delegations.map(d => <tr key={d.id}><td>{d.principalName}</td><td>{d.deputyName}</td><td>{when(d.validUntil)}</td><td>{words(d.status)}</td><td>{d.status === 'active' && (owner || d.principalId === s.actor.id) && <button type="button" className="link" disabled={larder.busy} onClick={() => larder.run('approval.revokeDeputy', { delegationId: d.id, reason: 'Revoked from Approvals' })}>Revoke</button>}</td></tr>)}</Table>}
      {can(s, ['manager', 'buyer']) && <Form submit="Name deputy" busy={larder.busy} onSubmit={d => larder.run('approval.deputize', { deputyId: text(d, 'deputy'), validUntil: new Date(text(d, 'until')).toISOString(), reason: text(d, 'reason') })}>
        <Choose label="Deputy" name="deputy" options={people.map(p => ({ value: p.id, label: `${p.name} (${words(p.role)})` }))} /><Field label="Until" name="until" type="datetime-local" /><Field label="Reason" name="reason" /></Form>}
    </Card>
  </>
}
