// The exception queue: everything that needs a person, computed from current
// records. Resolving an exception records who decided and why; it reappears if
// the underlying record changes.
import { day } from './day'
import { shortages } from './planning'
import { positions } from './stock'
import { lotStatuses } from './lot-dates'
import { fail } from './problem'
import { allow } from './roles'
import { row, text, type Context, type Row, type State } from './model'

export type Exception = { key: string; kind: string; title: string; detail: string; view: string; id: string; resolvable: boolean }

export function exceptions(s: State, today: string): Exception[] {
  const out: Exception[] = []
  const name = (id: string) => { const i = s.items.find(x => x.id === id); if (!i) return 'item'; const v = Object.values(i.attributes ?? {}).join(', '); return v ? `${i.name} (${v})` : i.name }
  for (const x of shortages(s)) out.push({ key: `shortage:${x.itemId}:${x.shortage}`, kind: 'shortage', title: `${name(x.itemId)} is short ${x.shortage}`, detail: x.reasons.map(r => `${r.reference} needs ${r.quantity} by ${day(r.date)}`).join('; '), view: 'plan', id: x.itemId, resolvable: true })
  for (const p of positions(s).filter(p => p.status === 'quarantine')) out.push({ key: `quarantine:${p.itemId}:${p.locationId}:${p.lotId}:${p.quantity}`, kind: 'quarantine', title: `${p.quantity} ${name(p.itemId)} waiting for a quality decision`, detail: `${s.locations.find(l => l.id === p.locationId)?.name}${p.lotId ? `, lot ${s.lots.find(l => l.id === p.lotId)?.code}` : ''}`, view: 'stock', id: p.itemId, resolvable: false })
  for (const po of s.purchaseOrders) {
    if (po.status === 'draft') out.push({ key: `po-approval:${po.id}:${po.version}`, kind: 'approval', title: `${po.reference} waits for approval`, detail: po.reason, view: 'purchase', id: po.id, resolvable: false })
    if (['approved', 'confirmed', 'part received'].includes(po.status) && po.expectedDate < today) out.push({ key: `po-late:${po.id}:${po.version}`, kind: 'late', title: `${po.reference} is overdue (expected ${day(po.expectedDate)})`, detail: s.parties.find(p => p.id === po.supplierId)?.name ?? '', view: 'purchase', id: po.id, resolvable: true })
  }
  for (const c of s.counts.filter(c => c.status === 'awaiting approval')) out.push({ key: `count:${c.id}:${c.version}`, kind: 'approval', title: `${c.reference}: count differs by ${c.variance}`, detail: name(c.itemId), view: 'stock', id: c.id, resolvable: false })
  for (const p of s.proposals.filter(p => p.status === 'awaiting approval')) out.push({ key: `proposal:${p.id}:${p.version}`, kind: 'proposal', title: p.summary, detail: `Prepared ${p.kind.replace('-', ' ')}`, view: 'today', id: p.id, resolvable: false })
  for (const h of s.handoffs.filter(h => h.status !== 'acknowledged')) out.push({ key: `handoff:${h.id}:${h.version}`, kind: h.status === 'mismatch' ? 'mismatch' : 'handoff', title: `${h.reference} ${h.status === 'mismatch' ? 'has amounts that differ from the ledger' : 'is not fully acknowledged'}`, detail: `${h.lines.length} lines`, view: 'handoff', id: h.id, resolvable: h.status === 'mismatch' })
  for (const w of s.workOrders.filter(w => w.status === 'released' && (w.shortages ?? []).length)) out.push({ key: `wo-short:${w.id}:${w.version}`, kind: 'shortage', title: `${w.reference} is missing materials`, detail: w.shortages.map((x: any) => `${name(x.itemId)} ${x.short}`).join(', '), view: 'make', id: w.id, resolvable: true })
  for (const i of s.imports.filter(i => i.status === 'previewed' && i.rejected.length)) out.push({ key: `import:${i.id}:${i.version}`, kind: 'import', title: `Move-in preview has ${i.rejected.length} rejected rows`, detail: i.label, view: 'move-in', id: i.id, resolvable: true })
  for (const l of lotStatuses(s, today).filter(l => l.onHand !== '0' && l.state !== 'current')) out.push(l.state === 'expiring'
    ? { key: `expiring:${l.lotId}:${l.expiresOn}`, kind: 'expiry', title: `Lot ${l.code} of ${name(l.itemId)} expires ${day(l.expiresOn)} (${l.remainingDays} days)`, detail: `${l.onHand} on hand`, view: 'stock', id: l.lotId, resolvable: true }
    : { key: `blocked-lot:${l.lotId}:${l.expiresOn}:${l.retestOn}`, kind: 'expiry', title: `Lot ${l.code} of ${name(l.itemId)} ${l.reason}`, detail: `${l.onHand} on hand is blocked until an owner or manager records its disposition`, view: 'stock', id: l.lotId, resolvable: false })
  const resolved = new Set(s.resolutions.map(r => r.key))
  return out.filter(x => !resolved.has(x.key))
}

export function resolutions(c: Context, type: string, p: any): Row | undefined {
  if (type !== 'exception.resolve') return
  allow(c, ['manager'])
  const x = exceptions(c.s, c.now.slice(0, 10)).find(e => e.key === p.key) ?? fail('NOT_FOUND', 'That exception is no longer open.')
  if (!x.resolvable) fail('NOT_RESOLVABLE', 'Resolve this by doing the work it points to.')
  return row(c, 'resolutions', { key: x.key, kind: x.kind, title: x.title, note: text(p.note, 'note', 1000) })
}
