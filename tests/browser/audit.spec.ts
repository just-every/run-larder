import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787'

test('GOV-004 the owner reads, filters and exports the append-only audit at 1440/390', async ({ page }) => {
  if (!process.env.LARDER_OPEN) throw new Error('Private local entry required.')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/setup', '/app'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  const send = async (type: string, payload: object) => expect((await page.request.post(origin + '/api/larder/commands', { headers: { origin }, data: { commandId: crypto.randomUUID(), type, payload } })).ok()).toBe(true)
  await send('location.save', { name: 'Audit bay', note: 'Walk-in store; portal password: synthetic-larder-1' })
  await send('item.save', { sku: 'AUD-1', name: 'Audit blank', kind: 'buy', baseUnit: 'each', attributes: { 'API key': 'synthetic-larder-2' } })
  await page.goto(origin + '/app#more/activity')
  const trail = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Audit trail', exact: true }) })
  await expect(trail).toContainText('Audit bay'); await expect(trail).toContainText('Audit blank')
  await expect(trail).not.toContainText('synthetic-larder')
  await expect(trail).toContainText('Retained for the life of the installation; purge authority: none.')
  await trail.getByLabel('Area', { exact: true }).selectOption('revisions')
  await expect(trail).toContainText('Audit blank'); await expect(trail).not.toContainText('Audit bay')
  await trail.getByLabel('Area', { exact: true }).selectOption('')
  await trail.getByLabel('Search the audit', { exact: true }).fill('walk-in')
  await expect(trail).toContainText('Audit bay'); await expect(trail).not.toContainText('Audit blank')
  const csv = await page.request.get(origin + await trail.getByRole('link', { name: 'Download CSV', exact: true }).getAttribute('href') as string)
  expect(csv.status()).toBe(200); expect(await csv.text()).not.toContain('synthetic-larder')
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    if (process.env.LARDER_SCREENSHOTS) { await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${width}-GOV-004-audit.png`), fullPage: true }) }
  }
})
