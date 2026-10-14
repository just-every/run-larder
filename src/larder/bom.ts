// Versioned bills of materials with a simple routing. A revision never changes
// after it is saved; a released work order pins the revision it was made from.
import { toBase } from './catalogue'
import { format } from './decimal'
import { fail } from './problem'
import { allow } from './roles'
import { bump, get, list, optionalText, row, text, type Context, type Row, type State } from './model'

export const activeBom = (s: State, itemId: string) => s.boms.find(b => b.itemId === itemId && b.status === 'active')

export function bom(c: Context, type: string, p: any): Row | undefined {
  if (type !== 'bom.revise') return
  allow(c, ['manager', 'production'])
  const item = get(c.s, 'items', p.itemId, 'item')
  if (item.kind !== 'make') fail('NOT_MADE', `${item.name} is bought, not made. Mark it as made before giving it a bill of materials.`)
  const components = list(p.components, 'components', 200).map((line: any) => {
    const component = get(c.s, 'items', line.itemId, 'component')
    if (component.id === item.id) fail('INPUT', 'An item cannot be a component of itself.')
    return { itemId: component.id, quantity: format(toBase(component, line.quantity, line.unit, `quantity of ${component.name}`)), note: optionalText(line.note, 'note', 200) }
  })
  if (new Set(components.map(l => l.itemId)).size !== components.length) fail('INPUT', 'List each component once per revision.')
  const routing = (Array.isArray(p.routing) ? p.routing : []).slice(0, 50).map((step: any, i: number) => ({
    sequence: i + 1, name: text(step.name, 'step name', 120), workCentre: optionalText(step.workCentre, 'work centre', 120),
    minutes: Number.isFinite(step.minutes) && step.minutes >= 0 && step.minutes <= 100000 ? step.minutes : fail('INPUT', 'Step minutes must be between 0 and 100000.'),
  }))
  const previous = activeBom(c.s, item.id)
  if (previous) bump(previous, { status: 'superseded' })
  const revision = Math.max(0, ...c.s.boms.filter(b => b.itemId === item.id).map(b => b.revision)) + 1
  return row(c, 'boms', { itemId: item.id, revision, components, routing, note: optionalText(p.note, 'change note', 400), status: 'active' })
}
