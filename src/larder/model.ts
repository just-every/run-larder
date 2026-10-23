import { fail } from './problem'

export const collections = [
  'workGroups', 'costPolicies', 'jobCharges', 'costLinks', 'marginCharges', 'costValuations', 'reportSchedules', 'scheduleGrants', 'replenishmentPlans', 'schedulePolicies', 'schedulePlans', 'scheduleBookings', 'machineCalendars', 'laborCalendars', 'laborRates', 'sourceHistory', 'historyImports', 'items', 'locations', 'parties', 'partyItems', 'boms', 'salesOrders', 'purchaseOrders', 'workOrders',
  'receipts', 'lots', 'shipments', 'returns', 'transfers', 'counts', 'openings', 'reversals', 'handoffs',
  'inventoryPolicies', 'inventoryPlans', 'certificates', 'certificatePolicies', 'maintenance', 'forecasts', 'productionPlans', 'proposals', 'approvals', 'orderChanges', 'bomChanges', 'catalogChanges', 'engineeringChanges', 'countSessions', 'followUps', 'resolutions', 'imports', 'roles', 'workTransfers', 'reworkOrders', 'subcontractOrders', 'subcontractCustody', 'inspectionPlans', 'inspections', 'qualityHolds', 'nonconformances', 'recalls', 'approvalPolicies', 'approvalDelegations', 'approvalSignatures', 'cutovers', 'auditErasures', 'customRoles', 'configModels', 'kits', 'kitSales', 'timeEntries', 'timeLocks',
] as const
export type Collection = (typeof collections)[number]
export type Row = { id: string; version: number; [key: string]: any }

// Quantities and unit costs on a movement are scaled integers (see decimal.ts).
export type Movement = {
  id: string; sequence: number; itemId: string; locationId: string; status: 'available' | 'quarantine'; lotId: string
  quantity: bigint; unitCost: bigint; kind: string; documentKind: string; documentId: string; reversesId: string | null
  actorId: string; commandId: string; importId: string | null; reason: string; createdAt: string
}
export type Reservation = { id: string; demandKind: 'sales' | 'work'; demandId: string; lineId: string; itemId: string; locationId: string; quantity: bigint }
export type Attachment = { id: string; name: string; contentType: string; size: number; sha256: string; bytes: Uint8Array; createdBy: string; createdAt: string }
export type State = Record<Collection, Row[]> & { version: number; movements: Movement[]; reservations: Reservation[] }
export type Actor = { id: string; name: string; role: string; sessionId: string; operatorVersion: number; scope?: import('./scope').Scope }
export type Context = { s: State; actor: Actor; commandId: string; now: string; attachments: Attachment[]; preparedBy?: string; people?: { id: string; name: string; role: string }[]; erasure?: { kind: string; id: string; entries: number; values: string[] } }

export const newId = () => crypto.randomUUID()

export function get(s: State, collection: Collection, id: unknown, label: string = collection): Row {
  return s[collection].find(r => r.id === id) ?? fail('NOT_FOUND', `That ${label} was not found.`, { collection, id })
}

export function fresh(row: Row, version: unknown) {
  if (row.version !== version) fail('STALE', 'This record changed since you opened it. Reload and review the current version.', { currentVersion: row.version })
}

export function row(c: Context, collection: Collection, data: Record<string, any>): Row {
  const r = { ...data, id: data.id ?? newId(), version: 1, createdAt: c.now, createdBy: c.actor.id }
  c.s[collection].push(r)
  return r
}

export function bump(r: Row, changes: Record<string, any>) {
  Object.assign(r, changes)
  r.version += 1
  return r
}

export const text = (value: unknown, name = 'value', max = 2000): string =>
  typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : fail('INPUT', `${name} is required (at most ${max} characters).`, { field: name })

export const optionalText = (value: unknown, name = 'value', max = 2000): string =>
  value === undefined || value === null || value === '' ? '' : text(value, name, max)

export const date = (value: unknown, name = 'date'): string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) ? value : fail('INPUT', `${name} must be a date (YYYY-MM-DD).`, { field: name })

export const list = <T = any>(value: unknown, name = 'lines', max = 500): T[] =>
  Array.isArray(value) && value.length > 0 && value.length <= max ? value as T[] : fail('INPUT', `${name} must list between 1 and ${max} entries.`, { field: name })

export const oneOf = <T extends string>(value: unknown, options: readonly T[], name: string): T =>
  options.includes(value as T) ? value as T : fail('INPUT', `${name} must be one of: ${options.join(', ')}.`, { field: name })

// A document's human reference, set once: SO-0001, PO-0001, WO-0001.
export function nextReference(rows: Row[], prefix: string) {
  const used = rows.map(r => Number(new RegExp(`^${prefix}-(\\d+)$`).exec(r.reference ?? '')?.[1] ?? 0))
  return `${prefix}-${String(Math.max(0, ...used) + 1).padStart(4, '0')}`
}

export const today = (c: Context) => c.now.slice(0, 10)
