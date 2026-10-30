// A real Larder Worker on Miniflare with D1, the committed migrations and a
// signed-in owner. Requests go over HTTP so Origin and cookies are real.
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { unstable_splitSqlQuery } from 'wrangler'
import { build } from 'esbuild'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID, randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'

let bundle
async function script(now, beforeCommit = false) {
  if (now !== undefined || beforeCommit) {
    if (now !== undefined) assert.equal(new Date(now).toISOString(), now, 'Use an explicit fixed command clock')
    const fixed = await build({ entryPoints: ['tests/api/worker.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022', external: ['node:*', 'cloudflare:*'], loader: { '.css': 'text', '.svg': 'text' },
      plugins: [{ name: 'fixed-command-clock', setup(builder) {
        if (now !== undefined) builder.onLoad({ filter: /[/\\]larder[/\\]clock\.ts$/ }, () => ({ contents: `export const commandTime = () => ${JSON.stringify(now)}`, loader: 'ts' }))
        // Test-only barrier: interleave a second real HTTP command before the
        // first command's atomic batch. Production has no barrier or override.
        if (beforeCommit) builder.onLoad({ filter: /[/\\]larder[/\\]storage\.ts$/ }, async ({ path }) => {
          const source = await readFile(path, 'utf8'), needle = '  await db.batch(['
          assert.equal(source.split(needle).length, 2, 'Instrument the one command batch')
          const barrier = `  if (type === 'member.scope') await fetch('https://scope-commit.synthetic.invalid/', { method: 'POST', body: JSON.stringify({ type, commandId: c.commandId, stateVersion: before.version }) })\n`
          return { contents: source.replace(needle, barrier + needle), loader: 'ts' }
        })
      } }] })
    return fixed.outputFiles[0].text
  }
  bundle ??= build({ entryPoints: ['tests/api/worker.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022', external: ['node:*', 'cloudflare:*'], loader: { '.css': 'text', '.svg': 'text' } }).then(b => b.outputFiles[0].text)
  return bundle
}

// Every committed migration, as `rer setup` and `rer reset` leave a database.
export async function migrate(db) {
  for (const file of (await readdir('migrations/core')).filter(n => n.endsWith('.sql')).sort())
    await db.batch(unstable_splitSqlQuery(await readFile('migrations/core/' + file, 'utf8')).map(q => db.prepare(q)))
}

// Public installation commands get an isolated checkout, home and canonical
// Wrangler state. Apply the real migrations before the HTTP owner bootstrap;
// this deliberately does not exercise the separate clean-install setup door.
async function commandInstallation(root) {
  const checkout = join(root, 'checkout'), home = join(root, 'home')
  const excluded = new Set(['.git', 'node_modules', '.wrangler', '.seed', '.rer', '.cache', 'dist', '.output', '.tanstack', '.dev.vars', '.dev.vars.previous', 'test-results', 'playwright-report'])
  await cp(resolve('.'), checkout, { recursive: true, filter: source => !excluded.has(relative(resolve('.'), source).split(/[\\/]/)[0]) })
  await symlink(resolve('node_modules'), join(checkout, 'node_modules'), 'dir')
  await mkdir(home)
  const env = { ...process.env, HOME: home, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false' }
  for (const key of Object.keys(env)) if (/^(?:GH_TOKEN|GITHUB_TOKEN|RER_CLOUD_KEY|CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|SESSION_SECRET|INSTALLATION_KEY|SETUP_TOKEN|OWNER_EMAIL|AUTH_|MAIL_)/.test(key)) delete env[key]
  const run = async (program, args) => {
    try { return { code: 0, ...await promisify(execFile)(program, args, { cwd: checkout, env, timeout: 120000, maxBuffer: 2 * 1024 * 1024 }) } }
    catch (error) {
      if (typeof error.code !== 'number') throw error
      return { code: error.code, stdout: error.stdout, stderr: error.stderr }
    }
  }
  const migrated = await run('pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'foundation', '--local', '--persist-to', '.wrangler/state', '--config', 'wrangler.jsonc'])
  assert.equal(migrated.code, 0, migrated.stdout + migrated.stderr)
  const config = JSON.parse(await readFile(join(checkout, 'wrangler.jsonc'), 'utf8'))
  return { checkout, persistence: join(checkout, '.wrangler/state/v3'), databases: Object.fromEntries(config.d1_databases.map(d => [d.binding, d.database_id])), run }
}

export async function installation({ now, modelEdge, modelKey, publicCommands = false, beforeCommit } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'larder-api-'))
  let native
  try { native = publicCommands ? await commandInstallation(root) : undefined }
  catch (error) { await rm(root, { recursive: true, force: true }); throw error }
  let origin = 'http://localhost'
  const setup = randomBytes(32).toString('hex')
  let code = await script(now, Boolean(beforeCommit))
  // The mail provider is the network edge: invitations reach this fake Resend.
  const mails = []
  let outboundRequests = 0
  const outboundService = async request => {
    if (request.url === 'https://scope-commit.synthetic.invalid/' && beforeCommit) { await beforeCommit(await request.json()); return Response.json({ ok: true }) }
    outboundRequests++
    if (['https://api.anthropic.com/v1/messages', 'https://openrouter.ai/api/v1/chat/completions'].includes(request.url) && modelEdge) return modelEdge(request)
    if (request.url !== 'https://api.resend.com/emails') return new Response('Unexpected outbound request', { status: 599 })
    mails.push(await request.json())
    return Response.json({ id: `test-${mails.length}` })
  }
  const sessionSecret = randomBytes(32).toString('hex'), devKey = randomBytes(32).toString('hex')
  const bindings = () => ({ ...(modelEdge ? { ANTHROPIC_API_KEY: modelKey ?? 'synthetic-larder-814', OPENROUTER_API_KEY: modelKey ?? 'synthetic-larder-814' } : {}), AUTH_LOCAL: 'true', AUTH_ORIGIN: origin, OWNER_EMAIL: 'owner@example.test', SESSION_SECRET: sessionSecret, SETUP_TOKEN: setup, MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'test-only-resend-key', MAIL_FROM: 'auth@example.test', RER_DEV_KEY: devKey })
  const options = port => ({
    ...convertV4MiniflareOptions({
      host: '127.0.0.1', port, modules: true, script: code, compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'], d1Databases: native?.databases ?? ['DB'],
      bindings: bindings(),
      outboundService,
    }),
    resourcePersistencePath: native?.persistence ?? root,
  })
  let mf = new Miniflare(options(0))
  try {
    const address = await mf.ready
    origin = address.origin
    await mf.setOptions(options(Number(address.port)))
    let db = await mf.getD1Database('DB')
    if (!native) await migrate(db)
    else await writeFile(join(native.checkout, '.dev.vars'), Object.entries({ ...bindings(), INSTALLATION_KEY: randomBytes(32).toString('hex') }).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 })
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
    // Invite a person, confirm through the mailed link and give them a Larder role.
    const person = async (email, role) => {
      const res = await request('/auth/invite', { method: 'POST', body: { email, displayName: email.split('@')[0], role: 'member' } })
      assert.equal(res.status, 202, await res.text())
      const link = String(mails.at(-1).text).match(/http[^\s]+\/auth\/confirm\?token=([^\s]+)/)
      const confirmed = await request('/auth/confirm', { method: 'POST', as: '', body: { token: decodeURIComponent(link[1]) } })
      assert.equal(confirmed.status, 303, await confirmed.text())
      const cookie = confirmed.headers.getSetCookie().map(v => v.split(';')[0]).join('; ')
      const session = await (await request('/auth/session', { as: cookie })).json()
      if (role) await command('role.set', { operatorId: session.operator.id, role })
      return { cookie, id: session.operator.id, run: (type, payload, opts = {}) => command(type, payload, { as: cookie, ...opts }) }
    }
    return { commandRoot: native?.checkout, async rer(...args) {
      assert.ok(native, 'Public commands require a disposable installation')
      await mf.dispose()
      try { return await native.run('pnpm', ['exec', 'rer', ...args]) }
      finally {
        mf = new Miniflare(options(Number(new URL(origin).port)))
        await mf.ready
        db = await mf.getD1Database('DB')
      }
    }, async signInOwner() {
      const sent = await request('/auth/magic-link', { method: 'POST', as: '', body: { email: bindings().OWNER_EMAIL } })
      assert.equal(sent.status, 202, await sent.text())
      const token = String(mails.at(-1).text).match(/http[^\s]+\/auth\/confirm\?token=([^\s]+)/)
      assert.ok(token, 'Owner receives an ordinary sign-in link')
      const confirmed = await request('/auth/confirm', { method: 'POST', as: '', body: { token: decodeURIComponent(token[1]) } })
      assert.equal(confirmed.status, 303, await confirmed.text())
      owner = confirmed.headers.getSetCookie().map(v => v.split(';')[0]).join('; ')
    }, async advanceClock(next) {
      assert.ok(now !== undefined && next > now, 'Advance an explicitly fixed command clock')
      code = await script(next, Boolean(beforeCommit)); now = next
      await mf.setOptions(options(Number(new URL(origin).port)))
      db = await mf.getD1Database('DB')
    }, outboundCount: () => outboundRequests, get mf() { return mf }, origin, get db() { return db }, async restart() {
      await mf.dispose()
      mf = new Miniflare(options(Number(new URL(origin).port)))
      await mf.ready
      db = await mf.getD1Database('DB')
    }, request, send, command, state, invariant, person, owner: () => owner, async close() { await mf.dispose(); await rm(root, { recursive: true, force: true }) } }
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
