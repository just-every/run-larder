import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787'
const day = (n = 0) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
async function command(page: Page, type: string, payload: object) {
  const response = await page.request.post(origin + '/api/larder/commands', { headers: { Origin: origin }, data: { commandId: crypto.randomUUID(), type, payload } })
  const body = await response.json(); expect(body.ok, JSON.stringify(body.error)).toBe(true); return body.result
}
async function settled(page: Page) { await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false'); await expect(page.getByRole('alert')).toHaveCount(0) }
async function act(page: Page, button: ReturnType<Page['getByRole']>) {
  const response = page.waitForResponse(r => r.url() === origin + '/api/larder/commands' && r.request().method() === 'POST')
  await button.click(); const body = await (await response).json(); expect(body.ok, JSON.stringify(body.error)).toBe(true); await settled(page); return body.result
}
async function shot(page: Page, stage: string, region?: ReturnType<Page['locator']>) {
  expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  if (!process.env.LARDER_SCREENSHOTS) return
  await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true })
  const path = join(process.env.LARDER_SCREENSHOTS, `${page.viewportSize()!.width}-DEMAND-004-${stage}.png`)
  if (region) await region.screenshot({ path }); else await page.screenshot({ path, fullPage: true })
}

test('DEMAND-004 compare same demand under stock/order policies, approve exact batches, inspect customer pegs and inventory floors at 1440/390', async ({ page }) => {
  if (!process.env.LARDER_OPEN) throw new Error('Private native entry required.')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/app', '/setup'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const suffix = crypto.randomUUID().slice(0, 6)
    const location = await command(page, 'location.save', { name: `Ohio fabrication ${suffix}` })
    const raw = await command(page, 'item.save', { sku: `PLATE-${suffix}`, name: `Steel blanks ${suffix}`, kind: 'buy', baseUnit: 'each' })
    const item = await command(page, 'item.save', { sku: `MOUNT-${suffix}`, name: `Machine mount ${suffix}`, kind: 'make', baseUnit: 'each', catalogLocations: [{ locationId: location.id, safetyStock: '1', minStock: '2', maxStock: '10', reorderPoint: '3', defaultBin: location.id, leadDays: 2 }] })
    await command(page, 'bom.revise', { itemId: item.id, components: [{ itemId: raw.id, quantity: '2' }] })
    await command(page, 'opening.record', { locationId: location.id, countedOn: day(), countedBy: 'Olive', valuationBasis: 'supplier-invoice', evidence: { name: 'count.txt', contentType: 'text/plain', base64: Buffer.from('Invoice and Ohio workshop count').toString('base64') }, lines: [{ itemId: item.id, quantity: '4', unitCost: '8' }, { itemId: raw.id, quantity: '40', unitCost: '2' }] })
    const customer = await command(page, 'party.save', { name: `Ohio customer ${suffix}`, kind: 'customer' })
    const quote = await command(page, 'so.quote', { customerId: customer.id, promiseDate: day(10), lines: [{ itemId: item.id, quantity: '10' }] })
    const order = await command(page, 'so.confirm', { orderId: quote.id, version: quote.version, reserve: false })
    await page.goto(origin + '/app#make/policies'); await page.reload(); await settled(page)
    async function policy(mode: string) {
      await page.getByLabel('Policy item', { exact: true }).selectOption(item.id)
      await page.getByLabel('Policy settings location', { exact: true }).selectOption(location.id)
      await page.getByLabel('Supply policy', { exact: true }).selectOption(mode)
      await page.getByLabel('Policy effective date', { exact: true }).fill(day())
      await page.getByLabel('Batch size', { exact: true }).fill('2')
      await page.getByLabel('Order multiple', { exact: true }).fill('3')
      await page.getByLabel('Policy reason', { exact: true }).fill(`Reviewed ${mode} policy for Ohio workshop`)
      await shot(page, 'policy-configuration', page.getByRole('heading', { name: 'SKU and location policies', exact: true }).locator('../..'))
      const saved = await act(page, page.getByRole('button', { name: 'Save inventory policy', exact: true }))
      await page.getByLabel('Inventory policy revision', { exact: true }).selectOption(saved.id)
      return saved
    }
    async function preview(reason: string) {
      await page.locator(`input[name=orderId][value="${order.id}"]`).check()
      await page.getByLabel('Inventory planning reason', { exact: true }).fill(reason)
      await shot(page, 'prepared-plan', page.getByRole('heading', { name: 'Prepare an inventory plan', exact: true }).locator('../..'))
      return act(page, page.getByRole('button', { name: 'Preview inventory plan', exact: true }))
    }
    await policy('make-to-stock')
    const stock = await preview('Compare stock policy for ten mounts')
    expect(stock.preview.suggestions[0].quantity).toBe('18')
    let plan = page.locator('section.card').filter({ has: page.getByRole('heading', { name: /^Inventory plan · preview/ }) }).first()
    await expect(plan).toContainText('protected floor 2'); await expect(plan).toContainText('available common 2'); await expect(plan).toContainText('unused common 0')
    await shot(page, 'stock-comparison', plan)
    await policy('make-to-order')
    const ordered = await preview('Compare customer-pegged policy for the same ten mounts')
    expect(ordered.preview.suggestions[0].quantity).toBe('12'); expect(ordered.preview.suggestions[0].orderId).toBe(order.id)
    plan = page.locator('section.card').filter({ has: page.getByRole('heading', { name: /^Inventory plan · preview/ }) }).first()
    await expect(plan).toContainText(order.reference); await expect(plan).toContainText('Components ready by planned start')
    await shot(page, 'order-preview', plan)
    const approved = await act(page, plan.getByRole('button', { name: 'Approve inventory plan', exact: true }))
    const work = approved.documents[0]
    await page.reload(); await settled(page)
    plan = page.locator('section.card').filter({ has: page.getByRole('heading', { name: /^Inventory plan · approved/ }) }).first()
    await expect(plan).toContainText(work.reference); await expect(plan).toContainText('draft')
    await shot(page, 'approved-order-plan', plan)
    await plan.getByRole('link', { name: work.reference, exact: true }).click(); await settled(page)
    await expect(page.locator('main')).toContainText(work.reference)
    await shot(page, 'pegged-work-draft')
    await page.goto(origin + '/app#make/policies'); await settled(page)
    await policy('make-to-stock')
    const replenishment = await preview('Replenish common stock while retaining dedicated customer work')
    expect(replenishment.preview.suggestions[0].quantity).toBe('12')
    expect(replenishment.preview.suggestions[0].components[0].committedToExistingWork).toBe('24')
    expect(replenishment.preview.suggestions[0].components[0].shortage).toBe('8')
    expect(replenishment.preview.demand[0].existingAllocated).toBe('8')
    plan = page.locator('section.card').filter({ has: page.getByRole('heading', { name: /^Inventory plan · preview/ }) }).first()
    const stocked = await act(page, plan.getByRole('button', { name: 'Approve inventory plan', exact: true }))
    expect(stocked.documents[0].quantity).toBe('12')
    plan = page.locator('section.card').filter({ has: page.getByRole('heading', { name: /^Inventory plan · approved/ }) }).first()
    await shot(page, 'approved-common-stock', plan)
    const end = await (await page.request.get(origin + '/api/larder/state')).json()
    expect(end.reservations.filter((r: any) => r.demandId === order.id).reduce((n: number, r: any) => n + Number(r.quantity), 0)).toBe(2)
    expect(end.workOrders.find((w: any) => w.id === work.id).inventoryPolicy.orderId).toBe(order.id)
    expect(end.workOrders.find((w: any) => w.id === work.id).status).toBe('draft')
    expect(end.movements.filter((m: any) => m.itemId === item.id)).toHaveLength(1)
  }
})
