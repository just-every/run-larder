import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787'

test('GOV-004 and GOV-005 owner audit and exact retention decisions preserve history', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
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
  expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    if (process.env.LARDER_SCREENSHOTS) { await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${width}-GOV-004-audit.png`), fullPage: true }) }
  }
  // Continue through the same owner's preservation decision and its audit.
  const sendResult = async (type: string, payload: object) => {
    const response = await page.request.post(origin + '/api/larder/commands', { headers: { origin }, data: { commandId: crypto.randomUUID(), type, payload } })
    const body = await response.json(); expect(body.ok, JSON.stringify(body.error)).toBe(true); return body.result
  }
  const contact = await sendResult('party.save', { name: 'Synthetic Former Contact', kind: 'customer', email: 'synthetic-larder-820@example.test' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(origin + '/app#more/archive')
  const card = (name: string) => page.locator('section.card').filter({ has: page.getByRole('heading', { name, exact: true }) })
  const retention = card('Retention settings'), holds = card('Legal holds'), erasure = card('Erasure review')
  const act = async (click: () => Promise<unknown>) => {
    const response = page.waitForResponse(r => r.url().endsWith('/api/larder/commands') && r.request().method() === 'POST')
    await click(); expect((await (await response).json()).ok).toBe(true)
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false')
  }
  await retention.getByLabel('Retention category', { exact: true }).selectOption('contacts')
  await retention.getByLabel('Minimum retention days', { exact: true }).fill('0')
  await retention.getByLabel('Retention reason', { exact: true }).fill('Owner reviewed US preservation policy')
  await act(() => retention.getByRole('button', { name: 'Save retention period', exact: true }).click())
  await expect(retention).toContainText('0 days')
  await holds.getByLabel('Record to preserve', { exact: true }).selectOption('parties:' + contact.id)
  await holds.getByLabel('Hold reason', { exact: true }).fill('Preserve current contact review')
  await act(() => holds.getByRole('button', { name: 'Place legal hold', exact: true }).click())
  await erasure.getByLabel('Erasure subject', { exact: true }).selectOption('contact:' + contact.id)
  await erasure.getByRole('button', { name: 'Review erasure', exact: true }).click()
  await expect(erasure).toContainText('Erasure is blocked by preservation requirements')
  await expect(erasure.getByRole('button', { name: 'Erase reviewed fields', exact: true })).toHaveCount(0)
  await holds.getByLabel('Release reason', { exact: true }).fill('Owner explicitly releases this resolved hold')
  await act(() => holds.getByRole('button', { name: 'Release this hold', exact: true }).click())
  await expect(holds).toContainText('Released: Owner explicitly releases this resolved hold')
  await erasure.getByLabel('Erasure subject', { exact: true }).selectOption('contact:' + contact.id)
  await erasure.getByRole('button', { name: 'Review erasure', exact: true }).click()
  await expect(erasure).toContainText('Current name: Synthetic Former Contact. Current email: synthetic-larder-820@example.test.')
  await expect(erasure).toContainText('production and financial trace')
  await expect(erasure).toContainText('Not attempted; this door makes no provider deletion request.')
  const erase = erasure.getByRole('button', { name: 'Erase reviewed fields', exact: true })
  await erasure.getByLabel('Erasure reason', { exact: true }).fill('Exact subject request')
  await erase.click()
  // Native required consent prevents a command before the owner checks it.
  expect(await erasure.getByRole('checkbox').isChecked()).toBe(false)
  await erasure.getByRole('checkbox').check()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    if (process.env.LARDER_SCREENSHOTS) await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${width}-GOV-005-retention.png`), fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await act(() => erase.click())
  await expect(erasure).toContainText('Completed contact name and email')
  const archived = await (await page.request.get(origin + '/api/larder/archive')).json()
  expect(archived.records.parties.find((p: any) => p.id === contact.id).name).toBe('[erased]')
  const audit = await (await page.request.get(origin + '/api/larder/audit?limit=500')).json()
  const release = audit.entries.find((e: any) => e.commandType === 'retention.release' && e.after.active === false)
  expect([release.before.active, release.after.active, release.reason]).toEqual([true, false, 'Owner explicitly releases this resolved hold'])

})
