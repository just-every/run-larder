import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { installation } from '/workspace/run-larder/tests/api/harness.mjs'
import { nativeMigrationPreflight } from '/workspace/run-larder/node_modules/@runeditrun/rer/cli/portability-migrations.mjs'
const h = await installation({ publicCommands: true })
try {
  const result = await nativeMigrationPreflight({ root: h.commandRoot, db: h.db, binding: 'DB' })
  assert.equal(result.nativeApply, false, 'The native migration ledger contains every current migration')
  const migration = await h.db.prepare("SELECT name FROM d1_migrations WHERE name='0026_change_events.sql'").first()
  assert.equal(migration.name, '0026_change_events.sql')
  console.log(JSON.stringify({ head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: '/workspace/run-larder', encoding: 'utf8' }).trim(), status: 'pass', result, migration }, null, 2))
} finally { await h.close() }
