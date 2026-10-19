import { fail } from './problem'
// Validated UTC instants shared by downtime and maintenance.
export function timestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))
    fail('INPUT', `${label} must be an ISO UTC timestamp.`, { field: label })
  const ms = Date.parse(value as string)
  const normalized = (value as string).replace(/(?:\.(\d{1,3}))?Z$/, (_, part) => `.${(part ?? '').padEnd(3, '0')}Z`)
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== normalized) fail('INPUT', `${label} must be a valid ISO UTC timestamp.`, { field: label })
  return new Date(ms).toISOString()
}

