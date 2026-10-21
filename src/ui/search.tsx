// Find a record by order, SKU or lot from the top bar: the loaded records only, no server search.
import { useId, useState } from 'react'
import { itemName, partyName, rows, type LarderState } from './api'
import { Icon } from './icons'

type Hit = { href: string; label: string; detail: string }

function hits(s: LarderState, query: string): Hit[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const has = (...t: unknown[]) => t.some(x => String(x ?? '').toLowerCase().includes(q))
  return [
    ...rows(s, 'sourceHistory').filter(r => has(r.source, r.originalId, r.reference, r.summary, ...r.references, ...r.attachments.map((f: any) => f.name))).map(r => ({ href: '#more/move-in', label: r.reference, detail: `Source history · ${r.source} · ${r.originalId}` })),
    ...rows(s, 'salesOrders').filter(o => has(o.reference, o.customerReference, partyName(s, o.customerId))).map(o => ({ href: `#orders/${o.id}`, label: o.reference, detail: `Sales order · ${partyName(s, o.customerId)}` })),
    ...rows(s, 'workOrders').filter(w => has(w.reference, itemName(s, w.itemId))).map(w => ({ href: `#make/wo/${w.id}`, label: w.reference, detail: `Work order · ${itemName(s, w.itemId)}` })),
    ...rows(s, 'purchaseOrders').filter(p => has(p.reference, p.supplierReference, partyName(s, p.supplierId))).map(p => ({ href: `#make/po/${p.id}`, label: p.reference, detail: `Purchase order · ${partyName(s, p.supplierId)}` })),
    ...rows(s, 'items').filter(i => has(i.sku, i.name)).map(i => ({ href: '#stock', label: i.sku, detail: `Item · ${itemName(s, i.id)}` })),
    ...rows(s, 'lots').filter(l => has(l.code)).map(l => ({ href: '#stock', label: l.code, detail: `Lot · ${itemName(s, l.itemId)}` })),
  ].slice(0, 8)
}

export function Search({ s }: { s: LarderState }) {
  const [query, setQuery] = useState(''), list = useId(), found = hits(s, query)
  const open = (href: string) => { window.location.hash = href.slice(1); setQuery('') }
  return <div className="search" role="search">
    <label><Icon name="search" /><input type="search" value={query} placeholder="Search order, SKU, lot…" aria-label="Search order, SKU, lot" aria-controls={list} aria-expanded={found.length > 0}
      onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && found[0]) open(found[0].href); if (e.key === 'Escape') setQuery('') }} /></label>
    {query.trim().length >= 2 && <ul id={list} className="search-hits">{found.length ? found.map(h => <li key={h.href + h.label}><a href={h.href} onClick={() => setQuery('')}><strong>{h.label}</strong><span>{h.detail}</span></a></li>) : <li className="none">Nothing matches “{query.trim()}”.</li>}</ul>}
  </div>
}
