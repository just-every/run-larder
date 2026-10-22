import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

// BUY-002 and MRP-002 through the built app: a short delivery with damaged units and a delivery note, allocation of the
// accepted stock to two jobs, and the late remainder's expedite recorded as a request, at desktop and phone widths.
const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787'
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

async function command(page: Page, type: string, payload: object) {
  const r = await page.request.post(origin + '/api/larder/commands', { headers: { Origin: origin }, data: { commandId: crypto.randomUUID(), type, payload } })
  const b = await r.json(); expect(b.ok, JSON.stringify(b.error)).toBe(true); return b.result
}
async function settled(page: Page) { await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false'); await expect(page.getByRole('alert')).toHaveCount(0) }
async function shot(page: Page, stage: string) {
  if (!process.env.LARDER_SCREENSHOTS) return
  await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${width}-BUY-002-${stage}.png`), fullPage: true })
  }
}

test('Receiving a short delivery quarantines damaged units, allocates the accepted stock to two jobs and records the late remainder expedite at 1440/390', async ({ page }) => {
  if (!process.env.LARDER_OPEN) throw new Error('Private local entry required.')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/setup', '/app'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  const tag = crypto.randomUUID().slice(0, 6)
  const raw = await command(page, 'item.save', { sku: `synthetic-larder-${tag}`, name: `Receiving steel ${tag}`, kind: 'buy', baseUnit: 'each' })
  const part = await command(page, 'item.save', { sku: `synthetic-larder-${tag}-p`, name: `Receiving part ${tag}`, kind: 'make', baseUnit: 'each' })
  await command(page, 'bom.revise', { itemId: part.id, components: [{ itemId: raw.id, quantity: '1' }] })
  const dock = await command(page, 'location.save', { name: `Receiving dock ${tag}` }), supplier = await command(page, 'party.save', { name: `Receiving supplier ${tag}`, kind: 'supplier' })
  const jobs = []
  for (const [quantity, days] of [['4', 6], ['4', 8]]) { const d = await command(page, 'wo.draft', { itemId: part.id, quantity, requiredBy: day(days), reason: 'Receiving journey job' }); jobs.push(await command(page, 'wo.release', { workOrderId: d.id, version: d.version })) }
  const draft = await command(page, 'po.draft', { supplierId: supplier.id, expectedDate: day(3), reason: 'Receiving journey supply', lines: [{ itemId: raw.id, quantity: '10', unitPrice: '2' }] })
  const po = await command(page, 'po.approve', { poId: draft.id, version: draft.version })
  await page.goto(origin + '/app'); await settled(page)
  await page.goto(origin + `/app#make/po/${po.id}`); await expect(page.getByRole('heading', { name: 'Receive delivery', exact: true })).toBeVisible()

  const form = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Receive delivery', exact: true }) })
  await form.getByLabel('Packing slip', { exact: true }).fill('DN-7')
  await form.getByLabel('Into location', { exact: true }).selectOption(dock.id)
  await form.getByLabel('Inspection', { exact: true }).selectOption('accept')
  await form.getByLabel('Delivery note file (optional)', { exact: true }).setInputFiles({ name: 'dn-7.txt', mimeType: 'text/plain', buffer: Buffer.from('Delivery note DN-7, one pallet corner crushed') })
  await form.getByLabel(/outstanding 10/).fill('7')
  await form.getByLabel('Supplier lot', { exact: true }).fill('SYN-LOT')
  await form.getByLabel('Damaged units (quarantined)', { exact: true }).fill('2')
  await form.getByLabel('Damage reason', { exact: true }).fill('Crushed pallet corner')
  await shot(page, 'receive-form')
  const reply = page.waitForResponse(r => r.url() === `${origin}/api/larder/commands` && r.request().method() === 'POST')
  await form.getByRole('button', { name: 'Receive', exact: true }).click()
  expect((await (await reply).json()).ok).toBe(true); await settled(page)
  const receipts = page.locator('p.muted').filter({ hasText: 'DN-7' })
  await expect(receipts).toContainText('dn-7.txt'); await expect(receipts).toContainText('2 damaged: Crushed pallet corner')

  const allocated = page.waitForResponse(r => r.url() === `${origin}/api/larder/commands` && r.request().method() === 'POST')
  await receipts.getByRole('button', { name: 'Allocate accepted stock', exact: true }).click()
  expect((await (await allocated).json()).ok).toBe(true); await settled(page)
  await expect(receipts).toContainText(`4 to ${jobs[0].reference}, 1 to ${jobs[1].reference}`)

  // The supplier ships the rest late: the remainder is the expedite naming the second job, and approving it records a request.
  const live = (await (await page.request.get(origin + '/api/larder/state')).json()).purchaseOrders.find((p: any) => p.id === po.id)
  await command(page, 'po.revise', { poId: po.id, version: live.version, expectedDate: day(12), note: 'Supplier ships the rest late' })
  await page.reload(); await settled(page)
  const changes = page.getByLabel('Supply change recommendations')
  await expect(changes).toContainText('Ask for it sooner'); await expect(changes).toContainText(`${jobs[1].reference} needs 3`)
  await shot(page, 'supply-changes')
  await changes.getByLabel('Decision', { exact: true }).selectOption('approve')
  await changes.getByLabel('Reason', { exact: true }).fill('Ask the supplier for the last three sooner')
  const decided = page.waitForResponse(r => r.url() === `${origin}/api/larder/commands` && r.request().method() === 'POST')
  await changes.getByRole('button', { name: 'Record decision', exact: true }).click()
  expect((await (await decided).json()).ok).toBe(true); await settled(page)
  await expect(changes).toContainText('Requested: Ask the supplier for the last three sooner')
  await expect(changes.getByRole('button', { name: 'Record decision', exact: true })).toHaveCount(0)
  await shot(page, 'requested')
})
