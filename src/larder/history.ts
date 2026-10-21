// Imported history is evidence, never executable manufacturing or provider work.
import { attach } from './attachments'
import { decimal, format } from './decimal'
import { fail, forbidden } from './problem'
import { bump, fresh, get, list, oneOf, row, text, type Context, type Row } from './model'

const optionalList = (value: unknown, name: string, max: number): any[] => value === undefined || (Array.isArray(value) && value.length === 0) ? [] : list(value, name, max)

export function historyMatches(r: Row, query: string) {
  const q = query.trim().toLowerCase()
  return [r.source, r.kind, r.originalId, r.reference, r.summary, ...r.references, ...r.attachments.map((f: any) => f.name)]
    .some(v => String(v).toLowerCase().includes(q))
}

function unique(records: Record<string, any>[], existing: Row[]) {
  const keys = new Set(existing.map(r => JSON.stringify([r.source, r.kind, r.originalId])))
  for (const r of records) {
    const key = JSON.stringify([r.source, r.kind, r.originalId])
    if (keys.has(key)) fail('DUPLICATE', `Source history already contains ${r.kind} ${r.originalId}.`)
    keys.add(key)
  }
}

export function history(c: Context, type: string, p: any): Row | undefined {
  if (!type.startsWith('history.')) return
  if (!['owner', 'manager', 'agent'].includes(c.actor.role)) forbidden('Only a manager or agent prepares source history.')
  if (type === 'history.preview') {
    const name = text(p.file?.name, 'history file name', 200), content = text(p.file?.content, 'history JSON', 1048576)
    let input: any
    try { input = JSON.parse(content) } catch { return fail('INPUT', 'Upload valid source-history JSON.') }
    if (input?.format !== 'larder-source-history-v1') fail('INPUT', 'Use larder-source-history-v1; see MOVE-IN.md.')
    const source = text(input.source, 'source system', 200)
    const supplied = optionalList(p.attachments, 'attachments', 5)
    const attachments = supplied.map(f => attach(c, f))
    if (new Set(attachments.map(f => f.name)).size !== attachments.length) fail('INPUT', 'Attachment names must be unique.')
    const records = list(input.records, 'history records', 200).map((r: any) => {
      const occurredAt = text(r.occurredAt, 'original timestamp', 40)
      if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(occurredAt) || !Number.isFinite(Date.parse(occurredAt))) fail('INPUT', 'Original timestamps must include Z or a time-zone offset.')
      const currency = text(r.currency, 'original currency', 3)
      if (!/^[A-Z]{3}$/.test(currency)) fail('INPUT', 'Supply the original three-letter currency; history never converts it.')
      const names: string[] = optionalList(r.attachments, 'record attachments', 5).map(n => text(n, 'attachment name', 200))
      return { source, kind: oneOf(r.kind, ['closed-job', 'shipment', 'bill', 'quality', 'lot'], 'history kind'),
        originalId: text(r.originalId, 'original ID', 200), reference: text(r.reference, 'source reference', 200), occurredAt, currency,
        sourceStatus: text(r.sourceStatus, 'source status', 100), summary: text(r.summary, 'summary'),
        references: optionalList(r.references, 'source references', 100).map(v => text(v, 'source reference', 200)),
        quantity: r.quantity === undefined ? null : format(decimal(r.quantity, 'history quantity', { signed: true })), unit: r.quantity === undefined ? '' : text(r.unit, 'quantity unit', 40),
        amount: r.amount === undefined ? null : format(decimal(r.amount, 'history amount', { signed: true })),
        attachments: names.map(n => attachments.find(f => f.name === n) ?? fail('INPUT', `Attach the original file ${n}.`)),
      }
    })
    unique(records, c.s.sourceHistory)
    // Retain the exact original bytes, including whitespace and source-only fields.
    const bytes = new TextEncoder().encode(p.file.content)
    let binary = ''; for (const b of bytes) binary += String.fromCharCode(b)
    const original = attach(c, { name, contentType: 'text/plain', base64: btoa(binary) })
    return row(c, 'historyImports', { source, status: 'previewed', records, original, attachments })
  }
  if (type === 'history.commit') {
    if (c.actor.role === 'agent') forbidden('A person approves source history; agents only prepare.')
    const batch = get(c.s, 'historyImports', p.importId); fresh(batch, p.version)
    if (batch.status !== 'previewed') fail('STATE', 'This source history was already committed.')
    unique(batch.records, c.s.sourceHistory)
    const records = batch.records.map((r: Row) => row(c, 'sourceHistory', { ...r, label: 'Source history', importId: batch.id, original: batch.original }))
    return bump(batch, { status: 'committed', recordIds: records.map((r: Row) => r.id), approvedBy: c.actor.id, approvedAt: c.now })
  }
}
