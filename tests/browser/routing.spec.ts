import { drawing } from './drawing'
import { test, expect, type Page } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787'
const today = () => new Date().toISOString().slice(0, 10)
async function command(page: Page, type: string, payload: object) {
  const res = await page.request.post(origin + '/api/larder/commands', { headers: { Origin: origin }, data: { commandId: crypto.randomUUID(), type, payload } })
  const body = await res.json(); expect(body.ok, JSON.stringify(body.error)).toBe(true); return body.result
}
async function open(page: Page, path: string) {
  // Load API-created records before navigating, so reload cannot discard a
  // fragment selected while the previous document is still hydrating.
  await page.reload(); await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false')
  await page.goto(origin + '/app#' + path); await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false')
}
async function shot(page: Page, stage: string) {
  if (!process.env.LARDER_SCREENSHOTS) return
  await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true })
  await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${page.viewportSize()!.width}-ENG-002-${stage}.png`), fullPage: true })
}
test('ENG-002 author routing, open tablet tasks/drawing, execute dependencies and retain instructions after revision at 1440/390', async ({ page }) => {
  if (!process.env.LARDER_OPEN) throw new Error('A private local owner entry is required.')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/app', '/setup'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false')
  const suffix = crypto.randomUUID().slice(0, 6)
  const raw = await command(page, 'item.save', { sku: `PLATE-${suffix}`, name: `Steel blank ${suffix}`, kind: 'buy', baseUnit: 'each', standardCost: '12' })
  const product = await command(page, 'item.save', { sku: `BRACKET-${suffix}`, name: `Machine bracket ${suffix}`, kind: 'make', baseUnit: 'each' })
  const loc = await command(page, 'location.save', { name: `Fabrication rack ${suffix}` })
  await command(page, 'opening.record', { locationId: loc.id, countedOn: today(), countedBy: 'Olive', valuationBasis: 'supplier-invoice', evidence: { name: 'count.txt', contentType: 'text/plain', base64: Buffer.from('Counted 10 steel blanks').toString('base64') }, lines: [{ itemId: raw.id, quantity: '10', unitCost: '12' }] })
  const pdfA = drawing('BRACKET rev A'), pdfB = drawing('BRACKET rev B')
  async function edit(instructions: string, file: Buffer) {
    await open(page, 'make/boms')
    const form = page.getByRole('heading', { name: 'New revision', exact: true }).locator('../..')
    await form.getByLabel('Item', { exact: true }).selectOption(product.id)
    await form.getByLabel('Component 1', { exact: true }).selectOption(raw.id)
    await form.getByLabel('Quantity', { exact: true }).nth(0).fill('1')
    await form.locator('textarea[name=routing]').fill('Machine bracket, Router 1, 7.5\nDeburr, Finish bench, 2')
    await form.getByLabel('Step 1 setup minutes', { exact: true }).fill('12')
    await form.getByLabel('Step 1 queue minutes', { exact: true }).fill('5')
    await form.getByLabel('Step 1 eligible centers', { exact: true }).fill('Router 1; Router 2')
    await form.getByLabel('Step 1 required skills', { exact: true }).fill('Router setup')
    await form.getByLabel('Step 1 instructions', { exact: true }).fill(instructions)
    await form.getByLabel('Step 1 drawing file', { exact: true }).setInputFiles({ name: 'bracket.pdf', mimeType: 'application/pdf', buffer: file })
    await form.getByLabel('Step 2 instructions', { exact: true }).fill('Deburr every edge and inspect the finish.')
    for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); await shot(page, instructions.includes('fixture A') ? 'author-A' : 'author-B') }
    const saved = page.waitForResponse(response => response.url().endsWith('/api/larder/commands') && response.request().postDataJSON()?.type === 'bom.revise')
    await form.getByRole('button', { name: 'Save new revision', exact: true }).click()
    expect((await (await saved).json()).ok).toBe(true)
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false')
    await expect(page.getByRole('alert')).toHaveCount(0)
  }
  await edit('Clamp securely in fixture A before machining.', pdfA)
  async function release() {
    const d = await command(page, 'wo.draft', { itemId: product.id, quantity: '2', requiredBy: today(), reason: 'Equipment order' })
    return command(page, 'wo.release', { workOrderId: d.id, version: d.version })
  }
  const first = await release()
  await open(page, `make/wo/${first.id}`)
  const tasks = page.getByRole('region', { name: 'Pinned operation tasks' })
  await expect(tasks).toContainText('fixture A')
  await expect(tasks.getByRole('button', { name: 'Start step 1', exact: true })).toBeDisabled()
  await expect(tasks.getByRole('button', { name: 'Start step 2', exact: true })).toBeDisabled()
  const download = page.waitForEvent('download')
  await tasks.getByRole('link', { name: 'Open drawing: bracket.pdf' }).click()
  const file = await download, path = await file.path(); expect(await readFile(path!)).toEqual(pdfA)
  for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); await shot(page, 'pinned-before') }
  await tasks.getByRole('button', { name: 'Acknowledge step 1 instructions and drawings' }).click()
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false')
  const session = await (await page.request.get(origin + '/api/larder/state')).json()
  await tasks.getByLabel('Step 1 authorized operator', { exact: true }).selectOption(session.actor.id)
  await tasks.getByRole('button', { name: 'Authorize step 1 operator', exact: true }).click()
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false')
  await tasks.getByLabel('Step 1 work center', { exact: true }).selectOption('Router 2')
  await tasks.getByLabel('Step 1 station', { exact: true }).fill('Shared router tablet')
  await tasks.getByLabel('Step 1 start reason', { exact: true }).fill('Fixture A and guards checked')
  await tasks.getByRole('button', { name: 'Start step 1', exact: true }).click()
  await tasks.getByLabel('Step 1 completion reason', { exact: true }).fill('Machined to pinned drawing')
  await tasks.getByRole('button', { name: 'Complete step 1', exact: true }).click()
  await tasks.getByRole('button', { name: 'Acknowledge step 2 instructions and drawings' }).click()
  await tasks.getByLabel('Step 2 authorized operator', { exact: true }).selectOption(session.actor.id)
  await tasks.getByRole('button', { name: 'Authorize step 2 operator', exact: true }).click()
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false')
  await tasks.getByLabel('Step 2 station', { exact: true }).fill('Shared finishing tablet')
  await tasks.getByLabel('Step 2 start reason', { exact: true }).fill('Machining accepted, finish edges')
  await tasks.getByRole('button', { name: 'Start step 2', exact: true }).click()
  await tasks.getByLabel('Step 2 completion reason', { exact: true }).fill('All edges deburred and inspected')
  await tasks.getByRole('button', { name: 'Complete step 2', exact: true }).click()
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false')
  await page.reload(); await expect(tasks.getByText('Done', { exact: true })).toHaveCount(2)
  await edit('Clamp securely in fixture B before machining.', pdfB)
  const second = await release()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 }); await open(page, `make/wo/${first.id}`)
    await expect(tasks).toContainText('fixture A'); await expect(tasks).not.toContainText('fixture B'); await expect(tasks.getByText('Done', { exact: true })).toHaveCount(2); await shot(page, 'old-pin-complete')
    await open(page, `make/wo/${second.id}`); await expect(tasks).toContainText('fixture B'); await expect(tasks.getByRole('button', { name: 'Start step 1', exact: true })).toBeDisabled()
    await expect(tasks.getByRole('button', { name: 'Acknowledge step 1 instructions and drawings' })).toBeVisible(); await shot(page, 'new-pin-unacknowledged')
  }
})
