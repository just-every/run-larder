import { test, expect, type Page, type Locator } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787'
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
async function command(page: Page, type: string, payload: object) {
  const r = await page.request.post(origin + '/api/larder/commands', { headers: { Origin: origin }, data: { commandId: crypto.randomUUID(), type, payload } })
  const b = await r.json(); expect(b.ok, JSON.stringify(b.error)).toBe(true); return b.result
}
async function settled(page: Page) { await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false'); await expect(page.getByRole('alert')).toHaveCount(0) }
const form = (region: Locator, button: string) => region.locator('form').filter({ has: region.getByRole('button', { name: button, exact: true }) })
async function save(page: Page, f: Locator, button: string) {
  const reply = page.waitForResponse(r => r.url() === origin + '/api/larder/commands' && r.request().method() === 'POST')
  await f.getByRole('button', { name: button, exact: true }).click(); const b = await (await reply).json(); expect(b.ok, JSON.stringify(b.error)).toBe(true); await settled(page)
}
async function shot(page: Page, region: Locator, name: string) {
  if (!process.env.LARDER_SCREENSHOTS) return
  await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true })
  await region.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${page.viewportSize()!.width}-AUTO-001-${name}.png`) })
}

test('AUTO-001 LARDER-013 assign, evidence, in-app escalation and source-cleared history at 1440/390', async ({ page }) => {
  if (!process.env.LARDER_OPEN) throw new Error('Private local owner entry required.')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/app', '/setup'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  await settled(page)
  const owner = (await (await page.request.get(origin + '/api/larder/state')).json()).actor
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const tag = `${width}-${crypto.randomUUID().slice(0, 6)}`, loc = await command(page, 'location.save', { name: `Receiving ${tag}` })
    const item = await command(page, 'item.save', { sku: `STEEL-${tag}`, name: `Steel plate ${tag}`, kind: 'buy', baseUnit: 'each' })
    const supplier = await command(page, 'party.save', { name: `Ohio Steel ${tag}`, kind: 'supplier' }), customer = await command(page, 'party.save', { name: `Machine Works ${tag}`, kind: 'customer' })
    const orders = []
    for (let i = 0; i < 2; i++) {
      const q = await command(page, 'so.quote', { customerId: customer.id, promiseDate: day(1), lines: [{ itemId: item.id, quantity: '2', unitPrice: '12' }] })
      orders.push(await command(page, 'so.confirm', { orderId: q.id, version: q.version }))
    }
    let po = await command(page, 'po.draft', { supplierId: supplier.id, expectedDate: day(-1), reason: 'Both customer orders need this material', lines: [{ itemId: item.id, quantity: '4', unitPrice: '3' }] })
    po = await command(page, 'po.approve', { poId: po.id, version: po.version })
    await page.goto(origin + '/app#today'); await settled(page); await page.reload(); await settled(page)
    const title = `${po.reference} is overdue (expected ${day(-1)})`, region = page.getByRole('region', { name: `Follow-up ${title}`, exact: true })
    await region.locator(':scope > details > summary').click()
    await region.getByText('Assign follow-up', { exact: true }).click()
    let f = form(region, 'Assign case')
    await f.getByLabel('Follow-up owner', { exact: true }).selectOption(owner.id); await f.getByLabel('Escalation owner', { exact: true }).selectOption(owner.id)
    await f.getByLabel('Due date (UTC)', { exact: true }).fill(day(-1)); await f.getByLabel('Next action', { exact: true }).fill('Inspect the incoming steel')
    await f.getByLabel('Assignment note', { exact: true }).fill('Both orders are waiting for accepted stock'); await shot(page, region, 'assignment')
    await save(page, f, 'Assign case')
    await expect(region).toContainText('In-app escalation is due')
    for (const order of orders) await expect(region.getByRole('link', { name: order.reference, exact: true })).toBeVisible()
    await region.getByText('Record follow-up', { exact: true }).click(); f = form(region, 'Save follow-up')
    await f.getByLabel('Next action', { exact: true }).fill('Inspect steel before reserving it'); await f.getByLabel('Follow-up note', { exact: true }).fill('Supplier arrived; quality has not accepted the material yet')
    await f.getByLabel('Evidence files (optional, up to 5)', { exact: true }).setInputFiles({ name: `supplier-${tag}.txt`, mimeType: 'text/plain', buffer: Buffer.from('Supplier arrival evidence') })
    await save(page, f, 'Save follow-up')
    await region.getByText(`Escalate to ${owner.name}`, { exact: true }).click(); f = form(region, 'Record escalation')
    await f.getByLabel('Escalation note', { exact: true }).fill('Owner reviewing both promised orders'); await save(page, f, 'Record escalation')
    await region.getByText(/^Case history \(/).click(); await expect(region).toContainText('Supplier arrived; quality has not accepted the material yet'); await shot(page, region, 'following-up')
    let s = await (await page.request.get(origin + '/api/larder/state')).json(), followUp = s.followUpCases.find((x: any) => x.key === `po-late:${po.id}`)
    expect(followUp.status).toBe('following up'); const file = followUp.history.flatMap((e: any) => e.evidence).find((e: any) => e.name === `supplier-${tag}.txt`)
    expect(await (await page.request.get(origin + `/api/larder/attachments/${file.id}`)).text()).toBe('Supplier arrival evidence')
    const receipt = await command(page, 'receipt.create', { poId: po.id, supplierReference: `Delivery ${tag}`, lines: [{ lineId: po.lines[0].id, locationId: loc.id, quantity: '4', lot: `STEEL-${tag}`, inspection: 'quarantine' }] })
    await page.reload(); await settled(page); await region.locator(':scope > details > summary').click(); await expect(region).toContainText('Following up'); await shot(page, region, 'held-not-closed')
    await command(page, 'quarantine.decide', { itemId: item.id, locationId: loc.id, lotId: receipt.lines[0].lotId, quantity: '4', decision: 'release', reason: 'Material passed documented inspection' })
    await page.reload(); await settled(page)
    const closed = page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'Closed follow-up cases', exact: true }) }).getByRole('region', { name: `Follow-up ${title}`, exact: true })
    await closed.locator(':scope > details > summary').click(); await closed.getByText(/^Case history \(/).click()
    await expect(closed).toContainText('Closed'); await expect(closed).toContainText('Owner reviewing both promised orders')
    await expect(closed.getByRole('button', { name: 'Assign case', exact: true })).toHaveCount(0); await shot(page, closed, 'closed-history')
  }
})
