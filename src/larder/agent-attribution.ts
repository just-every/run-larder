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
