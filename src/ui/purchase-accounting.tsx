import { can, itemName, personName, rows, type Rec } from './api'
import type { Larder } from './app'
import { Card, Choose, Details, Field, Form, Table, fileBase64, text } from './controls'
import { day, qty, words } from './format'

const choices = (values: string[]) => values.map(value => ({ value, label: words(value) }))
const proof = async (d: FormData) => {
  const file = d.get('evidence') as File
  return { name: file.name, contentType: file.type || 'application/octet-stream', base64: await fileBase64(file) }
}
function DecisionFields() {
  return <><Field label="Decision reason" name="reason" /><Field label="Evidence file" name="evidence" type="file" /></>
}

// The existing command door supplies live authority, exact versions and replay protection.
export function PurchaseAccounting({ larder, po }: { larder: Larder; po: Rec }) {
  const s = larder.state!, owner = can(s, []), accounts = can(s, ['accounts']), receiver = can(s, ['warehouse', 'manager'])
  const receipts = rows(s, 'receipts').filter(r => r.poId === po.id)
  const sources = receipts.flatMap(r => r.lines.map((l: any) => ({ ...l, receiptId: r.id, reference: r.reference })))
  const label = (l: any) => `${l.reference} · ${itemName(s, l.itemId)} · ${rows(s, 'lots').find(x => x.id === l.lotId)?.code ?? 'Unlotted'} · ${qty(l.quantity)}`
  const run = (type: string, d: FormData, payload: object) => larder.run(type, { poId: po.id, version: po.version, reason: text(d, 'reason'), ...payload })
  if ((s.actor as any).scope?.costs || po.status === 'draft') return null
  return <>
    <Card title="Supplier returns and credits">
      <p>Dispatch is locally recorded. Replacements stay quarantined until quality release. Credit acknowledgements and closure are locally recorded; the ledger is not connected.</p>
      {receiver && sources.length > 0 && <details><summary>Open supplier return</summary><Form submit="Open claim" busy={larder.busy} onSubmit={async d => {
        const source = sources.find(x => x.movementId === text(d, 'movementId'))
        return run('po.claim.open', d, { receiptId: source.receiptId, movementId: source.movementId, quantity: text(d, 'quantity'), purpose: text(d, 'purpose'), supplierRma: text(d, 'reference'), dueDate: text(d, 'dueDate'), evidence: await proof(d) })
      }}><Choose label="Original receipt and lot" name="movementId" options={sources.map(l => ({ value: l.movementId, label: label(l) }))} /><Choose label="Return purpose" name="purpose" options={choices(['rejected', 'excess'])} /><Field label="Claim quantity" name="quantity" inputMode="decimal" /><Field label="Supplier RMA reference" name="reference" /><Field label="Follow-up due" name="dueDate" type="date" /><DecisionFields /></Form></details>}
      {(po.supplierClaims ?? []).map((claim: any) => <section aria-label={`Supplier claim ${claim.supplierRma}`} key={claim.id}>
        <h3>{claim.supplierRma} · {claim.status}</h3><p>{qty(claim.quantity)} {itemName(s, claim.itemId)} · owned by {personName(s, claim.ownerId)} · due {day(claim.dueDate)}</p>
        <Details label="Claim evidence and settlement history" value={claim} s={s} />
        {claim.replacements.map((r: any) => <p key={r.id}>Replacement {rows(s, 'lots').find(l => l.id === r.lotId)?.code} · {qty(r.quantity)} in quarantine. <a href="#stock">Inspect lot genealogy</a></p>)}
        {owner && claim.status === 'open' && <>
          <details><summary>Record return dispatch</summary><Form submit="Record dispatch" busy={larder.busy} onSubmit={async d => run('po.claim.ship', d, { claimId: claim.id, quantity: text(d, 'quantity'), stockStatus: text(d, 'stockStatus'), reference: text(d, 'reference'), evidence: await proof(d) })}><Field label="Dispatch quantity" name="quantity" inputMode="decimal" /><Choose label="Dispatch stock status" name="stockStatus" options={choices(claim.purpose === 'rejected' ? ['quarantine'] : ['available', 'quarantine'])} /><Field label="Dispatch reference" name="reference" /><DecisionFields /></Form></details>
          <details><summary>Receive replacement</summary><Form submit="Record replacement" busy={larder.busy} onSubmit={async d => run('po.claim.replace', d, { claimId: claim.id, quantity: text(d, 'quantity'), lot: text(d, 'lot'), reference: text(d, 'reference'), evidence: await proof(d) })}><Field label="Replacement quantity" name="quantity" inputMode="decimal" /><Field label="Replacement lot or serial" name="lot" /><Field label="Replacement reference" name="reference" /><DecisionFields /></Form></details>
          <details><summary>Match supplier credit</summary><Form submit="Record credit" busy={larder.busy} onSubmit={async d => run('po.claim.credit', d, { claimId: claim.id, quantity: text(d, 'quantity'), amount: text(d, 'amount'), billId: text(d, 'billId'), reference: text(d, 'reference'), evidence: await proof(d) })}><Field label="Credit quantity" name="quantity" inputMode="decimal" /><Field label="Credit amount" name="amount" inputMode="decimal" /><Choose label="Original approved bill" name="billId" options={(po.bills ?? []).filter((b: any) => b.status === 'ready for handoff').map((b: any) => ({ value: b.id, label: `${b.reference} · ${b.currency} ${b.amount}` }))} /><Field label="Credit reference" name="reference" /><DecisionFields /></Form></details>
          <Form submit="Close locally settled claim" busy={larder.busy} note="Every dispatched unit must be settled and each credit must have a matching locally recorded accountant acknowledgement." onSubmit={d => run('po.claim.close', d, { claimId: claim.id })}><Field label="Closure reason" name="reason" /></Form>
        </>}
      </section>)}
    </Card>
    <Card title="Landed cost allocations">
      <p>Review separate stock, direct COGS and open WIP handoff lines. Physical movements and the valuation subledger remain unchanged. Completed production and unsupported returns are refused.</p>
      {accounts && sources.length > 0 && <details><summary>Prepare allocation</summary><Form submit="Prepare allocation" busy={larder.busy} onSubmit={async d => run('po.landed.prepare', d, { kind: text(d, 'kind'), policy: text(d, 'policy'), reference: text(d, 'reference'), amount: text(d, 'amount'), correctsId: text(d, 'correctsId') || undefined, evidence: await proof(d), sources: sources.filter(l => d.get(`source.${l.movementId}`) === 'on').map(l => ({ movementId: l.movementId, weight: text(d, `weight.${l.movementId}`) || undefined })) })}>
        <Choose label="Charge kind" name="kind" options={choices(['freight', 'duty', 'insurance', 'handling'])} /><Choose label="Allocation basis" name="policy" options={choices(['quantity', 'value', 'weight'])} /><Field label="Signed charge amount" name="amount" inputMode="decimal" /><Field label="Charge reference" name="reference" /><Choose label="Corrects approved charge" name="correctsId" required={false} options={(po.landedCharges ?? []).filter((c: any) => c.status === 'approved').map((c: any) => ({ value: c.id, label: c.reference }))} />
        {sources.map(l => <div className="line" key={l.movementId}><label><input type="checkbox" name={`source.${l.movementId}`} /> {label(l)}</label><Field label={`Supplied weight for ${label(l)}`} name={`weight.${l.movementId}`} inputMode="decimal" required={false} /></div>)}<DecisionFields />
      </Form></details>}
      {(po.landedCharges ?? []).map((charge: any) => <section aria-label={`Allocation ${charge.reference}`} key={charge.id}><h3>{charge.reference} · {charge.status}</h3><p>{charge.kind} · {charge.policy} · {po.currency} {charge.amount}</p><p>Six-decimal cumulative allocation truncates each share; the final share receives the remainder. Review the exact amounts below.</p>
        <Table head={['Receipt lot', 'Allocated', 'Stock', 'Direct COGS', 'Open WIP']}>{charge.lines.map((l: any) => <tr key={l.movementId}><td>{rows(s, 'lots').find(x => x.id === l.lotId)?.code}</td><td>{l.amount}</td><td>{l.stock}</td><td>{l.cogs}</td><td>{l.wip}</td></tr>)}</Table><Details label="Allocation evidence and decision" value={charge} s={s} />
        {owner && charge.status === 'draft' && <Form submit="Approve exact allocation" busy={larder.busy} onSubmit={d => run('po.landed.approve', d, { chargeId: charge.id })}><Field label="Approval reason" name="reason" /></Form>}
      </section>)}
    </Card>
    <Card title="Supplier invoices">
      <p>{po.billingStatus ?? 'Not billed'} · payment {po.paymentState ?? 'not connected'}. Approval prepares a local accountant handoff.</p>
      {accounts && <details><summary>Capture invoice</summary><Form submit="Capture invoice" busy={larder.busy} onSubmit={async d => run('po.bill.capture', d, { reference: text(d, 'reference'), currency: text(d, 'currency'), freight: text(d, 'freight') || '0', tax: text(d, 'tax') || '0', evidence: await proof(d), lines: po.lines.filter((l: any) => text(d, `quantity.${l.id}`)).map((l: any) => ({ lineId: l.id, quantity: text(d, `quantity.${l.id}`), unitPrice: text(d, `price.${l.id}`) })) })}>
        <Field label="Invoice reference" name="reference" /><Field label="Invoice currency" name="currency" defaultValue={po.currency} /><Field label="Freight" name="freight" inputMode="decimal" required={false} /><Field label="Tax" name="tax" inputMode="decimal" required={false} />
        {po.lines.map((l: any) => <div className="line" key={l.id}><Field label={`Invoice quantity for ${itemName(s, l.itemId)}`} name={`quantity.${l.id}`} inputMode="decimal" required={false} /><Field label={`Invoice unit price for ${itemName(s, l.itemId)}`} name={`price.${l.id}`} defaultValue={l.unitPrice} inputMode="decimal" required={false} /></div>)}<DecisionFields />
      </Form></details>}
      {(po.bills ?? []).map((bill: any) => <section aria-label={`Invoice ${bill.reference}`} key={bill.id}><h3>{bill.reference} · {bill.status}</h3><p>{bill.currency} {bill.amount} · freight {bill.freight} · tax {bill.tax}</p>
        <Table head={['Item', 'Invoice quantity', 'Accepted', 'Previously billed', 'Quantity variance', 'Price variance']}>{bill.lines.map((l: any) => <tr key={l.lineId}><td>{itemName(s, l.itemId)}</td><td>{l.quantity}</td><td>{l.acceptedQuantity}</td><td>{l.priorBilledQuantity}</td><td>{l.quantityVariance}</td><td>{l.priceVariance}</td></tr>)}</Table><Details label="Invoice evidence and decisions" value={bill} s={s} />
        {accounts && (owner || bill.preparedBy !== s.actor.id) && ['captured', 'resolved'].includes(bill.status) && <Form submit="Resolve reviewed variances" busy={larder.busy} note={owner && bill.preparedBy === s.actor.id ? 'Owner exception: resolving your own capture; evidence and matching safeguards still apply.' : 'Resolve independently of the invoice capturer.'} onSubmit={async d => run('po.bill.resolve', d, { billId: bill.id, evidence: await proof(d) })}><DecisionFields /></Form>}
        {owner && bill.status === 'resolved' && <Form submit="Approve invoice handoff" busy={larder.busy} onSubmit={d => run('po.bill.approve', d, { billId: bill.id })}><Field label="Invoice approval reason" name="reason" /></Form>}
      </section>)}
    </Card>
  </>
}
