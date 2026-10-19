import { itemName, locationName, personName, type LarderState, type Rec } from './api'
import type { Larder } from './app'
import { Field, Form, Table, text } from './controls'
import { qty, words } from './format'

export function MpsPolicyReview({ s, plan }: { s: LarderState; plan: Rec }) {
  const warnings: any[] = plan.policyWarnings ?? []
  if (!warnings.length) return null
  return <section aria-label="MPS location policy review">
    <h3>Location policies for this global MPS</h3>
    <p>This global quantity preview does not apply location policy sizing. Review each location’s inventory floor, batch, multiple and destination before releasing supply. The location policy planner is the default route; a manual global MPS override keeps these displayed weekly quantities without applying location sizing.</p>
    <Table head={['Item / settings location', 'Policy / revision', 'Inventory levels', 'Sizing / destination']}>
      {warnings.map(p => <tr key={p.policyId}><td>{itemName(s, p.itemId)}<small>{locationName(s, p.locationId)}</small></td><td>{words(p.mode)} · revision {p.revision}</td><td>Reorder {qty(p.reorderPoint)} · safety {qty(p.safetyStock)} · min {qty(p.minStock)} · max {p.maxStock === null ? 'not set' : qty(p.maxStock)}</td><td>Batch {qty(p.batchSize)} · multiple {qty(p.orderMultiple)} · lead {p.leadDays} calendar days<small>Bin {locationName(s, p.defaultBin)}</small></td></tr>)}
    </Table>
    {plan.policyOverride && <p>Manual policy override approved by {personName(s, plan.policyOverride.by)}: {plan.policyOverride.reason}</p>}
  </section>
}

export function MpsRelease({ larder, plan, disabled }: { larder: Larder; plan: Rec; disabled: boolean }) {
  const overridden = (plan.policyWarnings ?? []).length > 0
  return <Form submit="Approve and release MPS" busy={disabled} onSubmit={d => larder.run('mps.release', {
    planId: plan.id, version: plan.version,
    ...(overridden ? { manualPolicyOverride: d.get('manualPolicyOverride') === 'on', policyOverrideReason: text(d, 'policyOverrideReason') } : {}),
  })}>
    {overridden && <>
      <label className="field wide"><span><input type="checkbox" name="manualPolicyOverride" required aria-label="Acknowledge manual MPS policy override" /> I reviewed the location policies and approve these global weekly quantities as a manual policy override.</span></label>
      <Field label="Manual policy override reason" name="policyOverrideReason" />
    </>}
  </Form>
}
