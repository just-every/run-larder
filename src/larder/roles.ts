import { fail, forbidden } from './problem'
import { bump, row, type Context, type Row } from './model'

// Larder roles. The owner holds every authority; an agent prepares drafts and
// proposals and never approves, posts stock or changes roles.
export const roles = ['owner', 'manager', 'sales', 'buyer', 'production', 'warehouse', 'quality', 'accounts', 'agent', 'viewer'] as const
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
  if (preparedBy && preparedBy === c.actor.id && c.actor.role !== 'owner') forbidden('A different person must approve what you prepared.')
}

// The owner gives an invited person one Larder role.
export function roleCommand(c: Context, type: string, p: any): Row | undefined {
  if (type !== 'role.set') return
  if (c.actor.role !== 'owner') forbidden('Only the owner assigns roles.')
  if (!roles.includes(p.role) || p.role === 'owner') fail('INPUT', 'Choose a Larder role other than owner.')
  const existing = c.s.roles.find(r => r.id === p.operatorId)
  if (existing) return bump(existing, { role: p.role })
  return row(c, 'roles', { id: p.operatorId, role: p.role })
}
