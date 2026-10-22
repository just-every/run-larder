// BUY-008: allocation of accepted receipt stock to the jobs that make a product (ct, 22 October 2026). Only a manager,
// warehouse person or owner does it, by hand, never an agent and never automatically; only to a released job (draft, closed,
// cancelled and quality-held jobs refuse); only accepted stock of that receipt that nobody has reserved (quarantined,
// damaged and rejected stock never). Taking stock reserved to another demand needs a manager or owner, a named reservation
// and a reason, and is audited. Closing the job returns what is still reserved (`wo.close`). No GOV-002 signatures: this
// moves a reservation, not value.
import { decimal, format, min } from './decimal'
import { fail, forbidden } from './problem'
import { allow } from './roles'
import { availableAt, balance, reservedQuantity, reserve } from './stock'
import { toBase } from './catalogue'
import { holdReason, workHolds } from './quality-holds'
import { fresh, get, row, text, type Context, type Row } from './model'

export function receiptJobAllocation(c: Context, type: string, p: any): Row | undefined {
  if (type !== 'receipt.allocate.job') return
  allow(c, ['manager', 'warehouse'])
  const receipt = get(c.s, 'receipts', p.receiptId, 'receipt'), job = get(c.s, 'workOrders', p.workOrderId, 'job'), reason = text(p.reason, 'reason', 400)
  fresh(job, p.version)
  if (job.status !== 'released') fail('STATE', `${job.reference} is ${job.status}. Release the job first: stock is allocated only to released jobs.`, { status: job.status })
  const hold = workHolds(c.s, job)[0]
  if (hold) fail('QUALITY_HOLD', `${job.reference} is held. ${holdReason(hold)}`, { holdId: hold.id })
  const line = job.components.find((l: any) => l.itemId === p.itemId) ?? fail('NOT_IN_BOM', `That item is not a component of ${job.reference}.`, { field: 'itemId' })
  const item = get(c.s, 'items', line.itemId, 'item'), wanted = toBase(item, p.quantity, p.unit)
  if (wanted <= 0n) fail('INPUT', 'quantity must be more than zero.', { field: 'quantity' })
  const need = decimal(line.required) - decimal(line.issued) - reservedQuantity(c.s, job.id, line.id)
  if (wanted > need) fail('INPUT', `${job.reference} still needs ${format(need > 0n ? need : 0n)} ${item.baseUnit} of ${item.name} reserved.`, { field: 'quantity', needed: format(need > 0n ? need : 0n) })

  // The receipt's accepted stock per location: a lot counts while it is available there, so quarantined, damaged and rejected lots never do.
  const stock = new Map<string, bigint>(), seen = new Set<string>()
  for (const l of receipt.lines.filter((x: any) => x.itemId === item.id && (!p.locationId || x.locationId === p.locationId))) {
    const key = `${l.locationId}|${l.lotId}`
    if (seen.has(key)) continue
    seen.add(key)
    const accepted = l.lotId ? balance(c.s, item.id, l.locationId, 'available', l.lotId) : l.inspection === 'accept' ? decimal(l.quantity) : 0n
    if (accepted > 0n) stock.set(l.locationId, (stock.get(l.locationId) ?? 0n) + accepted)
  }
  const takeFrom: { demandId: string; lineId: string; locationId: string; quantity: bigint }[] = []
  if (p.takeFrom !== undefined) {
    if (c.actor.role !== 'owner' && c.actor.role !== 'manager') forbidden('Only a manager or the owner takes stock reserved to another demand.')
    if (!Array.isArray(p.takeFrom) || !p.takeFrom.length || p.takeFrom.length > 20) fail('INPUT', 'takeFrom names the reservations to take, at most 20.', { field: 'takeFrom' })
    for (const t of p.takeFrom) {
      const r = c.s.reservations.find(x => x.demandId === t.demandId && x.lineId === t.lineId && x.itemId === item.id && x.locationId === t.locationId) ?? fail('NOT_FOUND', 'That reservation was not found.', { field: 'takeFrom' })
      if (r.demandId === job.id) fail('INPUT', 'Stock already reserved to this job is not taken again.', { field: 'takeFrom' })
      takeFrom.push({ demandId: r.demandId, lineId: r.lineId, locationId: r.locationId, quantity: decimal(t.quantity, 'quantity taken', { positive: true }) })
    }
  }

  const allocated: Record<string, unknown>[] = [], taken: Record<string, unknown>[] = []
  let left = wanted
  for (const [locationId, accepted] of stock) {
    if (left <= 0n) break
    const location = get(c.s, 'locations', locationId, 'location')
    // Reserved stock is returned by its owner's reservation, only where the person named it.
    for (const t of takeFrom.filter(x => x.locationId === locationId)) {
      const shortfall = min(left, accepted) - min(min(left, accepted), availableAt(c.s, item.id, locationId))
      const r = c.s.reservations.find(x => x.demandId === t.demandId && x.lineId === t.lineId && x.itemId === item.id && x.locationId === locationId)!
      const give = min(min(t.quantity, r.quantity), shortfall)
      if (give <= 0n) continue
      r.quantity -= give
      if (r.quantity === 0n) c.s.reservations.splice(c.s.reservations.indexOf(r), 1)
      taken.push({ demandKind: r.demandKind, demandId: r.demandId, lineId: r.lineId, reference: c.s[r.demandKind === 'work' ? 'workOrders' : 'salesOrders'].find(o => o.id === r.demandId)?.reference ?? '', locationId, quantity: format(give) })
    }
    const got = reserve(c, { demandKind: 'work', demandId: job.id, lineId: line.id, itemId: item.id }, min(left, accepted), locationId)
    if (got > 0n) allocated.push({ demandKind: 'work', demandId: job.id, lineId: line.id, reference: job.reference, itemId: item.id, locationId, quantity: format(got), reservationId: c.s.reservations.find(r => r.demandId === job.id && r.lineId === line.id && r.locationId === locationId)!.id, lots: receipt.lines.filter((x: any) => x.itemId === item.id && x.locationId === locationId && x.lotId).map((x: any) => x.lotId) })
    left -= got
  }
  if (left > 0n) fail('INSUFFICIENT_STOCK', takeFrom.length
    ? `Only ${format(wanted - left)} ${item.baseUnit} of this receipt's accepted stock can be reserved to ${job.reference} from what is free and what you named.`
    : `Only ${format(wanted - left)} ${item.baseUnit} of this receipt's accepted, unreserved stock is free. Quarantined, damaged and rejected stock is never allocated; a manager or the owner may take stock reserved to another demand (takeFrom, with a reason).`, { free: format(wanted - left), wanted: format(wanted) })
  // Reserved stock was named but not needed: nothing moves, so the unused takeFrom is a refusal, not a silent no-op.
  if (takeFrom.length && !taken.length) fail('INPUT', 'The named reservations were not needed: enough free stock covers this allocation.', { field: 'takeFrom' })
  if (c.s.reservations.some(r => r.quantity <= 0n)) fail('STATE', 'A reservation would be left empty.')
  return row(c, 'approvals', { subjectKind: 'receipts', subjectId: receipt.id, subjectVersion: receipt.version, decision: 'allocated', category: 'receipt-allocation', mode: 'job', role: c.actor.role, note: reason, workOrderId: job.id, allocated, takenFrom: taken, skipped: [] })
}
