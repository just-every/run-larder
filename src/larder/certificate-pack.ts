// The dispatched packet is frozen at shipment, including original file bytes.
import { get, type State } from './model'
import { fail } from './problem'
export async function certificatePack(db: D1Database, s: State, shipmentId: string) {
  const shipment = get(s, 'shipments', shipmentId, 'shipment')
  if (!['shipped', 'reversed'].includes(shipment.status)) fail('STATE', 'Certificate packets belong to dispatched shipments.')
  const order = get(s, 'salesOrders', shipment.orderId, 'sales order')
  const trace = shipment.lines.flatMap((line: any) => (line.certificates ?? []).map((record: any) => ({ ...record,
    lineId: line.lineId })))
  const files = []
  const ids = new Set<string>(trace.flatMap((r: any) => r.documents.map((d: any) => d.file.id)))
  for (const id of ids) {
    const file = await db.prepare('SELECT id,name,content_type AS contentType,sha256,bytes FROM larder_attachments WHERE id=?').bind(id).first<any>()
    if (!file) fail('EVIDENCE', 'A retained shipment certificate file is missing.')
    let binary = ''; for (const b of new Uint8Array(file.bytes)) binary += String.fromCharCode(b)
    files.push({ id: file.id, name: file.name, contentType: file.contentType, sha256: file.sha256, base64: btoa(binary) })
  }
  return { format: 'larder-shipment-certificates-v1', shipmentId: shipment.id, shipmentReference: shipment.reference, shippedAt: shipment.shippedAt,
    salesOrderId: order.id, salesOrderReference: order.reference, customerId: order.customerId,
    evidenceBasis: 'Documents approved locally and retained at shipment; not provider verification or regulatory certification.', trace, files }
}
