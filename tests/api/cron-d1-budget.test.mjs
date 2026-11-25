// The */15 cron looks for due report schedules. On Workers Free every D1 row it
// reads counts against a 5,000,000-row daily allowance shared by the whole
// account, so one run must cost the same at 30 days of stock history as at one.
import test from 'node:test'
import assert from 'node:assert/strict'
import { installation } from './harness.mjs'

const movement = (db, m, items, pos) => db.prepare('INSERT INTO larder_movements VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(
  `mv${m}`, m + 1, `it${m % items}`, `loc${m % 5}`, 'available', '', 1000000, 100, 'receipt', 'po', `po${m % pos}`, null, 'o1', `cmd${m}`, null, 'r', '2027-01-01T00:00:00.000Z')
const record = (db, kind, id, row) => db.prepare('INSERT INTO larder_records(kind,id,version,data) VALUES(?,?,1,?)').bind(kind, id, JSON.stringify({ id, version: 1, createdAt: '2027-01-01T00:00:00.000Z', ...row }))

// One day of a small workshop: 6 sales orders, 4 work orders, 2 purchase orders, 60 stock movements.
async function addDays(db, from, to) {
  const statements = []
  for (let d = from; d < to; d++) {
    for (let i = 0; i < 6; i++) statements.push(record(db, 'salesOrders', `so${d}-${i}`, { number: `SO${d}-${i}`, status: 'shipped', lines: [] }))
    for (let i = 0; i < 4; i++) statements.push(record(db, 'workOrders', `wo${d}-${i}`, { number: `WO${d}-${i}`, status: 'done' }))
    for (let i = 0; i < 2; i++) statements.push(record(db, 'purchaseOrders', `po${d}-${i}`, { number: `PO${d}-${i}`, status: 'received' }))
    for (let m = d * 60; m < d * 60 + 60; m++) statements.push(movement(db, m, 80, 2))
  }
  for (let i = 0; i < statements.length; i += 90) await db.batch(statements.slice(i, i + 90))
}

test('a scheduled run reads the same few rows at 30 days of history as at 1', async t => {
  const h = await installation({ now: '2027-01-10T12:00:00.000Z' }); t.after(() => h.close())
  await h.command('reports.schedule', { filters: {}, consent: true, reason: 'cron read budget' })
  const meter = async () => (await h.request('/__d1/cron')).json()
  const first = await (await h.mf.getWorker()).scheduled()
  assert.equal(first.outcome, 'ok')
  assert.equal((await h.state()).reportSchedules[0].snapshots.length, 1, 'the due report ran, so tomorrow it is no longer due')
  await h.db.batch(Array.from({ length: 80 }, (_, i) => record(h.db, 'items', `it${i}`, { sku: `SKU${i}`, name: `Item ${i}` })).concat(Array.from({ length: 5 }, (_, i) => record(h.db, 'locations', `loc${i}`, { name: `L${i}` }))))
  await addDays(h.db, 0, 1)
  const day1 = await meter()
  await addDays(h.db, 1, 30)
  const day30 = await meter()
  console.log(`cron D1 rows read: ${day1.rows} at 1 day, ${day30.rows} at 30 days`)
  assert.ok(day30.rows <= day1.rows + 5, `a run read ${day30.rows} rows at 30 days against ${day1.rows} at 1 day`)
  assert.ok(day30.rows < 100, `a run read ${day30.rows} rows; at 96 runs a day that is ${day30.rows * 96} of the 5,000,000 daily allowance`)
})
