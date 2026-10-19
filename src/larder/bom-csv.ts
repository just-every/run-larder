import { activeBom } from './bom'
import { toBase } from './catalogue'
import { decimal, format, SCALE } from './decimal'
import { optionalText, text, type Row, type State } from './model'
import { parseCsv } from './odoo/csv'

const headers = ['item_sku', 'revision', 'effective_on', 'component_sku', 'quantity', 'unit', 'routing', 'note', 'yield', 'supply']
const today = () => new Date().toISOString().slice(0, 10)
const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
// Only free-text cells are escaped. SKU identifiers must retain their exact bytes.
const risky = /^[\s]*[=+\-@\t\r\n]/
const protect = (value: string) => risky.test(value) || value.startsWith("'") ? "'" + value : value
const unprotect = (value: string) => value.startsWith("'") && (risky.test(value.slice(1)) || value.startsWith("''")) ? value.slice(1) : value

export function bomCsv(s: State): string {
  const rows: unknown[][] = [headers]
  for (const item of s.items.filter(i => i.kind === 'make' && !i.archived)) {
    const bom = activeBom(s, item.id)
    if (!bom) continue
    const routing = JSON.stringify((bom.routing ?? []).map((step: any) => ({ name: step.name, workCentre: step.workCentre ?? '', minutes: step.minutes })))
    for (const component of bom.components) {
      const part = s.items.find(i => i.id === component.itemId)
      if (!part) throw new Error(`BOM ${bom.id} references a missing component.`)
      const effectiveOn = bom.effectiveOn && bom.effectiveOn > today() ? bom.effectiveOn : today()
      rows.push([item.sku, bom.revision, effectiveOn, part.sku, component.quantity, part.baseUnit, routing, protect(bom.note ?? ''), bom.yield ?? '1', component.supply ?? part.kind])
    }
  }
  return rows.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n'
}

type CsvError = { file: string; row: number; column: string; reason: string }
type Group = { revision: any; invalid: boolean; seen: Set<string>; metadata: Record<string, string> }
const reason = (error: unknown) => error instanceof Error ? error.message : String(error)

function routing(value: string) {
  const parsed = JSON.parse(value)
  if (!Array.isArray(parsed) || parsed.length > 50) throw new Error('Routing must be an array of at most 50 steps.')
  return parsed.map((step: any, index: number) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)
      || Object.keys(step).some(key => !['name', 'workCentre', 'minutes', 'sequence'].includes(key))) throw new Error(`Routing step ${index + 1} has invalid fields.`)
    if (step.sequence !== undefined && step.sequence !== index + 1) throw new Error('Routing step sequence must match its array order.')
    if (typeof step.minutes !== 'number' || !Number.isFinite(step.minutes) || step.minutes < 0 || step.minutes > 100000) throw new Error('Step minutes must be between 0 and 100000.')
    return { name: text(step.name, 'step name', 120), workCentre: optionalText(step.workCentre, 'work center', 120), minutes: step.minutes }
  })
}

// Record physical starting lines, including quoted newlines and skipped blank rows.
function rowLines(content: string): number[] {
  const lines: number[] = []
  let quoted = false, line = 1, start = 1, occupied = false
  for (let i = content.startsWith('\uFEFF') ? 1 : 0; i < content.length; i++) {
    const ch = content[i]
    if (ch === '"') {
      if (quoted && content[i + 1] === '"') { i++; occupied = true }
      else quoted = !quoted
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && content[i + 1] === '\n') i++
      line++
      if (!quoted) { if (occupied) lines.push(start); occupied = false; start = line }
      else occupied = true
    } else if (ch !== ',') occupied = true
  }
  if (occupied) lines.push(start)
  return lines
}

export function parseBomCsv(s: State, content: string, file: string): { revisions: any[]; errors: CsvError[] } {
  const errors: CsvError[] = [], groups = new Map<string, Group>()
  const error = (row: number, column: string, message: string) => { errors.push({ file, row, column, reason: message }) }
  let rows: string[][]
  try { rows = parseCsv(content, file) }
  catch (e) { error(Number(/line (\d+)/.exec(reason(e))?.[1] ?? 1), 'file', reason(e)); return { revisions: [], errors } }
  const lines = rowLines(content), header = rows.shift()
  if (!header) { error(1, 'file', 'The CSV file is empty.'); return { revisions: [], errors } }
  for (const name of headers.filter(h => !['yield', 'supply'].includes(h))) if (!header.includes(name)) error(lines[0] ?? 1, name, 'Required column is missing.')
  for (const [index, name] of header.entries()) {
    if (!headers.includes(name)) error(lines[0] ?? 1, name || 'header', 'Unknown column.')
    if (header.indexOf(name) !== index) error(lines[0] ?? 1, name, 'Duplicate column.')
  }
  if (errors.length) return { revisions: [], errors }
  if (!rows.length) error((lines[0] ?? 1) + 1, 'file', 'The CSV file has no component rows.')
  for (const [index, cells] of rows.entries()) {
    const row = lines[index + 1] ?? index + 2
    const data = Object.fromEntries(header.map((name, i) => [name, cells[i] ?? '']))
    const item = s.items.find(i => String(i.sku).toLowerCase() === data.item_sku.toLowerCase())
    if (!item) { error(row, 'item_sku', 'Unknown item SKU.'); continue }
    let group = groups.get(item.id)
    if (!group) {
      const source = activeBom(s, item.id)
      group = { revision: { itemId: item.id, sourceBomId: source?.id, sourceRevision: source?.revision, effectiveOn: data.effective_on, components: [], routing: [], note: '' }, invalid: false, seen: new Set(), metadata: {} }
      groups.set(item.id, group)
    }
    const reject = (column: string, message: string) => { group!.invalid = true; error(row, column, message) }
    if (cells.length !== header.length) reject('row', `Expected ${header.length} columns; received ${cells.length}.`)
    if (item.kind !== 'make' || item.archived) reject('item_sku', 'The item must be an active made item.')
    if (!group.revision.sourceBomId) reject('revision', 'The item has no active BOM to revise.')
    if (!/^[1-9]\d*$/.test(data.revision) || Number(data.revision) !== group.revision.sourceRevision) reject('revision', 'Revision does not match the current active BOM. Export again before revising.')
    const timestamp = Date.parse(data.effective_on + 'T00:00:00Z')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.effective_on) || !Number.isFinite(timestamp)
      || new Date(timestamp).toISOString().slice(0, 10) !== data.effective_on || data.effective_on < today()) reject('effective_on', 'Use a real date on or after today (YYYY-MM-DD, UTC).')
    let steps: ReturnType<typeof routing> = [], note = ''
    try { steps = routing(data.routing) } catch (e) { reject('routing', reason(e)) }
    try { note = optionalText(unprotect(data.note), 'change note', 400) } catch (e) { reject('note', reason(e)) }
    const source = s.boms.find(b => b.id === group!.revision.sourceBomId)
    const yieldRate = data.yield || source?.yield || '1'
    try { if (decimal(yieldRate, 'yield', { positive: true }) > SCALE) reject('yield', 'Yield cannot exceed one.') } catch (e) { reject('yield', reason(e)) }
    const metadata = { yield: yieldRate, revision: data.revision, effective_on: data.effective_on, routing: JSON.stringify(steps), note }
    for (const [column, value] of Object.entries(metadata)) {
      if (column in group.metadata && group.metadata[column] !== value) reject(column, 'All rows for an item must use the same value.')
      else group.metadata[column] = value
    }
    Object.assign(group.revision, { routing: steps, note, yield: yieldRate })
    const part: Row | undefined = s.items.find(i => String(i.sku).toLowerCase() === data.component_sku.toLowerCase())
    if (!part || part.archived) { reject('component_sku', 'Unknown or archived component SKU.'); continue }
    if (part.id === item.id) reject('component_sku', 'An item cannot be a component of itself.')
    if (group.seen.has(part.id)) reject('component_sku', 'List each component once per revision.')
    group.seen.add(part.id)
    if (!data.unit.trim()) reject('unit', 'A unit is required.')
    const supply = header.includes('supply') ? data.supply || part.kind : source?.components.find((l: any) => l.itemId === part.id)?.supply || part.kind
    if (!['make', 'buy', 'phantom'].includes(supply) || (supply !== 'buy' && part.kind !== 'make')) reject('supply', 'Choose buy, or make/phantom for a made item.')
    try { group.revision.components.push({ supply, itemId: part.id, quantity: format(toBase(part, data.quantity, data.unit)), unit: part.baseUnit }) }
    catch (e) { reject(/unit|conversion/i.test(reason(e)) ? 'unit' : 'quantity', reason(e)) }
    if (group.revision.components.length > 200) reject('component_sku', 'A BOM must contain at most 200 components.')
  }
  return { revisions: [...groups.values()].filter(group => !group.invalid).map(group => group.revision), errors }
}
