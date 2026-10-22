// BUY-002: receiving against production demand. A delivery can carry supplier documents and damaged units
// (quarantined with their reason, never allocated), a PO line can carry a percentage tolerance (0 unless the
// buyer sets up to 20; a delivery past it is refused, never accepted silently; above 10 percent on an order
// at or above the owner's spend threshold the setting needs the GOV-002 signatures), and a person with
// receiving authority can turn the accepted stock into hard reservations on the demand the dated plan pegs
// it to. Nothing here approves supply, ships, issues or changes a promise.
import { decimal, divide, format, max, min, times } from './decimal'
import { materialPegging } from './material-pegging'
import { gate } from './approval-policy'
import { allow } from './roles'
import { fail } from './problem'
import { reserve } from './stock'
import { bump, get, row, text, type Context, type Row } from './model'

const hundred = decimal('100')

// How many base units past the ordered quantity a delivery may bring, and how few still complete the line.
export const toleranceUnits = (line: any) => times(decimal(line.quantity), divide(decimal(line.tolerancePercent ?? '0'), hundred))
export const overAllowance = (line: any) => decimal(line.quantity) - decimal(line.received) + toleranceUnits(line)
export const completeWithinTolerance = (line: any) => decimal(line.received) > 0n && decimal(line.received) < decimal(line.quantity) && decimal(line.received) >= decimal(line.quantity) - toleranceUnits(line)

export function tolerancePercent(value: unknown): string {
  const percent = value === undefined || value === null || value === '' ? 0n : decimal(value, 'tolerance percent')
  if (percent < 0n || percent > decimal('20')) fail('INPUT', 'A delivery tolerance is between 0 and 20 percent.')
  return format(percent)
}

// The damaged part of a delivered line: how many units, and why. The rest of the line is received as given.
export function damaged(input: any, delivered: bigint): { quantity: bigint; reason: string } | null {
  if (input === undefined || input === null) return null
  const quantity = decimal(input.quantity, 'damaged quantity', { positive: true })
  if (quantity > delivered) fail('INPUT', 'More units are damaged than were delivered on that line.')
  return { quantity, reason: text(input.reason, 'damage reason', 400) }
}

// receipt.allocate reserves the receipt's accepted, still-unreserved stock for the direct sales and work demand the
// dated plan pegs it to (a sales line, or a released job's pinned component), in the plan's own date order. Demand reached
// only through a make path (kind dependent) stays unallocated.
export function receiving(c: Context, type: string, p: any): Row | undefined {
  if (type === 'po.tolerance') return setTolerance(c, p)
  if (type !== 'receipt.allocate') return
  allow(c, ['manager', 'warehouse'])
  const receipt = get(c.s, 'receipts', p.receiptId, 'receipt'), reason = text(p.reason, 'reason', 400)
  const pegs = materialPegging(c.s, new URLSearchParams({ kind: 'receipt', id: receipt.id }))
  if (p.version !== pegs.version || p.asOf !== pegs.asOf) fail('STALE', 'Planning inputs or the UTC day changed. Read the receipt pegs again.')
  const allocated: Record<string, unknown>[] = [], skipped: Record<string, unknown>[] = []
  for (const peg of pegs.pegs) {
    const source = peg.source as { kind: string; locationId?: string; lotId?: string; quantity: string; reserved: boolean }
    if (source.kind !== 'stock' || source.reserved) continue
    const demand = peg.demand, entry = { demandKind: demand.kind, demandId: demand.documentId, lineId: demand.lineId, reference: demand.reference, itemId: demand.itemId, lotId: source.lotId ?? '', locationId: source.locationId ?? '' }
    if (!['sales', 'work'].includes(demand.kind)) { skipped.push({ ...entry, quantity: source.quantity, reason: 'demand is reached through a make path; reserve it on the order or job that needs it' }); continue }
    const took = reserve(c, { demandKind: demand.kind as 'sales' | 'work', demandId: demand.documentId, lineId: demand.lineId, itemId: demand.itemId }, decimal(source.quantity), source.locationId)
    if (took > 0n) allocated.push({ ...entry, quantity: format(took) })
    if (took < decimal(source.quantity)) skipped.push({ ...entry, quantity: format(decimal(source.quantity) - took), reason: 'stock at that bin is already reserved elsewhere' })
  }
  return row(c, 'approvals', { subjectKind: 'receipts', subjectId: receipt.id, subjectVersion: receipt.version, decision: 'allocated', category: 'receipt-allocation', role: c.actor.role, note: reason, allocated, skipped })
}

// A line's delivery tolerance is the buyer's (or a manager's) to set, audited with its reason. On an order at or
// above the owner's spend threshold, a tolerance above this many percent needs the policy signatures on the exact setting.
const signedAbove = decimal('10')
function setTolerance(c: Context, p: any): Row {
  allow(c, ['manager', 'buyer'])
  const po = get(c.s, 'purchaseOrders', p.poId, 'purchase order'), line = po.lines.find((l: any) => l.id === p.lineId) ?? fail('NOT_FOUND', 'That purchase order line was not found.', { lineId: p.lineId })
  if (po.version !== p.version) fail('STALE', 'This order changed since you opened it. Reload and review the current version.', { currentVersion: po.version })
  if (!['draft', 'approved', 'confirmed', 'part received'].includes(po.status)) fail('STATE', 'Set a tolerance on a draft or open purchase order.')
  const percent = tolerancePercent(p.tolerancePercent), reason = text(p.reason, 'reason', 400)
  // A draft is approved later on its exact lines, tolerance included; an open order is signed for the change itself.
  const signed = po.status !== 'draft' && decimal(percent) > signedAbove ? gate(c, { category: 'spend', subjectKind: 'purchaseOrders', subject: po, measure: () => decimal(po.exposure), permitted: ['manager', 'buyer'], terms: { decision: 'tolerance', lineId: line.id, tolerancePercent: percent }, p }) : null
  if (signed && 'pending' in signed) return signed.pending
  const was = line.tolerancePercent
  line.tolerancePercent = percent
  po.history.push({ at: c.now, by: c.actor.id, change: 'delivery tolerance set', line: line.id, from: was, to: percent, note: reason, ...(signed ? { signatureIds: signed.signatureIds, override: signed.override } : {}) })
  signed?.consume(po.id)
  return bump(po, {})
}
