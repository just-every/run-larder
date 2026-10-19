// Requirements apply to locally approved documents, not external certification.
import { get, type Row, type State } from './model'
import { fail } from './problem'

export const certificateTypes = ['coa', 'sds', 'test-report', 'specification', 'coc'] as const
export type CertificateType = (typeof certificateTypes)[number]

export function certificateDate(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    fail('INPUT', `${name} must be a real UTC date (YYYY-MM-DD).`)
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    fail('INPUT', `${name} must be a real UTC date (YYYY-MM-DD).`)
  return value as string
}

// A customer policy adds requirements; clearing it never clears general policy.
export function requiredTypes(s: State, itemId: string, customerId = ''): CertificateType[] {
  const required = new Set(s.certificatePolicies
    .filter(policy => policy.itemId === itemId && (policy.customerId === '' || policy.customerId === customerId))
    .flatMap(policy => policy.types as CertificateType[]))
  return certificateTypes.filter(type => required.has(type))
}

export function hasCertificateRequirements(s: State, itemId: string): boolean {
  return requiredTypes(s, itemId).length > 0
}

// Only decided revisions participate: a draft replacement leaves the approved
// document usable, while a revoked newest decision cannot revive an older one.
// Return detached exact records so later revocation cannot rewrite a shipment.
export function approvedCertificates(s: State, itemId: string, lotId: string, on: string, customerId = ''): Row[] {
  const types = requiredTypes(s, itemId, customerId)
  if (types.length === 0) return []
  certificateDate(on, 'Release date')
  if (!lotId) fail('CERTIFICATE_REQUIRED', 'A lot is required to select its required approved documents.', { itemId, types })
  const lot = get(s, 'lots', lotId, 'lot')
  if (lot.itemId !== itemId) fail('CERTIFICATE_REQUIRED', 'The required documents must belong to this item and lot.', { itemId, lotId })
  return types.map(type => {
    const latest = s.certificates
      .filter(document => document.itemId === itemId && document.lotId === lotId && document.type === type && ['approved', 'revoked'].includes(document.status))
      .sort((a, b) => b.revision - a.revision)[0]
    if (!latest || latest.status !== 'approved')
      fail('CERTIFICATE_REQUIRED', `An approved ${type} document is required for lot ${lot.code}.`, { itemId, lotId, type, certificateId: latest?.id })
    if (latest.declaredLot !== lot.code)
      fail('CERTIFICATE_REQUIRED', `The approved ${type} document declares a different lot.`, { itemId, lotId, type, certificateId: latest.id })
    if (certificateDate(latest.expiresOn, 'Document expiry') < on)
      fail('EXPIRED', `The approved ${type} document for lot ${lot.code} expired on ${latest.expiresOn}.`, { itemId, lotId, type, certificateId: latest.id, expiresOn: latest.expiresOn })
    return structuredClone(latest)
  })
}
