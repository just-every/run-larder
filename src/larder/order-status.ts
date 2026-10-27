import { activeBom } from './bom'
import { deliveries, firstPromise } from './sales-schedules'
import { resolvedComponents } from './bom-explosion'
import { open } from './availability'
import { decimal, format, max, min } from './decimal'
import type { Row, State } from './model'
import { combined, supplyAllocator, type IngredientStatus, type ProductionStatus, type StatusLine } from './order-supply'

export type OrderStatus = { id: string; rank: number; ingredientStatus: IngredientStatus; productionStatus: ProductionStatus; lines: StatusLine[] }
type Entry = { kind: 'sales' | 'work'; row: Row; rank: number }
const explicit = (r: Row) => Number.isSafeInteger(r.rank) && r.rank > 0 && r.rank <= 1000000
const due = (r: Row) => r.promiseDate ? firstPromise(r) : r.requiredBy ?? ''
const remaining = (w: Row) => max(0n, decimal(w.quantity) - decimal(w.output) - decimal(w.scrap))
const incomplete = (status: IngredientStatus) => status === 'Not available' || status === 'No BOM'

export function orderStatuses(s: State, on = new Date().toISOString().slice(0, 10)): { sales: OrderStatus[]; work: OrderStatus[] } {
  const entries: Entry[] = [
    ...s.salesOrders.map(row => ({ kind: 'sales' as const, row, rank: 0 })),
    ...s.workOrders.map(row => ({ kind: 'work' as const, row, rank: 0 })),
  ].sort((a, b) => Number(!explicit(a.row)) - Number(!explicit(b.row)) ||
    (explicit(a.row) && explicit(b.row) ? a.row.rank - b.row.rank : 0) || due(a.row).localeCompare(due(b.row)) ||
    (a.row.createdAt ?? '').localeCompare(b.row.createdAt ?? '') || a.row.id.localeCompare(b.row.id))
  let next = Math.max(0, ...entries.filter(e => explicit(e.row)).map(e => e.row.rank))
  for (const e of entries) e.rank = explicit(e.row) ? e.row.rank : ++next
  const allocate = supplyAllocator(s, on), result = { sales: [] as OrderStatus[], work: [] as OrderStatus[] }
  for (const { kind, row: r, rank } of entries) {
    const lines: StatusLine[] = []
    if (kind === 'work') {
      const live = ['draft', 'released'].includes(r.status), bom = r.status === 'draft' ? (r.engineeringBomId ? s.boms.find(b => b.id === r.engineeringBomId) : activeBom(s, r.itemId, on)) : undefined
      const components = r.status === 'draft' ? (bom ? resolvedComponents(s, bom, decimal(r.quantity), on, r.engineeringBomIds).components : undefined) : r.components
      if (live && components) for (const l of components) {
        const need = r.status === 'draft' ? decimal(l.quantity) : max(0n, decimal(l.required) - decimal(l.issued))
        lines.push(allocate(l.itemId, need, r.id, l.id ?? `${r.id}:${l.itemId}`, r.reference))
      }
      const ingredientStatus: IngredientStatus = live && !components ? 'No BOM' : combined(lines)
      const productionStatus: ProductionStatus = !live || remaining(r) === 0n ? 'done' :
        decimal(r.output) > 0n || (r.components ?? []).some((l: any) => decimal(l.issued) > 0n) ? 'in progress' : incomplete(ingredientStatus) ? 'blocked' : 'not started'
      for (const l of lines) l.productionStatus = productionStatus
      result.work.push({ id: r.id, rank, ingredientStatus, productionStatus, lines })
    } else {
      const live = ['quote', 'confirmed', 'part shipped'].includes(r.status)
      for (const l of r.lines) {
        const need = live ? max(0n, open(l)) : 0n
        const line = allocate(l.itemId, need, r.id, l.id, r.reference)
        const item = s.items.find(i => i.id === l.itemId)
        if (item?.kind === 'make' && line.ingredientStatus === 'Expected' && !line.supplies.some(p => p.kind === 'purchase')) line.ingredientStatus = 'In stock'
        const uncovered = decimal(line.missing)
        if (uncovered > 0n && item?.kind === 'make') {
          const bom = activeBom(s, item.id, on)
          if (!bom) line.ingredientStatus = 'No BOM'
          else {
            const resolved = resolvedComponents(s, bom, uncovered, on).components
            line.ingredients = resolved.map((c: any) => allocate(c.itemId, decimal(c.quantity), r.id, `${l.id}:${c.itemId}`, r.reference))
            // A recipe's shortages are expressed in product units at the parent,
            // while each ingredient retains its own quantity and supply units.
            let covered = uncovered
            for (let i = 0; i < resolved.length; i++) {
              const per = decimal(resolved[i].quantity), ingredient = line.ingredients![i]
              if (per > 0n) covered = min(covered, max(0n, decimal(ingredient.required) - decimal(ingredient.missing)) * uncovered / per)
            }
            line.missing = format(max(0n, uncovered - covered))
            line.ingredientStatus = combined(line.ingredients!)
            if (line.ingredientStatus === 'In stock' && line.supplies.some(p => p.kind === 'purchase')) line.ingredientStatus = 'Expected'
          }
        }
        line.productionStatus = need === 0n ? 'done' : decimal(line.available) >= need ? 'ready to ship' :
          incomplete(line.ingredientStatus) ? 'blocked' : decimal(l.shipped ?? '0') > 0n ? 'in progress' : 'not started'
        Object.assign(line, { schedules: deliveries(r, l) })
        lines.push(line)
      }
      result.sales.push({ id: r.id, rank, ingredientStatus: combined(lines), productionStatus: salesProgress(lines), lines })
    }
  }
  // MOs already consumed their components once. Consumers follow those actual
  // results rather than allocating the supplying MO's ingredients again.
  const work = new Map(result.work.map(w => [w.id, w]))
  const dependenciesOf = (w: OrderStatus) => w.lines.flatMap(l => l.supplies).filter(p => p.kind === 'work').map(p => p.documentId)
  const circular = (id: string, visiting = new Set<string>()): boolean => {
    if (visiting.has(id)) return true
    const w = work.get(id)
    if (!w) return false
    const path = new Set(visiting); path.add(id)
    return dependenciesOf(w).some(next => circular(next, path))
  }
  for (const w of result.work) if (circular(w.id)) {
    w.ingredientStatus = 'Not available'
    if (w.productionStatus === 'not started') w.productionStatus = 'blocked'
    for (const l of w.lines) if (l.supplies.some(p => p.kind === 'work')) l.ingredientStatus = 'Not available'
  }
  const salesIds = new Set(result.sales.map(o => o.id))
  const base = new Map(result.sales.flatMap(o => o.lines.map(l => [l, l.ingredientStatus] as const)))
  for (let pass = 0; pass <= result.work.length; pass++) {
    let changed = false
    for (const o of [...result.work, ...result.sales]) for (const line of o.lines) {
      for (const ingredient of line.ingredients ?? []) {
        if (ingredient.supplies.some(p => p.kind === 'work' && incomplete(work.get(p.documentId)?.ingredientStatus ?? 'Not available'))) ingredient.ingredientStatus = 'Not available'
      }
      const dependencies = [...line.supplies, ...(line.ingredients ?? []).flatMap(i => i.supplies)]
        .filter(p => p.kind === 'work').map(p => work.get(p.documentId)).filter((w): w is OrderStatus => !!w)
      if (salesIds.has(o.id)) {
        const previous = line.ingredientStatus
        line.ingredientStatus = combined([{ ingredientStatus: base.get(line)! }, ...dependencies.map(w => ({ ingredientStatus: w.ingredientStatus }))])
        if (previous !== line.ingredientStatus) changed = true
      }
      if (dependencies.some(w => incomplete(w.ingredientStatus)) && !incomplete(line.ingredientStatus)) {
        line.ingredientStatus = 'Not available'; line.productionStatus = 'blocked'; changed = true
      } else if (dependencies.some(w => w.productionStatus === 'in progress') && line.productionStatus === 'not started') line.productionStatus = 'in progress'
      o.ingredientStatus = combined(o.lines)
      if (salesIds.has(o.id)) o.productionStatus = salesProgress(o.lines)
      else if (o.productionStatus === 'not started' && incomplete(o.ingredientStatus)) o.productionStatus = 'blocked'
    }
    if (!changed) break
  }
  for (const o of result.sales) for (const l of o.lines) {
    l.supplyingWork = l.supplies.filter(p => p.kind === 'work').map(p => ({ documentId: p.documentId, quantity: p.quantity, lines: work.get(p.documentId)?.lines ?? [] }))
    if (incomplete(l.ingredientStatus) && !['done', 'ready to ship'].includes(l.productionStatus)) l.productionStatus = 'blocked'
    o.productionStatus = salesProgress(o.lines)
  }
  return result
}

function salesProgress(lines: StatusLine[]): ProductionStatus {
  if (lines.every(l => l.productionStatus === 'done')) return 'done'
  if (lines.every(l => ['done', 'ready to ship'].includes(l.productionStatus))) return 'ready to ship'
  if (lines.some(l => l.productionStatus === 'blocked')) return 'blocked'
  if (lines.some(l => ['in progress', 'done', 'ready to ship'].includes(l.productionStatus))) return 'in progress'
  return 'not started'
}
