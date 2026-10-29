import {collections,type Context,type State} from './model'

// Supplement each native record's own history without replacing its human ids,
// signatures, original author or append-only stock evidence.
export function attributeAgentChanges(c: Context,before: State) {
  const agent=c.actor.agentDoor
  if(!agent)return
  const entry={commandId:c.commandId,operationId:agent.operationId,at:c.now,agent:{id:agent.id,name:agent.name},for:{id:c.actor.id,name:c.actor.name},label:`${agent.name} for ${c.actor.name}`,policyApprovers:agent.approvers}
  for(const kind of collections){
    const old=new Map(before[kind].map(record=>[record.id,JSON.stringify(record)]))
    for(const record of c.s[kind])if(old.get(record.id)!==JSON.stringify(record))record.agentActivity=[...(record.agentActivity??[]),entry]
  }
}

// Base retains decision arguments and outcomes outside native client records.
// Until a client-scoped custody/redaction hook exists, native erasure must not
// report completion while those retained artifacts can still replay or execute.
export const agentCustodyEmptySql = ['agent_door_agents','agent_door_calls','agent_door_audit','agent_door_approvals','agent_door_reviews','larder_command_agents']
  .map(table=>`NOT EXISTS(SELECT 1 FROM ${table})`).join(' AND ')
  + " AND NOT EXISTS(SELECT 1 FROM larder_records WHERE json_type(data,'$.preparedByAgent') IS NOT NULL OR COALESCE(json_array_length(data,'$.agentActivity'),0)>0)"
