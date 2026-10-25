import { bump, fresh, get, row, text, type Context, type Row } from '../model'
import { allow } from '../roles'
import { fail } from '../problem'
import { decimal } from '../decimal'
import { varianceEvidence, jobDigest, comparison } from './variance-evidence'
import { jobCosts } from './jobs'
import { varianceRequest, requestBound, modelDestinations, type ModelProvider } from './variance-model'

export function variance(c: Context, type: string, p: any): Row | undefined {
  if (!type.startsWith('variance.')) return
  allow(c, [])
  const reason = text(p.reason, 'analysis reason', 400)
  if (type === 'variance.prepare') {
    const provider = p.provider ?? 'anthropic'
    if (!Object.hasOwn(modelDestinations, provider)) fail('INPUT', 'Choose a declared model destination.')
    const evidence = varianceEvidence(c.s, p.orderId), request = varianceRequest(evidence, provider as ModelProvider)
    const tokenBound = requestBound(request), tokenCap = Number(p.tokenCap), usdCap = String(p.usdCap)
    if (!Number.isSafeInteger(tokenCap) || tokenCap < tokenBound || tokenCap > 44000) fail('CAP', `Choose a token cap from ${tokenBound} to 44000.`)
    if (decimal(usdCap) > decimal('0.02') || decimal(usdCap) * 2n < BigInt(tokenBound)) fail('CAP', 'The USD cap must cover the conservative token bound and be at most USD 0.02.')
    return row(c, 'varianceAnalyses', { orderId: evidence.orderId, evidence, provider, destination: modelDestinations[provider as ModelProvider], tokenBound, tokenCap, usdCap, status: 'prepared', reason, followups: [] })
  }
  const r = get(c.s, 'varianceAnalyses', p.analysisId)
  fresh(r, p.version)
  if (type === 'variance.consent') {
    if (r.status !== 'prepared' || p.digest !== r.evidence.digest || p.destination !== r.destination || p.acceptProviderRetention !== true) fail('CONSENT', 'Approve the exact records and destination and acknowledge provider retention before sending.')
    if (varianceEvidence(c.s, r.orderId).digest !== r.evidence.digest) fail('STALE', 'Source evidence changed; prepare a new explanation.')
    return bump(r, { status: 'approved', consentedBy: c.actor.id, consentedAt: c.now, consentReason: reason, retentionAcknowledged: true })
  }
  if (type === 'variance.revoke') {
    if (!['prepared', 'approved'].includes(r.status)) fail('STATE', 'Only an unsent analysis can be revoked.')
    return bump(r, { status: 'revoked', revokedAt: c.now, revokeReason: reason })
  }
  if (type === 'variance.run') {
    if (r.status !== 'approved' || r.consentedBy !== c.actor.id) fail('CONSENT', 'Only the consenting owner may explicitly run this approved explanation once.')
    if (varianceEvidence(c.s, r.orderId).digest !== r.evidence.digest) fail('STALE', 'Source evidence changed; prepare and consent to a new explanation.')
    return bump(r, { status: 'running', startedAt: c.now, runCommandId: c.commandId })
  }
  if (type === 'variance.followup') {
    if (r.status !== 'complete') fail('STATE', 'Follow up a completed explanation.')
    const proposal = r.observations[Number(p.proposalIndex)]
    if (!proposal) fail('INPUT', 'Choose a cited process proposal.')
    const change = get(c.s, 'engineeringChanges', p.changeId), next = get(c.s, 'workOrders', p.workOrderId)
    const baseline = r.evidence.baselines.find((b: any) => b.itemId === next.itemId)
    if (!baseline || change.status !== 'approved' || change.itemId !== next.itemId || change.approvedBom?.revision !== next.bomRevision || next.status !== 'closed' || next.bomRevision <= baseline.bomRevision) fail('STATE', 'Choose completed new work on the approved later engineering revision.')
    const unchanged = r.evidence.baselines.every((b: any) => jobDigest(c.s, get(c.s, 'workOrders', b.workOrderId)) === b.digest)
    if (!unchanged) fail('STALE', 'Historical cost evidence changed; review it before claiming an improvement.')
    if (r.followups.some((f: any) => f.workOrderId === next.id)) fail('DUPLICATE', 'This next-job comparison is already retained.')
    return bump(r, { followups: [...r.followups, { proposalIndex: Number(p.proposalIndex), changeId: change.id, workOrderId: next.id, comparedAt: c.now, comparedBy: c.actor.id, historicalUnchanged: true, reason, comparison: comparison(baseline, { ...jobCosts(c.s, next), quantity: next.quantity, output: next.output, scrap: next.scrap, bomRevision: next.bomRevision }) }] })
  }
  fail('COMMAND', 'Unknown variance command.')
}
