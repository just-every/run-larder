import { sha256 } from '../modules/import-kit/src/d1/index'
import { fail } from './problem'
import { newId, text, type Context } from './model'

const types = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/csv', 'text/plain', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']

// Evidence a person attaches (a count sheet, a supplier confirmation). Stored
// with its digest in the same atomic write as the record that cites it.
export function attach(c: Context, input: any): { id: string; name: string; sha256: string; size: number } {
  if (!input || typeof input !== 'object') fail('EVIDENCE', 'Attach the evidence file.')
  const name = text(input.name, 'file name', 200), contentType = text(input.contentType, 'file type', 120)
  if (!types.includes(contentType)) fail('EVIDENCE', 'Attach a PDF, image, CSV, text or spreadsheet file.')
  if (typeof input.base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64)) fail('EVIDENCE', 'The file content is not valid base64.')
  const bytes = Uint8Array.from(atob(input.base64), ch => ch.charCodeAt(0))
  if (bytes.length === 0 || bytes.length > 1048576) fail('EVIDENCE', 'Evidence files must be between 1 byte and 1 MiB.')
  const a = { id: newId(), name, contentType, size: bytes.length, sha256: sha256(bytes), bytes, createdBy: c.actor.id, createdAt: c.now }
  c.attachments.push(a)
  return { id: a.id, name: a.name, sha256: a.sha256, size: a.size }
}
