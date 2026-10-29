import { scrub, scrubText } from '../larder/audit'

const credentials = /(secret|token|passw|passcode|api[\s_-]?key|access[\s_-]?key|private[\s_-]?key|authorization|credential|cookie|signature|bearer)/i
const fileBytes = /^(base64|bytes)$/i
// Resource projections retain native record structure and untrusted prose.
// Credential fields are withheld and original file bytes stay on their native
// download door; neither is copied into a retained MCP result.
export function projectRecord(value: unknown, depth = 0): any {
  if (typeof value === 'string') return scrubText(value)
  if (!value || typeof value !== 'object') return scrub(value)
  if (depth > 20) return scrub(value)
  if (Array.isArray(value)) return value.map(item => projectRecord(item,depth+1))
  return Object.fromEntries(Object.entries(value).map(([key,field]) => [key,
    credentials.test(key) ? '[withheld]' : fileBytes.test(key) ? scrub({[key]:field}) : projectRecord(field,depth+1),
  ]))
}
