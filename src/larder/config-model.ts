// ENG-003: a configuration model says which attributes, dimensions and options a made item may be sold with, which
// combinations are refused, and the rules that derive component quantities, routing and cost with formulas. A saved
// revision never changes; a quote line and a work order pin the resolved configuration (revision, choices, components,
// routing, cost and the arithmetic behind each figure), so a later rule edit never moves old work.
import { evaluate, explain, formulaNames } from './config-expr'
import { averageCost } from './stock'
import { normalizeRouting } from './routing'
import { decimal, format, times } from './decimal'
import { fail } from './problem'
import { get, list, text, type Row, type State } from './model'

export type Selection = { attributes: Record<string, string>; dimensions: Record<string, string>; options: Record<string, boolean> }
const identifier = /^[A-Za-z][A-Za-z0-9_]{0,39}$/

// The model a made item is sold with today.
export const activeModel = (s: State, itemId: unknown) => s.configModels.filter(m => m.itemId === itemId && m.status === 'active').sort((a, b) => b.revision - a.revision)[0]

function conditions(model: { attributes: any[]; dimensions: any[]; options: any[] }, when: unknown, label: string) {
  if (!when || typeof when !== 'object' || Array.isArray(when) || !Object.keys(when).length) fail('INPUT', `${label} needs at least one condition.`, { field: label })
  const out: Record<string, unknown> = {}
  for (const [name, v] of Object.entries(when as Record<string, any>)) {
    const attribute = model.attributes.find(a => a.name === name), dimension = model.dimensions.find(d => d.name === name), option = model.options.find(o => o.name === name)
    if (attribute) {
      const wanted = [...new Set<string>(Array.isArray(v) ? v : [v])]
      if (!wanted.length || wanted.some(x => !attribute.values.includes(x))) fail('INPUT', `${label} names a value that ${name} does not offer.`, { field: label })
      out[name] = wanted
    } else if (option) {
      if (typeof v !== 'boolean') fail('INPUT', `${label} must say whether ${name} is chosen (true or false).`, { field: label })
      out[name] = v
    } else if (dimension) {
      const min = v?.min === undefined ? undefined : format(decimal(v.min, `${name} minimum`)), max = v?.max === undefined ? undefined : format(decimal(v.max, `${name} maximum`))
      if (min === undefined && max === undefined) fail('INPUT', `${label} needs a minimum or maximum for ${name}.`, { field: label })
      out[name] = { ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) }
    } else fail('INPUT', `${label} names ${name}, which this model does not define.`, { field: label })
  }
  return out
}

// Validate and normalize a model's definition. Formulas are dry-run so a mistake is refused when saved, not at the quote.
export function normalizeModel(s: State, itemId: string, p: any) {
  const item = get(s, 'items', itemId, 'item')
  if (item.kind !== 'make') fail('NOT_MADE', `${item.name} is bought, not made. Only a made item has a configuration.`)
  const attributes = (Array.isArray(p.attributes) ? p.attributes : []).map((a: any) => ({ name: text(a?.name, 'attribute name', 60), values: [...new Set<string>(list(a?.values, 'attribute values', 30).map(v => text(v, 'attribute value', 60)))] }))
  const dimensions = (Array.isArray(p.dimensions) ? p.dimensions : []).map((d: any) => {
    const name = text(d?.name, 'dimension name', 40), min = decimal(d?.min, `${name} minimum`), max = decimal(d?.max, `${name} maximum`)
    if (!identifier.test(name)) fail('INPUT', 'A dimension name is letters, digits and underscores, starting with a letter.', { field: 'dimensions' })
    if (min > max || max === 0n) fail('INPUT', `${name} needs a minimum not above its maximum.`, { field: 'dimensions' })
    return { name, unit: text(d?.unit, 'dimension unit', 20), min: format(min), max: format(max) }
  })
  const options = (Array.isArray(p.options) ? p.options : []).map((o: any) => ({ name: text(o?.name, 'option name', 40) }))
  for (const o of options) if (!identifier.test(o.name)) fail('INPUT', 'An option name is letters, digits and underscores, starting with a letter.', { field: 'options' })
  const every = [...attributes.map((a: any) => a.name), ...dimensions.map((d: any) => d.name), ...options.map((o: any) => o.name)]
  if (!every.length) fail('INPUT', 'Define at least one attribute, dimension or option.')
  if (new Set(every).size !== every.length) fail('INPUT', 'Attribute, dimension and option names must all differ.')
  const model = { attributes, dimensions, options }
  const probe: Record<string, bigint> = Object.fromEntries([...dimensions.map((d: any) => [d.name, decimal(d.max)]), ...options.map((o: any) => [o.name, 1n])])
  const dry = (formula: unknown, label: string) => { const f = text(formula, label, 200); for (const n of formulaNames(f)) if (!(n in probe)) fail('FORMULA', `${label} uses ${n}, which is not a dimension or option of this model.`, { formula: f }); evaluate(f, probe); return f }
  const rules = list(p.rules, 'rules', 60).map((r: any, i: number) => {
    const name = text(r?.name, 'rule name', 120), label = `rule "${name}"`
    const components = (Array.isArray(r.components) ? r.components : []).map((l: any) => {
      const component = get(s, 'items', l?.itemId, 'component')
      if (component.id === item.id) fail('INPUT', 'An item cannot be a component of itself.')
      if (component.kind === 'make' && !activeModelFree(s, component.id)) fail('INPUT', `${component.name} is itself configurable; list its components instead.`)
      return { itemId: component.id, quantity: dry(l.quantity, `${label} quantity of ${component.name}`) }
    })
    const routing = (Array.isArray(r.routing) ? r.routing : []).map((l: any) => ({ name: text(l?.name, 'step name', 120), workCentre: text(l?.workCentre, 'work center', 120), setupMinutes: dry(l?.setupMinutes ?? '0', `${label} setup minutes`), runMinutes: dry(l?.runMinutes, `${label} run minutes`) }))
    if (!components.length && !routing.length && !r.cost) fail('INPUT', `${label} derives nothing: give it components, routing or a cost.`)
    return { id: `r${i + 1}`, name, when: r.when === undefined ? null : conditions(model, r.when, `${label} condition`), components, routing, ...(r.cost === undefined ? {} : { cost: dry(r.cost, `${label} cost`) }), note: typeof r.note === 'string' ? r.note.slice(0, 400) : '' }
  })
  const invalid = (Array.isArray(p.invalid) ? p.invalid : []).map((r: any, i: number) => ({ id: `x${i + 1}`, when: conditions(model, r?.when, `invalid combination ${i + 1}`), reason: text(r?.reason, 'reason an invalid combination is refused', 400) }))
  return { itemId: item.id, ...model, rules, invalid }
}
const activeModelFree = (s: State, itemId: string) => !activeModel(s, itemId)

const matches = (when: Record<string, any> | null, choice: Selection) => !when || Object.entries(when).every(([name, v]) => {
  if (name in choice.attributes) return (v as string[]).includes(choice.attributes[name])
  if (name in choice.options) return choice.options[name] === v
  const n = decimal(choice.dimensions[name]); return (v.min === undefined || n >= decimal(v.min)) && (v.max === undefined || n <= decimal(v.max))
})

// Check a choice against the model and normalize it. Anything not permitted is refused with the reason.
export function checkSelection(model: Row, input: any): Selection {
  const choice: Selection = { attributes: {}, dimensions: {}, options: {} }
  for (const a of model.attributes) {
    const v = input?.attributes?.[a.name]
    if (typeof v !== 'string' || !a.values.includes(v)) fail('INVALID_CONFIGURATION', `Choose ${a.name}: ${a.values.join(', ')}.`, { field: a.name })
    choice.attributes[a.name] = v
  }
  for (const d of model.dimensions) {
    const v = decimal(input?.dimensions?.[d.name], d.name, { positive: true })
    if (v < decimal(d.min) || v > decimal(d.max)) fail('INVALID_CONFIGURATION', `${d.name} must be from ${d.min} to ${d.max} ${d.unit}.`, { field: d.name })
    choice.dimensions[d.name] = format(v)
  }
  for (const o of model.options) choice.options[o.name] = input?.options?.[o.name] === true
  for (const x of model.invalid) if (matches(x.when, choice)) fail('INVALID_CONFIGURATION', x.reason, { rule: x.id })
  return choice
}

// What a choice makes: components per unit, routing and cost, each with the rule and arithmetic that produced it.
export function resolveConfiguration(s: State, model: Row, input: unknown) {
  const choice = checkSelection(model, input)
  const values: Record<string, bigint> = Object.fromEntries([...Object.entries(choice.dimensions).map(([k, v]) => [k, decimal(v)]), ...Object.entries(choice.options).map(([k, v]) => [k, v ? 1n : 0n])])
  const applied = model.rules.filter((r: any) => matches(r.when, choice))
  const parts = new Map<string, { itemId: string; quantity: bigint; because: { rule: string; formula: string }[] }>()
  for (const r of applied) for (const l of r.components) {
    const q = evaluate(l.quantity, values)
    if (q < 0n) fail('INVALID_CONFIGURATION', `${r.name} derives a negative quantity for this choice.`, { rule: r.id })
    if (q === 0n) continue
    const held = parts.get(l.itemId) ?? { itemId: l.itemId, quantity: 0n, because: [] as { rule: string; formula: string }[] }
    held.quantity += q; held.because.push({ rule: r.name, formula: explain(l.quantity, values) }); parts.set(l.itemId, held)
  }
  const components = [...parts.values()].map(l => {
    const item = get(s, 'items', l.itemId, 'component'), standard = item.standardCost ? decimal(item.standardCost) : 0n, unitCost = standard > 0n ? standard : averageCost(s, item.id)
    return { itemId: l.itemId, quantity: format(l.quantity), unitCost: format(unitCost), cost: format(times(l.quantity, unitCost)), because: l.because }
  })
  const steps = applied.flatMap((r: any) => r.routing.map((l: any) => ({ step: { name: l.name, workCentre: l.workCentre, setupMinutes: Number(format(evaluate(l.setupMinutes, values))), runMinutes: Number(format(evaluate(l.runMinutes, values))) }, because: { rule: r.name, setup: explain(l.setupMinutes, values), run: explain(l.runMinutes, values) } })))
  const routing = normalizeRouting(steps.map((x: any) => x.step)).map((step: any, i: number) => ({ ...step, because: steps[i].because }))
  const extras = applied.flatMap((r: any) => r.cost ? [{ rule: r.name, amount: evaluate(r.cost, values), formula: explain(r.cost, values) }] : [])
  if (!components.length) fail('INVALID_CONFIGURATION', 'No rule derives a component for this choice.')
  const materials = components.reduce((n: bigint, l: any) => n + decimal(l.cost), 0n), extra = extras.reduce((n: bigint, x: any) => n + x.amount, 0n)
  return {
    modelId: model.id, itemId: model.itemId, revision: model.revision, selection: choice, components, routing,
    cost: { materials: format(materials), extra: format(extra), unit: format(materials + extra), extras: extras.map((x: any) => ({ rule: x.rule, amount: format(x.amount), formula: x.formula })) },
    explanation: [...Object.entries(choice.attributes).map(([k, v]) => `${k}: ${v}`), ...Object.entries(choice.dimensions).map(([k, v]) => `${k}: ${v}`), ...Object.entries(choice.options).filter(([, v]) => v).map(([k]) => `${k}: yes`)].join('; '),
  }
}
