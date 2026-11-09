import { Miniflare, convertV4MiniflareOptions } from '/workspace/run-larder/node_modules/miniflare/dist/src/index.js'
import { unstable_splitSqlQuery } from '/workspace/run-larder/node_modules/wrangler/wrangler-dist/cli.js'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
const root = await mkdtemp(join(tmpdir(), 'larder-journal-upgrade-'))
const mf = new Miniflare({ ...convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("ok") } }', compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'] }), resourcePersistencePath: root })
try {
  const db = await mf.getD1Database('DB')
  const apply = async path => db.batch(unstable_splitSqlQuery(await readFile(path, 'utf8')).map(sql => db.prepare(sql)))
  await apply('migrations/core/0026_change_events.sql')
  for (const seq of [3, 17]) await db.prepare('INSERT INTO larder_change_events VALUES(?,?,?,?,?)').bind(seq, 'synthetic-larder-' + seq, 'synthetic-larder-command-' + seq, 'receipt.recorded', JSON.stringify({ id: 'synthetic-larder-' + seq, exact: 'retained bytes' })).run()
  await db.prepare("UPDATE sqlite_sequence SET seq=31 WHERE name='larder_change_events'").run()
  const before = (await db.prepare('SELECT * FROM larder_change_events ORDER BY seq').all()).results
  await apply('migrations/core/0027_change_event_vocabulary.sql')
  assert.deepEqual((await db.prepare('SELECT * FROM larder_change_events ORDER BY seq').all()).results, before)
  await db.prepare("INSERT INTO larder_change_events(id,command_id,type,data) VALUES('synthetic-larder-new','synthetic-larder-new','material.usable','{}')").run()
  assert.equal((await db.prepare("SELECT seq FROM larder_change_events WHERE id='synthetic-larder-new'").first()).seq, 32)
  await assert.rejects(db.prepare("DELETE FROM larder_change_events WHERE seq=3").run(), /append_only_change_events/)
  await assert.rejects(db.prepare("UPDATE larder_change_events SET data='{}' WHERE seq=17").run(), /append_only_change_events/)
  console.log(JSON.stringify({ head: 'a99abda4998359ab358158aa0f7c86f24a685005', probe: 'D1 retained-journal migration', retainedRows: before.length, oldHighWater: 31, nextSequence: 32, appendOnly: 'enforced', exit: 0 }))
} finally {
  await mf.dispose()
  await rm(root, { recursive: true, force: true })
}
