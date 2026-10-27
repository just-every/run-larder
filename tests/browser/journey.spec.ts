import { test, expect, type Page } from '@playwright/test'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// The owner's first-release journey through the built app: move in from Odoo,
// reserve, make the shortfall, ship part of the order and hand off to the
// accountant, with the released work on the schedule; then a phone-width order from quote to shipment.
const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787'
const shots = process.env.LARDER_SCREENSHOTS
const fixtures = resolve('fixtures/odoo')

async function shot(page: Page, name: string) {
  if (!shots) return
  await mkdir(shots, { recursive: true })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: join(shots, `${page.viewportSize()!.width}-${name}.png`), fullPage: true })
}
async function act(page: Page, click: () => Promise<unknown>) {
  const reply = page.waitForResponse(r => r.url() === `${origin}/api/larder/commands` && r.request().method() === 'POST')
  await click()
  const body = await (await reply).json()
  expect(body.ok, JSON.stringify(body.error)).toBe(true)
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false')
  return body.result
}
const card = (page: Page, title: string) => page.locator('section.card').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
const state = (page: Page) => page.evaluate(async () => (await fetch('/api/larder/state')).json())

async function enter(page: Page) {
  const entry = process.env.LARDER_OPEN
  if (!entry) throw new Error('Set LARDER_OPEN privately to the rer dev owner-entry URL.')
  try { await page.goto(entry); await page.waitForURL(u => ['/app', '/setup'].includes(u.pathname)) } catch { throw new Error('The private owner entry failed.') }
  if (new URL(page.url()).pathname === '/setup') {
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Finish setup', exact: true }).click()
    await page.waitForURL(u => u.pathname === '/app')
  }
}

test('HTTP-001 MRP-001 public Lobby, health and docs stay separate from private app and exports', async ({ page, context }) => {
  const site = process.env.LARDER_SITE_URL
  if (!site) throw new Error('Set LARDER_SITE_URL to the built run site preview.')
  // This context has never signed in. Redirects are inspected before following.
  for (const path of ['/api/larder/state', '/api/larder/archive', '/api/larder/planning/materials']) {
    const denied = await context.request.get(origin + path)
    expect(denied.status()).toBe(401)
    expect((await denied.json()).error.code).toBe('AUTH')
    expect(denied.headers()['cache-control']).toContain('no-store')
  }
  const app = await context.request.get(origin + '/app', { maxRedirects: 0 })
  expect(app.status()).toBe(303)
  expect(app.headers().location).toMatch(/^\/signin\?returnTo=/)
  const health = await context.request.get(origin + '/health')
  expect(health.status()).toBe(200)
  expect((await health.json()).status).toBe('ok')
  for (const path of ['/missing-workshop-page', '/api/missing'])
    expect((await context.request.get(origin + path)).status()).toBe(404)
  expect((await context.request.get(site + '/missing-workshop-page')).status()).toBe(404)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    expect((await page.goto(origin))!.status()).toBe(200)
    await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
    await shot(page, 'HTTP-001-lobby')
    expect((await page.goto(site + '/docs'))!.status()).toBe(200)
    await page.getByRole('link', { name: 'Take an order', exact: false }).first().click()
    await expect(page.locator('article')).toBeVisible()
    await shot(page, 'HTTP-001-docs')
    // MRP-001 is an API clause with no screen of its own: its public contract row shows its status at both widths.
    expect((await page.goto(site + '/contract'))!.status()).toBe(200)
    await page.getByPlaceholder('Find a clause').fill('MRP-001')
    const mrp = page.locator('tr.clause[data-id="MRP-001"]')
    await expect(mrp).toBeVisible()
    await expect(mrp).toHaveAttribute('data-status', 'done')
    await mrp.scrollIntoViewIfNeeded()
    if (shots) await page.screenshot({ path: join(shots, `${width}-MRP-001-contract.png`), fullPage: true })

  }
  await enter(page)
  const before = await state(page)
  const name = `HTTP-001 receiving bench ${crypto.randomUUID().slice(0, 6)}`
  const payload = { commandId: crypto.randomUUID(), type: 'location.save', payload: { name } }
  const refused = await context.request.post(origin + '/api/larder/commands', { headers: { Origin: 'https://untrusted.example' }, data: payload })
  expect(refused.status()).toBe(403)
  expect((await refused.json()).error.code).toBe('ORIGIN')
  expect((await state(page)).version).toBe(before.version)
  const created = await context.request.post(origin + '/api/larder/commands', { headers: { Origin: origin }, data: payload })
  expect(created.status()).toBe(200)
  const result = await created.json()
  expect(result.ok).toBe(true)
  expect((await state(page)).locations.find((l: any) => l.id === result.result.id).name).toBe(name)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(origin + '/app#more/setup')
    // The location was created through the API after this document loaded.
    // A hash-only navigation keeps the document and its original records.
    await page.reload()
    await expect(page.getByText(name, { exact: true })).toBeVisible()
    await shot(page, 'HTTP-001-private-app')
    await page.goto(origin + '/auth/settings/identity')
    await expect(page.getByRole('heading', { name: 'Provider setup', exact: true })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'Allow provider sign-in', exact: true })).toBeDisabled()
    await shot(page, 'OPEN-001-provider-fees')

  }
  expect((await context.request.get(origin + '/api/larder/archive')).status()).toBe(200)
  const anonymous = await page.context().browser()!.newContext()
  try {
    expect((await anonymous.request.get(origin + '/api/larder/archive')).status()).toBe(401)
    expect((await anonymous.request.post(origin + '/api/larder/commands', { headers: { Origin: origin }, data: payload })).status()).toBe(401)
  } finally { await anonymous.close() }
})

test('owner runs an order from Odoo move-in to accountant handoff at 1440px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await enter(page)
  await page.goto(`${origin}/app#today`)
  await expect(page.getByRole('heading', { name: 'What needs attention' })).toBeVisible()
  // Move in from Odoo: preview with rejected rows, then commit.
  await page.goto(`${origin}/app#more/move-in`)
  const preview = card(page, 'Preview an Odoo export')
  await preview.getByLabel('Label').fill('Odoo October cutover')
  await preview.getByLabel('Odoo CSV files').setInputFiles((await readdir(fixtures)).filter(n => n.endsWith('.csv')).map(n => join(fixtures, n)))
  await preview.getByLabel('Opening count date').fill('2026-10-01')
  await preview.getByLabel('Counted by').fill('Olive')
  await preview.getByLabel('Valuation basis').selectOption('standard-cost')
  await act(page, () => preview.getByRole('button', { name: 'Preview move-in' }).click())
  await expect(page.getByRole('heading', { name: 'Rejected rows (stay out of Larder)' })).toBeVisible()
  await expect(page.getByRole('cell', { name: '__export__.product_product_107_edfe', exact: true })).toBeVisible()
  await act(page, () => page.getByRole('button', { name: /^Commit, leaving 10 rejected rows out$/ }).click())
  await expect(page.locator('.chip', { hasText: 'Committed' }).first()).toBeVisible()
  await shot(page, 'move-in')
  // The confirmed order: reserve, then draft and make the shortfall.
  await page.goto(`${origin}/app#orders`)
  await shot(page, 'orders')
  const importedOrder = (await state(page)).salesOrders.find((o: any) => o.sourceReference === 'S00031')
  expect(importedOrder, 'The confirmed Odoo source order must have moved in').toBeTruthy()
  await page.getByRole('link', { name: importedOrder.reference, exact: true }).click()
  await expect(page.getByRole('heading', { name: importedOrder.reference, exact: true })).toBeVisible()
  await act(page, () => page.getByRole('button', { name: 'Reserve stock' }).click())
  await act(page, () => page.getByRole('button', { name: 'Draft work order for 24 short' }).click())
  await expect(page).toHaveURL(/#make\/wo\//)
  await act(page, () => page.getByRole('button', { name: 'Release and reserve materials' }).click())
  await expect(page.getByText('pinned to BOM revision 1')).toBeVisible()
  // The released work is on the schedule: its routing steps as bars by work center, the job in the side panel.
  const workOrder = page.url()
  await page.goto(`${origin}/app#schedule`)
  await expect(page.getByRole('heading', { name: 'Schedule', exact: true })).toBeVisible()
  const workOrderId = new URL(workOrder).hash.split('/').at(-1)
  const releasedWork = (await state(page)).workOrders.find((w: any) => w.id === workOrderId)
  expect(releasedWork.status).toBe('released')
  const reference = releasedWork.reference, bar = page.locator('.gantt .bar').filter({ hasText: reference }).first()
  await expect(bar).toBeVisible()
  await bar.click()
  await expect(page.locator('.job-panel').getByRole('heading', { name: reference })).toBeVisible()
  await shot(page, 'schedule')
  await page.goto(workOrder)
  const issue = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Issue materials' }) })
  await issue.getByLabel('From location').selectOption({ label: 'WH/Stock' })
  await act(page, () => issue.getByRole('button', { name: 'Issue' }).click())
  const output = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Record output' }) })
  await output.getByLabel('Into location').selectOption({ label: 'WH/Stock/Dispatch shelf' })
  await output.getByLabel('Good quantity').fill('23')
  await output.getByLabel('Scrapped').fill('1')
  await output.getByLabel('Scrap reason').fill('Split while planing')
  await act(page, () => output.getByRole('button', { name: 'Record output' }).click())
  await shot(page, 'work-order')
  await act(page, () => page.getByRole('button', { name: 'Close work order' }).click())
  await expect(page.getByText(/Materials used/)).toBeVisible()
  // Back on the order: reserve the new stock, then pick, pack and ship part of it.
  const order = (await state(page)).salesOrders.find((o: any) => o.id === importedOrder.id)
  await page.goto(`${origin}/app#orders/${order.id}`)
  await act(page, () => page.getByRole('button', { name: 'Reserve stock' }).click())
  const lines = card(page, 'Order lines')
  await expect(lines.getByRole('row').filter({ hasText: 'Large' }).getByText('27', { exact: true })).toBeVisible()
  const pick = card(page, 'Pick, pack and ship')
  await act(page, () => pick.getByRole('button', { name: 'Pick', exact: true }).click())
  await act(page, () => pick.getByRole('button', { name: 'Mark packed' }).click())
  await pick.getByLabel('Carrier').fill('StarTrack')
  await act(page, () => pick.getByRole('button', { name: 'Ship', exact: true }).click())
  await expect(page.locator('.chip', { hasText: 'Part shipped' })).toBeVisible()
  const large = (await state(page)).salesOrders.find((o: any) => o.id === importedOrder.id).lines[0]
  expect([large.shipped, large.quantity]).toEqual(['27', '28'])
  await shot(page, 'order')
  await page.goto(`${origin}/app#stock`)
  await expect(page.getByRole('heading', { name: 'Stock on hand' })).toBeVisible()
  await shot(page, 'stock')
  await page.goto(`${origin}/app#make/plan`)
  await shot(page, 'make')
  // Hand the movements to the accountant.
  await page.goto(`${origin}/app#handoff`)
  await act(page, () => page.getByRole('button', { name: 'Prepare handoff batch' }).click())
  await expect(page.getByRole('link', { name: 'Download CSV' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Customer shipment (invoice preparation)' }).first()).toBeVisible()
  await shot(page, 'handoff')
  for (const [hash, name] of [['today', 'today'], ['more/setup', 'setup'], ['more/people', 'people'], ['more/archive', 'archive'], ['more/activity', 'activity']]) {
    await page.goto(`${origin}/app#${hash}`)
    await expect(page.locator('main h1')).toBeVisible()
    await shot(page, name)
  }
})

test('owner quotes, confirms and ships an order at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await enter(page)
  await page.goto(`${origin}/app#orders`)
  const quote = card(page, 'New quote')
  await quote.getByLabel('Customer', { exact: true }).selectOption({ label: 'Sagebrush Cafe' })
  await quote.getByLabel('Promise date').fill('2026-11-05')
  await quote.getByLabel('Item 1').selectOption({ label: 'Walnut blank · WAL-BLANK' })
  await quote.getByLabel('Quantity', { exact: true }).fill('2')
  await quote.getByLabel('Unit price').fill('15')
  await act(page, () => quote.getByRole('button', { name: 'Save quote' }).click())
  await expect(page).toHaveURL(/#orders\//)
  await act(page, () => page.getByRole('button', { name: 'Confirm order and reserve stock' }).click())
  const pick = card(page, 'Pick, pack and ship')
  await act(page, () => pick.getByRole('button', { name: 'Pick', exact: true }).click())
  await act(page, () => pick.getByRole('button', { name: 'Mark packed' }).click())
  await pick.getByLabel('Carrier').fill('UPS Ground')
  await act(page, () => pick.getByRole('button', { name: 'Ship', exact: true }).click())
  await expect(page.locator('.chip', { hasText: 'Shipped' }).first()).toBeVisible()
  await shot(page, 'order')
  for (const [hash, name] of [['today', 'today'], ['orders', 'orders'], ['schedule', 'schedule'], ['stock', 'stock'], ['make/plan', 'make'], ['make/wo', 'work-orders'], ['handoff', 'handoff'], ['more/move-in', 'move-in'], ['more', 'more']]) {
    await page.goto(`${origin}/app#${hash}`)
    await expect(page.locator('main h1')).toBeVisible()
    await shot(page, name)
  }
})

test('BUY-001 buyers maintain two suppliers, select feasible scheduled terms and recover approval history at 1440/390', async ({ page }) => {
  await enter(page)
  const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
  async function command(type: string, payload: object) {
    const res = await page.request.post(origin + '/api/larder/commands', { headers: { Origin: origin }, data: { commandId: crypto.randomUUID(), type, payload } })
    const body = await res.json(); expect(body.ok, JSON.stringify(body.error)).toBe(true); return body.result
  }
  async function purchases() {
    await page.goto(origin + '/app'); await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false')
    await page.goto(origin + '/app#make/po'); await expect(page.getByRole('heading', { name: 'Compare supplier quotes', exact: true })).toBeVisible()
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const tag = crypto.randomUUID().slice(0, 6)
    const item = await command('item.save', { sku: `synthetic-larder-${tag}`, name: `Contract alloy ${tag}`, kind: 'buy', baseUnit: 'each' })
    const vendors = []
    for (const speed of ['Fast','Slow']) vendors.push(await command('party.save', { name: `${speed} vendor ${tag}`, kind: 'supplier' }))
    await purchases()
    const termsCard = card(page, 'Supplier terms')
    for (let i = 0; i < 2; i++) {
      await termsCard.locator('summary').filter({ hasText: /^Add supplier terms$/ }).click()
      const form = termsCard.locator('form').filter({ has: page.getByRole('heading', { name: 'Add supplier terms', exact: true }) })
      await form.getByLabel('Terms supplier', { exact: true }).selectOption(vendors[i].id)
      await form.getByLabel('Terms item', { exact: true }).selectOption(item.id)
      for (const [label,value] of [['Supplier item code',`synthetic-larder-${tag}-${i}`],['Pack quantity',i ? '10' : '6'],['Minimum order quantity',i ? '20' : '12'],['Lead working days',i ? '10' : '1'],['Price per base unit',i ? '0.5' : '2'],['Price breaks',i ? '' : '12=1.6'],['Currency', i ? 'USD' : 'CAD'],['USD per currency unit',i ? '1' : '0.75'],['Rate source', 'Buyer recorded quotation'],['Payment terms','Net 30'],['Freight terms','Delivered duty paid'],['Working weekdays','0,1,2,3,4,5,6'],['Closed dates',day(1)]]) await form.getByLabel(label, { exact: true }).fill(value)
      await shot(page, `BUY-001-terms-${i}`)
      await act(page, () => form.getByRole('button', { name: 'Save supplier terms', exact: true }).click())
      // Collapse the creation form before using the same disclosure again.
      await termsCard.locator('summary').filter({ hasText: /^Add supplier terms$/ }).click()
    }
    const compare = card(page, 'Compare supplier quotes')
    await compare.getByLabel('Quote item', { exact: true }).selectOption(item.id)
    await compare.getByLabel('Required base quantity', { exact: true }).fill('7')
    await compare.getByLabel('Material required by', { exact: true }).fill(day(5))
    await compare.getByRole('button', { name: 'Compare quotes', exact: true }).click()
    const fastRow = compare.getByRole('row').filter({ hasText: vendors[0].name }), slowRow = compare.getByRole('row').filter({ hasText: vendors[1].name })
    await expect(fastRow).toContainText('Feasible'); await expect(fastRow).toContainText('$14.40'); await expect(fastRow).toContainText('12')
    await expect(slowRow).toContainText('Too late'); await expect(slowRow.getByRole('button')).toHaveCount(0)
    await compare.getByLabel('Purchase reason', { exact: true }).fill('Two scheduled workshop deliveries')
    await compare.getByLabel('Delivery schedule', { exact: true }).fill(`${day(2)}=6, ${day(4)}=6`)
    await shot(page, 'BUY-001-comparison')
    const draft = await act(page, () => compare.getByRole('button', { name: `Select ${vendors[0].name}`, exact: true }).click())
    await expect(page.getByRole('button', { name: 'Approve purchase order', exact: true })).toBeVisible()
    expect(draft.lines.map((l: any) => l.expectedDate)).toEqual([day(2),day(4)])
    await act(page, () => page.getByRole('button', { name: 'Approve purchase order', exact: true }).click())
    const frozen = (await state(page)).approvals.find((a: any) => a.subjectId === draft.id).terms
    const delivery = card(page, 'Supplier and delivery')
    const confirmation = delivery.locator('form').filter({ has: page.getByRole('heading', { name: 'Record supplier confirmation', exact: true }) })
    await confirmation.getByLabel('Received by', { exact: true }).selectOption('phone')
    await confirmation.getByLabel('Supplier reference', { exact: true }).fill(`synthetic-larder-${tag}-ack`)
    await confirmation.getByLabel('Confirmed delivery', { exact: true }).fill(day(3))
    await act(page, () => confirmation.getByRole('button', { name: 'Save confirmation', exact: true }).click())
    await expect(page.getByText(/supplier confirmed .* by phone, ref/).first()).toBeVisible()
    const revise = delivery.locator('form').filter({ has: page.getByRole('heading', { name: 'Revise expected delivery', exact: true }) })
    await revise.getByLabel('Delivery to revise', { exact: true }).selectOption(draft.lines[1].id)
    await revise.getByLabel('New expected date', { exact: true }).fill(day(8))
    await revise.getByLabel('Why', { exact: true }).fill('Supplier revises the second delivery')
    await shot(page, 'BUY-001-revision')
    await act(page, () => revise.getByRole('button', { name: 'Revise date', exact: true }).click())
    await page.reload(); await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false')
    await page.getByRole('button', { name: 'Original approved terms and delivery schedule', exact: true }).click()
    await expect(page.locator('main')).toContainText('Net 30')
    await expect(page.locator('.details-body').getByText('CAD 1.6', { exact: true }).first()).toBeVisible()
    await page.getByRole('button', { name: 'Selected supplier quote terms', exact: true }).click()
    for (const detail of await page.locator('.details-body').all()) expect(await detail.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Historical supplier terms must fit the phone display.').toBe(true)
    await shot(page, 'BUY-001-original-approval')
    const s = await state(page), po = s.purchaseOrders.find((p: any) => p.id === draft.id)
    expect(po.lines.map((l: any) => l.expectedDate)).toEqual([day(3),day(8)])
    expect(s.approvals.find((a: any) => a.subjectId === draft.id).terms).toEqual(frozen)
    // Change live terms using the native form and re-read the old approved PO.
    await purchases()
    const vendor = page.getByRole('article', { name: `Terms for ${vendors[0].name}`, exact: true })
    await vendor.getByText(`Revise ${vendors[0].name} terms`, { exact: true }).click()
    await vendor.getByLabel('Payment terms', { exact: true }).fill('Prepaid')
    await vendor.getByLabel('Price per base unit', { exact: true }).fill('3')
    await vendor.getByLabel('Price breaks', { exact: true }).fill('')
    await shot(page, 'BUY-001-terms-revision')
    await act(page, () => vendor.getByRole('button', { name: 'Save supplier terms', exact: true }).click())
    await vendor.getByRole('button', { name: 'Terms and revision history', exact: true }).click()
    await expect(vendor).toContainText('Prepaid'); await expect(vendor).toContainText('Net 30')
    await shot(page, 'BUY-001-term-history')
    await page.goto(origin + `/app#make/po/${draft.id}`)
    await page.getByRole('button', { name: 'Original approved terms and delivery schedule', exact: true }).click()
    await expect(page.locator('main')).toContainText('Net 30')
    await expect(page.locator('main')).not.toContainText('Prepaid')
    await shot(page, 'BUY-001-recovered-approval')
    const archive = await (await page.request.get(origin + '/api/larder/archive')).json()
    expect(archive.records.purchaseOrders.find((p: any) => p.id === draft.id).lines).toEqual(po.lines)
    expect(archive.records.approvals.find((a: any) => a.subjectId === draft.id).terms).toEqual(frozen)
    const location = await command('location.save', { name: `Supplier receipt rack ${tag}` })
    await command('receipt.create', { poId: draft.id, supplierReference: `synthetic-larder-${tag}-delivery`, lines: [{ lineId: draft.lines[0].id, quantity: '1', locationId: location.id, inspection: 'accept' }] })
    await purchases()
    const performance = card(page, 'Supplier delivery performance').locator('article').filter({ has: page.getByRole('heading', { name: vendors[0].name, exact: true }) })
    await expect(performance).toContainText('1 measured deliveries')
    await expect(performance).toContainText('On time')
    await shot(page, 'BUY-001-performance')
  }
})

test('COST reports retain shipment margins, job source drills and missing performance evidence at 1440/390', async ({page,browser})=>{
  await enter(page)
  const suffix=crypto.randomUUID().slice(0,8),today=new Date().toISOString().slice(0,10),ownerId=(await state(page)).actor.id
  const command=async(type:string,payload:any)=>{const res=await page.request.post(origin+'/api/larder/commands',{headers:{Origin:origin},data:{commandId:crypto.randomUUID(),type,payload}});const b=await res.json();expect(b.ok,JSON.stringify(b.error)).toBe(true);return b.result}
  await page.goto(origin+'/app#handoff/variances');await page.reload()
  await expect(page.getByRole('heading',{name:'Job cost variances',exact:true})).toBeVisible()
  const policy=card(page,'Versioned allocation policy')
  for(const[label,value]of [['standard Labor Rate','0'],['machine Rate','0'],['overhead Rate','0'],['overtime After Hours','8'],['overtime Multiplier','1.5'],['Policy reason','synthetic-larder-471 explicit rule']])await policy.getByLabel(label,{exact:true}).fill(value)
  await act(page,()=>policy.getByRole('button',{name:'Prepare costing policy',exact:true}).click())
  await policy.getByLabel('Policy approval reason',{exact:true}).last().fill('synthetic-larder-472 reviewed independently as owner')
  await act(page,()=>policy.getByRole('button',{name:'Approve costing policy',exact:true}).last().click())
  const raw=await command('item.save',{sku:`synthetic-larder-473-${suffix}`,name:`Cost blank ${suffix}`,kind:'buy',baseUnit:'each',standardCost:'12'})
  const product=await command('item.save',{sku:`synthetic-larder-474-${suffix}`,name:`Cost product ${suffix}`,kind:'make',baseUnit:'each',standardCost:'12'})
  const location=await command('location.save',{name:`Cost shelf ${suffix}`}),customer=await command('party.save',{name:`Cost buyer ${suffix}`,kind:'customer'})
  await command('opening.record',{locationId:location.id,countedOn:today,countedBy:'synthetic-larder-475',valuationBasis:'supplier-invoice',evidence:{name:'count.txt',contentType:'text/plain',base64:Buffer.from('synthetic-larder-476 count and valuation').toString('base64')},lines:[{itemId:raw.id,quantity:'10',unitCost:'12'}]})
  await command('bom.revise',{itemId:product.id,components:[{itemId:raw.id,quantity:'1'}]})
  const order=await command('so.quote',{customerId:customer.id,channel:`wholesale-${suffix}`,promiseDate:today,lines:[{itemId:product.id,quantity:'4',unitPrice:'50'}]})
  const jobs=[]
  for(const[quantity,issued,good,scrap]of [['3','4','2','1'],['2','2','2','0']]){
    let w=await command('wo.draft',{itemId:product.id,quantity,requiredBy:'2026-01-01',reason:'synthetic-larder-477 source costing work'})
    w=await command('wo.release',{workOrderId:w.id,version:w.version});w=await command('wo.issue',{workOrderId:w.id,lines:[{itemId:raw.id,locationId:location.id,quantity:issued}]});w=await command('wo.output',{workOrderId:w.id,version:w.version,locationId:location.id,quantity:good,scrap,scrapReason:'synthetic-larder-478 reject',lot:`synthetic-larder-479-${suffix}-${jobs.length}`});if(jobs.length===0)w=await command('wo.close',{workOrderId:w.id,version:w.version});jobs.push(w)
    await command('costing.link',{workOrderId:w.id,orderId:order.id,lineId:order.lines[0].id,quantity:'2',reason:'synthetic-larder-480 source job allocation'})
  }
  // The actual correcting valuations are reviewed through their built screen.
  for(const w of jobs){
    await page.goto(origin+'/app#handoff/variances');await page.reload()
    if(w.status==='released'){await page.getByLabel('Job to close and value',{exact:true}).selectOption(w.id);await page.getByLabel('Close and valuation reason',{exact:true}).fill('synthetic-larder-536 exact actual cost at closing');const value=await act(page,()=>page.getByRole('button',{name:'Close and approve actual valuation',exact:true}).click());expect(value.closedWithValuation).toBe(true);continue}
    await page.getByLabel('Valuation job',{exact:true}).selectOption(w.id);await page.getByLabel('Valuation reason',{exact:true}).fill('synthetic-larder-481 review all source costs')
    await act(page,()=>page.getByRole('button',{name:'Prepare valuation review',exact:true}).click())
    await page.getByLabel('Valuation approval reason',{exact:true}).last().fill('synthetic-larder-482 approve exact value correction')
    await act(page,()=>page.getByRole('button',{name:'Approve valuation review',exact:true}).last().click())
  }
  await command('so.confirm',{orderId:order.id,version:order.version})
  let shipment=await command('shipment.pick',{orderId:order.id,lines:[{lineId:order.lines[0].id,quantity:'2',locationId:location.id,lotId:jobs[0].outputs[0].lotId}]});shipment=await command('shipment.pack',{shipmentId:shipment.id,version:shipment.version,packages:1});await command('shipment.ship',{shipmentId:shipment.id,version:shipment.version,carrier:'synthetic-larder-483'})
  await command('return.receive',{orderId:order.id,lineId:order.lines[0].id,quantity:'1',locationId:location.id,disposition:'quarantine',reason:'synthetic-larder-484 returned unit'})
  await page.goto(origin+'/app#handoff/margins');await page.reload()
  const charge=card(page,'Record a line discount, fee or freight')
  await charge.getByLabel('Charge order',{exact:true}).selectOption(order.id);await charge.getByLabel('Charge sales line',{exact:true}).selectOption(order.lines[0].id);await charge.getByLabel('Charge kind',{exact:true}).selectOption('discount');await charge.getByLabel('Charge USD',{exact:true}).fill('4');await charge.getByLabel('Refund proportionally on a return').check();await charge.getByLabel('Charge evidence',{exact:true}).setInputFiles({name:'discount.txt',mimeType:'text/plain',buffer:Buffer.from('synthetic-larder-485 agreed discount')});await charge.getByLabel('Charge reason',{exact:true}).fill('synthetic-larder-486 exact commercial charge')
  await act(page,()=>charge.getByRole('button',{name:'Record commercial charge',exact:true}).click())
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000})
    for(const report of ['margins','variances','performance']){
      await page.goto(origin+`/app#handoff/${report}`)
      await expect(page.getByRole('heading',{name:report==='margins'?'Order margins':report==='variances'?'Job cost variances':'Production performance',exact:true})).toBeVisible()
      if(report==='performance'){
        await page.getByLabel('Site location',{exact:true}).selectOption(location.id);await page.getByLabel('Report owner',{exact:true}).selectOption(ownerId);await page.getByLabel('Product',{exact:true}).selectOption(product.id);await page.getByLabel('From date',{exact:true}).fill(today);await page.getByLabel('To date',{exact:true}).fill(today)
      }else await page.getByLabel('Sales order',{exact:true}).selectOption(order.id)
      const ready=page.waitForResponse(r=>r.url().includes(`/api/larder/costing/${report}?`)&&r.request().method()==='GET')
      await page.getByRole('button',{name:'Apply report filters',exact:true}).click();await ready
      if(report==='margins'){
        const lines=card(page,'Sales lines');await expect(lines).toContainText(order.reference);await expect(lines).toContainText('$49.00');await expect(lines).toContainText('$16.00');await expect(lines).toContainText('$33.00');await expect(lines).toContainText('76%')
        await lines.getByRole('button',{name:`Sources ${order.reference}`,exact:true}).click();await expect(lines).toContainText('return')
      }else if(report==='variances'){
        await expect(card(page,'Job costs and variances')).toContainText(jobs[0].reference)
        await page.getByRole('button',{name:`Cost sources ${jobs[0].reference}`,exact:true}).click();await expect(card(page,'Job costs and variances')).toContainText('Usage variance')
      }else{
        await expect(card(page,'Performance metrics')).toContainText('Unknown');await expect(card(page,'Performance metrics')).toContainText('No recorded operation clocks')
        const metrics=card(page,'Performance metrics')
        for(const [name,numerator,denominator,result]of [['Yield','4','5','80%'],['On-time job delivery','0','2','0%']]){
          const row=metrics.getByRole('row').filter({has:metrics.getByRole('button',{name:'Metric sources '+name,exact:true})}),cells=row.getByRole('cell')
          expect(await cells.nth(1).evaluate(el=>el.childNodes[0].textContent)).toBe(numerator);expect(await cells.nth(2).evaluate(el=>el.childNodes[0].textContent)).toBe(denominator);await expect(cells.nth(3)).toHaveText(result)
        }
        const sourceButtons=metrics.getByRole('button',{name:/^Metric sources /});expect(await sourceButtons.count()).toBe(11);for(const button of await sourceButtons.all()){await button.click();await expect(button).toHaveAttribute('aria-expanded','true');await button.click()}const metric=metrics.getByRole('button',{name:'Metric sources Yield',exact:true});await metric.click();await expect(metrics).toContainText('Output')
      }
      if(width===390) {
        const readable=page.locator('.cost-reports .details-body').first()
        await expect(readable).toBeVisible()
        expect(await readable.evaluate(el=>el.clientWidth)).toBeGreaterThan(240)
        expect(await readable.locator('dd').first().evaluate(el=>el.clientWidth)).toBeGreaterThan(200)
      }
      const account=page.getByRole('button',{name:'Account menu'}).or(page.locator('summary[aria-label="Account menu"]'))
      await page.mouse.move(0,0);await account.evaluate(el=>(el as HTMLElement).blur());await expect(account.locator('[role=tooltip]')).toBeHidden();await account.hover();await expect(account.locator('[role=tooltip]')).toHaveCSS('transition-delay','0.3s, 0.3s');await expect(page.getByRole('tooltip',{name:'Account menu'})).toBeVisible()
      await page.mouse.move(0,0);await page.keyboard.press('Tab');await account.focus();await expect(page.getByRole('tooltip',{name:'Account menu'})).toBeVisible({timeout:100})
      expect(await page.locator('main').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
      await shot(page,`COST-${report}`)
      const download=page.waitForEvent('download');await page.getByRole('link',{name:'Download this report CSV',exact:true}).click();expect((await download).suggestedFilename()).toBe('larder-costs.csv')
    }
  }
  await expect(card(page,'Performance metrics')).toContainText('Unknown')
  await page.getByLabel('I consent to saving this filtered report in the app').check();await page.getByLabel('Schedule reason',{exact:true}).fill('synthetic-larder-487 daily in-app snapshot')
  const scheduled=await act(page,()=>page.getByRole('button',{name:'Schedule this report',exact:true}).click());expect(scheduled.filters.itemId).toBe(product.id);expect(scheduled.filters.from).toBe(today);expect(scheduled.filters.site).toBe(location.id);expect(scheduled.filters.ownerId).toBe(ownerId)
  await page.setViewportSize({width:1440,height:1000});await expect(card(page,'Save a daily in-app report')).toContainText('Snapshots stop at sign-out, session expiry, revocation or owner change.');await expect(card(page,'Scheduled in-app reports')).toContainText('Consenting owner:')
  const opened=await act(page,()=>card(page,'Scheduled in-app reports').getByRole('button',{name:'Open due report',exact:true}).last().click())
  expect(opened.snapshots[0].generation).toBe('manual');expect(opened.snapshots[0].by).toBe((await state(page)).actor.id);await expect(card(page,'Scheduled in-app reports')).toContainText(`Owner: ${opened.snapshots[0].ownerName}`)
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await shot(page,'COST-scheduled-report')}
  const email=`synthetic-larder-1113-${suffix}@example.test`
  expect((await page.request.post(origin+'/auth/invite',{headers:{Origin:origin},data:{email,displayName:'Restricted report manager',role:'member'}})).status()).toBe(202)
  const context=await browser.newContext({storageState:await page.context().storageState()}),member=await context.newPage()
  try{
    await member.goto(origin+'/auth/dev/enter?as='+encodeURIComponent(email));await member.waitForURL(u=>u.pathname==='/app');await expect(member.locator('main')).toHaveAttribute('aria-busy','false')
    const memberId=(await(await member.request.get(origin+'/auth/session')).json()).operator.id
    await command('role.set',{operatorId:memberId,role:'manager'});await command('member.scope',{operatorId:memberId,costsRestricted:true,locations:null})
    for(const width of [1440,390]){
      await member.setViewportSize({width,height:1000});await member.goto(origin+'/app');await member.reload();await expect(member.locator('main')).toHaveAttribute('aria-busy','false');await member.getByRole('link',{name:'Handoff',exact:true}).click();await member.getByRole('link',{name:'Production performance',exact:true}).click()
      await expect(member.getByRole('status',{name:''}).filter({hasText:'Costs and wages restricted'})).toBeVisible()
      await expect(card(member,'Performance metrics')).toContainText('Yield')
      const scoped=await state(member);expect(scoped.items.find((r:any)=>r.id===product.id).standardCost).toBe('restricted')
      expect(scoped.reportSchedules.find((r:any)=>r.id===scheduled.id).snapshots[0].report).toEqual(opened.snapshots[0].report)
      await expect(card(member,'Scheduled in-app reports').getByRole('button',{name:'Open due report',exact:true})).toHaveCount(0)
      expect(await member.locator('main').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await shot(member,'COST-restricted-performance')
    }
  }finally{await context.close()}
  await page.goto(origin+'/app#handoff');await expect(page.getByRole('heading',{name:'Accountant handoff',exact:true})).toBeVisible()
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});for(const name of ['Order margins','Job cost variances','Production performance'])await expect(page.getByRole('link',{name,exact:true})).toBeVisible();expect(await page.locator('main').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await shot(page,'COST-handoff')}
})


test('Owner reviews exact variance sources and destination, then inspects the live cited explanation and approved improvement at both widths', async ({ page }) => {
  const archivePath = process.env.LARDER_LIVE_VARIANCE_ARCHIVE
  test.skip(!archivePath, 'Explicit generated-job live-model archive is required; no model fixture substitutes for this journey.')
  await enter(page)
  const archive = JSON.parse(await readFile(archivePath!, 'utf8'))
  const restored = await page.request.post(origin + '/api/larder/archive/restore', { headers: { origin }, data: archive })
  expect(restored.ok(), await restored.text()).toBe(true)
  await page.goto(origin + '/app#handoff/variances'); await page.reload()
  const s = await state(page), completed = s.varianceAnalyses.find((a: any) => a.status === 'complete'), order = s.salesOrders.find((o: any) => o.id === completed.orderId)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const account = page.locator('.account > summary')
    await page.keyboard.press('Tab'); await account.focus(); await expect(page.getByRole('tooltip', { name: 'Account menu', exact: true })).toBeVisible()
    await page.getByRole('heading', { name: 'Job cost variances', exact: true }).click()
    await account.hover(); await expect(page.getByRole('tooltip', { name: 'Account menu', exact: true })).toBeVisible()
    const explanation = page.locator(`[data-analysis-id="${completed.id}"]`)
    await explanation.locator('summary').first().click()
    await expect(explanation).toContainText(`${completed.evidence.sourceCount} distinct cited source records`)
    if (width === 1440 && !completed.followups.length) {
      const approvedChange = s.engineeringChanges.find((c: any) => c.status === 'approved')
      const nextJob = s.workOrders.find((w: any) => w.itemId === approvedChange.itemId && w.bomRevision === approvedChange.approvedBom.revision && w.status === 'closed')
      await explanation.getByText('Compare an approved improvement', { exact: true }).click()
      await explanation.getByLabel('Proposed experiment', { exact: true }).selectOption('0')
      await explanation.getByLabel('Approved engineering change', { exact: true }).selectOption(approvedChange.id)
      await explanation.getByLabel('Completed next job', { exact: true }).selectOption(nextJob.id)
      await explanation.getByLabel('Improvement comparison reason', { exact: true }).fill('synthetic-larder-814 approved controlled routing experiment')
      await act(page, () => explanation.getByRole('button', { name: 'Record next-job comparison', exact: true }).click())
    }
    await expect(explanation).toContainText('Historical variances unchanged')
    const improvement = explanation.getByRole('button', { name: 'Improvement measures', exact: true }).last()
    if (await improvement.getAttribute('aria-expanded') !== 'true') await improvement.click()
    await expect(improvement.locator('..')).toContainText('$190.00')
    await expect(improvement.locator('..')).toContainText('$50.00')
    await expect(explanation).toContainText('Hypothesis 1')
    const factSummary = explanation.getByText('Review exact numeric records', { exact: true })
    if (!await factSummary.evaluate(el => (el.parentElement as HTMLDetailsElement).open)) await factSummary.click()
    const link = explanation.locator('a[href*="/sources/"]').first(), response = await page.request.get(new URL((await link.getAttribute('href'))!, origin).href)
    expect(response.status()).toBe(200); expect((await response.json()).key).toBe(completed.evidence.facts[0].sourceKeys[0])
    const measures = explanation.getByRole('button', { name: 'Measures F1', exact: true })
    if (await measures.getAttribute('aria-expanded') !== 'true') await measures.click()
    await shot(page, 'AGENT-003-live-explanation')
    await explanation.getByRole('heading', { name: 'Hypothesis 1', exact: true }).scrollIntoViewIfNeeded()
    if (shots) await page.screenshot({ path: join(shots, `${width}-AGENT-003-result-viewport.png`) })
    expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await explanation.locator('summary').first().click()
    const section = card(page, 'Explain an order variance')
    await section.getByText('Prepare a cited explanation', { exact: true }).click()
    await page.getByLabel('Explanation order', { exact: true }).selectOption(order.id)
    await page.getByLabel('Explanation reason', { exact: true }).fill('synthetic-larder-814 review at each width')
    const prepared = await act(page, () => page.getByRole('button', { name: 'Prepare evidence review', exact: true }).click())
    const review = page.locator(`[data-analysis-id="${prepared.id}"]`)
    await review.locator('summary').first().click()
    await review.getByText('Review exact numeric records', { exact: true }).click()
    await expect(review).toContainText('OpenRouter to Anthropic only')
    await expect(review).toContainText('Causal explanations still need a controlled experiment.')
    await shot(page, 'AGENT-003-exact-consent')
    await review.getByRole('checkbox').scrollIntoViewIfNeeded()
    if (shots) await page.screenshot({ path: join(shots, `${width}-AGENT-003-consent-viewport.png`) })
    await review.getByRole('checkbox').check()
    await review.getByLabel('Model consent reason', { exact: true }).fill('synthetic-larder-814 exact numeric records approved')
    const approved = await act(page, () => review.getByRole('button', { name: 'Approve exact model destination', exact: true }).click())
    expect(approved.status).toBe('approved')
    await review.getByRole('button', { name: 'Run approved explanation once', exact: true }).scrollIntoViewIfNeeded()
    if (shots) await page.screenshot({ path: join(shots, `${width}-AGENT-003-approved-viewport.png`) })
    await review.getByLabel('Revoke explanation reason', { exact: true }).fill('synthetic-larder-814 do not send from browser proof')
    await act(page, () => review.getByRole('button', { name: 'Revoke unsent explanation', exact: true }).click())
    await expect(review).toContainText('Revoked')
    await shot(page, 'AGENT-003-revoked')
    await review.locator('summary').first().evaluate(el => el.scrollIntoView({ block: 'start' }))
    if (shots) await page.screenshot({ path: join(shots, `${width}-AGENT-003-revoked-viewport.png`) })
    await review.locator('summary').first().click()
    await section.getByText('Prepare a cited explanation', { exact: true }).click()
  }
})
