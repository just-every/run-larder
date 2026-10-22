// GOV-013: the audit is kept for the life of the installation, nobody purges it, and an erasure request replaces a data subject's personal values with a tombstone through the erasure door only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { installation, workshop } from './harness.mjs'

const roles = ['manager', 'sales', 'planner', 'buyer', 'engineer', 'production', 'operator', 'warehouse', 'quality', 'accounts', 'agent', 'viewer']

test('GOV-013 the export states the life-of-installation period and no purge authority, every role is refused at command, HTTP and database, and an erasure replaces personal values and leaves the entry and an audit of the replacement', async t => {
  const h = await installation(); t.after(() => h.close())
  const w = await workshop(h)
  const people = {}
  for (const role of roles) people[role] = await h.person(`gov13-${role}@example.test`, role === 'viewer' ? undefined : role)
  const leaver = await h.person('former.worker@example.test', 'warehouse')
  const audit = async (query = '') => (await h.request('/api/larder/audit' + query)).json()

  // The leaver's work and a sole-trader contact are in the audit with their personal values.
  await leaver.run('location.save', { name: 'Back shelf', note: 'Set up by former.worker for the autumn run' })
  const contact = await h.command('party.save', { name: 'Casey Sole Trader', kind: 'customer', email: 'casey.trader@example.test' })
  await h.command('party.save', { id: contact.id, version: contact.version, name: 'Casey Sole Trader', kind: 'customer', email: 'casey.trader@example.test', terms: 'Net 14' })
  const before = await audit('?limit=500')
  const mine = before.entries.filter(e => e.actorId === leaver.id)
  assert.ok(mine.length >= 1 && mine.every(e => e.actorName === 'former.worker'))

  // The export states the period and the purge authority, as JSON, as CSV headers and on the screen's data.
  const json = await (await h.request('/api/larder/audit.json')).json(), csv = await h.request('/api/larder/audit.csv')
  assert.deepEqual([json.retention.period, json.retention.purgeAuthority, json.retention.erasure.door, json.complete], ['the life of the installation', 'none', 'erasure.audit', true])
  assert.match(csv.headers.get('x-audit-retention'), /life of the installation.*Purge authority: none.*tombstone/)

  // Every role, the owner included, is refused a purge: at the command door, over HTTP and in the database.
  for (const [role, who] of Object.entries(people)) {
    for (const type of ['audit.purge', 'audit.delete', 'audit.erase']) await who.run(type, { before: '2099-01-01', id: mine[0].id, reason: 'Tidy up' }, { error: 'FORBIDDEN' })
    await who.run('erasure.audit', { operatorId: leaver.id, reason: 'Not the owner' }, { error: 'FORBIDDEN' })
    for (const method of ['DELETE', 'PUT', 'PATCH']) assert.equal((await h.request('/api/larder/audit', { method, as: who.cookie, body: {} })).status, 405, `${role} ${method}`)
  }
  for (const type of ['audit.purge', 'audit.delete']) await h.command(type, { before: '2099-01-01', reason: 'Tidy up' }, { error: 'FORBIDDEN' })
  assert.equal((await h.request('/api/larder/audit', { method: 'DELETE' })).status, 405)
  await assert.rejects(h.db.prepare('DELETE FROM larder_audit').run(), /append_only_audit/)
  await assert.rejects(h.db.prepare("UPDATE larder_audit SET actor_name='x' WHERE seq=1").run(), /append_only_audit/)
  await assert.rejects(h.db.prepare("UPDATE larder_audit SET reason='x', erasure_id='unrecorded' WHERE seq=1").run(), /append_only_audit/)
  assert.equal((await audit('?limit=500')).total, before.total)

  // The owner passes an erasure request for the leaver: values replaced, entries kept, the request audited.
  await h.command('erasure.audit', { operatorId: leaver.id }, { error: 'INPUT' })
  await h.command('erasure.audit', { operatorId: leaver.id, partyId: contact.id, reason: 'x' }, { error: 'INPUT' })
  await h.command('erasure.audit', { operatorId: '00000000-0000-4000-8000-000000000000', reason: 'x' }, { error: 'NOT_FOUND' })
  const request = await h.command('erasure.audit', { operatorId: leaver.id, request: 'Letter of 20 October', reason: 'Erasure request from former.worker@example.test' })
  assert.deepEqual([request.subjectKind, request.subjectId, request.entries >= mine.length, request.tombstone], ['operator', leaver.id, true, '[erased]'])
  const after = await audit('?limit=500')
  assert.equal(after.total, before.total + 1 + (after.entries.filter(e => e.commandType === 'erasure.audit').length - 1))
  const kept = after.entries.filter(e => mine.some(m => m.id === e.id))
  assert.deepEqual(kept.map(e => [e.id, e.actorId, e.at, e.commandId, e.commandType, e.subjectKind, e.subjectId, e.op, e.refs]), mine.map(e => [e.id, e.actorId, e.at, e.commandId, e.commandType, e.subjectKind, e.subjectId, e.op, e.refs]))
  assert.ok(kept.every(e => e.actorName === '[erased]' && e.erasureId === request.id))
  const note = kept.find(e => e.subjectKind === 'locations')
  assert.match(JSON.stringify(note.after), /Set up by \[erased\] for the autumn run/)
  const replacement = after.entries.find(e => e.commandType === 'erasure.audit' && e.subjectKind === 'auditErasures')
  assert.deepEqual([replacement.op, replacement.actorId, replacement.after.subjectId, replacement.after.entries, replacement.reason], ['create', (await h.state()).actor.id, leaver.id, request.entries, 'Erasure request from [erased]'])
  assert.equal(after.retention.erasureRequests, 1)
  // The request stays on record (id, date, subject id, scope, the owner who ran it) without the erased values, in the state, the audit read and the export.
  const ownerId = (await h.state()).actor.id
  const record = (await h.state()).auditErasures.find(r => r.id === request.id)
  assert.deepEqual([record.subjectKind, record.subjectId, record.scope, record.requestedBy, record.createdBy, typeof record.createdAt, record.request, record.reason], ['operator', leaver.id, 'audit', ownerId, ownerId, 'string', 'Letter of 20 October', 'Erasure request from [erased]'])
  const listed = after.retention.requests.find(r => r.id === request.id)
  assert.deepEqual([listed.subjectKind, listed.subjectId, listed.scope, listed.ranBy, listed.entries, typeof listed.at], ['operator', leaver.id, 'audit', ownerId, request.entries, 'string'])
  assert.deepEqual((await (await h.request('/api/larder/audit.json')).json()).retention.requests.map(r => r.id), [request.id])
  assert.equal(replacement.commandType, 'erasure.audit'); assert.equal(/former\.worker/i.test(JSON.stringify(replacement)), false)
  const stored = JSON.stringify((await h.db.prepare('SELECT * FROM larder_audit').all()).results) + JSON.stringify((await h.db.prepare('SELECT * FROM larder_audit_erasures').all()).results)
  const exported = JSON.stringify(await (await h.request('/api/larder/audit.json')).json()) + await (await h.request('/api/larder/audit.csv')).text() + JSON.stringify(after)
  for (const [name, body] of [['stored', stored], ['exported', exported]]) {
    assert.equal(/former\.worker/.test(body), false, `${name} still names the person`)
    assert.match(body, /Back shelf/); assert.match(body, /Casey Sole Trader/)
  }
  // Only personal columns change, and only under a recorded request.
  await assert.rejects(h.db.prepare("UPDATE larder_audit SET actor_id='someone-else', erasure_id=? WHERE seq=1").bind(request.id).run(), /append_only_audit/)
  await assert.rejects(h.db.prepare("UPDATE larder_audit SET command_type='x', erasure_id=? WHERE seq=1").bind(request.id).run(), /append_only_audit/)
  await assert.rejects(h.db.prepare('DELETE FROM larder_audit_erasures').run(), /append_only_audit/)
  await assert.rejects(h.db.prepare("UPDATE larder_audit_erasures SET entries=0").run(), /append_only_audit/)

  // A party's contact values are replaced the same way; the party record link and the entries stay.
  const party = await h.command('erasure.audit', { partyId: contact.id, reason: 'Erasure request from the contact' })
  assert.deepEqual([party.subjectKind, party.entries >= 1], ['party', true])
  const last = await audit(`?ref=${contact.id}&limit=500`)
  assert.ok(last.entries.filter(e => e.subjectKind === 'parties').length >= 2)
  assert.equal(/casey\.trader|Casey Sole/.test(JSON.stringify(last)), false)
  assert.equal((await audit('?limit=500')).retention.erasureRequests, 2)
  // The erased person's own later work names them again only if they act again; nothing else reverts.
  assert.equal((await audit(`?actor=${leaver.id}&limit=500`)).entries.every(e => e.actorName === '[erased]'), true)
  await h.invariant()
})

test('GOV-013 a sole owner who is the data subject still runs the erasure, it is audited, and they are addressable only by id afterwards', async t => {
  const h = await installation(); t.after(() => h.close())
  const me = (await h.state()).actor
  await h.command('location.save', { name: 'Goods in', note: 'Counted by Olive Owner on Monday' })
  const audit = async (query = '') => (await h.request('/api/larder/audit' + query)).json()
  const mine = (await audit(`?actor=${me.id}&limit=500`)).entries
  assert.ok(mine.length >= 1 && mine.every(e => e.actorName === me.name))

  const request = await h.command('erasure.audit', { operatorId: me.id, request: 'Own request', reason: `Erase ${me.name} from the audit` })
  assert.deepEqual([request.subjectId, request.requestedBy, request.scope, request.reason], [me.id, me.id, 'audit', 'Erase [erased] from the audit'])
  const after = await audit(`?actor=${me.id}&limit=500`)
  assert.ok(after.entries.length > mine.length, 'the erasure itself is audited under the person\'s id')
  assert.ok(after.entries.every(e => e.actorId === me.id && e.actorName === '[erased]'))
  const entry = after.entries.find(e => e.commandType === 'erasure.audit')
  assert.deepEqual([entry.subjectKind, entry.subjectId, entry.erasureId, entry.reason], ['auditErasures', request.id, request.id, 'Erase [erased] from the audit'])
  assert.equal(after.entries.filter(e => mine.some(m => m.id === e.id)).length, mine.length)
  assert.deepEqual(after.retention.requests.map(r => [r.subjectId, r.ranBy, r.scope]), [[me.id, me.id, 'audit']])
  const everything = JSON.stringify((await h.db.prepare('SELECT * FROM larder_audit').all()).results) + JSON.stringify(await (await h.request('/api/larder/audit.json')).json())
  assert.equal(everything.includes(me.name), false)
  assert.match(everything, /Goods in/)
  await h.invariant()
})
