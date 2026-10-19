// Engineering proposals are a separate door; ordinary edits cannot publish a
// revision behind a pending review. Released work always retains its snapshot.
import { activeBom } from './bom'
import { fail } from './problem'
import { get, type Context, type Row, type State } from './model'

export function guardEngineeringRevision(s: State, itemId: unknown) {
  if (s.engineeringChanges.some(e => e.itemId === itemId && e.status === 'proposed'))
    fail('ENGINEERING_REVIEW', 'An engineering change is pending. Approve or decline it before saving another revision.')
}

export function engineeringReleaseBom(c: Context, w: Row): Row | undefined {
  const items = new Set<string>()
  const discover = (itemId: string) => {
    if (items.has(itemId)) return
    items.add(itemId)
    const selected = w.engineeringBomIds?.[itemId]
    const b = selected ? c.s.boms.find(b => b.id === selected) : activeBom(c.s, itemId, c.now.slice(0, 10))
    if (b && b.effectiveOn > c.now.slice(0, 10)) fail('EFFECTIVITY', `This reviewed revision becomes effective on ${b.effectiveOn}.`)
    for (const line of b?.components ?? []) if (line.supply === 'phantom') discover(line.itemId)
  }
  discover(w.itemId)
  const changes = c.s.engineeringChanges.filter(e => items.has(e.itemId))
  if (changes.some(e => e.status === 'proposed' && e.safety))
    fail('ENGINEERING_REVIEW', 'A safety-related engineering change must be approved before releasing new work.')
  const approved = [...items].map(id => changes.filter(e => e.itemId === id && e.status === 'approved').sort((a, b) => b.approvedAt.localeCompare(a.approvedAt)).at(0)).filter(Boolean)
  if (approved.some(e => !e!.acknowledgments?.some((a: any) => a.actorId === c.actor.id)))
    fail('ENGINEERING_ACK', 'Acknowledge the approved engineering change before releasing affected work.')
  if (!w.engineeringBomId) return
  const bom = get(c.s, 'boms', w.engineeringBomId, 'reviewed BOM')
  if (bom.itemId !== w.itemId) fail('INPUT', 'The reviewed BOM belongs to another item.')
  if (bom.effectiveOn > c.now.slice(0, 10)) fail('EFFECTIVITY', `This reviewed revision becomes effective on ${bom.effectiveOn}.`)
  return bom
}
