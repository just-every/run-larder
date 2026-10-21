import { test, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787'

test('MOVE-008 preview and commit source history, find closed job/lot, download original and portable exports at 1440/390', async ({ page }) => {
  if (!process.env.LARDER_OPEN) throw new Error('Private local entry required.')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/setup', '/app'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  const settled = async () => { await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false'); await expect(page.getByRole('alert')).toHaveCount(0) }
  const shots = async (stage: string) => {
    if (!process.env.LARDER_SCREENSHOTS) return
    await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true })
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${width}-MOVE-008-${stage}.png`), fullPage: true })
    }
  }
  const source = { format: 'larder-source-history-v1', source: 'Walnut workshop archive', records: [
    { kind: 'closed-job', originalId: 'job/712', reference: 'JOB-712', occurredAt: '2025-12-01T17:30:00-05:00', currency: 'USD', sourceStatus: 'closed', summary: 'Walnut boards completed and inspected', references: ['LOT-WAL-62', 'SHIP-241'], quantity: '3', unit: 'each', amount: '150.75', attachments: ['job-closed.txt'] },
    { kind: 'lot', originalId: 'lot/62', reference: 'LOT-WAL-62', occurredAt: '2025-12-01T17:30:00-05:00', currency: 'AUD', sourceStatus: 'consumed', summary: 'Original timber lot', references: ['JOB-712'], quantity: '3', unit: 'each', amount: '42.5', attachments: [] },
  ] }
  await page.goto(origin + '/app#more/move-in'); await settled()
  await page.locator('input[name="history"]').setInputFiles({ name: 'source-history.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) })
  await page.locator('input[name="attachments"]').setInputFiles({ name: 'job-closed.txt', mimeType: 'text/plain', buffer: Buffer.from('Three walnut boards completed ✓') })
  await page.getByRole('button', { name: 'Preview source history', exact: true }).click(); await settled()
  const review = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Review source history: Walnut workshop archive', exact: true }) })
  await expect(review).toContainText('JOB-712'); await expect(review).toContainText('USD'); await expect(review).toContainText('AUD')
  await expect(page.getByRole('heading', { name: 'JOB-712 Source history', exact: true })).toHaveCount(0)
  await shots('preview')
  await page.getByRole('button', { name: 'Commit source history from Walnut workshop archive', exact: true }).click(); await settled()
  await expect(page.getByRole('heading', { name: 'JOB-712 Source history', exact: true })).toBeVisible()
  await page.getByLabel('Search source references or files', { exact: true }).fill('LOT-WAL-62')
  await expect(page.locator('article')).toHaveCount(2)
  await shots('committed')
  await page.getByLabel('Search source references or files', { exact: true }).fill('job-closed.txt')
  await expect(page.locator('article')).toHaveCount(1)
  const file = await page.request.get(origin + await page.getByRole('link', { name: 'job-closed.txt', exact: true }).getAttribute('href'))
  expect(await file.text()).toBe('Three walnut boards completed ✓')
  await page.getByLabel('Search order, SKU, lot', { exact: true }).fill('JOB-712')
  await expect(page.locator('.search-hits')).toContainText('Source history'); await shots('top-search')
  await page.locator('.search-hits a').first().click(); await settled()
  await page.goto(origin + '/app#more/archive'); await settled()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download archive', exact: true }).click()
  const archive = await download, path = await archive.path()
  expect(path).toBeTruthy()
  await expect(page.getByRole('status').filter({ hasText: 'Archive downloaded' })).toBeVisible()
  const csvDownload = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download archive CSV', exact: true }).click()
  const csv = await csvDownload; expect(await csv.path()).toBeTruthy()
  await shots('archive')
  const state = await (await page.request.get(origin + '/api/larder/state')).json()
  expect(state.sourceHistory).toHaveLength(2); expect(state.movements).toHaveLength(0); expect(state.shipments).toHaveLength(0)
  await page.goto(origin + '/app#more/move-in'); await settled()
  await page.getByRole('link', { name: 'Move-in documentation', exact: true }).click()
  await page.waitForURL(origin + '/docs/move-in')
  await shots('documentation')
  const json = await (await page.request.get(origin + '/api/larder/archive')).json()
  expect(json.records.sourceHistory.map((r: any) => r.currency).sort()).toEqual(['AUD', 'USD'])
  if (process.env.LARDER_BROWSER_OUTPUT) await writeFile(join(process.env.LARDER_BROWSER_OUTPUT, 'MOVE-008-archive.json'), JSON.stringify(json))
})
