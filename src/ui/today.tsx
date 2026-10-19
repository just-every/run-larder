import { can, itemName, partyName, personName, rows, type LarderState, type Rec } from './api'
import type { Larder } from './app'
import { Card, Chip, Details, Empty, Field, Form, text } from './controls'
import { Icon } from './icons'
import { day, money, qty, words } from './format'
import { stories } from './supply'
import { schedule } from './schedule/plan'

function Checklist({ s }: { s: LarderState }) {
  const steps = [
    { done: rows(s, 'locations').length > 0 && rows(s, 'items').length > 0, label: 'Add your locations and items, or move them in from Odoo', href: '#more/move-in' },
    { done: rows(s, 'movements').length > 0, label: 'Record counted opening stock with its evidence', href: '#stock' },
    { done: rows(s, 'boms').length > 0, label: 'Give each made item a bill of materials', href: '#make/boms' },
    { done: rows(s, 'salesOrders').some(o => o.status !== 'quote'), label: 'Confirm your first order and reserve its stock', href: '#orders' },
    { done: rows(s, 'operators').length > 1 || s.actor.role !== 'owner', label: 'Invite your team and give each person a role', href: '#more/people' },
  ]
  if (steps.every(x => x.done)) return null
  const step = (x: typeof steps[number], i: number) => <><span className="disc" aria-hidden="true">{i + 1}</span><span className="label">{x.label}</span>{x.done ? <Chip tone="good">Done</Chip> : <Icon name="chevron" />}</>
  return <Card title="Getting started" className="checklist"><div className="steps"><ol>{steps.map((x, i) => <li key={x.label} className={x.done ? 'done' : undefined}>{x.done ? <span>{step(x, i)}</span> : <a href={x.href}>{step(x, i)}</a>}</li>)}</ol></div></Card>
}

// Where each kind of exception is dealt with.
const route = (x: any) => ({ plan: 'make/plan', purchase: `make/po/${x.id}`, make: `make/wo/${x.id}`, 'move-in': 'more/move-in', handoff: `handoff/${x.id}` } as Record<string, string>)[x.view] ?? x.view

function ProposalBody({ s, p }: { s: LarderState; p: Rec }) {
  const plan = p.plan
  if (p.kind === 'order-intake') return <><p>{partyName(s, plan.customerId)} · promise {day(plan.promiseDate)}</p><ul>{plan.lines.map((l: any, i: number) => <li key={i}>{itemName(s, l.itemId)}: {l.quantity === null ? <Chip tone="warn">quantity missing</Chip> : qty(l.quantity)} at {money(l.unitPrice)}</li>)}</ul><p className="muted">Reply to approve: “{plan.message}”</p><blockquote className="enquiry">{plan.enquiry}</blockquote></>
  if (p.kind === 'replenishment') return <><p>{plan.explanation}</p><ul>{plan.purchases.map((x: any, i: number) => <li key={i}>{partyName(s, x.supplierId)}, due {day(x.expectedDate)}: {x.lines.map((l: any) => `${qty(l.quantity)} ${itemName(s, l.itemId)} at ${money(l.unitPrice)}`).join('; ')}</li>)}</ul><p>Cash exposure <strong>{money(p.context.cashExposure)}</strong></p></>
  if (p.kind === 'item-merge') return <><p>Merge {itemName(s, plan.duplicateItemId)} into {itemName(s, plan.keepItemId)}.</p><p className="muted">Affects {p.context.impact.references.length} supplier codes, {p.context.impact.boms.length} BOMs, {p.context.impact.stock.length} stock positions{p.context.impact.blocking.length ? `; blocked by ${p.context.impact.blocking.join(', ')}` : ''}.</p></>
  if (p.kind === 'reschedule') return <><ul>{plan.changes.map((c: any, i: number) => { const w = rows(s, 'workOrders').find(x => x.id === c.workOrderId); return <li key={i}>{w?.reference}: start {day(c.plannedStart)}, priority {c.priority}</li> })}</ul>{p.context.conflicts.length > 0 && <p className="muted">Conflicts: {p.context.conflicts.join('; ')}</p>}<p><a href="#schedule">See the moves on the schedule</a></p></>
  if (p.kind === 'reconciliation') return <p>{plan.entries.length} ledger matches for {p.context.handoff}.</p>
  return null
}

export function Today({ larder }: { larder: Larder }) {
  const s = larder.state!, run = larder.run, busy = larder.busy
  const proposals = rows(s, 'proposals').filter(p => p.status === 'awaiting approval')
  const drafts = rows(s, 'purchaseOrders').filter(p => p.status === 'draft'), counts = rows(s, 'counts').filter(c => c.status === 'awaiting approval')
  const approve = can(s, ['manager', 'sales', 'buyer', 'production', 'accounts'])
  // A released job missing materials reads what it waits on and when, as the Shortages page and the Schedule do.
  const plan = schedule(s, new Date())
  const others = s.exceptions.filter((x: any) => !['proposal', 'approval'].includes(x.kind)).map((x: any) => {
    const w = x.view === 'make' && x.kind === 'shortage' ? rows(s, 'workOrders').find(r => r.id === x.id) : undefined
    return w ? { ...x, detail: stories(s, w, plan).join('; ') } : x
  })
  const waiting = proposals.length + drafts.length + counts.length
  return <div className="page today">
    <header className="page-head"><p className="eyebrow">Today</p><h1>What needs attention</h1></header>
    <Checklist s={s} />
    <div className="split">
      <Card title="Exceptions" aside={<Chip tone={others.length ? 'warn' : 'good'}>{others.length} open</Chip>}>
        {others.length === 0 ? <Empty>Nothing is short, late, quarantined or unreconciled.</Empty> : <ul className="queue">{others.map((x: any) => <li key={x.key}>
          <a className="queue-row" href={`#${route(x)}`}><Chip tone={x.kind === 'mismatch' || x.kind === 'late' ? 'bad' : 'warn'}>{words(x.kind)}</Chip><span><strong>{x.title}</strong><span className="muted">{x.detail}</span></span><Icon name="chevron" /></a>
          {x.resolvable && can(s, ['manager']) && <details className="resolve"><summary>Resolve with a note</summary><Form submit="Mark resolved" quiet busy={busy} onSubmit={d => run('exception.resolve', { key: x.key, note: text(d, 'note') })}><Field label="Decision note" name="note" placeholder="What you decided and why" /></Form></details>}
        </li>)}</ul>}
      </Card>
      <Card title="Needs a person" aside={<Chip tone={waiting ? 'warn' : 'good'}>{waiting}</Chip>} className="needs">
        {waiting === 0 && <Empty>No proposals or approvals are waiting.</Empty>}
        {proposals.map(p => <article key={p.id} className="proposal"><h3>{p.summary}</h3><p className="muted">{words(p.kind)} prepared by {personName(s, p.preparedBy)}</p><div className="plan"><ProposalBody s={s} p={p} /></div>
          {p.assumptions && <p className="muted">Assumptions: {p.assumptions}</p>}<Details label="Evidence and exact plan" value={{ evidence: p.evidence, plan: p.plan }} s={s} />
          {approve && p.preparedBy !== s.actor.id && <div className="actions"><button className="button primary" disabled={busy} onClick={() => run('proposal.approve', { proposalId: p.id, version: p.version })}>Approve</button><button className="button" disabled={busy} onClick={() => run('proposal.reject', { proposalId: p.id, version: p.version, note: 'Declined on review' })}>Decline</button></div>}
        </article>)}
        {drafts.map(po => <article key={po.id} className="proposal"><h3><a href={`#make/po/${po.id}`}>{po.reference} for {partyName(s, po.supplierId)}</a></h3><p className="muted">Draft purchase · {money(po.exposure)} · due {day(po.expectedDate)}</p><p className="muted">{po.reason}</p>
          {can(s, ['manager', 'buyer']) && <div className="actions"><button className="button primary" disabled={busy} onClick={() => run('po.approve', { poId: po.id, version: po.version })}>Approve</button><a className="button" href={`#make/po/${po.id}`}>Review</a></div>}</article>)}
        {counts.map(c => <article key={c.id} className="proposal"><h3>{c.reference}: {itemName(s, c.itemId)} counted {qty(c.counted)}</h3><p className="muted">Records show {qty(c.system)}; difference {qty(c.variance)}. Counted by {personName(s, c.createdBy)}.</p>
          {c.sessionId ? <a className="button" href="#stock">Review count session</a> : can(s, ['manager']) && c.createdBy !== s.actor.id || s.actor.role === 'owner' ? <div className="actions"><button className="button primary" disabled={busy} onClick={() => run('count.approve', { countId: c.id, version: c.version })}>Approve adjustment</button><button className="button" disabled={busy} onClick={() => run('count.reject', { countId: c.id, version: c.version, note: 'Recount' })}>Ask for a recount</button></div> : null}</article>)}
      </Card>
    </div>
  </div>
}
