import { operatorAuth, type Bindings } from '../auth.server'
import type { TeamAdapter } from '../modules/business-settings/types.ts'

// OA supplies the native invitation and revocation lifecycle. Only a managed
// person's role is projected; existing site and cost restrictions are retained.
export function larderTeam(env: Bindings): TeamAdapter {
  const native = operatorAuth(env).businessTeam
  if (!native) throw new Error('Native Business team adapter is required')
  return {
    ownerEmail: native.ownerEmail,
    async prepare(input) {
      const plan = await native.prepare(input)
      const statements = [...plan.statements]
      for (const row of plan.rows) {
        const member = input.members.find(member => member.email === row.email)
        const previous = row.operatorId ? await env.DB.prepare('SELECT business_role AS businessRole FROM bs_team WHERE operator_id=?').bind(row.operatorId).first<{businessRole:string}>() : null
        if (!member || !row.operatorId || row.state === 'conflict' || previous?.businessRole === member.role) continue
        const role = member.role === 'admin' ? 'manager' : 'viewer'
        statements.push(env.DB.prepare(`INSERT INTO larder_records(kind,id,version,data)
          SELECT 'roles',?,1,json_object('id',?,'version',1,'role',?)
          WHERE ${input.guard.sql} AND NOT EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND role='owner')
          ON CONFLICT(kind,id) DO UPDATE SET version=version+1,
            data=json_set(data,'$.role',?,'$.version',version+1)
          WHERE ${input.guard.sql}`).bind(row.operatorId,row.operatorId,role,...input.guard.args,row.operatorId,role,...input.guard.args))
        statements.push(env.DB.prepare(`UPDATE larder_meta SET version=version+1 WHERE id=1 AND ${input.guard.sql}`).bind(...input.guard.args))
      }
      return { ...plan, statements }
    },
  }
}
