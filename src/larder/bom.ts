// Versioned bills of materials with a simple routing. A revision never changes
// after it is saved; a released work order pins the revision it was made from.
import { toBase } from './catalogue'
import { decimal, format, SCALE } from './decimal'
import { validateBomGraph } from './bom-explosion'
import { fail } from './problem'
import { allow } from './roles'
import { bump, date, get, list, oneOf, optionalText, row, text, type Context, type Row, type State } from './model'

export const activeBom = (s: State, itemId: string, on = new Date().toISOString().slice(0, 10)) =>
  s.boms.filter(b => b.itemId === itemId && ['active', 'scheduled'].includes(b.status) && (!b.effectiveOn || b.effectiveOn <= on))
    .sort((a, b) => (b.effectiveOn ?? '').localeCompare(a.effectiveOn ?? '') || b.revision - a.revision)[0]

export function bom(c: Context, type: string, p: any): Row | undefined {
  if (type !== 'bom.revise') return
  allow(c, ['manager', 'production'])
  const item = get(c.s, 'items', p.itemId, 'item')
  if (item.kind !== 'make') fail('NOT_MADE', `${item.name} is bought, not made. Mark it as made before giving it a bill of materials.`)
  const components = list(p.components, 'components', 200).map((line: any) => {
    const component = get(c.s, 'items', line.itemId, 'component')
    if (component.id === item.id) fail('INPUT', 'An item cannot be a component of itself.')
    const supply = oneOf(line.supply ?? component.kind, ['make', 'buy', 'phantom'] as const, 'component supply')
    if (supply !== 'buy' && component.kind !== 'make') fail('NOT_MADE', `${component.name} must be made to use ${supply} supply.`)
    return { supply, itemId: component.id, quantity: format(toBase(component, line.quantity, line.unit, `quantity of ${component.name}`)), note: optionalText(line.note, 'note', 200) }
  })
  if (new Set(components.map(l => l.itemId)).size !== components.length) fail('INPUT', 'List each component once per revision.')
  const routing = (Array.isArray(p.routing) ? p.routing : []).slice(0, 50).map((step: any, i: number) => ({
    sequence: i + 1, name: text(step.name, 'step name', 120), workCentre: optionalText(step.workCentre, 'work center', 120),
    minutes: Number.isFinite(step.minutes) && step.minutes >= 0 && step.minutes <= 100000 ? step.minutes : fail('INPUT', 'Step minutes must be between 0 and 100000.'),
  }))
  const effectiveOn = p.effectiveOn === undefined ? c.now.slice(0, 10) : date(p.effectiveOn, 'effective date')
  if (effectiveOn < c.now.slice(0, 10) || new Date(effectiveOn + 'T00:00:00Z').toISOString().slice(0, 10) !== effectiveOn) fail('INPUT', 'A new BOM revision needs a real effective date today or later.')
  const yieldRate = format(decimal(p.yield ?? '1', 'yield', { positive: true }))
  if (decimal(yieldRate) > SCALE) fail('INPUT', 'Yield is a fraction greater than zero and at most one.')
  const immediate = effectiveOn <= c.now.slice(0, 10)
  const previous = activeBom(c.s, item.id, c.now.slice(0, 10))
  if (immediate && previous) bump(previous, { status: 'superseded' })
  const revision = Math.max(0, ...c.s.boms.filter(b => b.itemId === item.id).map(b => b.revision)) + 1
  const saved = row(c, 'boms', { itemId: item.id, revision, yield: yieldRate, components, routing, note: optionalText(p.note, 'change note', 400), effectiveOn, status: immediate ? 'active' : 'scheduled' })
  validateBomGraph(c.s, c.now.slice(0, 10))
  return saved
}
