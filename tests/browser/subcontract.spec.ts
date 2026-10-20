import { test, expect, type Page, type Locator } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787', today = new Date().toISOString().slice(0, 10)
const file = { name: 'finisher-slip.txt', mimeType: 'text/plain', buffer: Buffer.from('Coastal Finishing: dispatch, receipt and service bill evidence') }
async function command(page: Page, type: string, payload: object) { const r = await page.request.post(origin + '/api/larder/commands', { headers: { Origin: origin }, data: { commandId: crypto.randomUUID(), type, payload } }); const b = await r.json(); expect(b.ok, JSON.stringify(b.error)).toBe(true); return b.result }
const card = (page: Page, title: string) => page.locator('section.card').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
const form = (c: Locator, title: string) => c.locator('form').filter({ has: c.getByRole('heading', { name: title, exact: true }) })
async function settled(page: Page) { await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false'); await expect(page.getByRole('alert')).toHaveCount(0) }
async function shot(page: Page, name: string) { if (!process.env.LARDER_SCREENSHOTS) return; await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${page.viewportSize()!.width}-BUY-004-${name}.png`), fullPage: true }) }
for (const width of [1440, 390]) test(`BUY-004 outside finishing, partial receipt/scrap, custody return and bill at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 })
  if (!process.env.LARDER_OPEN) throw new Error('Private local entry required')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/app', '/setup'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup' }).click(); await page.waitForURL('**/app') }
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false')
  const shop = await command(page, 'location.save', { name: `Finishing workshop ${width}` }), vendor = await command(page, 'location.save', { name: `Coastal custody ${width}` })
  const supplier = await command(page, 'party.save', { name: `Coastal Finishing ${width}`, kind: 'supplier' })
  const part = await command(page, 'item.save', { sku: `PLATE-${width}`, name: `Steel plate ${width}`, kind: 'buy', baseUnit: 'each' }), output = await command(page, 'item.save', { sku: `COATED-${width}`, name: `Coated plate ${width}`, kind: 'make', baseUnit: 'each' })
  let po = await command(page, 'po.draft', { supplierId: supplier.id, expectedDate: today, reason: 'Outside finishing inputs', lines: [{ itemId: part.id, quantity: '8', unitPrice: '10' }] }); po = await command(page, 'po.approve', { poId: po.id, version: po.version })
  for (const lot of [`HEAT-A-${width}`, `HEAT-B-${width}`]) await command(page, 'receipt.create', { poId: po.id, supplierReference: lot, lines: [{ lineId: po.lines[0].id, locationId: shop.id, lot, quantity: '4', inspection: 'accept' }] })
  await page.reload(); await settled(page); await page.evaluate(() => { location.hash = 'make/subcontract' })
  const draft = card(page, 'New subcontract service order')
  await draft.getByLabel('Subcontract supplier').selectOption(supplier.id); await draft.getByLabel('Vendor custody location').selectOption(vendor.id); await draft.getByLabel('Finished item', { exact: true }).selectOption(output.id)
  await draft.getByLabel('Ordered output quantity').fill('7'); await draft.getByLabel('Service rate').fill('2'); await draft.getByLabel('Expected date').fill(today); await draft.getByLabel('Outside operation').fill(`Coat plates ${width}`)
  await draft.getByRole('button', { name: 'Save service draft' }).click(); await settled(page)
  const state = await (await page.request.get(origin + '/api/larder/state')).json(), o = state.subcontractOrders.find((o: any) => o.itemId === output.id), c = card(page, `${o.reference} · Coat plates ${width}`)
  await shot(page, 'draft'); await c.getByRole('button', { name: 'Approve service order' }).click(); await settled(page)
  const lots = state.lots.filter((l: any) => l.itemId === part.id)
  for (const l of lots) { const dispatch = form(c, 'Dispatch material'); await dispatch.getByLabel('Material lot', { exact: true }).selectOption(l.id); await dispatch.getByLabel('From location').selectOption(shop.id); await dispatch.getByLabel('Dispatch quantity').fill('4'); await dispatch.getByRole('button', { name: 'Record dispatch' }).click(); await settled(page) }
  await expect(c).toContainText('HEAT-A'); await expect(c).toContainText('HEAT-B'); await shot(page, 'dispatched')
  const receive = async (good: string, scrap: string, a: string, b: string, name: string) => { const f = form(c, 'Receive finished work'); await f.getByLabel('Good quantity', { exact: true }).fill(good); await f.getByLabel('Scrap quantity', { exact: true }).fill(scrap); await f.getByLabel('Finished lot', { exact: true }).fill(name); await f.getByLabel('Into location').selectOption(shop.id); await f.getByLabel('Receipt and yield note').fill('Packing slip: coated plates, damaged rejects segregated'); await f.locator('input[type=file]').setInputFiles(file); if (a) await f.getByLabel(`Consumed HEAT-A-${width}`).fill(a); if (b) await f.getByLabel(`Consumed HEAT-B-${width}`).fill(b); await f.getByRole('button', { name: 'Record subcontract receipt' }).click(); await settled(page) }
  await receive('2', '1', '3', '', `COATED-A-${width}`)
  await expect(c).toContainText('part received'); await expect(c).toContainText('Good 2 · scrap 1'); await expect(c.getByRole('article', { name: `Receipt COATED-A-${width}` })).toContainText(`HEAT-A-${width}: 3`); await shot(page, 'partial-receipt')
  await receive('4', '0', '1', '3', `COATED-B-${width}`)
  const returnForm = form(c, 'Return unused material'), latest = await (await page.request.get(origin + '/api/larder/state')).json(), order = latest.subcontractOrders.find((x: any) => x.id === o.id)
  await returnForm.getByLabel('Issued lot').selectOption(order.issued.find((i: any) => i.lotId === lots[1].id).id); await returnForm.getByLabel('Return quantity').fill('1'); await returnForm.getByLabel('Return location').selectOption(shop.id); await returnForm.getByLabel('Return reason').fill('Unused blank physically returned'); await returnForm.getByRole('button', { name: 'Return custody stock' }).click(); await settled(page)
  const bill = form(c, 'Reconcile service bill'); await bill.getByLabel('Bill reference').fill('COASTAL-007'); await bill.getByLabel('Bill amount').fill('14'); await bill.locator('input[type=file]').setInputFiles(file); await bill.getByRole('button', { name: 'Record bill reconciliation' }).click(); await settled(page)
  await expect(c).toContainText('recorded match (local record)'); await expect(c).toContainText('Good 6 · scrap 1'); await shot(page, 'complete')
  const final = await (await page.request.get(origin + '/api/larder/state')).json(), done = final.subcontractOrders.find((x: any) => x.id === o.id)
  expect(done.bill.difference).toBe('0'); expect(done.serviceAccrued).toBe('14'); expect(done.issued.map((i: any) => Number(i.quantity) - Number(i.consumed) - Number(i.returned))).toEqual([0, 0])
  expect(final.lots.find((l: any) => l.id === done.receipts[1].lotId).documentId).toBe(done.id)
  const customer = await command(page, 'party.save', { name: `Harbor Tools ${width}`, kind: 'customer' })
  await page.reload(); await settled(page)
  const intake = card(page, 'Receive customer property'); await intake.getByLabel('Customer', { exact: true }).selectOption(customer.id); await intake.getByLabel('Customer material').selectOption(part.id); await intake.getByLabel('Custody location').selectOption(shop.id); await intake.getByLabel('Customer lot').fill(`PROPERTY-${width}`); await intake.getByLabel('Customer quantity').fill('4'); await intake.locator('input[type=file]').setInputFiles(file); await intake.getByRole('button', { name: 'Record customer custody' }).click(); await settled(page)
  await expect(card(page, 'Customer property custody ledger')).toContainText(`PROPERTY-${width}`); await shot(page, 'customer-custody')

})
