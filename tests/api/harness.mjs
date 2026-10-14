// A real Larder Worker on Miniflare with D1, the committed migrations and a
// signed-in owner. Requests go over HTTP so Origin and cookies are real.
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { unstable_splitSqlQuery } from 'wrangler'
import { build } from 'esbuild'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'

let bundle
async function script() {
  bundle ??= build({ entryPoints: ['tests/api/worker.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022', external: ['node:*'], loader: { '.css': 'text', '.svg': 'text' } }).then(b => b.outputFiles[0].text)
  return bundle
}

// Every committed migration, as `rer setup` and `rer reset` leave a database.
export async function migrate(db) {
  for (const file of (await readdir('migrations/core')).filter(n => n.endsWith('.sql')).sort())
    await db.batch(unstable_splitSqlQuery(await readFile('migrations/core/' + file, 'utf8')).map(q => db.prepare(q)))
}

export async function installation() {
  const root = await mkdtemp(join(tmpdir(), 'larder-api-'))
  let origin = 'http://localhost'
  const setup = randomBytes(32).toString('hex'), code = await script()
  const options = port => ({
    ...convertV4MiniflareOptions({
      host: '127.0.0.1', port, modules: true, script: code, compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'],
      bindings: { AUTH_LOCAL: 'true', AUTH_ORIGIN: origin, OWNER_EMAIL: 'owner@example.test', SESSION_SECRET: randomBytes(32).toString('hex'), SETUP_TOKEN: setup, MAIL_PROVIDER: 'development', MAIL_FROM: 'auth@example.test', RER_DEV_KEY: randomBytes(32).toString('hex') },
    }),
    resourcePersistencePath: root,
  })
  const mf = new Miniflare(options(0))
  try {
    const address = await mf.ready
    origin = address.origin
    await mf.setOptions(options(Number(address.port)))
    const db = await mf.getD1Database('DB')
    await migrate(db)
    let owner = ''
    const request = (path, { method = 'GET', body, as = owner, raw } = {}) => fetch(origin + path, {
      method, redirect: 'manual', headers: { origin, 'content-type': 'application/json', ...(as ? { cookie: as } : {}) },
      ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const boot = await request('/auth/bootstrap', { method: 'POST', body: { token: setup, displayName: 'Olive Owner' } })
    assert.equal(boot.status, 303, await boot.text())
    owner = boot.headers.getSetCookie().map(v => v.split(';')[0]).join('; ')
    const send = async (type, payload, opts = {}) => {
      const commandId = opts.commandId ?? randomUUID()
      const res = await request('/api/larder/commands', { method: 'POST', body: { commandId, type, payload }, as: opts.as ?? owner })
      return { res, body: await res.json(), commandId }
    }
    const command = async (type, payload, opts = {}) => {
      const { res, body } = await send(type, payload, opts)
      if (opts.error) { assert.equal(body.ok, false, JSON.stringify(body)); assert.equal(body.error.code, opts.error, JSON.stringify(body)); return body }
      assert.equal(res.status, 200, JSON.stringify(body))
      return body.result
    }
    const state = async (as = owner) => { const res = await request('/api/larder/state', { as }); assert.equal(res.status, 200); return res.json() }
    // Derived balances always reconcile to movements and never oversell.
    const invariant = async () => {
      const s = await state()
      for (const p of s.positions) {
        const sum = s.movements.filter(m => m.itemId === p.itemId && m.locationId === p.locationId && m.status === p.status && m.lotId === p.lotId).reduce((n, m) => n + parse(m.quantity), 0n)
        assert.equal(parse(p.quantity), sum); assert.ok(sum >= 0n)
      }
      const keys = new Set(s.reservations.map(r => `${r.itemId}|${r.locationId}`))
      for (const k of keys) {
        const [itemId, locationId] = k.split('|')
        const onHand = s.movements.filter(m => m.itemId === itemId && m.locationId === locationId && m.status === 'available').reduce((n, m) => n + parse(m.quantity), 0n)
        const reserved = s.reservations.filter(r => r.itemId === itemId && r.locationId === locationId).reduce((n, r) => n + parse(r.quantity), 0n)
        assert.ok(reserved <= onHand, `reserved ${reserved} exceeds on hand ${onHand}`)
      }
      return s
    }
    // Invite a person, confirm through the outbox link and give them a Larder role.
    const person = async (email, role) => {
      const res = await request('/auth/invite', { method: 'POST', body: { email, displayName: email.split('@')[0], role: 'member' } })
      assert.equal(res.status, 202, await res.text())
      const outbox = await db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY created_at DESC,sequence DESC LIMIT 1').first()
      const link = String(JSON.parse(outbox.message).text).match(/http[^\s]+\/auth\/confirm\?token=([^\s]+)/)
      const confirmed = await request('/auth/confirm', { method: 'POST', as: '', body: { token: decodeURIComponent(link[1]) } })
      assert.equal(confirmed.status, 303, await confirmed.text())
      const cookie = confirmed.headers.getSetCookie().map(v => v.split(';')[0]).join('; ')
      const session = await (await request('/auth/session', { as: cookie })).json()
      if (role) await command('role.set', { operatorId: session.operator.id, role })
      return { cookie, id: session.operator.id, run: (type, payload, opts = {}) => command(type, payload, { as: cookie, ...opts }) }
    }
    return { mf, origin, db, request, send, command, state, invariant, person, owner: () => owner, async close() { await mf.dispose(); await rm(root, { recursive: true, force: true }) } }
  } catch (error) {
    await mf.dispose().catch(() => {}); await rm(root, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

export function parse(v) {
  const negative = v.startsWith('-'), [a, b = ''] = v.replace('-', '').split('.')
  const n = BigInt(a) * 1000000n + BigInt(b.padEnd(6, '0'))
  return negative ? -n : n
}

export const evidence = (text = 'Bay A count sheet, 1 Oct 2026') => ({ name: 'count-sheet.txt', contentType: 'text/plain', base64: Buffer.from(text).toString('base64') })

// A small workshop: a made serving board, its timber and oil, a supplier, a customer.
export async function workshop(h) {
  const loc = await h.command('location.save', { name: 'Workshop' })
  const store = await h.command('location.save', { name: 'Dispatch shelf' })
  const timber = await h.command('item.save', { sku: 'WAL-BLANK', name: 'Walnut blank', kind: 'buy', baseUnit: 'each', conversions: [{ unit: 'bundle', factor: '10' }], standardCost: '9.5' })
  const oil = await h.command('item.save', { sku: 'OIL-1L', name: 'Board oil', kind: 'buy', baseUnit: 'l', conversions: [{ unit: 'ml', factor: '0.001' }] })
  const board = await h.command('item.save', { sku: 'BRD-WAL-L', name: 'Walnut serving board', kind: 'make', baseUnit: 'each', template: 'Serving board', attributes: { Timber: 'Walnut', Size: 'Large' }, salePrice: '89' })
  const supplier = await h.command('party.save', { name: 'Tasmanian Timber Co', kind: 'supplier' })
  const customer = await h.command('party.save', { name: 'Harbour Kitchen Co', kind: 'customer' })
  await h.command('partyItem.save', { partyId: supplier.id, itemId: timber.id, partyCode: 'TT-WAL-40', price: '9.5', leadDays: 7, preferred: true })
  await h.command('bom.revise', { itemId: board.id, components: [{ itemId: timber.id, quantity: '1' }, { itemId: oil.id, quantity: '50', unit: 'ml' }], routing: [{ name: 'Plane and cut', workCentre: 'Bench', minutes: 20 }, { name: 'Oil', workCentre: 'Finishing', minutes: 5 }] })
  await h.command('opening.record', { locationId: loc.id, countedOn: '2026-10-01', valuationBasis: 'supplier-invoice', countedBy: 'Olive', evidence: evidence(), lines: [{ itemId: timber.id, quantity: '6', unitCost: '9.5' }, { itemId: oil.id, quantity: '2', unitCost: '18' }, { itemId: board.id, quantity: '4', unitCost: '30' }] })
  return { loc, store, timber, oil, board, supplier, customer }
}
