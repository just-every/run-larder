// The installation backup: what `rer export` writes restores with `rer import`
// into the freshly migrated database `rer reset --yes` leaves, through Base
// portability and the seed's own policy, with every Larder record intact.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPortability } from '@runeditrun/rer/modules/portability'
import { exportArchive, importArchive } from '@runeditrun/rer/modules/portability/files'
import { portabilityPolicy } from '../../scripts/installer/portability-policy.mjs'
import { installation, migrate, workshop } from './harness.mjs'

const tables = async db => (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'larder_%' OR name LIKE 'oa_operators') ORDER BY name").all()).results.map(r => r.name)
const rows = async (db, table) => (await db.prepare(`SELECT * FROM "${table}" ORDER BY 1`).all()).results

test('LARDER-013 an installation backup restores into a reset installation', async t => {
  const h = await installation(); t.after(() => h.close())
  const w = await workshop(h)
  const q = await h.command('so.quote', { customerId: w.customer.id, promiseDate: '2026-10-28', lines: [{ itemId: w.board.id, quantity: '2', unitPrice: '89' }] })
  const order = await h.command('so.confirm', { orderId: q.id, version: q.version })
  const sh = await h.command('shipment.pick', { orderId: order.id, lines: [{ lineId: order.lines[0].id, locationId: w.loc.id, quantity: '2' }] })
  const packed = await h.command('shipment.pack', { shipmentId: sh.id, version: sh.version, packages: 1 })
  await h.command('shipment.ship', { shipmentId: sh.id, version: packed.version, carrier: 'Courier' })
  await h.command('handoff.prepare', { note: 'October' })
  const before = await h.state()

  const dir = await mkdtemp(join(tmpdir(), 'larder-backup-')); t.after(() => rm(dir, { recursive: true, force: true }))
  const archive = join(dir, 'installation.rer')
  await exportArchive(await createPortability({ db: h.db, policy: portabilityPolicy }), archive, [])

  // The destination is what reset leaves: every migration applied, nobody signed up.
  const target = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch: () => new Response(null, { status: 404 }) }', compatibilityDate: '2026-09-08', d1Databases: ['DB'] }))
  t.after(() => target.dispose())
  const db = await target.getD1Database('DB')
  await migrate(db)
  await importArchive(await createPortability({ db, policy: portabilityPolicy }), archive, [])

  const names = await tables(h.db)
  assert.ok(names.includes('larder_meta') && names.includes('oa_operators'), names.join(', '))
  for (const name of names) assert.deepEqual(await rows(db, name), await rows(h.db, name), name)
  assert.equal(before.handoffs[0].reference, 'HO-0001'); assert.equal(before.shipments[0].status, 'shipped')
})
