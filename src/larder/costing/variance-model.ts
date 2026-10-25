import type { Bindings } from '../../auth.server'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/d1/index'
import { auditEntries } from '../audit'
import { bump, get, type Actor, type Context, type Row } from '../model'
import { commit, load, authority } from '../storage'
import { fail } from '../problem'

export const modelDestinations = { anthropic: 'Anthropic · claude-haiku-5-5 · https://api.anthropic.com/v1/messages', openrouter: 'OpenRouter to Anthropic only · claude-haiku-5-5 · https://openrouter.ai/api/v1/chat/completions' }
export type ModelProvider = keyof typeof modelDestinations
const tool = { name: 'explain_variance', description: 'At most three physical process hypotheses and inert experiments: repeated time and overtime, material consumption and scrap, or excess hours driving overhead. Cite source facts. Do not discuss quote arithmetic, monetary amounts, scrap cost allocation or accounting policy; these are displayed deterministically. No standard changes.', input_schema: { type: 'object', additionalProperties: false, required: ['observations'], properties: { observations: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['factIds', 'hypothesis', 'experiment'], properties: { factIds: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string' } }, hypothesis: { type: 'string', maxLength: 900 }, experiment: { type: 'string', maxLength: 600 } } } } } } }
const citedTool = (e: any) => {
  const grounded: any = structuredClone(tool)
  grounded.input_schema.properties.observations.items.properties.factIds.items.enum = e.facts.map((f: any) => f.id)
  return grounded
}
const anthropicRequest = (e: any) => ({ model: 'claude-haiku-5-5', max_tokens: 1600, thinking: { type: 'disabled' }, system: 'Analyze only the supplied numeric source records. Call explain_variance with at most four concise observations, each with at most three sentences and one experiment sentence. Cite existing fact IDs for every observation and experiment. Explain repeated scrap, overtime, material usage, cost and overhead where supported. Causality is a hypothesis, never established by correlation. Identify missing evidence; do not invent it. All experiments need human engineering and financial approval; never propose executing a command. Do not infer identities. Order line quoted cost is total line quantity times its pinned quoted unit cost; actual cost is net shipped quantity times approved output lot unit cost. These are comparable for equal ordered and shipped quantities. Job actual cost includes good and scrap allocation; report it separately from the order line actual cost. Cost links allocate a fraction of each full job: linked quantity divided by the planned quantity of that job. Never sum full linked job totals or treat different quantities as an unexplained discrepancy. Do not repeat deterministic arithmetic as a hypothesis; focus on supported recurring process patterns. Never claim a missing allocation rate or basis when the cited policy supplies it. No payroll or financial posting is requested. Pinned standardHours already includes planned job quantity; routing minutes are per unit. Actual machine and overhead cost equal recorded active labor hours times the respective pinned policy rates. Overhead variance is actual overhead minus pinned standardOverheadCost. OvertimeCost is separately measured and included in laborCost, not an unknown allocation. Do not call a numeric measure or allocation basis missing when these records and formulas supply it. Distinguish an unproven physical root cause from missing accounting arithmetic. GoodCost, scrapCost and WIP are separate allocations: scrap cost is excluded from goodCost and actualUnitCost, never absorbed into good output. Do not invent a different accounting policy or propose correcting an allocation already explained by these supplied fields. Hypotheses should describe process patterns in hours, scrap and material quantities, not restate monetary calculations; the native deterministic measures already show those. Return at most three process observations: repeated time and overtime, material consumption and scrap, and excess hours driving overhead, only where evidence supports each. Exclude quote comparisons and all accounting allocation hypotheses. Use concise plain language.', messages: [{ role: 'user', content: canonicalJson({ facts: e.facts, sources: e.sources, missing: e.missing }) }], tools: [citedTool(e)], tool_choice: { type: 'tool', name: tool.name } })
export function varianceRequest(e: any, provider: ModelProvider = 'anthropic') {
  const request = anthropicRequest(e)
  if (provider === 'anthropic') return request
  return { model: ['anthropic', 'claude-haiku-5.5'].join('/'), max_tokens: 1600, reasoning: { enabled: false }, messages: [{ role: 'system', content: request.system }, ...request.messages], tools: [{ type: 'function', function: { name: tool.name, description: tool.description, parameters: request.tools[0].input_schema } }], tool_choice: 'auto', provider: { only: ['anthropic'], allow_fallbacks: false, require_parameters: true, data_collection: 'deny', max_price: { prompt: 0.1, completion: 0.5 } } }
}
function normalized(body: any, provider: ModelProvider) {
  if (provider === 'anthropic') return body
  const choice = body.choices?.[0], call = choice?.message?.tool_calls?.find((t: any) => t.function?.name === tool.name)
  return { ...body, stop_reason: choice?.finish_reason === 'tool_calls' ? 'tool_use' : choice?.finish_reason, content: call ? [{ type: 'tool_use', name: tool.name, input: JSON.parse(call.function.arguments) }] : [], usage: { input_tokens: body.usage?.prompt_tokens, output_tokens: body.usage?.completion_tokens } }
}


// A byte per input token plus a generous fixed envelope is deliberately above
// the tokenizer's bound. No cache, thinking, tools or follow-up calls add spend.
export const requestBound = (request: unknown) => new TextEncoder().encode(JSON.stringify(request)).length + 4096 + 1600
const parseOutput = (body: any, r: Row) => {
  const block = body.content?.find((x: any) => x.type === 'tool_use' && x.name === tool.name)
  if (body.stop_reason !== 'tool_use' || !Array.isArray(block?.input?.observations) || !block.input.observations.length || block.input.observations.length > 4) fail('MODEL_OUTPUT', 'The model did not return a complete cited explanation.')
  return block.input.observations.map((o: any) => {
    if (!Array.isArray(o.factIds) || !o.factIds.length || o.factIds.length > 8 || o.factIds.some((id: unknown) => !r.evidence.facts.some((f: any) => f.id === id))) fail('MODEL_CITATION', 'The model returned an unknown citation.')
    if (typeof o.hypothesis !== 'string' || !o.hypothesis.trim() || o.hypothesis.length > 900 || typeof o.experiment !== 'string' || !o.experiment.trim() || o.experiment.length > 600) fail('MODEL_OUTPUT', 'The model returned an incomplete or oversized proposal.')
    const mentioned = `${o.hypothesis} ${o.experiment}`.match(/\bF\d+\b/g) ?? []
    if (mentioned.some((id: string) => !r.evidence.facts.some((f: any) => f.id === id))) fail('MODEL_CITATION', 'The model text named an unknown fact.')
    return { factIds: [...new Set([...o.factIds, ...mentioned])], hypothesis: o.hypothesis, experiment: o.experiment }
  })
}

export async function finishVariance(env: Bindings, actor: Actor, started: Row) {
  let outcome: Record<string, unknown>
  try {
    const provider: ModelProvider = started.provider
    const key = (provider === 'openrouter' ? env.OPENROUTER_API_KEY : env.ANTHROPIC_API_KEY) ?? fail('MODEL_KEY', `${provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'ANTHROPIC_API_KEY'} is not configured; no request was sent.`)
    const guard = authority(actor)
    const authorized = await env.DB.prepare(`SELECT CASE WHEN (${guard.sql}) THEN 1 ELSE 0 END AS ok`).bind(...guard.params).first<{ ok: number }>()
    if (authorized?.ok !== 1) fail('AUTH', 'Owner authority changed before the model send; no request was sent.')
    const request = varianceRequest(started.evidence, provider)
    if (requestBound(request) > started.tokenCap || requestBound(request) * 0.0000005 > Number(started.usdCap)) fail('CAP', 'The request exceeds its approved run cap; no request was sent.')
    const endpoint = provider === 'openrouter' ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.anthropic.com/v1/messages'
    const authHeaders: Record<string, string> = provider === 'openrouter' ? { authorization: `Bearer ${key}` } : { 'anthropic-version': '2023-06-01', 'x-api-key': key }
    const response = await fetch(endpoint, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(45000), headers: { 'content-type': 'application/json', ...authHeaders }, body: JSON.stringify(request) })
    const body: any = await response.json()
    if (!response.ok) {
      const code = String(body.error?.type ?? 'provider_error').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)
      // Retain the provider's diagnostic, never request headers or credentials.
      const message = String(body.error?.message ?? 'No provider diagnostic').replaceAll(key, '[withheld]').slice(0, 1500)
      fail('MODEL_PROVIDER', `${provider} HTTP ${response.status} ${code}: ${message}`)
    }
    const result = normalized(body, provider)
    const input = Number(result.usage?.input_tokens), output = Number(result.usage?.output_tokens)
    if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0 || input + output > started.tokenCap || output > 1600) fail('MODEL_USAGE', 'Provider usage exceeded or did not confirm the approved token bound.')
    const usd = provider === 'openrouter' ? Number(body.usage?.cost) : (input * 0.1 + output * 0.5) / 1000000
    if (!Number.isFinite(usd) || usd < 0) fail('MODEL_USAGE', 'Provider did not confirm the actual USD cost.')
    if (usd > Number(started.usdCap)) fail('MODEL_USAGE', 'Provider usage exceeded the approved USD cap.')
    outcome = { status: 'complete', observations: parseOutput(result, started), usage: { inputTokens: input, outputTokens: output, usd: usd.toFixed(8), pricing: 'USD ceiling 0.10 input and 0.50 output per million tokens; routed cost is provider-reported' }, providerRequestId: response.headers.get('request-id') || body.id, finishedAt: new Date().toISOString() }
  } catch (error) {
    outcome = { status: 'failed', error: error instanceof Error ? error.message : 'Model request failed; outcome unconfirmed.', finishedAt: new Date().toISOString() }
  }
  // The send was reserved durably before the network. A replay, restart or
  // concurrent request cannot send it again, including an uncertain timeout.
  for (let attempt = 0; attempt < 8; attempt++) {
    const before = await load(env.DB), c: Context = { s: structuredClone(before), actor, commandId: `variance-result-${started.id}`, now: new Date().toISOString(), attachments: [] }
    const r = get(c.s, 'varianceAnalyses', started.id)
    if (r.status !== 'running' || r.runCommandId !== started.runCommandId) fail('STATE', 'The model run is no longer current.')
    bump(r, outcome)
    try {
      return await commit(env.DB, c, before, 'variance.result', sha256(canonicalJson(outcome)), r, auditEntries(c, before, 'variance.result', { reason: 'Retain the single approved model attempt' }))
    } catch (error) {
      if (attempt < 7 && (await load(env.DB)).version !== before.version) continue
      throw error
    }
  }
  return fail('BUSY', 'The single model result could not be retained; no automatic resend is allowed.')
}
