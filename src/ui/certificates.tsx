import { can, itemName, partyName, personName, rows, type Rec } from './api'
import type { Larder } from './app'
import { Area, Card, Choose, Chip, Field, Form, fileBase64, options, text } from './controls'
import { day, when } from './format'
const types = [{ value: 'coa', label: 'CoA' }, { value: 'sds', label: 'SDS' }, { value: 'test-report', label: 'Test report' }, { value: 'specification', label: 'Specification' }, { value: 'coc', label: 'CoC' }]
const typeName = (value: string) => types.find(t => t.value === value)?.label ?? value
function Types({ selected = [] }: { selected?: string[] }) {
  return <fieldset className="lines wide"><legend>Required document types</legend>{types.map(t => <label key={t.value}><input type="checkbox" name="types" value={t.value} defaultChecked={selected.includes(t.value)} /> {t.label}</label>)}</fieldset>
}
function Certificate({ larder, doc }: { larder: Larder; doc: Rec }) {
  const s = larder.state!, lot = rows(s, 'lots').find(l => l.id === doc.lotId), authorized = can(s, ['manager', 'quality'])
  return <article className="proposal" aria-label={`Certificate ${doc.reference}`}>
    <h3>{doc.reference} · {typeName(doc.type)} <Chip tone={doc.status === 'approved' ? 'good' : 'warn'}>{doc.status}</Chip></h3>
    <p>{itemName(s, doc.itemId)} · lot {lot?.code} · document lot {doc.declaredLot}<br />{doc.issuer} · version {doc.documentVersion} (revision {doc.revision}) · expires {day(doc.expiresOn)}</p>
    <p>Prepared by {personName(s, doc.createdBy)} {when(doc.createdAt)}{doc.approvedAt && <> · approved locally by {personName(s, doc.approvedBy)} {when(doc.approvedAt)}</>}</p>
    <p><a href={`/api/larder/attachments/${doc.file.id}`} target="_blank" rel="noreferrer">Original certificate: {doc.file.name}</a></p>
    <details><summary>{doc.reference} digest and decisions</summary><p style={{ overflowWrap: 'anywhere' }}>SHA-256 {doc.file.sha256}</p>{doc.history?.map((h: any, i: number) => <p key={i}>{h.status} · {personName(s, h.actorId)} {when(h.at)} · {h.note}</p>)}</details>
    {authorized && doc.status === 'draft' && (doc.createdBy !== s.actor.id || s.actor.role === 'owner') && <Form submit={`Approve ${doc.reference}`} busy={larder.busy} note="Approve this exact document for this SKU and lot. This is a local evidence decision, not provider verification or regulatory certification." onSubmit={d => larder.run('certificate.approve', { certificateId: doc.id, version: doc.version, note: text(d, 'note') })}><Area label={`${doc.reference} approval reason`} name="note" /></Form>}
    {authorized && doc.status === 'approved' && <details><summary>Revoke {doc.reference}</summary><Form submit={`Revoke ${doc.reference}`} busy={larder.busy} onSubmit={d => larder.run('certificate.revoke', { certificateId: doc.id, version: doc.version, note: text(d, 'note') })}><Area label={`${doc.reference} revocation reason`} name="note" /></Form></details>}
  </article>
}
export function Certificates({ larder }: { larder: Larder }) {
  const s = larder.state!, manage = can(s, ['manager', 'quality']), prepare = can(s, ['manager', 'production', 'warehouse', 'quality', 'agent'])
  const policies = rows(s, 'certificatePolicies'), customers = rows(s, 'parties').filter(p => p.kind !== 'supplier')
  return <Card title="Controlled lot documents">
    <p>Retain CoAs, SDSs, test reports, specifications and CoCs with their lot, version, expiry and original file. Human approval records an evidence decision in Larder; it does not certify a product or verify a provider.</p>
    {manage && <details><summary>Configure required certificates</summary><Form submit="Save certificate requirements" busy={larder.busy} onSubmit={d => {
      const itemId = text(d, 'item'), customerId = text(d, 'customer'), current = policies.find(p => p.itemId === itemId && (p.customerId || '') === customerId)
      return larder.run('certificate.requirements', { itemId, customerId, ...(current ? { version: current.version } : {}), types: d.getAll('types').map(String), note: text(d, 'note') })
    }}><Choose label="Certificate requirement SKU" name="item" options={options(rows(s, 'items'), i => `${i.sku} · ${i.name}`)} />
      <Choose label="Certificate customer (blank means all customers)" name="customer" required={false} options={options(customers, c => c.name)} /><Types /><Area label="Certificate requirement reason" name="note" />
    </Form></details>}
    <ul>{policies.map(p => <li key={p.id}>{itemName(s, p.itemId)} · {p.customerId ? partyName(s, p.customerId) : 'All customers / lot release'}: {p.types.length ? p.types.map(typeName).join(', ') : 'No requirements'}<br />{p.history?.at(-1)?.note}</li>)}</ul>
    {prepare && <details><summary>Upload a lot document</summary><Form submit="Prepare certificate" busy={larder.busy} onSubmit={async d => {
      const lotId = text(d, 'lot'), lot = rows(s, 'lots').find(l => l.id === lotId), f = d.get('file') as File
      return larder.run('certificate.prepare', { itemId: lot?.itemId, lotId, type: text(d, 'type'), documentVersion: text(d, 'documentVersion'), declaredLot: text(d, 'declaredLot'), issuer: text(d, 'issuer'), expiresOn: text(d, 'expiresOn'), evidence: { name: f.name, contentType: f.type || 'text/plain', base64: await fileBase64(f) } })
    }}>
      <Choose label="Certificate stock lot" name="lot" options={options(rows(s, 'lots'), l => `${itemName(s, l.itemId)} · ${l.code}`)} /><Choose label="Certificate document type" name="type" options={types} />
      <Field label="Lot printed on document" name="declaredLot" /><Field label="Document issuer" name="issuer" /><Field label="Document version" name="documentVersion" /><Field label="Document expiry (UTC date)" name="expiresOn" type="date" /><Field label="Original certificate file" name="file" type="file" />
    </Form></details>}
    {rows(s, 'certificates').map(doc => <Certificate key={doc.id} larder={larder} doc={doc} />)}
  </Card>
}

export function ShipmentCertificates({ shipment }: { shipment: Rec }) {
  const lots = shipment.lines.flatMap((l: any) => l.certificates ?? []).filter((r: any) => r.documents.length)
  if (!lots.length) return null
  return <section aria-label={`${shipment.reference} retained certificates`}>
    <h4>Certificates retained at shipment</h4>
    <p>These exact versions accompanied this shipment. Later approvals, expiry or revocation do not rewrite its record.</p>
    <ul>{lots.flatMap((r: any) => r.documents.map((d: any) => <li key={`${r.movementId}:${d.id}`}>{typeName(d.type)} · {d.declaredLot} · {d.documentVersion} (revision {d.revision}) · <a href={`/api/larder/attachments/${d.file.id}`} target="_blank" rel="noreferrer">{d.file.name}</a></li>))}</ul>
    <a className="button" href={`/api/larder/shipments/${shipment.id}/certificates.json`} download>Download {shipment.reference} certificate trace and originals</a>
  </section>
}
