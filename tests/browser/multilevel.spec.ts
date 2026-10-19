import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787'
const date = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
async function command(page: Page, type: string, payload: object) {
  const res = await page.request.post(origin + '/api/larder/commands', { headers: { Origin: origin }, data: { commandId: crypto.randomUUID(), type, payload } })
  const body = await res.json(); expect(body.ok, JSON.stringify(body.error)).toBe(true); return body.result
}
async function shot(page: Page, stage: string) {
  if (!process.env.LARDER_SCREENSHOTS) return
  await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true })
  await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${page.viewportSize()!.width}-ENG-001-${stage}.png`), fullPage: true })
}
test('ENG-001 edit phantom/yield recipes, inspect three-level pegged shortages and pinned work at 1440/390', async ({ page }) => {
  if (!process.env.LARDER_OPEN) throw new Error('A private local entry is required.')
  try { await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/app', '/setup'].includes(u.pathname)) } catch { throw new Error('Local owner entry failed.') }
  if (new URL(page.url()).pathname === '/setup') {
    await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app')
  }
  const suffix = crypto.randomUUID().slice(0, 6)
  const item = (sku: string, name: string, kind = 'make') => command(page, 'item.save', { sku: `${sku}-${suffix}`, name: `${name} ${suffix}`, kind, baseUnit: 'each', standardCost: '4' })
  const raw = await item('ALLOY', 'Aluminum blank', 'buy'), left = await item('LH', 'Left bracket'), right = await item('RH', 'Right bracket'), kit = await item('FASTENERS', 'Fastener kit'), product = await item('FRAME', 'Equipment frame')
  const loc = await command(page, 'location.save', { name: `Production rack ${suffix}` })
  const customer = await command(page, 'party.save', { name: `Equipment Works ${suffix}`, kind: 'customer' })
  const supplier = await command(page, 'party.save', { name: `Metal supplier ${suffix}`, kind: 'supplier' })
  await command(page, 'partyItem.save', { partyId: supplier.id, itemId: raw.id, partyCode: 'AL-1', price: '4', preferred: true })
  await command(page, 'bom.revise', { itemId: left.id, yield: '0.5', components: [{ itemId: raw.id, quantity: '2' }] })
  await command(page, 'bom.revise', { itemId: right.id, components: [{ itemId: raw.id, quantity: '3' }] })
  await command(page, 'bom.revise', { itemId: kit.id, components: [{ itemId: raw.id, quantity: '1' }] })
  // Build the finished recipe in its actual editor, including explicit supply.
  await page.goto(origin + '/app#make/boms'); await page.reload()
  const editor = page.getByRole('heading', { name: 'New revision', exact: true }).locator('../..')
  await editor.getByLabel('Item', { exact: true }).selectOption(product.id)
  await editor.getByLabel('Component 1', { exact: true }).selectOption(left.id); await editor.getByLabel('Quantity', { exact: true }).nth(0).fill('1')
  await editor.getByLabel('Component 2', { exact: true }).selectOption(right.id); await editor.getByLabel('Quantity', { exact: true }).nth(1).fill('1')
  await editor.getByLabel('Component 3', { exact: true }).selectOption(kit.id); await editor.getByLabel('Quantity', { exact: true }).nth(2).fill('1'); await editor.getByLabel('Supply 3', { exact: true }).selectOption('phantom')
  await editor.getByLabel('Yield fraction', { exact: true }).fill('1')
  await editor.getByRole('button', { name: 'Save new revision', exact: true }).click()
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByRole('row').filter({ hasText: `Equipment frame ${suffix}` }).first()).toContainText('phantom')
  await command(page, 'opening.record', { locationId: loc.id, countedOn: date(0), countedBy: 'Olive', valuationBasis: 'supplier-invoice', evidence: { name: 'rack.txt', contentType: 'text/plain', base64: Buffer.from('Counted production rack').toString('base64') }, lines: [{ itemId: raw.id, quantity: '3', unitCost: '4' }, { itemId: left.id, quantity: '1', unitCost: '16' }, { itemId: kit.id, quantity: '100', unitCost: '4' }] })
  const order = await command(page, 'so.quote', { customerId: customer.id, promiseDate: date(10), lines: [{ itemId: product.id, quantity: '2' }] })
  await command(page, 'so.confirm', { orderId: order.id, version: order.version, reserve: false })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 }); await page.goto(origin + '/app#make/boms'); await page.reload(); await expect(page.getByLabel('Yield fraction', { exact: true })).toBeVisible(); await shot(page, 'recipes')
    await page.goto(origin + '/app#make/plan'); await page.reload()
    const row = page.getByRole('row').filter({ has: page.getByText(`Aluminum blank ${suffix}`, { exact: true }) })
    await expect(row.locator('td').nth(1)).toHaveText('9'); await expect(row).toContainText(`Left bracket ${suffix} rev 1`); await expect(row).toContainText(`Right bracket ${suffix} rev 1`); await expect(row).toContainText(`Fastener kit ${suffix} rev 1`)
    await shot(page, 'net-shortages')
  }
  const frameRow = page.getByRole('row').filter({ has: page.getByText(`Equipment frame ${suffix}`, { exact: true }) })
  await frameRow.getByRole('button', { name: 'Draft work order (2)', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Release and reserve materials', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Release and reserve materials', exact: true }).click()
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false')
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 }); await expect(page.getByText(/Pinned recipes:/)).toContainText(`Fastener kit ${suffix} rev 1`); await shot(page, 'released')
  }
  const s = await page.evaluate(async () => (await fetch('/api/larder/state')).json())
  const w = s.workOrders.find((r: any) => r.itemId === product.id)
  expect(w.components.find((l: any) => l.itemId === raw.id).required).toBe('2')
  expect(s.shortages.find((l: any) => l.itemId === raw.id).shortage).toBe('9')
})
