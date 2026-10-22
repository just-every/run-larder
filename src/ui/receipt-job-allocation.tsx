import { can, itemName, locationName, rows, type Rec } from './api'
import type { Larder } from './app'
import { Choose, Field, Form, text } from './controls'
import { qty } from './format'

// BUY-008: a person reserves a receipt's accepted stock to a released job that makes a product, by hand. A manager or the owner may
// also name a reservation of another demand to take it from, with the reason.
export function ReceiptJobAllocation({ larder, receipt }: { larder: Larder; receipt: Rec }) {
  const s = larder.state!, items = [...new Set<string>(receipt.lines.filter((l: any) => l.inspection === 'accept').map((l: any) => l.itemId))]
  const jobs = rows(s, 'workOrders').filter(w => w.status === 'released' && w.components.some((l: any) => items.includes(l.itemId)))
  if (!can(s, ['manager', 'warehouse']) || !jobs.length) return null
  const reference = (id: string) => [...rows(s, 'workOrders'), ...rows(s, 'salesOrders')].find(o => o.id === id)?.reference ?? 'another demand'
  const reserved = (s.reservations ?? []).filter((r: any) => items.includes(r.itemId))
  const take = can(s, ['manager'])
  return <Form title="Allocate to a job" submit="Allocate to job" quiet busy={larder.busy} onSubmit={d => {
    const [workOrderId, itemId] = text(d, 'job').split('|'), job = jobs.find(w => w.id === workOrderId)!, from = text(d, 'from')
    const [demandId, lineId, locationId] = from.split('|')
    return larder.run('receipt.allocate.job', { receiptId: receipt.id, workOrderId, version: job.version, itemId, quantity: text(d, 'quantity'), reason: text(d, 'reason'), ...(from ? { takeFrom: [{ demandId, lineId, locationId, quantity: text(d, 'quantity') }] } : {}) })
  }} note="Reserves this receipt's accepted, unreserved stock to a released job. Quarantined, damaged and rejected stock is never allocated.">
    <Choose label="Job" name="job" options={jobs.flatMap(w => w.components.filter((l: any) => items.includes(l.itemId)).map((l: any) => ({ value: `${w.id}|${l.itemId}`, label: `${w.reference} · ${itemName(s, l.itemId)} · needs ${qty(l.required)}` })))} />
    <Field label="Quantity" name="quantity" inputMode="decimal" />
    <Field label="Reason" name="reason" />
    {take && reserved.length > 0 && <Choose label="Take from a reservation (optional)" name="from" required={false} options={reserved.map((r: any) => ({ value: `${r.demandId}|${r.lineId}|${r.locationId}`, label: `${reference(r.demandId)} · ${qty(r.quantity)} at ${locationName(s, r.locationId)}` }))} />}
  </Form>
}
