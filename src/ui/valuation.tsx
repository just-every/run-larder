import { Chip, Table } from './controls'
import { money, words } from './format'

// MOVE-007: the source and proposed stock valuation, their exact USD difference and the rows to review.
export function Valuation({ v }: { v: any }) {
  if (!v) return null
  const usd = (value: string) => `${money(value)} USD`
  return <section aria-label="Stock valuation">
    <h3>Stock valuation {v.matched ? <Chip tone="good">Matched to the cent</Chip> : <Chip tone="bad">Difference blocks cutover</Chip>}</h3>
    <dl className="facts counts">
      <div><dt>Source total{v.currency !== 'USD' ? ` (${v.currency} ${money(v.source.total)} at ${v.rateToUsd})` : ''}</dt><dd>{usd(v.source.totalUsd)}</dd></div>
      <div><dt>Larder opening total</dt><dd>{usd(v.larder.totalUsd)}</dd></div>
      <div><dt>Difference</dt><dd className={v.matched ? undefined : 'bad'}>{usd(v.differenceUsd)}</dd></div>
      <div><dt>Rows to review</dt><dd>{v.reviewCount}</dd></div>
    </dl>
    {v.exceptions.length > 0 && <Table head={['Line', 'External ID', 'Kind', 'Source value (USD)', 'Why']}>{v.exceptions.map((e: any, i: number) => <tr key={i}><td>{e.line}</td><td className="mono">{e.sourceId}</td><td>{words(e.kind)}</td><td>{e.sourceValueUsd === null ? 'Unknown' : money(e.sourceValueUsd)}</td><td>{e.reason}</td></tr>)}</Table>}
    {v.stockValues.length > 0 && <details><summary>{v.stockValues.length} opening values as of {v.asOf}{v.lots.length ? `, ${v.lots.length} lots` : ''}</summary><ul>{v.stockValues.map((x: any, i: number) => <li key={i}>{x.sku} at {x.location}: {x.quantity} × {x.unitCostUsd} = {usd(x.valueUsd)}</li>)}</ul></details>}
  </section>
}
