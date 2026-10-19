import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787'
const card = (page: Page, name: string) => page.locator('section.card').filter({ has: page.getByRole('heading', { name, exact: true }) })
const state = (page: Page) => page.evaluate(async () => (await fetch('/api/larder/state')).json())
async function command(page: Page, type: string, payload: object) {
  const res = await page.request.post(origin + '/api/larder/commands', { headers: { Origin: origin }, data: { commandId: crypto.randomUUID(), type, payload } })
  const body = await res.json(); expect(body.ok, JSON.stringify(body.error)).toBe(true); return body.result
}
async function act(page: Page, click: () => Promise<unknown>, error?: string) {
  const response = page.waitForResponse(r => r.url() === origin + '/api/larder/commands' && r.request().method() === 'POST')
  await click(); const body = await (await response).json()
  if (error) expect(body.error.code).toBe(error); else expect(body.ok, JSON.stringify(body.error)).toBe(true)
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false'); return body.result
}
async function shot(page: Page, name: string) {
  if (!process.env.LARDER_SCREENSHOTS) return
  await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true })
  await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${page.viewportSize()!.width}-STOCK-002-${name}.png`), fullPage: true })
}

test('STOCK-002 schedule, blind count, busy-bin stale refusal, recount and independent valued approval at 1440/390', async ({ page, browser }) => {
  const runId = crypto.randomUUID().slice(0, 8)
  const email = `counter-stock002-${runId}@example.test`
  const entry = process.env.LARDER_OPEN
  if (!entry) throw new Error('A private local entry is required.')
  try { await page.goto(entry); await page.waitForURL(u => ['/app', '/setup'].includes(u.pathname)) } catch { throw new Error('Local owner entry failed.') }
  if (new URL(page.url()).pathname === '/setup') {
    await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app')
  }
  const invite = await page.request.post(origin + '/auth/invite', { headers: { Origin: origin }, data: { email, displayName: 'Bea Warehouse', role: 'member' } })
  expect(invite.status()).toBe(202)
  // The native local one-click door accepts this real invitation and issues
  // a separate cookie. No product state or authentication is mocked.
  const counterContext = await browser.newContext({ storageState: await page.context().storageState() })
  const counter = await counterContext.newPage()
  try {
    await counter.goto(origin + '/auth/dev/enter?as=' + encodeURIComponent(email))
    await counter.waitForURL(u => ['/app', '/setup'].includes(u.pathname))
    const native = await (await counter.request.get(origin + '/auth/session')).json()
    await command(page, 'role.set', { operatorId: native.operator.id, role: 'warehouse' })
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 }); await counter.setViewportSize({ width, height: 1000 })
      const location = await command(page, 'location.save', { name: `Count bin ${width} ${runId}` })
      const item = await command(page, 'item.save', { sku: `STOCK-002-${width}-${runId}`, name: `Machined spacer ${width}`, kind: 'buy', baseUnit: 'each', standardCost: '12.5' })
      await command(page, 'opening.record', { locationId: location.id, countedOn: new Date().toISOString().slice(0, 10), valuationBasis: 'supplier-invoice', countedBy: 'Olive', evidence: { name: 'count.txt', contentType: 'text/plain', base64: Buffer.from('Verified receiving sheet').toString('base64') }, lines: [{ itemId: item.id, quantity: '10', unitCost: '12.5' }] })
      const supplier = await command(page, 'party.save', { name: `Spacer supply ${width} ${runId}`, kind: 'supplier' })
      const po = await command(page, 'po.draft', { supplierId: supplier.id, expectedDate: new Date().toISOString().slice(0, 10), reason: 'Stocktake concurrent delivery', lines: [{ itemId: item.id, quantity: '2', unitPrice: '12.5' }] })
      const approved = await command(page, 'po.approve', { poId: po.id, version: po.version })
      await page.goto(origin + '/app#stock'); await page.reload()
      const schedule = card(page, 'Cycle counts and stocktake')
      await schedule.getByLabel('Count location', { exact: true }).selectOption(location.id)
      await schedule.getByLabel('Scheduled on', { exact: true }).fill(new Date().toISOString().slice(0, 10))
      await schedule.getByLabel('Assigned counter', { exact: true }).selectOption(native.operator.id)
      await schedule.getByLabel('Recount tolerance (quantity)', { exact: true }).fill('2')
      const session = await act(page, () => schedule.getByRole('button', { name: 'Schedule count', exact: true }).click())
      await shot(page, 'scheduled')
      await counter.goto(origin + '/app#stock'); await counter.reload()
      await expect(counter.getByRole('heading', { name: 'Blind counts', exact: true })).toBeVisible()
      expect((await state(counter)).positions).toEqual([])
      await counter.getByLabel('Counted quantity', { exact: true }).fill('9')
      await shot(counter, 'blind')
      await act(counter, () => counter.getByRole('button', { name: 'Submit count', exact: true }).click())
      await command(page, 'receipt.create', { poId: po.id, supplierReference: 'BUSY-BIN', lines: [{ lineId: approved.lines[0].id, quantity: '2', locationId: location.id, inspection: 'accept' }] })
      await page.reload()
      const current = card(page, 'Cycle counts and stocktake').locator('section').filter({ has: page.getByRole('heading', { name: new RegExp(session.reference) }) })
      await act(page, () => current.getByRole('button', { name: 'Approve adjustment', exact: true }).click(), 'STALE_COUNT')
      await expect(page.getByRole('alert')).toBeVisible(); await shot(page, 'stale')
      await current.getByLabel('Recount reason', { exact: true }).fill('Delivery arrived during count')
      await act(page, () => current.getByRole('button', { name: 'Request fresh count', exact: true }).click())
      await counter.reload(); await counter.getByLabel('Counted quantity', { exact: true }).fill('11')
      await act(counter, () => counter.getByRole('button', { name: 'Submit fresh count', exact: true }).click())
      await page.reload(); await current.getByRole('button', { name: 'Count history (2)', exact: true }).click(); await shot(page, 'reconciliation')
      await act(page, () => current.getByRole('button', { name: 'Approve adjustment', exact: true }).click())
      await expect(current.getByText('Complete', { exact: true })).toBeVisible()
      const s = await state(page), count = s.counts.find((c: any) => c.sessionId === session.id && c.status === 'adjusted')
      expect(count.variance).toBe('-1'); expect(count.valueVariance).toBe('-12.5'); expect(count.approvedBy).not.toBe(count.createdBy)
      await shot(page, 'approved')
      await counter.reload(); await expect(counter.getByRole('heading', { name: 'Stock on hand', exact: true })).toBeVisible()
      await shot(counter, 'counter-complete')
    }
  } finally { await counterContext.close() }
})
