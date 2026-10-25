import { rows, type Rec } from './api'
import type { Larder } from './app'
import { Card, Choose, Details, Field, Form, options, text } from './controls'
import { money, words } from './format'

function SourceLinks({ analysis, keys }: { analysis: Rec; keys: string[] }) {
  return <span>{keys.map((key, i) => <span key={key}>{i > 0 ? ' · ' : ''}<a href={`/api/larder/costing/explanations/${analysis.id}/sources/${encodeURIComponent(key)}`} target="_blank" rel="noreferrer">{key.split(':')[0]} {analysis.evidence.sources.findIndex((s: any) => s.key === key) + 1}</a></span>)}</span>
}

export function VarianceExplanations({ larder }: { larder: Larder }) {
  const s = larder.state!
  if (s.actor.role !== 'owner') return null
  return <Card title="Explain an order variance">
    <details><summary>Prepare a cited explanation</summary>
      <Form submit="Prepare evidence review" busy={larder.busy} onSubmit={d => larder.run('variance.prepare', { provider: text(d, 'provider'), orderId: text(d, 'orderId'), usdCap: text(d, 'usdCap'), tokenCap: Number(text(d, 'tokenCap')), reason: text(d, 'reason') })}>
        <Choose label="Explanation order" name="orderId" options={options(rows(s, 'salesOrders').filter(o => rows(s, 'costLinks').some(l => l.orderId === o.id)), o => o.reference)} />
        <Choose label="Model destination" name="provider" defaultValue="openrouter" options={[{ value: 'openrouter', label: 'OpenRouter to Anthropic only · Haiku 5.5' }, { value: 'anthropic', label: 'Anthropic direct · Haiku 5.5' }]} />
        <Field label="Run USD cap" name="usdCap" defaultValue="0.02" inputMode="decimal" />
        <Field label="Run token cap" name="tokenCap" type="number" defaultValue="44000" />
        <Field label="Explanation reason" name="reason" />
      </Form>
    </details>
    {rows(s, 'varianceAnalyses').slice().reverse().map(a => <details key={a.id} className="proposal" data-analysis-id={a.id}>
      <summary>{rows(s, 'salesOrders').find(o => o.id === a.orderId)?.reference} · {words(a.status)} · {a.evidence.sourceCount} sources</summary>
      <p>{a.destination}</p>
      <p>At most {money(a.usdCap)} USD and {a.tokenCap} tokens. Conservative request bound: {a.tokenBound} tokens.</p>
      <p>Only the numeric records below are sent. Names, customer details, notes, attachments and operator identities are excluded. Provider retention follows your selected provider account terms. Local evidence and decisions remain in the business archive and audit.</p>
      <p>Every observation is a hypothesis requiring validation. Experiments and future standards need separate human approval.</p>
      <details><summary>Review exact numeric records</summary>
        {a.evidence.facts.map((f: any) => <article key={f.id} id={`${a.id}-${f.id}`}>
          <h3>{f.id} · {f.label}</h3>
          <Details label={`Measures ${f.id}`} value={f.values} s={s} />
          <SourceLinks analysis={a} keys={f.sourceKeys} />
        </article>)}
      </details>
      <p>{a.evidence.missing.length ? `Missing evidence: ${a.evidence.missing.join('; ')}` : 'All configured cost measures have source records. Causal explanations still need a controlled experiment.'}</p>
      {a.status === 'prepared' && <Form submit="Approve exact model destination" busy={larder.busy} onSubmit={d => larder.run('variance.consent', { analysisId: a.id, version: a.version, digest: a.evidence.digest, destination: a.destination, acceptProviderRetention: d.has('retention'), reason: text(d, 'reason') })}>
        <label className="check"><input type="checkbox" name="retention" required />I approve these records and destination and accept the provider retention terms.</label>
        <Field label="Model consent reason" name="reason" />
      </Form>}
      {a.status === 'approved' && <Form submit="Run approved explanation once" busy={larder.busy} onSubmit={() => larder.run('variance.run', { analysisId: a.id, version: a.version, reason: 'Owner explicitly requested this approved single model attempt' })}><span /></Form>}
      {['prepared', 'approved'].includes(a.status) && <Form submit="Revoke unsent explanation" quiet busy={larder.busy} onSubmit={d => larder.run('variance.revoke', { analysisId: a.id, version: a.version, reason: text(d, 'reason') })}><Field label="Revoke explanation reason" name="reason" /></Form>}
      {a.status === 'running' && <p role="status">One attempt reserved. Refresh to inspect the outcome; it will never resend automatically.</p>}
      {a.status === 'failed' && <p role="alert">{a.error}</p>}
      {a.status === 'complete' && <>
        <p>Explained with {a.evidence.sourceCount} distinct cited source records · {a.usage.inputTokens + a.usage.outputTokens} tokens · USD {a.usage.usd}</p>
        {a.observations.map((o: any, i: number) => <article key={i}>
          <h3>Hypothesis {i + 1}</h3><p>{o.hypothesis}</p><p>Proposed experiment: {o.experiment}</p>
          <p>{o.factIds.map((id: string) => <a key={id} href={`#${a.id}-${id}`} onClick={e => { e.preventDefault(); const el = document.getElementById(`${a.id}-${id}`); if (el) { el.closest('details')?.setAttribute('open', ''); el.scrollIntoView({ block: 'center' }) } }}>{id} </a>)}</p>
          <SourceLinks analysis={a} keys={[...new Set<string>(o.factIds.flatMap((id: string) => a.evidence.facts.find((f: any) => f.id === id).sourceKeys))]} />
        </article>)}
        <details><summary>Compare an approved improvement</summary>
          <p><a href="#make/boms">Review and approve a future engineering revision</a>, then produce the next job and retain its comparison here. This explanation never edits standards.</p>
          <Form submit="Record next-job comparison" busy={larder.busy} onSubmit={d => larder.run('variance.followup', { analysisId: a.id, version: a.version, proposalIndex: Number(text(d, 'proposalIndex')), changeId: text(d, 'changeId'), workOrderId: text(d, 'workOrderId'), reason: text(d, 'reason') })}>
            <Choose label="Proposed experiment" name="proposalIndex" options={a.observations.map((_: any, i: number) => ({ value: String(i), label: `Hypothesis ${i + 1}` }))} />
            <Choose label="Approved engineering change" name="changeId" options={options(rows(s, 'engineeringChanges').filter(c => c.status === 'approved'), c => `Revision ${c.approvedBom?.revision} · ${c.reason}`)} />
            <Choose label="Completed next job" name="workOrderId" options={options(rows(s, 'workOrders').filter(w => w.status === 'closed'), w => w.reference)} />
            <Field label="Improvement comparison reason" name="reason" />
          </Form>
        </details>
      </>}
      {a.followups.map((f: any) => <div key={f.workOrderId}><p>Historical variances unchanged. Next-job comparison retained.</p><Details label="Improvement measures" value={f.comparison} s={s} /></div>)}
    </details>)}
  </Card>
}
