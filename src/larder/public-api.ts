// Versioned native-session reads reuse the app's current permission-filtered view.
import { fail } from './problem'
import type { Actor, State } from './model'
import { stateView } from './view'

const resources = { catalog: 'items', orders: 'salesOrders', operations: 'workOrders', trace: 'lots' } as const
export function publicPage(s: State, actor: Actor, resource: string, params: URLSearchParams) {
  if (!(Object.hasOwn(resources, resource))) fail('NOT_FOUND', 'Unknown versioned resource.')
  const rawLimit = params.get('limit') ?? '50'
  if (!/^[1-9]\d{0,2}$/.test(rawLimit) || Number(rawLimit) > 100) fail('INPUT', 'limit must be a whole number from 1 to 100.')
  const limit = Number(rawLimit)
  let offset = 0
  if (params.has('cursor')) {
    let cursor: any
    try { cursor = JSON.parse(atob(params.get('cursor')!)) } catch { fail('INPUT', 'Invalid page cursor.') }
    if (!cursor || typeof cursor !== 'object' || cursor.resource !== resource || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0 || !Number.isSafeInteger(cursor.version)) fail('INPUT', 'Invalid page cursor.')
    if (cursor.version !== s.version) fail('STALE', 'Records changed between pages. Restart from the first page.')
    offset = cursor.offset
  }
  const view = stateView(s, actor, {}) as Record<string, any>
  const rows = [...view[resources[resource as keyof typeof resources]]].sort((a, b) => a.id.localeCompare(b.id))
  if (offset > rows.length) fail('INPUT', 'Invalid page cursor.')
  return { apiVersion: '1', version: s.version, data: rows.slice(offset, offset + limit), nextCursor: offset + limit < rows.length ? btoa(JSON.stringify({ resource, version: s.version, offset: offset + limit })) : null }
}
