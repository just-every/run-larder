import { test, expect, type Page } from '@playwright/test'
import { mkdir, readdir } from 'node:fs/promises'
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
    // MRP-001 is an API slice: its public contract must still disclose the
    // remaining feasibility gaps at both supported widths.
    expect((await page.goto(site + '/contract'))!.status()).toBe(200)
    await page.getByPlaceholder('Find a clause').fill('MRP-001')
    const mrp = page.locator('tr.clause[data-id="MRP-001"]')
    await expect(mrp).toBeVisible()
    await expect(mrp).toHaveAttribute('data-status', 'partial')
    await expect(mrp).toContainText('Dated physical/purchase projection')
    await expect(mrp).toContainText('Material-feasible WIP')
    await expect(mrp).toContainText('dated multilevel root/revision pegs with shared pools')
    await expect(mrp).toContainText('make/buy/phantom and aggregate yields')
    await expect(mrp).toContainText('nonduplicated current physical catalog safety/minimum floors')
    await expect(mrp).toContainText('future dated floor replenishment')
    await expect(mrp).toContainText('stale-safe dated draft preparation')
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
    await confirmation.getByLabel('Supplier reference', { exact: true }).fill(`synthetic-larder-${tag}-ack`)
    await confirmation.getByLabel('Confirmed delivery', { exact: true }).fill(day(3))
    await act(page, () => confirmation.getByRole('button', { name: 'Save confirmation', exact: true }).click())
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

test('Qualified alternates compare setup, tools, labor, delivery and cost before human approval at 1440/390', async ({ page }) => {
  await enter(page)
  const call = async (type: string, payload: any) => { const r=await page.request.post(origin+'/api/larder/commands',{headers:{Origin:origin},data:{commandId:crypto.randomUUID(),type,payload}}); const b=await r.json();expect(b.ok,JSON.stringify(b.error)).toBe(true);return b.result }
  const suffix=crypto.randomUUID().slice(0,6), day=(n:number)=>new Date(Date.now()+n*86400000).toISOString().slice(0,10)
  const raw=await call('item.save',{sku:`synthetic-larder-611-${suffix}`,name:'Fixture blank',kind:'buy',baseUnit:'each'})
  const made=await call('item.save',{sku:`synthetic-larder-612-${suffix}`,name:'Fixture bracket',kind:'make',baseUnit:'each'})
  const names=['Primary','Alternate A','Alternate B'].map(n=>`${n} ${suffix}`)
  const calendar=(name:string)=>({name,timeZone:'UTC',effectiveFrom:day(0),effectiveTo:day(60),shifts:[{weekdays:[0,1,2,3,4,5,6],start:0,end:1440,breaks:[]}],closedDates:[],exceptions:[],usHolidays:false,capacity:1,efficiency:100,reason:'synthetic-larder-613 calendar'})
  for (const name of names) await call('capacity.machine',calendar(name))
  const s=await (await page.request.get(origin+'/api/larder/state')).json(), old=s.laborCalendars.find((l:any)=>l.operatorIds.includes(s.actor.id))
  await call('capacity.labor',{...calendar(old?.name??`Fixture team ${suffix}`),...(old?{id:old.id,version:old.version}:{}),operatorIds:[s.actor.id],skills:[]})
  await call('bom.revise',{itemId:made.id,components:[{itemId:raw.id,quantity:'1'}],routing:[{name:'Fixture cutting',workCentre:names[0],eligibleCentres:names,requiredTools:['Fixture'],setupFamily:'wood',setupMinutes:5,runMinutes:20,instructions:'Keep the approved fixture and inspection.'}]})
  let w=await call('wo.draft',{itemId:made.id,quantity:'1',requiredBy:day(3),reason:'synthetic-larder-614 order'});w=await call('wo.release',{workOrderId:w.id,version:w.version})
  await call('maintenance.create',{workCentre:names[0],kind:'breakdown',expectedReturnAt:day(5)+'T00:00:00Z',repairOwner:'Owner',note:'synthetic-larder-615 spindle unavailable'})
  await page.goto(origin+'/app#schedule');await page.reload();await expect(page.locator('main')).toHaveAttribute('aria-busy','false')
  for(const [index,name] of names.entries()) {
    await page.getByLabel('Sequence machine',{exact:true}).selectOption({label:name})
    await page.getByLabel('Qualified machine tools',{exact:true}).fill('Fixture')
    await page.getByLabel('Initial setup family',{exact:true}).fill('steel')
    await page.getByLabel('Public planning tariff USD/hour',{exact:true}).fill('60')
    await page.getByLabel('Overtime estimate USD/hour',{exact:true}).fill('90')
    await page.getByLabel('External service quote USD',{exact:true}).fill('150')
    await page.getByLabel('External service lead days',{exact:true}).fill('3')
    await page.getByLabel('Family transitions',{exact:true}).fill(`steel,wood,${index===2?40:10},${index===2?10:5}`)
    await page.getByLabel('Sequence constraint reason',{exact:true}).fill('synthetic-larder-616 qualified transition')
    await act(page,()=>page.getByRole('button',{name:'Save sequence constraints',exact:true}).click())
  }
  await page.getByLabel('Finite plan starts (local time)',{exact:true}).fill(day(1)+'T00:00')
  await page.getByRole('button',{name:'Run finite scheduling',exact:true}).click()
  await expect(page.getByLabel('Move work order',{exact:true})).toBeVisible()
  for(const alternate of [names[1],names[2]]) {
    await page.getByLabel('Move work order',{exact:true}).selectOption(w.id)
    await page.getByLabel('Move not before date',{exact:true}).fill(day(1))
    await page.getByLabel('Move priority',{exact:true}).fill('500')
    await page.getByLabel('Qualified alternate center',{exact:true}).fill(alternate)
    await page.getByLabel('Finite move reason',{exact:true}).fill('synthetic-larder-617 review '+alternate)
    await act(page,()=>page.getByRole('button',{name:'Preview finite move',exact:true}).click())
    const review=page.getByRole('region',{name:'Finite reschedule review'})
    await expect(review).toContainText(alternate);await expect(review).toContainText('Fixture');await expect(review).toContainText('overtime');await expect(review).toContainText('outsource')
    const row=review.getByRole('row').filter({hasText:'Fixture cutting'})
    await expect(row).toContainText(alternate===names[1]?'40 labor minutes':'75 labor minutes')
    for(const width of [1440,390]) { await page.setViewportSize({width,height:1000});await shot(page,`CAP-006-${alternate===names[1]?'a':'b'}-review`);if(shots)await review.screenshot({path:join(shots,`${width}-CAP-006-${alternate===names[1]?'a':'b'}-detail.png`)}) }
  }
  await act(page,()=>page.getByRole('button',{name:'Approve finite schedule',exact:true}).click())
  await expect(page.getByText('Approved finite schedule',{exact:true})).toBeVisible()
  const current=await state(page);expect(current.workOrders.find((j:any)=>j.id===w.id).scheduleChoices[1]).toBe(names[2]);expect(current.workOrders.find((j:any)=>j.id===w.id).routing).toEqual(w.routing)
  for(const width of [1440,390]) {await page.setViewportSize({width,height:1000});await shot(page,'CAP-006-approved')}
})

test('Frozen recovery and isolated outage scenarios retain locks, show displacement and reject stale adoption at 1440/390',async({page})=>{
  await enter(page)
  const call=async(type:string,payload:any)=>{const r=await page.request.post(origin+'/api/larder/commands',{headers:{Origin:origin},data:{commandId:crypto.randomUUID(),type,payload}});const b=await r.json();expect(b.ok,JSON.stringify(b.error)).toBe(true);return b.result}
  const day=(n:number)=>new Date(Date.now()+n*86400000).toISOString().slice(0,10),suffix=crypto.randomUUID().slice(0,6)
  const raw=await call('item.save',{sku:`synthetic-larder-811-${suffix}`,name:'Recovery blank',kind:'buy',baseUnit:'each'})
  const calendar=(name:string)=>({name,timeZone:'UTC',effectiveFrom:day(0),effectiveTo:day(60),shifts:[{weekdays:[0,1,2,3,4,5,6],start:0,end:1440,breaks:[]}],closedDates:[],exceptions:[],usHolidays:false,capacity:1,efficiency:100,reason:'synthetic-larder-812 calendar'})
  const s=await(await page.request.get(origin+'/api/larder/state')).json(),old=s.laborCalendars.find((l:any)=>l.operatorIds.includes(s.actor.id))
  await call('capacity.labor',{...calendar(old?.name??`Recovery team ${suffix}`),...(old?{id:old.id,version:old.version}:{}),operatorIds:[s.actor.id],skills:old?.skills??[]})
  const machines:any[]=[],jobs:any[]=[]
  for(let i=0;i<3;i++) {
    const m=await call('capacity.machine',calendar(`Recovery ${suffix} ${i}`));machines.push(m)
    const item=await call('item.save',{sku:`synthetic-larder-813-${suffix}-${i}`,name:`Recovery assembly ${i}`,kind:'make',baseUnit:'each'})
    await call('bom.revise',{itemId:item.id,components:[{itemId:raw.id,quantity:'1'}],routing:[{name:'Recovery operation',workCentre:m.name,minutes:60}]})
    let j=await call('wo.draft',{itemId:item.id,quantity:'1',requiredBy:day(13),plannedStart:day(i===0?1:8),reason:'synthetic-larder-814 customer work'});j=await call('wo.release',{workOrderId:j.id,version:j.version});jobs.push(j)
  }
  await page.goto(origin+'/app#schedule');await page.reload();await expect(page.locator('main')).toHaveAttribute('aria-busy','false')
  await page.getByLabel('Finite plan starts (local time)',{exact:true}).fill(day(1)+'T00:00');await page.getByRole('button',{name:'Run finite scheduling',exact:true}).click()
  await page.getByLabel('Freeze schedule through (local time)',{exact:true}).fill(day(7)+'T00:00')
  await page.getByLabel('Manual operation lock',{exact:true}).selectOption(jobs[1].id+':1')
  await page.getByLabel('Protection reason',{exact:true}).fill('synthetic-larder-815 freeze this week and keep manual override')
  await act(page,()=>page.getByRole('button',{name:'Save schedule protections',exact:true}).click())
  let active=jobs[2];active=await call('wo.operation.assign',{workOrderId:active.id,version:active.version,sequence:1,operatorId:s.actor.id})
  active=await call('wo.operation.start',{workOrderId:active.id,version:active.version,sequence:1,workCentre:machines[2].name,station:'synthetic-larder-816 tablet',reason:'synthetic-larder-817 start'})
  await call('wo.operation.pause',{workOrderId:active.id,version:active.version,sequence:1,reason:'breakdown',note:'synthetic-larder-818 spindle stopped',escalationOwnerId:s.actor.id,anticipatedResumeAt:day(10)+'T12:00:00Z'})
  await page.reload();await expect(page.locator('main')).toHaveAttribute('aria-busy','false')
  const recovery=page.getByLabel('Schedule review wo.operation.pause recovery',{exact:true})
  await expect(recovery).toContainText(jobs[2].reference);await expect(recovery).toContainText('Changed customer promises: 0')
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await shot(page,'CAP-007-reflow');if(shots)await recovery.screenshot({path:join(shots,`${width}-CAP-007-detail.png`)})}
  // A reload restarts the scheduler projection; it must not duplicate the event.
  await page.reload();await expect(page.getByLabel('Schedule review wo.operation.pause recovery',{exact:true})).toHaveCount(1)
  await page.getByLabel('Finite plan starts (local time)',{exact:true}).fill(day(1)+'T00:00');await page.getByRole('button',{name:'Run finite scheduling',exact:true}).click()
  for(const [name,end] of [['Short outage',day(9)],['Long outage',day(11)]]){
    await page.getByLabel('Scenario name',{exact:true}).fill(name)
    await page.getByLabel('Scenario unavailable machine',{exact:true}).selectOption(machines[2].id)
    await page.getByLabel('Scenario outage starts (local time)',{exact:true}).fill(day(8)+'T00:00');await page.getByLabel('Scenario outage ends (local time)',{exact:true}).fill(end+'T00:00')
    await page.getByLabel('Scenario reason',{exact:true}).fill('synthetic-larder-819 compare future capacity')
    await act(page,()=>page.getByRole('button',{name:'Compare outage scenario',exact:true}).click())
    await expect(page.getByLabel('Schedule review '+name,{exact:true})).toContainText('Frozen/manual conflicts: 0')
  }
  const panel=page.locator('section.card').filter({has:page.getByRole('heading',{name:'Planning scenarios and event recovery',exact:true})})
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await shot(page,'MRP-004-scenarios');if(shots)await panel.screenshot({path:join(shots,`${width}-MRP-004-detail.png`)})}
  await page.getByLabel('Decision reason for Short outage',{exact:true}).fill('synthetic-larder-820 approved next week')
  await act(page,()=>page.getByRole('button',{name:'Adopt Short outage',exact:true}).click())
  await expect(page.getByLabel('Schedule review Short outage',{exact:true})).toContainText('adopted')
  // Material ETA change invalidates the other review; the UI displays the API refusal.
  const supplier=await call('party.save',{name:`synthetic-larder-821-${suffix}`,kind:'supplier'})
  let po=await call('po.draft',{supplierId:supplier.id,expectedDate:day(3),reason:'synthetic-larder-822 scheduled material',lines:[{itemId:raw.id,quantity:'1',unitPrice:'2'}]});po=await call('po.approve',{poId:po.id,version:po.version});await call('po.revise',{poId:po.id,version:po.version,expectedDate:day(4),note:'synthetic-larder-823 ETA changed'})
  await page.reload();await expect(page.locator('main')).toHaveAttribute('aria-busy','false')
  const before=await state(page)
  await page.getByLabel('Decision reason for Long outage',{exact:true}).fill('synthetic-larder-824 stale adoption')
  const reply=page.waitForResponse(r=>r.url().endsWith('/api/larder/commands')&&r.request().postDataJSON()?.type==='schedule.adopt');await page.getByRole('button',{name:'Adopt Long outage',exact:true}).click()
  const denied=await(await reply).json();expect(denied.error.code).toBe('STALE');await expect(page.getByRole('alert')).toContainText('Planning inputs, live people or planning window changed. Prepare a fresh scenario.')
  expect((await state(page)).scheduleBookings).toEqual(before.scheduleBookings)
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await shot(page,'MRP-004-stale')}
})
