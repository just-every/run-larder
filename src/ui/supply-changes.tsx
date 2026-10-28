import { useEffect, useState } from 'react'
import { can, rows, type Rec } from './api'
import type { Larder } from './app'
import { Chip, Choose, Field, Form, text } from './controls'
import { day, qty } from './format'

const noun: Record<string, string> = { expedite: 'Ask for it sooner', defer: 'Ask for it later', cancel: 'Cancel the unneeded quantity' }

// MRP-007: the recommendations on one purchase order, each with the orders it affects, and the decision.
export function SupplyChanges({ larder, po }: { larder: Larder; po: Rec }) {
  const s = larder.state!, [plan, setPlan] = useState<any>(null), [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController(); setError('')
    fetch('/api/larder/planning/supply-changes', { signal: controller.signal, credentials: 'same-origin', cache: 'no-store' }).then(async r => { const b: any = await r.json(); if (!r.ok) throw Error(b.error?.message ?? 'Recommendations could not load.'); setPlan(b) }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [s.version])
  const mine = (plan?.recommendations ?? []).filter((r: any) => r.poId === po.id)
  if (error) return <p role="alert">{error}</p>
  if (!mine.length) return null
  const decide = can(s, ['manager', 'buyer'])
  return <div aria-label="Supply change recommendations"><h3>Supply changes to consider</h3>
    {mine.map((r: any) => <div className="line" key={r.key}>
      <p><Chip tone={r.kind === 'expedite' ? 'warn' : 'info'}>{noun[r.kind] ?? r.kind}</Chip> {qty(r.quantity)} {r.requestedDate && <>by {day(r.requestedDate)}</>}</p>
      <p className="muted">{r.reason}</p>
      {r.affected.length > 0 && <ul>{r.affected.map((a: any, i: number) => <li key={i}>{a.reference} needs {qty(a.shortage ?? a.quantity)} by {day(a.requiredBy)}</li>)}</ul>}
      {r.requested && <p className="muted">Requested: {r.requested.reason}</p>}
      {decide && !r.requested && <Form submit="Record decision" quiet busy={larder.busy} onSubmit={d => larder.run(`supply.change.${text(d, 'decision')}`, { key: r.key, version: plan.version, asOf: plan.asOf, inputsDigest: r.inputsDigest, reason: text(d, 'reason') })}>
        <Choose label="Decision" name="decision" options={[{ value: 'approve', label: 'Approve' }, { value: 'reject', label: 'Reject' }]} /><Field label="Reason" name="reason" />
      </Form>}
    </div>)}
    <p className="muted">An approved change is recorded as a request. The supplier's date changes only when you revise or confirm it; nothing is sent.</p>
  </div>
}

// BUY-002: reserve a receipt's accepted stock for the jobs and orders the dated plan pegs it to.
export function ReceiptAllocation({ larder, receipt }: { larder: Larder; receipt: Rec }) {
  const s = larder.state!, allocations = rows(s, 'approvals').filter(a => a.category === 'receipt-allocation' && a.subjectId === receipt.id)
  const allocate = async () => {
    const res = await fetch(`/api/larder/planning/pegging?kind=receipt&id=${receipt.id}`, { credentials: 'same-origin', cache: 'no-store' }), pegs: any = await res.json()
    if (!res.ok) return false
    return larder.run('receipt.allocate', { receiptId: receipt.id, version: pegs.version, asOf: pegs.asOf, reason: 'Allocate the accepted stock to the demand it is pegged to' })
  }
  return <span>{can(s, ['manager', 'warehouse']) && <button type="button" className="button" disabled={larder.busy} onClick={() => void allocate()}>Allocate accepted stock</button>}
    {allocations.map(a => <small key={a.id}> Allocated {a.allocated.map((x: any) => `${qty(x.quantity)} to ${x.reference}`).join(', ') || 'nothing new'}{(a.takenFrom ?? []).length > 0 && `, taking ${a.takenFrom.map((x: any) => `${qty(x.quantity)} from ${x.reference}`).join(', ')}`}{a.skipped.length > 0 && `; ${a.skipped.length} not allocated`}.</small>)}</span>
}
