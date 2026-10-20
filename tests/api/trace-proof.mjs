import assert from 'node:assert/strict'
import { parse } from './harness.mjs'
// Compare the two public downloads to each other and to the physical state.
export async function traceProof(h, lotId, direction, expectedLots = []) {
  const path = `/api/larder/lots/${lotId}/trace`, response = await h.request(`${path}?direction=${direction}`)
  assert.equal(response.status, 200); const trace = await response.json(), s = await h.state()
  assert.equal(trace.selectedLotId, lotId); assert.equal(trace.direction, direction)
  for (const id of expectedLots) assert.ok(trace.nodes.some(n => n.lotId === id), `Missing linked lot ${id}`)
  const csv = await h.request(`${path}.csv?direction=${direction}`); assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /text\/csv/)
  const lines = (await csv.text()).trimEnd().split('\r\n').map(line => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map(m => m[1].replaceAll('""', '"'))), header = lines.shift()
  const exported = lines.map(line => Object.fromEntries(header.map((field, i) => [field, line[i]])))
  assert.equal(exported.length, trace.rows.length)
  for (const [i, row] of trace.rows.entries()) for (const field of header) assert.equal(exported[i][field], row[field] ?? '', `${row.id} ${field}`)
  const ids = trace.rows.filter(r => r.recordType === 'movement').map(r => r.id); assert.equal(new Set(ids).size, ids.length)
  for (const row of trace.rows.filter(r => r.recordType === 'movement')) {
    const m = s.movements.find(m => m.id === row.id); assert.ok(m); assert.equal(row.lotId, m.lotId); assert.equal(row.quantity, m.quantity); assert.equal(row.date, m.createdAt); assert.equal(row.documentId, m.documentId); assert.equal(row.locationId, m.locationId)
  }
  for (const row of trace.rows.filter(r => r.recordType === 'custody')) {
    const e = s.subcontractCustody.find(e => e.id === row.id); assert.ok(e); assert.equal(row.quantity, e.quantity); assert.equal(row.lotId, e.lotId)
  }
  const tracedLots = trace.nodes.flatMap(n => n.lotId ? [n.lotId] : [])
  assert.deepEqual(new Set(ids), new Set(s.movements.filter(m => tracedLots.includes(m.lotId)).map(m => m.id)))
  for (const b of trace.rows.filter(r => r.recordType === 'balance')) {
    const rows = trace.rows.filter(r => ['movement', 'custody'].includes(r.recordType) && r.lotId === b.lotId && r.itemId === b.itemId && r.locationId === b.locationId && r.status === b.status)
    assert.equal(parse(b.quantity), rows.reduce((n, r) => n + parse(r.quantity), 0n))
  }
  return trace
}
