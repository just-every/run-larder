import { rows, type LarderState, type Rec } from './api'
import { minus, money, plus, timesMoney } from './format'

// Repricing remaining demand never revalues a shipment already issued.
export function commercialValue(s: LarderState, order: Rec): string {
  if (order.customerTerms) return `${order.customerTerms.currency} ${money(order.customerTerms.totalAmount)} · USD ${money(order.customerTerms.totalUsdAmount)}`
  if (order.status === 'quote') return money(plus(...order.lines.map((line: any) => timesMoney(line.quantity, line.unitPrice))))
  const issued = rows(s, 'shipments').filter(shipment => shipment.orderId === order.id && shipment.status === 'shipped').flatMap(shipment => shipment.lines)
  if (order.lines.some((line: any) => plus(...issued.filter((shipmentLine: any) => shipmentLine.lineId === line.id).map((shipmentLine: any) => shipmentLine.quantity)) !== line.shipped) || issued.some((line: any) => line.unitPrice === undefined)) return 'Historical price not recorded'
  const open = order.lines.map((line: any) => timesMoney(minus(minus(line.quantity, line.cancelled), line.shipped), line.unitPrice))
  return money(plus(...issued.map((line: any) => timesMoney(line.quantity, line.unitPrice)), ...open))
}
