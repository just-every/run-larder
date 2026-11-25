import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { installation } from './harness.mjs'

test('mail-off refuses email and the owner signs in with a one-time CLI grant', async t => {
  const h = await installation({ mailOff: true })
  t.after(() => h.close())
  const owner = (await (await h.request('/auth/session')).json()).operator

  const signIn = await h.request('/signin', { as: '' })
  assert.equal(signIn.status, 200)
  assert.doesNotMatch(await signIn.text(), /action="\/auth\/magic-link"/)
  const mail = await h.request('/auth/magic-link', { as: '', method: 'POST', body: { email: owner.email } })
  assert.equal(mail.status, 503)
  assert.deepEqual(await mail.json(), { error: 'mail_off' })

  // The deployment account's D1 write is the external edge of rer signin.
  // Apply its grant to the real migrated database, then use the public form.
  const token = randomBytes(32).toString('base64url')
  const digest = createHash('sha256').update('owner-signin\0' + token).digest('hex')
  const issued = Date.now()
  await h.db.prepare(`INSERT INTO oa_owner_signins(id, token_hash, operator_id, operator_version, created_at, expires_at)
    SELECT ?, ?, id, version, ?, ? FROM oa_operators WHERE id=? AND role='owner'`)
    .bind(randomUUID(), digest, issued, issued + 300_000, owner.id).run()

  const preview = await h.request('/auth/owner-signin?token=' + encodeURIComponent(token), { as: '' })
  assert.equal(preview.status, 200)
  assert.match(await preview.text(), /action="\/auth\/owner-signin"/)
  const confirm = () => h.request('/auth/owner-signin', { as: '', method: 'POST', body: { token } })
  const signedIn = await confirm()
  assert.equal(signedIn.status, 303)
  const session = await h.request('/auth/session', { as: signedIn.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') })
  assert.equal((await session.json()).operator.id, owner.id)
  assert.equal((await confirm()).status, 400)
  assert.equal(h.outboundCount(), 0)
})
