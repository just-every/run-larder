// ENG-003: the formulas a configuration rule uses to derive a quantity, a time or a cost. Exact six-place
// fixed-point arithmetic over numbers, the configuration's dimension and option names, + - * / and parentheses.
// Nothing is evaluated as code, and a division by zero is refused rather than read as zero.
import { decimal, divide, format, times } from './decimal'
import { fail } from './problem'

type Token = { kind: 'number'; value: bigint } | { kind: 'name'; value: string } | { kind: 'op'; value: string }

function tokens(source: string): Token[] {
  const out: Token[] = []
  for (let i = 0; i < source.length;) {
    const rest = source.slice(i), space = /^\s+/.exec(rest), number = /^\d+(\.\d{1,6})?/.exec(rest), name = /^[A-Za-z][A-Za-z0-9_]*/.exec(rest)
    if (space) i += space[0].length
    else if (number) { out.push({ kind: 'number', value: decimal(number[0], 'formula number') }); i += number[0].length }
    else if (name) { out.push({ kind: 'name', value: name[0] }); i += name[0].length }
    else if ('+-*/()'.includes(rest[0])) { out.push({ kind: 'op', value: rest[0] }); i++ }
    else fail('FORMULA', `The formula "${source}" has a character Larder does not read: ${rest[0]}`, { formula: source })
  }
  return out
}

export const formulaNames = (source: string) => [...new Set(tokens(source).flatMap(t => t.kind === 'name' ? [t.value] : []))]

export function evaluate(source: string, values: Record<string, bigint>): bigint {
  if (typeof source !== 'string' || !source.trim() || source.length > 200) fail('FORMULA', 'A formula is required (at most 200 characters).')
  const list = tokens(source)
  let at = 0
  const bad = (): never => fail('FORMULA', `The formula "${source}" is not complete.`, { formula: source })
  const peek = () => list[at]
  const take = (): Token => list[at++] ?? bad()
  const expression = (): bigint => {
    let left = term()
    while (peek()?.kind === 'op' && '+-'.includes(peek().value as string)) { const op = take().value; const right = term(); left = op === '+' ? left + right : left - right }
    return left
  }
  const term = (): bigint => {
    let left = factor()
    while (peek()?.kind === 'op' && '*/'.includes(peek().value as string)) {
      const op = take().value, right = factor()
      if (op === '/' && right === 0n) fail('FORMULA', `The formula "${source}" divides by zero for this configuration.`, { formula: source })
      left = op === '*' ? times(left, right) : divide(left, right)
    }
    return left
  }
  const factor = (): bigint => {
    const t = take()
    if (t.kind === 'number') return t.value
    if (t.kind === 'name') return values[t.value] ?? fail('FORMULA', `The formula "${source}" uses ${t.value}, which is not a dimension or option of this configuration.`, { formula: source, name: t.value })
    if (t.value === '-') return -factor()
    if (t.value === '(') { const inner = expression(); if (take().value !== ')') bad(); return inner }
    return bad()
  }
  const result = expression()
  if (at !== list.length) bad()
  return result
}

// The formula read back with the values it used, so a person can check the arithmetic.
export function explain(source: string, values: Record<string, bigint>) {
  const used = formulaNames(source)
  return `${source}${used.length ? ` with ${used.map(n => `${n} = ${format(values[n] ?? 0n)}`).join(', ')}` : ''} = ${format(evaluate(source, values))}`
}
