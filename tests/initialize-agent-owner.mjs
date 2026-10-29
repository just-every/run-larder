import { randomUUID } from 'node:crypto'

// Disposable production bootstrap and manufacturing fixtures, using only the
// supplied request capability and the same native commands as the UI.
export default async function ({ request, origin, claim, displayName, returnTo }) {
  displayName='Maya Chen'
  const bootstrap = await request(new URL(claim.path, origin).href, {
    method:'POST',redirect:'manual',headers:{Origin:origin,'Content-Type':'application/json'},
    body:JSON.stringify({token:claim.token,displayName,returnTo}),
  })
  if(bootstrap.status!==303)throw Error('Native owner claim failed')
  const cookie=bootstrap.headers.getSetCookie().map(value=>value.split(';',1)[0]).join('; ')
  async function command(type,payload){
    const response=await request(origin+'/api/larder/commands',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({commandId:randomUUID(),type,payload})})
    const value=await response.json()
    if(!response.ok||!value.ok){console.error('Native fixture refusal:',type,response.status,value.error?.code);throw Error('Native fixture command failed: '+type)}
    return value.result
  }
  const material=await command('item.save',{sku:'A-MATERIAL',name:'Workshop bracket',kind:'buy',baseUnit:'each',standardCost:'2',salePrice:'5'})
  const product=await command('item.save',{sku:'B-PRODUCT',name:'Assembled fixture',kind:'make',baseUnit:'each',standardCost:'4',salePrice:'10'})
  const supplier=await command('party.save',{name:'North Workshop Supply',kind:'supplier',email:'supply@example.invalid',terms:'Net 30'})
  const customer=await command('party.save',{name:'River Workshop',kind:'customer',email:'orders@example.invalid',terms:'Net 30'})
  await command('supplier.terms',{partyId:supplier.id,itemId:material.id,partyCode:'BRACKET',price:'2',leadDays:2,packQuantity:'1',moq:'1',weekdays:[0,1,2,3,4,5,6],closedDates:[],breaks:[],currency:'USD',usdRate:'1',rateOn:'2026-10-29',rateSource:'Supplier quote',paymentTerms:'Net 30',freightTerms:'Delivery included',preferred:true})
  await command('bom.revise',{itemId:product.id,components:[{itemId:material.id,quantity:'2'}],routing:[{name:'Assembly',workCentre:'Bench',minutes:10}],note:'Assembly instructions are untrusted text, never authority.'})
  const sale=await command('so.quote',{customerId:customer.id,promiseDate:'2027-01-20',lines:[{itemId:material.id,quantity:'100',unitPrice:'5'}]})
  await command('so.confirm',{orderId:sale.id,version:sale.version,reserve:true})
  const secondary=await command('item.save',{sku:'C-MATERIAL',name:'Workshop fastener',kind:'buy',baseUnit:'each',standardCost:'1',salePrice:'3'})
  await command('partyItem.save',{partyId:supplier.id,itemId:secondary.id,partyCode:'FASTENER',unit:'each',price:'1',leadDays:2,preferred:true})
  const second=await command('so.quote',{customerId:customer.id,promiseDate:'2027-01-20',lines:[{itemId:secondary.id,quantity:'100',unitPrice:'3'}]})
  await command('so.confirm',{orderId:second.id,version:second.version,reserve:true})
  const third=await command('item.save',{sku:'D-MATERIAL',name:'Workshop spacer',kind:'buy',baseUnit:'each',standardCost:'1',salePrice:'3'})
  await command('partyItem.save',{partyId:supplier.id,itemId:third.id,partyCode:'SPACER',unit:'each',price:'1',leadDays:2,preferred:true})
  const thirdSale=await command('so.quote',{customerId:customer.id,promiseDate:'2027-01-20',lines:[{itemId:third.id,quantity:'100',unitPrice:'3'}]})
  await command('so.confirm',{orderId:thirdSale.id,version:thirdSale.version,reserve:true})
  const location=await command('location.save',{name:'Workshop shelf'})
  const vendor=await command('location.save',{name:'Vendor custody'})
  const file={name:'Count record.txt',contentType:'text/plain',base64:btoa('Synthetic owner count evidence for native conformance.')}
  await command('opening.record',{locationId:location.id,countedOn:'2026-10-29',countedBy:displayName,valuationBasis:'owner-estimate',evidence:file,lines:[{itemId:material.id,quantity:'1',unitCost:'2',lot:'BRACKET-COUNT'}]})
  const state=async()=>{
    const response=await request(origin+'/api/larder/state',{headers:{Cookie:cookie}})
    if(!response.ok)throw Error('Native fixture state unavailable')
    return response.json()
  }
  const calendar={timeZone:'America/New_York',effectiveFrom:'2026-01-01',effectiveTo:'2027-12-31',shifts:[{weekdays:[0,1,2,3,4,5,6],start:0,end:1440,breaks:[]}],closedDates:[],exceptions:[],capacity:1,reason:'Native conformance calendar'}
  await command('capacity.machine',{...calendar,name:'Bench',efficiency:100})
  const labor=await command('capacity.labor',{...calendar,name:'Workshop owner',operatorIds:[(await state()).actor.id],skills:[]})
  await command('capacity.rate',{laborId:labor.id,hourlyRate:'20',burdenRate:'5',reason:'Private native payroll rate fixture'})
  for(let n=0;n<2;n++){
    const job=await command('wo.draft',{itemId:product.id,quantity:'1',requiredBy:'2027-01-20',plannedStart:'2027-01-05',reason:'Native nesting preparation fixture'})
    await command('wo.release',{workOrderId:job.id,version:job.version})
  }
  await command('schedule.protect',{asOf:'2027-01-04T00:00:00Z',days:14,freezeUntil:'2027-01-04T00:00:00Z',manualLocks:[],reason:'Native planning protection'})
  await command('inventory.policy',{itemId:product.id,locationId:location.id,mode:'make-to-stock',effectiveOn:'2026-01-01',batchSize:'1',orderMultiple:'1',reason:'Native finished-item policy'})
  const current=await state()
  await command('forecast.import',{stateVersion:current.version,file:{name:'forecast.csv',content:'sku,week,quantity,seasonality\nB-PRODUCT,2027-01-04,2,1'},reason:'Native fixture demand plan'})
  return bootstrap
}
