import { personName, type LarderState, type Rec } from './api'
import { Table } from './controls'
import { qty, when } from './format'
const basis = (b: any) => b ? `${qty(b.quantity)} × ${qty(b.seasonality)}${b.overrideQuantity !== null && b.overrideQuantity !== undefined ? `; override ${qty(b.overrideQuantity)}` : ''}` : 'No previous forecast'

export function ForecastHistory({ s, forecast }: { s: LarderState; forecast: Rec }) {
  return <details><summary>Forecast change history</summary>
    <Table head={['Change', 'Before', 'After', 'Reason / person']}>{forecast.history.map((entry: any) => <tr key={entry.id}>
      <td>{entry.kind}<small>{when(entry.at)}</small></td><td>{basis(entry.before)}</td><td>{basis(entry.after)}</td>
      <td>{entry.reason}<small>{personName(s, entry.by)}</small>{entry.attachmentId && <a href={`/api/larder/attachments/${entry.attachmentId}`}>Original forecast CSV</a>}</td>
    </tr>)}</Table>
  </details>
}
