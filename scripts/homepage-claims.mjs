// Usage: node scripts/homepage-claims.mjs /path/to/CLAIMS.md [before-ref]
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseContract } from '../src/base/seed-contract.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const [claimsPath, beforeRef = 'origin/main'] = process.argv.slice(2)
assert(claimsPath, 'Pass the approved homepage CLAIMS.md path.')
const markdown = readFileSync(new URL('../CONTRACT.md', import.meta.url), 'utf8')
const after = parseContract(markdown)
const before = parseContract(execFileSync('git', ['show', `${beforeRef}:CONTRACT.md`], { cwd: root, encoding: 'utf8' }))
const numberedRows = text => text.split('\n').filter(line => /^\| \d+ \|/.test(line)).map(line => line.split('|').slice(1, -1).map(cell => cell.trim()))
const claims = numberedRows(readFileSync(claimsPath, 'utf8'))
const mapped = numberedRows(markdown.split('## Homepage claims\n')[1].split('## Status\n')[0])
assert.equal(mapped.length, claims.length, 'One contract row is required per claim.')
assert.equal(new Set(mapped.map(row => row[0])).size, claims.length, 'Claim numbers must be unique.')
const clauses = new Map(after.clauses.map(clause => [clause.id, clause]))
for (const [number, , text, sourceIds] of claims) {
  const row = mapped.find(row => row[0] === number)
  assert(row, `Claim ${number} is mapped.`)
  assert.equal(row[1], text, `Claim ${number} text matches the approved register.`)
  const ids = row[2].match(/[A-Z]+-\d{3}/g) ?? []
  assert(ids.length, `Claim ${number} needs a clause.`)
  for (const id of sourceIds.match(/[A-Z]+-\d{3}/g) ?? []) assert(ids.includes(id), `Claim ${number} retains ${id}.`)
  const states = ids.map(id => { assert(clauses.has(id), `${id} is defined.`); return clauses.get(id).status })
  const status = states.every(s => s === 'done') ? 'done' : states.every(s => s === 'missing') ? 'missing' : 'partial'
  assert.equal(row[3], status, `Claim ${number} status comes from its clauses.`)
  console.log(`${number}: ${ids.join(', ')} — all defined; ${status}`)
}
for (const clause of before.clauses) assert.equal(clauses.get(clause.id)?.status, clause.status, `${clause.id} keeps its pre-existing status.`)
const counts = c => `${c.done} done / ${c.partial} partial / ${c.missing} missing / ${c.total} total`
console.log(`Claims mapped: ${mapped.length}`)
console.log(`Before: ${counts(before.counts)}`)
console.log(`After: ${counts(after.counts)}`)
console.log(`Pre-existing statuses unchanged: ${before.clauses.length}/${before.clauses.length}`)
