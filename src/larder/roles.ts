import { fail, forbidden } from './problem'
import { bump, get, list, oneOf, row, text, type Context, type Row } from './model'
import { approvalDoor } from './scope'
import { scopeClassification } from './scope-classification'

// Larder roles. The owner holds every authority; an agent prepares drafts and
// proposals and never approves, posts stock or changes roles. GOV-001: a planner
// holds today's planning doors (forecast/MPS, inventory policies, shortage and
// work drafts, ranks, reschedules, protections, independent plan adoption,
// bounded sequencing grants and split/merge) but never releases work or buys;
// an engineer holds revision doors (BOMs/routings, BOM and catalog CSV, change
// proposals) while managers approve changes; an operator executes only their
// own assigned operations and posts no stock.
export const roles = ['owner', 'manager', 'sales', 'planner', 'buyer', 'engineer', 'production', 'operator', 'warehouse', 'quality', 'accounts', 'agent', 'viewer'] as const
export type Role = (typeof roles)[number]

export function allow(c: Context, permitted: Role[]) {
  if (c.actor.role === 'owner' || permitted.includes(c.actor.role as Role)) return
  forbidden()
}

// A person approving must not be the one who prepared the record, unless the
// owner approves; agents never approve.
export function approver(c: Context, permitted: Role[], preparedBy?: string) {
  if (c.actor.role === 'agent') forbidden('Agents prepare; a person with authority approves.')
  allow(c, permitted)
  if (preparedBy) c.preparedBy = preparedBy
  if (preparedBy && preparedBy === c.actor.id && c.actor.role !== 'owner') forbidden('A different person must approve what you prepared.')
}

// The owner gives an invited person one Larder role, narrows a member with a location scope or the costs-and-wages
// restriction (GOV-001), and names custom roles: a copy of one built-in role that can only be narrowed.
export function roleCommand(c: Context, type: string, p: any): Row | undefined {
  if (!['role.set', 'role.assign', 'role.custom', 'member.scope'].includes(type)) return
  if (c.actor.role !== 'owner') forbidden('Only the owner assigns roles and scopes.')
  if (type === 'role.custom') return customRole(c, p)
  const existing = c.s.roles.find(r => r.id === p.operatorId)
  if (type === 'role.set') {
    if (!roles.includes(p.role) || p.role === 'owner') fail('INPUT', 'Choose a Larder role other than owner.')
    // A member holds exactly one role: choosing a built-in role replaces any custom role.
    if (existing) return bump(existing, { role: p.role, customRoleId: '' })
    return row(c, 'roles', { id: p.operatorId, role: p.role })
  }
  if (existing?.role === 'agent') fail('INPUT', 'Scopes and custom roles apply to people; an agent only prepares.')
  if (type === 'role.assign') {
    const custom = get(c.s, 'customRoles', p.customRoleId, 'custom role')
    if (existing) return bump(existing, { role: custom.base, customRoleId: custom.id })
    return row(c, 'roles', { id: p.operatorId, role: custom.base, customRoleId: custom.id })
  }
  for (const key of Object.keys(p)) if (!['operatorId', 'sites', 'locations', 'costsRestricted', 'reason'].includes(key)) fail('INPUT', 'Scope facts are computed by the server; send only the member restrictions.', { field: key })
  const places = p.locations === null || p.locations === undefined ? null : [...new Set<string>(list<string>(p.locations, 'locations'))]
  for (const id of places ?? []) get(c.s, 'locations', id, 'location')
  const sites = p.sites === undefined || p.sites === null ? null : [...new Set<string>(list<string>(p.sites, 'sites'))]
  for (const id of sites ?? []) get(c.s, 'sites', id, 'site')
  const next = { sites, locations: places, costsRestricted: p.costsRestricted === true }
  const previous = existing ? structuredClone(existing) : undefined
  const changed = existing ? bump(existing, next) : row(c, 'roles', { id: p.operatorId, role: 'viewer', ...next })
  changed.scopeClassification = scopeClassification(c, previous, changed, c.scopeTarget ?? fail('NOT_FOUND', 'Choose an invited person.'))
  return changed
}

function customRole(c: Context, p: any): Row {
  const base = oneOf(p.base, roles.filter(r => r !== 'owner' && r !== 'agent'), 'base role'), name = text(p.name, 'name', 80)
  const doors = [...new Set<string>(Array.isArray(p.removedDoors) ? p.removedDoors : [])]
  for (const d of doors) if (typeof d !== 'string' || !approvalDoor.test(d)) fail('INPUT', 'Only approval doors can be removed from a custom role.', { field: 'removedDoors' })
  const places = p.locations === null || p.locations === undefined ? null : [...new Set<string>(list<string>(p.locations, 'locations'))]
  for (const id of places ?? []) get(c.s, 'locations', id, 'location')
  const data = { name, base, locations: places, costsRestricted: p.costsRestricted === true, removedDoors: doors }
  const existing = p.customRoleId ? get(c.s, 'customRoles', p.customRoleId, 'custom role') : undefined
  if (c.s.customRoles.some(r => r.id !== existing?.id && r.name.toLowerCase() === name.toLowerCase())) fail('INPUT', 'A custom role with that name exists.', { field: 'name' })
  if (existing) {
    if (existing.base !== base) fail('INPUT', 'A custom role keeps its base role; make a new one for another base.', { field: 'base' })
    return bump(existing, data)
  }
  return row(c, 'customRoles', data)
}
