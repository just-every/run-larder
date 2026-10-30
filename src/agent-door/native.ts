import type { Bindings } from '../auth.server'
import { executeCommand } from '../larder/api'
import { load, roleSql, authority } from '../larder/storage'
import { effectiveScope } from '../larder/scope'
import { stateView } from '../larder/view'
import { projectRecord } from './projection'
import { Problem } from '../larder/problem'
import { sha256 } from '../modules/import-kit/src/d1/index'
import { ToolRefusal, type Person, type ToolContext } from '../modules/agent-door/index.ts'
import type { Actor } from '../larder/model'

export async function nativeActor(env: Bindings, person: Person, ctx?: ToolContext): Promise<Actor> {
  const operator = await env.DB.prepare(`SELECT o.id,o.display_name AS name,o.version,${roleSql} AS role FROM oa_operators o WHERE o.id=? AND o.status='active'`).bind(person.id).first<{ id: string; name: string; version: number; role: string }>()
  if (!operator || !person.active) throw new ToolRefusal('unauthenticated')
  const s = await load(env.DB), member = s.roles.find(r => r.id === person.id), custom = s.customRoles.find(r => r.id === member?.customRoleId)
  const actor: Actor = { id: operator.id, name: operator.name, role: operator.role, operatorVersion: operator.version, sessionId: '', scope: effectiveScope(member, custom, s.locations) }
  if (ctx) {
    const state = await env.DB.prepare('SELECT envelope,local_document,local_revision FROM agent_door_state WHERE id=1').first<{ envelope: string | null; local_document: string | null; local_revision: number }>()
    if (!state) throw new ToolRefusal('policy_unset')
    const admission = await env.DB.prepare(`SELECT row FROM agent_door_audit
      WHERE json_extract(row,'$.operation_id')=? AND agent=? AND json_extract(row,'$.outcome')='running'
      ORDER BY sequence DESC LIMIT 1`).bind(ctx.operationId,ctx.agent.id).first<{row:string}>()
    const admitted = admission && JSON.parse(admission.row)
    if (!admitted || admitted.sponsor.id !== ctx.person.id || admitted.consent !== (ctx.consent ?? null)) throw new ToolRefusal('operation_mismatch')
    actor.agentDoor = { id: ctx.agent.id, name: ctx.agent.name, consent: ctx.consent, operationId: ctx.operationId, approvers: ctx.approvers,
      envelope: state.envelope, localDocument: state.local_document, localRevision: state.local_revision, admissionRevision: admitted.revision }
    const fence = authority(actor)
    if (!(await env.DB.prepare(`SELECT CASE WHEN (${fence.sql}) THEN 1 ELSE 0 END AS ok`).bind(...fence.params).first<{ok:number}>())?.ok) throw new ToolRefusal('unauthenticated')
  }
  return actor
}

export async function nativeView(env: Bindings, person: Person) {
  const actor = await nativeActor(env, person)
  return { actor, view: stateView(await load(env.DB), actor, {}) as Record<string, any> }
}

export async function nativeCommand(env: Bindings, type: string, payload: Record<string, unknown>, ctx: ToolContext) {
  try {
    const actor = await nativeActor(env, ctx.person, ctx)
    // The native replay identity is stable across the original and approved
    // execution and agent-scoped; it never uses a caller-supplied command id.
    const commandId = sha256(JSON.stringify([ctx.agent.id, ctx.idempotencyKey, type]))
    const response = await executeCommand(env, actor, { commandId, type, payload: structuredClone(payload) })
    const value = await response.json() as { ok: boolean; result: unknown }
    if (!response.ok || !value.ok) throw new ToolRefusal('native_refused')
    return projectRecord(value.result)
  } catch (error) {
    if (error instanceof Problem) throw new ToolRefusal(error.code.toLowerCase())
    throw error
  }
}
