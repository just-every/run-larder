// BUY-002: receiving against production demand. A delivery can carry supplier documents and damaged units
// (quarantined with their reason, never allocated), a PO line can carry a percentage tolerance, and a person
// with receiving authority can turn the accepted stock into hard reservations on the demand the dated plan
// pegs it to. Nothing here approves supply, ships, issues or changes a promise.
import { decimal, divide, format, max, min, times } from './decimal'
import { materialPegging } from './material-pegging'
import { allow } from './roles'
import { fail } from './problem'
import { reserve } from './stock'
import { get, row, text, type Context, type Row } from './model'

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
