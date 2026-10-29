import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787'
const today = new Date().toISOString().slice(0, 10)
async function command(page: Page, type: string, payload: object) {
  const res = await page.request.post(origin + '/api/larder/commands', { headers: { Origin: origin }, data: { commandId: crypto.randomUUID(), type, payload } })
  const body = await res.json(); expect(body.ok, JSON.stringify(body.error)).toBe(true); return body.result
}
async function settled(page: Page) { await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false'); await expect(page.getByRole('alert')).toHaveCount(0) }
async function shot(page: Page, name: string) {
  if (!process.env.LARDER_SCREENSHOTS) return
  await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true })
  await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${page.viewportSize()!.width}-GOV-014 GOV-015 GOV-016-${name}.png`), fullPage: true })
}
const card = (page: Page, title: string) => page.locator('section.card').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
const open = async (page: Page, hash: string) => { await page.goto(origin + `/app#${hash}`); await page.reload(); await settled(page) }

test('GOV-014 GOV-015 GOV-016 the owner limits a person to one location and the costs-and-wages restriction, and that person sees only their reach at 1440/390', async ({ page, browser }) => {
  const runId = crypto.randomUUID().slice(0, 6), entry = process.env.LARDER_OPEN, email = `scoped-${runId}@example.test`
  if (!entry) throw new Error('A private local entry is required.')
  await page.goto(entry); await page.waitForURL(u => ['/app', '/setup'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  await settled(page)
  expect((await page.request.post(origin + '/auth/invite', { headers: { Origin: origin }, data: { email, displayName: `Sam Scoped ${runId}`, role: 'member' } })).status()).toBe(202)
  const context = await browser.newContext({ storageState: await page.context().storageState() }), member = await context.newPage()
  try {
    await member.goto(origin + '/auth/dev/enter?as=' + encodeURIComponent(email)); await member.waitForURL(u => u.pathname === '/app')
    const operatorId = (await (await member.request.get(origin + '/auth/session')).json()).operator.id
    await command(page, 'role.set', { operatorId, role: 'manager' })
    const bench = await command(page, 'location.save', { name: `Bench room ${runId}` }), annex = await command(page, 'location.save', { name: `Annex room ${runId}` })
    const item = await command(page, 'item.save', { sku: `SCOPE-${runId}`, name: `Scope bracket ${runId}`, kind: 'buy', baseUnit: 'each', standardCost: '47.3219' })
    const evidence = { name: 'count.txt', contentType: 'text/plain', base64: Buffer.from('Counted').toString('base64') }
    await command(page, 'opening.record', { locationId: bench.id, countedOn: today, valuationBasis: 'supplier-invoice', countedBy: 'Olive', evidence, lines: [{ itemId: item.id, quantity: '3', unitCost: '47.3219' }] })
    await command(page, 'opening.record', { locationId: annex.id, countedOn: today, valuationBasis: 'supplier-invoice', countedBy: 'Olive', evidence, lines: [{ itemId: (await command(page, 'item.save', { sku: `ANNEX-${runId}`, name: `Annex clamp ${runId}`, kind: 'buy', baseUnit: 'each' })).id, quantity: '5', unitCost: '2' }] })
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 }); await member.setViewportSize({ width, height: 1000 })
      await open(page, 'more/people')
      const limit = card(page, 'Limit a person')
      await limit.getByLabel('Person', { exact: true }).selectOption({ label: `Sam Scoped ${runId}` })
      await limit.getByLabel('Locations', { exact: true }).selectOption({ label: `Bench room ${runId}` })
      await limit.getByLabel('Costs and wages restricted', { exact: true }).check()
      await limit.getByRole('button', { name: 'Save limits', exact: true }).click(); await settled(page)
      await expect(card(page, 'Who sees what')).toContainText(`Only Bench room ${runId}. Costs and wages restricted`)
      await shot(page, 'limits')
      await open(member, 'stock')
      await expect(member.locator('main')).toContainText(`Scope bracket ${runId}`)
      await expect(member.locator('main')).not.toContainText(`Annex room ${runId}`)
      await expect(member.locator('main')).not.toContainText('47.3219')
      await member.locator('summary').filter({ has: member.locator('.avatar') }).click()
      await expect(member.locator('.account-menu')).toContainText(`Limited to Bench room ${runId}. Costs and wages restricted`)
      expect(await member.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      await shot(member, 'member-stock')
      // Lift the limits for the next width.
      await command(page, 'member.scope', { operatorId, locations: null, costsRestricted: false })
    }
  } finally { await context.close() }
})
