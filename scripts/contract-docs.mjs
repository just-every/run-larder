// Project selected canonical clauses into the existing acceptance record. A
// focused update preserves other writers' rows and the established document.
import fs from 'node:fs'

const [mode, ...ids] = process.argv.slice(2)
if (!['write', 'check'].includes(mode) || !ids.length || ids.some(id => !/^[A-Z]+-\d+$/.test(id))) throw new Error('Usage: node scripts/contract-docs.mjs write|check CLAUSE [CLAUSE ...]')
let contract = fs.readFileSync('CONTRACT.md', 'utf8')
const rows = new Map()
for (const line of contract.split('\n')) {
  const cells = line.split('|').slice(1, -1).map(c => c.trim())
  const id = /^`([A-Z]+-\d+)`$/.exec(cells[0] ?? '')?.[1]
  if (id && ['done', 'partial', 'missing'].includes(cells[3])) rows.set(id, cells)
}
for (const [label, selected] of [['Published', [...rows.values()].filter(c => c[2] === 'published')], ['Target and push further', [...rows.values()].filter(c => c[2] !== 'published')], ['All', [...rows.values()]]]) {
  const count = state => selected.filter(c => c[3] === state).length
  const line = `| ${label} | ${count('done')} | ${count('partial')} | ${count('missing')} | ${selected.length} |`
  contract = contract.replace(new RegExp(`^\\| ${label} \\|.*$`, 'm'), line)
}
let acceptance = fs.readFileSync('ACCEPTANCE.md', 'utf8')
for (const id of ids) {
  const row = rows.get(id)
  if (!row) throw new Error(`Missing canonical status: ${id}`)
  const clause = contract.split('\n').find(line => line.startsWith(`- **${id} —`))
  const journey = clause?.split('**Acceptance evidence:** ')[1]
  if (!journey) throw new Error(`Missing canonical acceptance evidence: ${id}`)
  if (row[3] === 'done' && row[5]) throw new Error(`DONE must have an empty Gap: ${id}`)
  const evidence = [row[4], row[5]].filter(Boolean).join(' ')
  const projected = `| ${id} | ${journey} | ${evidence} | ${row[3]} |`
  const pattern = new RegExp(`^\\| ${id} \\|.*$`, 'm')
  if (!pattern.test(acceptance)) throw new Error(`Missing acceptance row: ${id}`)
  acceptance = acceptance.replace(pattern, projected)
}
const results = [['CONTRACT.md', contract], ['ACCEPTANCE.md', acceptance]]
for (const [path, content] of results) {
  if (mode === 'write') fs.writeFileSync(path, content)
  else if (fs.readFileSync(path, 'utf8') !== content) throw new Error(`${path} is stale; run the same command with write`)
}
console.log(`Contract documentation ${mode}: ${ids.join(', ')}`)
