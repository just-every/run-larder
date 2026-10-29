import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
const error = answer => answer.result?._meta?.['com.runeditrun/error']?.code ?? answer.body?.error?.data?.code
const content = answer => {assert.equal(answer.result?.isError,false);return answer.result.structuredContent}

export default async function ({request,origin,cookie,tool}) {
  const snapshot=()=>tool('larder.workspace.snapshot',{}).then(content)
  const before=await snapshot()
  const key=randomUUID()
  const args={idempotency_key:key,supplierId:before.parties[0].id,expectedDate:'2027-01-20',reason:'Native replay proof',lines:[{itemId:before.items[2].id,quantity:'1',unitPrice:'1'}]}
  const first=content(await tool('larder.purchases.draft',args)), after=await snapshot()
  assert.deepEqual(content(await tool('larder.purchases.draft',args)),first)
  assert.deepEqual(await snapshot(),after)
  assert.equal(error(await tool('larder.purchases.draft',{...args,reason:'Changed proposed effect'})),'idempotency_conflict')
  assert.deepEqual(await snapshot(),after)
  assert.equal(error(await tool('larder.purchases.amend',{idempotency_key:randomUUID(),poId:first.id,version:first.version,expected_revision:first.version+1,reason:'Stale revision proof',lines:[{lineId:first.lines[0].id,quantity:'2'}]})),'revision_conflict')
  assert.deepEqual(await snapshot(),after)
  const pause=async paused=>{
    const response=await request(origin+'/agents/api/pause',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({paused})})
    assert.equal(response.status,200)
  }
  await pause(true)
  try {assert.equal(error(await tool('larder.purchases.draft',{...args,idempotency_key:randomUUID()})),'agents_paused')}
  finally {await pause(false)}
  assert.deepEqual(await snapshot(),after)
  assert.equal(error(await tool('larder.records.read',{kind:'purchases',id:randomUUID()})),'resource_unavailable')
  console.log('LARDER-AGENT native journey: one effect on replay, changed arguments conflict, stale native revision refuses, local Pause stops the next write, resumed witness unchanged, missing record unavailable.')
}
