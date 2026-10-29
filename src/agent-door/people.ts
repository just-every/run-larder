import { authConfig, operatorAuth, type Bindings } from '../auth.server'
import { operatorAuthPeople, type PeopleAdapter } from '../modules/agent-door/index.ts'
import { roleSql } from '../larder/storage'

// OA owns identity/admission; the manufacturing role is Larder's own role.
// Business policy roles continue to come from the signed durable binding.
export function larderPeople(env: Bindings): PeopleAdapter {
  const native = operatorAuthPeople({ db: env.DB, allowList: authConfig(env).allowList, session: request => operatorAuth(env).getSession(request) })
  const policyRoles = new Map<string,'owner' | 'editor' | null>()
  async function person(id: string) {
    const found = await native.person(id)
    if (!found) return null
    const row = await env.DB.prepare(`SELECT ${roleSql} AS role FROM oa_operators o WHERE o.id=?`).bind(id).first<{ role: string }>()
    const current = { ...found, role: row?.role ?? 'viewer' }
    const member = await native.businessMember?.(found)
    policyRoles.set(current.id,env.RER_OWNER_CLAIM_PUBLIC_KEYS ? member?.role ?? null : current.role === 'owner' ? 'owner' : null)
    return current
  }
  return { person, businessMember: native.businessMember, businessRole: person => policyRoles.get(person.id) ?? null,
    async sponsor(claims) { const found = await native.sponsor(claims); return found ? person(found.id) : null },
    async session(request) { const found = await native.session(request); return found ? person(found.id) : null },
  }
}
