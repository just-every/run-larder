import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787'
async function command(page: Page, type: string, payload: object) {
  const r = await page.request.post(origin + '/api/larder/commands', { headers: { Origin: origin }, data: { commandId: crypto.randomUUID(), type, payload } })
  const b = await r.json(); expect(b.ok, JSON.stringify(b.error)).toBe(true); return b.result
}
async function settled(page: Page) { await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false'); await expect(page.getByRole('alert')).toHaveCount(0) }
async function shots(page: Page, stage: string, region?: ReturnType<Page['locator']>) {
  if (!process.env.LARDER_SCREENSHOTS) return
  await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    const path = join(process.env.LARDER_SCREENSHOTS, `${width}-FLOOR-003-${stage}.png`)
    if (region) await region.screenshot({ path }); else await page.screenshot({ path, fullPage: true })
  }
}

test('FLOOR-003 six of ten complete, four handed on, two held and four backordered, inspected at 1440/390', async ({ page }) => {
  if (!process.env.LARDER_OPEN) throw new Error('Private local entry required.')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/setup', '/app'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  const suffix = crypto.randomUUID().slice(0, 6), day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10), today = day(0)
  const raw = await command(page, 'item.save', { sku: `WIPB-${suffix}`, name: `WIP blank ${suffix}`, kind: 'buy', baseUnit: 'each' })
  const product = await command(page, 'item.save', { sku: `WIPP-${suffix}`, name: `WIP plate ${suffix}`, kind: 'make', baseUnit: 'each' })
  const location = await command(page, 'location.save', { name: `WIP shelf ${suffix}` })
  await command(page, 'bom.revise', { itemId: product.id, components: [{ itemId: raw.id, quantity: '1' }], routing: [
    { name: 'Machine', workCentre: `Mill ${suffix}`, minutes: 2, setupMinutes: 10, queueMinutes: 5 },
    { name: 'Coat', workCentre: `Booth ${suffix}`, minutes: 3, transferBatch: '4', allowOverlap: true },
  ] })
  await command(page, 'opening.record', { locationId: location.id, countedOn: today, countedBy: 'Olive', valuationBasis: 'supplier-invoice', evidence: { name: 'blank-count.txt', contentType: 'text/plain', base64: Buffer.from('Invoice and counted blanks').toString('base64') }, lines: [{ itemId: raw.id, quantity: '20', unitCost: '4' }] })
  let work = await command(page, 'wo.draft', { itemId: product.id, quantity: '10', requiredBy: day(10), reason: 'Ten plates, partly completed' })
  work = await command(page, 'wo.release', { workOrderId: work.id, version: work.version })
  await command(page, 'wo.reserve', { workOrderId: work.id })
  work = await command(page, 'wo.issue', { workOrderId: work.id, lines: [{ itemId: raw.id, locationId: location.id, quantity: '6' }] })
  const actor = (await (await page.request.get(origin + '/api/larder/state')).json()).actor
  work = await command(page, 'wo.operation.assign', { workOrderId: work.id, version: work.version, sequence: 1, operatorId: actor.id })
  await page.goto(origin + `/app#make/wo/${work.id}`); await page.reload(); await settled(page)
  await page.getByLabel('Step 1 station', { exact: true }).fill('Mill tablet')
  await page.getByLabel('Step 1 start reason', { exact: true }).fill('Fixture checked')
  await page.getByRole('button', { name: 'Start step 1', exact: true }).click(); await settled(page)
  const control = page.getByRole('region', { name: 'Step 1 quantity ledger', exact: true }), ledger = page.getByRole('region', { name: `${work.reference} operation ledger`, exact: true })
  await control.getByLabel('Step 1 good units completed', { exact: true }).fill('6')
  await control.getByLabel('Step 1 quantity reason', { exact: true }).fill('Six measured and accepted')
  await control.getByRole('button', { name: 'Record step 1 quantities', exact: true }).click(); await settled(page)
  const row = (n: number, bucket: string) => ledger.locator('tr').filter({ has: page.locator('td[data-label="Units and material cost"]', { hasText: new RegExp(`^${bucket}$`) }) }).locator(`td[data-label^="Step ${n}:"]`)
  await expect(row(1, 'Completed')).toHaveText(/^6 · /); await expect(row(1, 'Running')).toHaveText(/^4 · /)
  await shots(page, 'reported', ledger)
  await page.getByLabel('Step 1 transfer quantity', { exact: true }).fill('4')
  await page.getByLabel('Step 1 transfer reason', { exact: true }).fill('First four to coating')
  await page.getByRole('button', { name: 'Record step 1 transfer', exact: true }).click(); await settled(page)
  await control.getByLabel('Step 1 hold quantity', { exact: true }).fill('2')
  await control.getByLabel('Step 1 hold reason', { exact: true }).fill('Burr on two parts')
  await control.getByRole('button', { name: 'Hold step 1 units', exact: true }).click(); await settled(page)
  await control.getByLabel('Step 1 backorder quantity', { exact: true }).fill('4')
  await control.getByLabel('Step 1 backorder date', { exact: true }).fill(day(20))
  await control.getByLabel('Step 1 backorder reason', { exact: true }).fill('New tool arrives next week')
  await control.getByRole('button', { name: 'Backorder step 1 units', exact: true }).click(); await settled(page)
  for (const [bucket, quantity] of [['Completed', '0'], ['Handed on', '4'], ['Held', '2'], ['Backordered', '4'], ['Running', '0']]) await expect(row(1, bucket)).toHaveText(new RegExp(`^${quantity} · `))
  await expect(row(2, 'Waiting')).toHaveText(/^4 · /); await expect(row(2, 'Upstream')).toHaveText('6')
  const backorders = ledger.getByRole('region', { name: `${work.reference} manufacturing backorders`, exact: true })
  await expect(backorders).toContainText('4 each at step 1'); await expect(backorders).toContainText('after the required date')
  await expect(backorders).toContainText('4 needed, 4 reserved, 6 issued'); await expect(backorders).toContainText('step 1 Mill'); await expect(backorders).toContainText('23 min')
  await shots(page, 'backordered', ledger)
  await page.reload(); await settled(page); await expect(row(1, 'Held')).toHaveText(/^2 · /)
  const end = await (await page.request.get(origin + '/api/larder/state')).json(), final = end.workOrders.find((w: any) => w.id === work.id)
  expect(final.output).toBe('0'); expect(final.scrap).toBe('0'); expect(final.status).toBe('released'); expect(final.requiredBy).toBe(day(10))
  expect(end.movements.filter((m: any) => m.documentId === work.id).map((m: any) => m.kind)).toEqual(['issue'])
  await page.setViewportSize({ width: 390, height: 900 }); await expect(row(1, 'Backordered')).toBeVisible()
})
