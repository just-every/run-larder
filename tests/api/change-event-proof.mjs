import assert from 'node:assert/strict'

export async function journal(h, query = '', as = h.owner()) {
  const response = await h.request('/api/larder/audit/events' + query, { as })
  assert.equal(response.status, 200, await response.clone().text())
  return response.json()
}

// Follow the event through authenticated state and original-file doors while
// its source revision is current. Later reads retain the captured revision.
export async function followEvent(h, event) {
  const s = await h.state()
  assert.equal(event.stateVersion, s.version)
  for (const ref of event.records) {
    const record = s[ref.kind].find(r => r.id === ref.id)
    assert.ok(record, JSON.stringify(ref))
    assert.equal(record.version, ref.version, JSON.stringify(ref))
  }
  assert.ok(event.records.some(r => r.kind === event.source.kind && r.id === event.source.id && r.version === event.source.version))
  for (const movement of event.movements) {
    const actual = s.movements.find(m => m.id === movement.id)
    assert.ok(actual)
    for (const [key, value] of Object.entries(movement)) assert.equal(actual[key], value, key)
    assert.equal(actual.commandId, event.commandId)
  }
  for (const file of event.evidence) {
    const response = await h.request(file.href)
    assert.equal(response.status, 200)
    const { createHash } = await import('node:crypto')
    assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), file.sha256)
  }
  return s
}
