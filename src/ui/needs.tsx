import { can, partyName, rows } from './api'
import type { Larder } from './app'
import { Card, Chip, Empty, GoodsPicture } from './controls'
import { day, money, words } from './format'

// The compact "Needs a person" card: agent proposals and drafts awaiting approval.
export function NeedsList({ larder, compact }: { larder: Larder; compact?: boolean }) {
  const s = larder.state!, run = larder.run, shown = compact ? 3 : Infinity
  const proposals = rows(s, 'proposals').filter(p => p.status === 'awaiting approval'), drafts = rows(s, 'purchaseOrders').filter(p => p.status === 'draft')
  const total = proposals.length + drafts.length, more = Math.max(0, proposals.length - shown) + Math.max(0, drafts.length - shown)
  return <Card title="Needs a person" aside={<Chip tone={total ? 'warn' : 'good'}>{total}</Chip>} className={compact ? 'needs compact' : 'needs'}>
    {compact && <p className="muted">Agent-prepared items waiting for approval.</p>}
    {total === 0 && <Empty>Nothing is waiting.</Empty>}
    {proposals.slice(0, shown).map(p => <article key={p.id} className="proposal"><GoodsPicture name="docket" /><h3>{words(p.kind)}</h3><p>{p.summary}</p><div className="actions"><a className="button" href="#today">Review</a></div></article>)}
    {drafts.slice(0, shown).map(po => <article key={po.id} className="proposal"><GoodsPicture name="po" /><h3><a href={`#make/po/${po.id}`}>Purchase order {po.reference}</a></h3><p className="muted">{partyName(s, po.supplierId)} · {money(po.exposure)} · due {day(po.expectedDate)}</p><p className="muted"><b>Reason:</b> {po.reason}</p>
      <div className="actions">{can(s, ['manager', 'buyer']) && <button className="button primary" disabled={larder.busy} onClick={() => run('po.approve', { poId: po.id, version: po.version })}>Approve</button>}<a className="button" href={`#make/po/${po.id}`}>Review</a></div></article>)}
    {more > 0 && <p><a href="#today">{more} more on Today</a></p>}
  </Card>
}
