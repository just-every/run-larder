// Authorized local document approval retains the file and every decision.
import { attach } from './attachments'
import { certificateDate, certificateTypes } from './certificate-policy'
import { bump, fresh, get, oneOf, row, nextReference, text, type Context, type Row } from './model'
import { fail } from './problem'
import { allow, approver } from './roles'

function requirements(c: Context, p: any): Row {
  allow(c, ['manager'])
  const item = get(c.s, 'items', p.itemId, 'item')
  const customerId = p.customerId === undefined || p.customerId === '' ? '' : text(p.customerId, 'customer ID', 200)
  if (customerId) {
    const customer = get(c.s, 'parties', customerId, 'customer')
    if (!['customer', 'both'].includes(customer.kind)) fail('INPUT', 'Choose a customer for the certificate policy.')
  }
  if (!Array.isArray(p.types) || p.types.length > certificateTypes.length)
    fail('INPUT', 'List the required document types, or use an empty list with a reason to clear them.')
  const types = p.types.map((type: unknown) => oneOf(type, certificateTypes, 'document type'))
  if (new Set(types).size !== types.length) fail('INPUT', 'List each required document type once.')
  const note = text(p.note, 'requirements reason', 2000)
  const policy = c.s.certificatePolicies.find(policy => policy.itemId === item.id && policy.customerId === customerId)
  if (policy) fresh(policy, p.version)
  const entry = { before: policy ? [...policy.types] : [], types: [...types], actorId: c.actor.id, at: c.now, note }
  const data = { itemId: item.id, customerId, types, note, updatedBy: c.actor.id, updatedAt: c.now,
    history: [...(policy?.history ?? []), entry] }
  return policy ? bump(policy, data) : row(c, 'certificatePolicies', data)
}

function prepare(c: Context, p: any): Row {
  allow(c, ['manager', 'production', 'warehouse', 'agent'])
  const item = get(c.s, 'items', p.itemId, 'item'), lot = get(c.s, 'lots', p.lotId, 'lot')
  if (lot.itemId !== item.id) fail('INPUT', 'The document lot must belong to its item.')
  const type = oneOf(p.type, certificateTypes, 'document type')
  const documentVersion = text(p.documentVersion, 'document version', 200)
  const declaredLot = text(p.declaredLot, 'declared lot', 200)
  const issuer = text(p.issuer, 'issuer', 200)
  const expiresOn = certificateDate(p.expiresOn, 'Document expiry')
  const revision = c.s.certificates.reduce((highest, document) =>
    document.itemId === item.id && document.lotId === lot.id && document.type === type ? Math.max(highest, document.revision) : highest, 0) + 1
  const file = attach(c, p.evidence)
  return row(c, 'certificates', { reference: nextReference(c.s.certificates, 'DC'), itemId: item.id, lotId: lot.id, type, documentVersion, revision, declaredLot,
    issuer, expiresOn, file, digest: file.sha256, status: 'draft', preparedBy: c.actor.id, preparedAt: c.now,
    history: [{ status: 'draft', actorId: c.actor.id, at: c.now, commandId: c.commandId }] })
}

export function certificates(c: Context, type: string, p: any): Row | undefined {
  if (type === 'certificate.requirements') return requirements(c, p)
  if (type === 'certificate.prepare') return prepare(c, p)
  if (type !== 'certificate.approve' && type !== 'certificate.revoke') return
  allow(c, ['manager'])
  const document = get(c.s, 'certificates', p.certificateId, 'certificate document')
  fresh(document, p.version)
  const note = text(p.note, 'document decision note', 2000)
  const decision = { actorId: c.actor.id, at: c.now, note, commandId: c.commandId }
  if (type === 'certificate.revoke') {
    if (document.status !== 'approved') fail('STATE', 'Only an approved document can be revoked.')
    return bump(document, { status: 'revoked', revokedBy: c.actor.id, revokedAt: c.now, revocationNote: note,
      history: [...document.history, { ...decision, status: 'revoked', version: document.version + 1 }] })
  }
  approver(c, ['manager'], document.preparedBy)
  if (document.status !== 'draft') fail('STATE', 'Only a draft document can be approved.')
  const lot = get(c.s, 'lots', document.lotId, 'lot')
  if (lot.itemId !== document.itemId || document.declaredLot !== lot.code)
    fail('CERTIFICATE_REQUIRED', 'The document declares a different lot. Prepare a matching document before approval.', { certificateId: document.id, lotId: lot.id, declaredLot: document.declaredLot })
  if (certificateDate(document.expiresOn, 'Document expiry') < c.now.slice(0, 10))
    fail('EXPIRED', 'An expired document cannot be approved.', { certificateId: document.id, expiresOn: document.expiresOn })
  return bump(document, { status: 'approved', approvedBy: c.actor.id, approvedAt: c.now, approvalNote: note,
    approvedVersion: document.version + 1,
    history: [...document.history, { ...decision, status: 'approved', version: document.version + 1 }] })
}
