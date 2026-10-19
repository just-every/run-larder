import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787'
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
async function command(page: Page, type: string, payload: object) {
  const res = await page.request.post(origin + '/api/larder/commands', { headers: { Origin: origin }, data: { commandId: crypto.randomUUID(), type, payload } })
  const body = await res.json(); expect(body.ok, JSON.stringify(body.error)).toBe(true); return body.result
}
async function settled(page: Page) { await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false'); await expect(page.getByRole('alert')).toHaveCount(0) }
async function shot(page: Page, name: string) {
  if (!process.env.LARDER_SCREENSHOTS) return
  await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true })
  await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${page.viewportSize()!.width}-TRACE-003-${name}.png`), fullPage: true })
}
const form = (page: Page, title: string) => page.locator('form').filter({ has: page.getByRole('heading', { name: title, exact: true }) })

test('TRACE-003 receive dated lots, pick FEFO for a customer shelf-life rule and dispose of an expired lot at 1440/390', async ({ page }) => {
  const runId = crypto.randomUUID().slice(0, 6), entry = process.env.LARDER_OPEN
  page.on('pageerror', e => console.log('TRACE-003 page error:', e.message, e.stack?.split('\n').slice(0, 4).join(' | ')))
  page.on('response', r => { if (r.status() >= 400) console.log('TRACE-003 response:', r.status(), r.url()) })
  if (!entry) throw new Error('A private local entry is required.')
  await page.goto(entry); await page.waitForURL(u => ['/app', '/setup'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const tag = `${width}-${runId}`, cold = await command(page, 'location.save', { name: `Cold room ${tag}` })
    const item = await command(page, 'item.save', { sku: `VAN-${tag}`, name: `Vanilla extract ${tag}`, kind: 'buy', baseUnit: 'each' })
    const supplier = await command(page, 'party.save', { name: `Botanicals ${tag}`, kind: 'supplier' }), customer = await command(page, 'party.save', { name: `Fresh Market ${tag}`, kind: 'customer', minShelfLifeDays: 60 })
    let po = await command(page, 'po.draft', { supplierId: supplier.id, expectedDate: day(0), reason: 'Dated extract', lines: [{ itemId: item.id, quantity: '35', unitPrice: '5' }] })
    po = await command(page, 'po.approve', { poId: po.id, version: po.version })
    await page.goto(origin + `/app#make/po/${po.id}`); await page.reload(); await settled(page)
    if (!(await form(page, 'Receive delivery').count())) console.log('TRACE-003 main:', (await page.locator('main').innerText()).slice(0, 1500))
    for (const [lot, quantity, dates] of [[`A-${tag}`, '10', { Expires: day(20), 'Storage conditions': 'Refrigerate 2-8 °C' }], [`B-${tag}`, '20', { Manufactured: day(-5), 'Supplier shelf life (days)': '120' }], [`X-${tag}`, '5', { Expires: day(-1) }]] as const) {
      const receive = form(page, 'Receive delivery')
      await receive.getByLabel('Packing slip', { exact: true }).fill(`Slip ${lot}`); await receive.getByLabel('Into location', { exact: true }).selectOption(cold.id)
      await receive.getByLabel('Inspection', { exact: true }).selectOption('accept'); await receive.getByLabel(/^Vanilla extract .* \(outstanding/).fill(quantity)
      await receive.getByLabel('Supplier lot', { exact: true }).fill(lot)
      for (const [label, value] of Object.entries(dates)) await receive.getByLabel(label, { exact: true }).fill(value)
      if (lot.startsWith('B')) await shot(page, 'receive-dated-lot')
      await receive.getByRole('button', { name: 'Receive', exact: true }).click(); await settled(page)
    }
    await page.goto(origin + '/app#stock'); await page.reload(); await settled(page)
    const expiry = page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'Lot dates and expiry', exact: true }) })
    const row = (lot: string) => expiry.locator('tr').filter({ hasText: lot })
    await expect(row(`A-${tag}`)).toContainText('20 days'); await expect(row(`A-${tag}`)).toContainText('Expiring soon')
    await expect(row(`B-${tag}`)).toContainText('115 days'); await expect(row(`X-${tag}`)).toContainText(`expired on ${day(-1)}`)
    await shot(page, 'stock-expiry')
    await page.goto(origin + '/app#today'); await page.reload(); await settled(page)
    await expect(page.getByText(`Lot X-${tag} of Vanilla extract ${tag} expired on ${day(-1)}`, { exact: true })).toBeVisible(); await shot(page, 'today-alerts')

    let order = await command(page, 'so.quote', { customerId: customer.id, promiseDate: day(3), lines: [{ itemId: item.id, quantity: '8', unitPrice: '12' }] })
    order = await command(page, 'so.confirm', { orderId: order.id, version: order.version }); await command(page, 'so.reserve', { orderId: order.id })
    await page.goto(origin + `/app#orders/${order.id}`); await page.reload(); await settled(page)
    const pick = form(page, 'Pick reserved stock'), fefo = pick.getByLabel(`FEFO for Vanilla extract ${tag}`, { exact: true })
    await expect(fefo).toContainText(`the customer needs 60 days of shelf life`)
    await expect(fefo.locator('tr').filter({ hasText: `A-${tag}` })).toContainText('17 days of shelf life left'); await expect(fefo.locator('tr').filter({ hasText: `B-${tag}` })).toContainText('Eligible')
    await shot(page, 'fefo-proposal')
    await pick.getByRole('button', { name: 'Pick', exact: true }).click(); await settled(page)
    await expect(page.locator('article.shipment')).toContainText(`8 Vanilla extract ${tag} from Cold room ${tag}, lot B-${tag}`); await shot(page, 'fefo-picked')

    await page.goto(origin + '/app#stock'); await page.reload(); await settled(page)
    const decide = form(page, `Decide lot X-${tag} (expired on ${day(-1)})`)
    await decide.getByLabel('Decision', { exact: true }).selectOption('scrap'); await decide.getByLabel('Scrap at', { exact: true }).selectOption(cold.id)
    await decide.getByLabel('Reason', { exact: true }).fill('Expired on arrival; destroyed')
    await decide.locator('input[type=file]').setInputFiles({ name: `destruction-${tag}.txt`, mimeType: 'text/plain', buffer: Buffer.from('Destruction record') })
    await decide.getByRole('button', { name: 'Record disposition', exact: true }).click(); await settled(page)
    await expect(page.getByRole('region', { name: `Lot X-${tag} dispositions`, exact: true })).toContainText(`Scrapped 5 at Cold room ${tag}`)
    await expect(row(`X-${tag}`)).toContainText('0'); await shot(page, 'disposition')
    const state = await (await page.request.get(origin + '/api/larder/state')).json()
    expect(state.availability.find((a: any) => a.itemId === item.id)).toMatchObject({ onHand: '30', expired: '0' })
  }
})
