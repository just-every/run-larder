import { writeFile } from 'node:fs/promises'
import { installation } from '../tests/api/harness.mjs'
import { varianceFixture } from '../tests/api/variance-fixture.mjs'

if (!process.env.OPENROUTER_API_KEY) throw new Error('Inject OPENROUTER_API_KEY before invoking the generated-job live journey.')
const h = await installation({ now: '2026-10-25T12:00:00.000Z', modelKey: process.env.OPENROUTER_API_KEY, modelEdge: async request => {
  try {
    const response = await fetch(request.url, { method: request.method, headers: { 'content-type': 'application/json', authorization: request.headers.get('authorization') }, body: await request.text(), redirect: 'manual' })
    return new Response(await response.text(), { status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? 'application/json', 'request-id': response.headers.get('request-id') ?? '' } })
  } catch (error) {
    return Response.json({ error: { type: 'transport_error', message: String(error.message) + (error.cause ? ': ' + String(error.cause.message) : '') } }, { status: 502 })
  }
} })
try {
  const fixture = await varianceFixture(h), reason = 'synthetic-larder-814 live generated-job explanation'
  let a = await h.command('variance.prepare', { provider: 'openrouter', orderId: fixture.order.id, tokenCap: 44000, usdCap: '0.02', reason })
  a = await h.command('variance.consent', { analysisId: a.id, version: a.version, digest: a.evidence.digest, destination: a.destination, acceptProviderRetention: true, reason })
  a = await h.command('variance.run', { analysisId: a.id, version: a.version, reason })
  if (a.status !== 'complete') throw new Error(a.error ?? `Model outcome ${a.status}`)
  const { change, next } = await fixture.improve()
  if (process.env.LARDER_LIVE_VARIANCE_ARCHIVE) await writeFile(process.env.LARDER_LIVE_VARIANCE_ARCHIVE, JSON.stringify(await (await h.request('/api/larder/archive')).json()), { mode: 0o600 })
  a = await h.command('variance.followup', { analysisId: a.id, version: a.version, proposalIndex: 0, changeId: change.id, workOrderId: next.id, reason })
  console.log(JSON.stringify({ destination: a.destination, sourceCount: a.evidence.sourceCount, usage: a.usage, providerRequestId: a.providerRequestId, hypotheses: a.observations.length, historicalUnchanged: a.followups[0].historicalUnchanged, before: a.followups[0].comparison.before.actualCost, after: a.followups[0].comparison.after.actualCost }))
} finally { await h.close() }
