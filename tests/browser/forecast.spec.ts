import type { Page } from '@playwright/test'
import { test, expect, navigationMark } from './navigation-diagnostics'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787'
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return
  console.error('Forecast failed page', JSON.stringify(await page.evaluate(() => {
    const router = (window as any).__TSR_ROUTER__
    const safeHash = (hash: string | undefined) => hash?.includes('rer-dev') ? '[private entry]' : hash
    return { hash: safeHash(location.hash), historyHash: safeHash(router?.history.location.hash), routerHash: safeHash(router?.stores.location.get().hash),
      headings: [...document.querySelectorAll('main h1, main h2')].map(h => h.textContent), busy: document.querySelector('main')?.getAttribute('aria-busy'),
      alert: document.querySelector('[role=alert]')?.textContent,
      stateRequests: performance.getEntriesByType('resource').filter(e => new URL(e.name).pathname === '/api/larder/state').map(e => ({ initiator: (e as PerformanceResourceTiming).initiatorType, duration: e.duration, responseEnd: (e as PerformanceResourceTiming).responseEnd })) }
  })))
})
const day = (start: string, n: number) => new Date(Date.parse(start + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
async function command(page: Page, type: string, payload: object) {
  const res = await page.request.post(origin + '/api/larder/commands', { headers: { Origin: origin }, data: { commandId: crypto.randomUUID(), type, payload } })
  const body = await res.json(); expect(body.ok, JSON.stringify(body.error)).toBe(true); return body.result
}
async function settled(page: Page) { await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false'); await expect(page.getByRole('alert')).toHaveCount(0) }
async function shots(page: Page, stage: string, region?: ReturnType<Page['locator']>) {
  if (!process.env.LARDER_SCREENSHOTS) return
  await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    if (region) await region.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${width}-DEMAND-003-${stage}.png`) })
    else await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${width}-DEMAND-003-${stage}.png`), fullPage: true })
  }
}

test('DEMAND-003 DEMAND-004 import twelve weeks, consume real orders, adjust and undo forecasts, review and release linked MPS at 1440/390', async ({ page }) => {
  if (!process.env.LARDER_OPEN) throw new Error('Private local entry required.')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/setup', '/app'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  const suffix = crypto.randomUUID().slice(0, 6), sku = `BRACKET-${suffix}`
  const raw = await command(page, 'item.save', { sku: `BLANK-${suffix}`, name: `Steel blank ${suffix}`, kind: 'buy', baseUnit: 'each' })
  const product = await command(page, 'item.save', { sku, name: `Ohio bracket ${suffix}`, kind: 'make', baseUnit: 'each' })
  await command(page, 'bom.revise', { itemId: product.id, components: [{ itemId: raw.id, quantity: '2' }] })
  const location = await command(page, 'location.save', { name: `Ohio forecast stockroom ${suffix}` })
  await command(page, 'inventory.policy', { itemId: product.id, locationId: location.id, mode: 'make-to-stock', effectiveOn: new Date().toISOString().slice(0, 10), batchSize: '4', orderMultiple: '6', reason: 'Reviewed location policy for weekly demand' })
  const customer = await command(page, 'party.save', { name: `Equipment Works ${suffix}`, kind: 'customer' })
  const now = new Date(), monday = day(now.toISOString().slice(0, 10), 8 - (now.getUTCDay() || 7)), weeks = Array.from({ length: 12 }, (_, i) => day(monday, i * 7))
  navigationMark(page, 'before-goto')
  await page.goto(origin + '/app#make/forecast'); navigationMark(page, 'after-goto')
  await page.reload(); navigationMark(page, 'after-reload')
  await settled(page); navigationMark(page, 'after-settled')
  const importer = page.getByRole('heading', { name: 'Import weekly forecast', exact: true }).locator('../..')
  await expect(importer).toBeVisible()
  const csv = 'sku,week,quantity,seasonality\n' + weeks.map((week, i) => `${sku},${week},10,${i === 1 ? '1.5' : '1'}`).join('\n')
  await importer.getByLabel('Forecast CSV', { exact: true }).setInputFiles({ name: 'quarterly-forecast.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await importer.getByLabel('Import reason', { exact: true }).fill('Equipment customers’ winter demand')
  await shots(page, 'import', importer)
  await importer.getByRole('button', { name: 'Import forecast CSV', exact: true }).click(); await settled(page)
  const schedule = page.getByRole('heading', { name: 'Forecast and master production schedule', exact: true }).locator('../..')
  await schedule.getByLabel('Schedule item', { exact: true }).selectOption(product.id)
  await expect(schedule.locator('tbody tr')).toHaveCount(12)
  await schedule.getByLabel('Schedule week', { exact: true }).selectOption(monday)
  await shots(page, 'forecast-baseline', schedule)
  const order = await command(page, 'so.quote', { customerId: customer.id, promiseDate: day(monday, 2), lines: [{ itemId: product.id, quantity: '6' }] })
  await command(page, 'so.confirm', { orderId: order.id, version: order.version, reserve: false })
  await page.reload(); await settled(page); await schedule.getByLabel('Schedule item', { exact: true }).selectOption(product.id); await schedule.getByLabel('Schedule week', { exact: true }).selectOption(monday)
  const row = schedule.locator('tbody tr').first()
  await expect(row.locator('td').nth(2)).toHaveText('6'); await expect(row.locator('td').nth(4)).toHaveText('4'); await expect(row.locator('td').nth(5)).toHaveText('10'); expect((await row.locator('td').nth(6).textContent())?.replace('−', '-')).toBe('-4')
  await row.getByRole('button', { name: 'Demand and supply sources' }).click(); await expect(schedule.getByRole('region', { name: 'Demand and supply sources', exact: true })).toContainText(order.reference)
  await shots(page, 'order-consumption', schedule)
  const loaded = await (await page.request.get(origin + '/api/larder/state')).json()
  await page.getByLabel('Forecast week', { exact: true }).selectOption(loaded.forecasts.find((f: any) => f.itemId === product.id && f.week === monday).id)
  const adjust = page.getByRole('button', { name: 'Record forecast adjustment', exact: true }).locator('../..')
  await adjust.getByLabel('Seasonality factor', { exact: true }).fill('1.25'); await adjust.getByLabel('Override quantity', { exact: true }).fill('20'); await adjust.getByLabel('Adjustment reason', { exact: true }).fill('Customer campaign')
  await adjust.getByRole('button', { name: 'Record forecast adjustment', exact: true }).click(); await settled(page)
  await expect(row.locator('td').nth(4)).toHaveText('14'); await expect(row.locator('td').nth(5)).toHaveText('20')
  await shots(page, 'adjusted', adjust.locator('..'))
  const undo = page.getByRole('button', { name: 'Undo latest forecast change', exact: true }).locator('../..')
  await undo.getByLabel('Undo reason', { exact: true }).fill('Campaign deferred'); await undo.getByRole('button', { name: 'Undo latest forecast change', exact: true }).click(); await settled(page)
  await expect(row.locator('td').nth(4)).toHaveText('4')
  await page.getByText('Forecast change history', { exact: true }).click()
  await expect(page.locator('main')).toContainText('Campaign deferred'); await expect(page.locator('main')).toContainText('Customer campaign')
  await shots(page, 'undo-history', adjust.locator('..'))
  await schedule.getByLabel('Schedule reason', { exact: true }).fill('Winter manufacturing plan')
  await schedule.getByRole('button', { name: 'Preview MPS', exact: true }).click(); await settled(page)
  let plan = page.getByRole('heading', { name: /MPS · preview/ }).first().locator('../..')
  await expect(plan.getByRole('region', { name: 'MPS quantity suggestions', exact: true }).locator('tbody tr').filter({ hasText: product.name })).toHaveCount(12); await expect(plan.getByRole('button', { name: 'Approve and release MPS' })).toBeEnabled()
  await expect(plan.getByRole('region', { name: 'MPS location policy review' })).toContainText(location.name)
  await shots(page, 'mps-preview', plan)
  // A real concurrent business change invalidates the reviewed schedule.
  await command(page, 'item.save', { sku: `EXTRA-${suffix}`, name: 'New purchased washer', kind: 'buy', baseUnit: 'each' })
  await page.reload(); await settled(page)
  plan = page.getByRole('heading', { name: /MPS · preview/ }).first().locator('../..')
  await expect(plan.getByRole('button', { name: 'Approve and release MPS' })).toBeDisabled(); await expect(plan).toContainText('Records changed')
  await shots(page, 'stale-schedule', plan)
  await schedule.getByLabel('Schedule reason', { exact: true }).fill('Refreshed winter manufacturing plan'); await schedule.getByRole('button', { name: 'Preview MPS', exact: true }).click(); await settled(page)
  plan = page.getByRole('heading', { name: /MPS · preview/ }).first().locator('../..')
  await plan.getByLabel('Acknowledge manual MPS policy override', { exact: true }).check()
  await plan.getByLabel('Manual policy override reason', { exact: true }).fill('Reviewed exact winter quantities as a manual global exception')
  await shots(page, 'manual-policy-override', plan)
  await plan.getByRole('button', { name: 'Approve and release MPS', exact: true }).click(); await settled(page)
  const released = page.getByRole('heading', { name: /MPS · released/ }).first().locator('../..')
  await expect(released).toContainText('Reviewed exact winter quantities as a manual global exception')
  await expect(released.locator('li').filter({ hasText: product.name })).toHaveCount(12); await shots(page, 'released', released)
  const state = await (await page.request.get(origin + '/api/larder/state')).json()
  expect(state.masterSchedule.every((r: any) => r.itemId !== product.id || r.proposed === '0')).toBe(true)
  expect(state.workOrders.filter((w: any) => w.itemId === product.id).reduce((n: number, w: any) => n + Number(w.quantity), 0)).toBe(125)
  const link = released.locator('li').filter({ hasText: product.name }).getByRole('link').first(); await link.click(); await settled(page)
  await expect(page.getByRole('heading', { name: /WO-/ }).first()).toBeVisible(); await expect(page.locator('main')).toContainText('Refreshed winter manufacturing plan')
  await shots(page, 'linked-draft')
})
