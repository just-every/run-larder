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
  await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${page.viewportSize()!.width}-TRACE-004-${name}.png`), fullPage: true })
}
const form = (page: Page, title: string) => page.locator('form').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
const card = (page: Page, title: string) => page.locator('section.card').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
const open = async (page: Page, hash: string) => { await page.goto(origin + `/app#${hash}`); await page.reload(); await settled(page) }

test('TRACE-004 define and approve a fill-weight plan, record passing and failing batches, see the dispatch hold, retest and release at 1440/390', async ({ page }) => {
  const runId = crypto.randomUUID().slice(0, 6), entry = process.env.LARDER_OPEN
  if (!entry) throw new Error('A private local entry is required.')
  await page.goto(entry); await page.waitForURL(u => ['/app', '/setup'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  await settled(page)
  const me = (await (await page.request.get(origin + '/api/larder/state')).json()).actor.id
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const tag = `${width}-${runId}`, line = await command(page, 'location.save', { name: `Fill line ${tag}` })
    const base = await command(page, 'item.save', { sku: `BASE-${tag}`, name: `Balm base ${tag}`, kind: 'buy', baseUnit: 'each' })
    const tin = await command(page, 'item.save', { sku: `TIN-${tag}`, name: `Balm tin ${tag}`, kind: 'make', baseUnit: 'each' })
    await command(page, 'bom.revise', { itemId: tin.id, components: [{ itemId: base.id, quantity: '1' }], routing: [{ name: 'Fill', workCentre: 'Filler', minutes: 1 }, { name: 'Lid', workCentre: 'Capper', minutes: 1 }] })
    await command(page, 'opening.record', { locationId: line.id, countedOn: today, valuationBasis: 'supplier-invoice', countedBy: 'Olive', evidence: { name: 'count.txt', contentType: 'text/plain', base64: Buffer.from('Count').toString('base64') }, lines: [{ itemId: base.id, quantity: '40', unitCost: '1' }] })

    // Define and approve the sampling rule on screen.
    await open(page, 'make/quality')
    const plan = card(page, 'New inspection plan')
    await plan.getByLabel('Item', { exact: true }).selectOption(tin.id); await plan.getByLabel('Stage', { exact: true }).selectOption('in-process')
    await plan.getByLabel('After operation', { exact: true }).fill('1'); await plan.getByLabel('Plan name', { exact: true }).fill(`Fill weight ${tag}`); await plan.getByLabel('Sample size', { exact: true }).fill('20')
    for (const [label, value] of [['Measurement', 'Fill weight'], ['Unit', 'oz'], ['Target', '4.0'], ['Lower limit', '3.95'], ['Upper limit', '4.15']]) await plan.getByLabel(label, { exact: true }).fill(value)
    await plan.locator('input[type=file]').setInputFiles({ name: `fill-spec-${tag}.txt`, mimeType: 'text/plain', buffer: Buffer.from('Fill 4.0 oz, limits 3.95-4.15 oz') })
    await plan.getByRole('button', { name: 'Save plan', exact: true }).click(); await settled(page)
    await page.getByRole('button', { name: `Approve plan Fill weight ${tag}`, exact: true }).click(); await settled(page)
    const planRow = card(page, 'Inspection plans').locator('tr').filter({ hasText: `Fill weight ${tag}` })
    await expect(planRow).toContainText('Approved'); await expect(planRow).toContainText('20 sampled · Fill weight target 4 oz · limits 3.95–4.15'); await expect(planRow).toContainText(`fill-spec-${tag}.txt`)
    await shot(page, 'plan-approved')

    const batch = async (lot: string) => {
      const draft = await command(page, 'wo.draft', { itemId: tin.id, quantity: '20', requiredBy: today, reason: `Batch ${lot}` })
      let w = await command(page, 'wo.release', { workOrderId: draft.id, version: draft.version })
      for (const sequence of [1, 2]) w = await command(page, 'wo.operation.assign', { workOrderId: w.id, version: w.version, sequence, operatorId: me })
      w = await command(page, 'wo.operation.start', { workOrderId: w.id, version: w.version, sequence: 1, workCentre: 'Filler', station: 'Filler 1', reason: 'Fill tins' })
      w = await command(page, 'wo.output', { workOrderId: w.id, version: w.version, locationId: line.id, quantity: '20', lot })
      await open(page, `make/wo/${w.id}`)
      return w
    }
    const record = async (weights: string[]) => {
      const f = form(page, `Record Fill weight ${tag}`)
      await f.getByLabel('Fill weight samples (oz)', { exact: true }).fill(weights.join(' '))
      await f.locator('input[type=file]').setInputFiles({ name: `scale-${tag}.csv`, mimeType: 'text/csv', buffer: Buffer.from(weights.join('\n')) })
      await f.getByRole('button', { name: 'Record inspection', exact: true }).click(); await settled(page)
    }

    // A passing set: count, mean and pass against the approved limits on the batch.
    const good = await batch(`BB-${tag}`)
    await record([...Array(10).fill('4.02'), ...Array(10).fill('4.04')])
    const goodResults = page.getByRole('region', { name: `Inspection results for ${good.reference}` })
    for (const t of ['20 sampled', 'avg 4.03 oz', 'limits 3.95–4.15', 'Passed', `scale-${tag}.csv`]) await expect(goodResults).toContainText(t)
    await expect(card(page, 'Quality checks')).toContainText(`lot BB-${tag} (Released)`)
    await shot(page, 'batch-passed')

    // A failing set holds the lot and the job's next operation.
    const bad = await batch(`BX-${tag}`)
    await record([...Array(18).fill('4.01'), '3.9', '3.92'])
    const badResults = page.getByRole('region', { name: `Inspection results for ${bad.reference}` })
    for (const t of ['20 sampled', 'avg 4 oz', 'Failed · 2 outside']) await expect(badResults).toContainText(t)
    await expect(card(page, 'Quality checks')).toContainText(`lot BX-${tag} (Quality hold)`)
    await expect(page.getByRole('status').filter({ hasText: 'Quality hold: Fill weight' })).toContainText(`Held 20 of lot BX-${tag} in quarantine.`)
    await shot(page, 'batch-held')
    await open(page, 'make/dispatch')
    const lid = card(page, `${bad.reference} · Lid`)
    await expect(lid).toContainText('Blocked'); await expect(lid).toContainText(`Quality hold: Fill weight ${tag} failed on ${today} (Fill weight 2 of 20 outside 3.95–4.15 oz, mean 4)`)
    await expect(lid.getByRole('button', { name: 'Start step 2', exact: true })).toBeDisabled()
    await shot(page, 'dispatch-hold')

    // Retest, then the authorized release keeps both results and unblocks the operation.
    await open(page, `make/wo/${bad.id}`)
    await record([...Array(20).fill('4.03')])
    await expect(badResults.getByText('Retest', { exact: true })).toBeVisible()
    const release = form(page, `Release hold Fill weight ${tag}`)
    await release.getByLabel('Release reason', { exact: true }).fill('Refilled and retested')
    await release.locator('input[type=file]').setInputFiles({ name: `retest-${tag}.txt`, mimeType: 'text/plain', buffer: Buffer.from('Retest passed') })
    await release.getByRole('button', { name: 'Release after passing retest', exact: true }).click(); await settled(page)
    await expect(card(page, 'Quality checks')).toContainText(`after a passing retest: Refilled and retested · evidence retest-${tag}.txt`)
    await expect(card(page, 'Quality checks')).toContainText(`lot BX-${tag} (Released)`)
    await expect(badResults.locator('tr')).toHaveCount(3)
    await shot(page, 'released')
    await open(page, 'make/dispatch')
    await expect(card(page, `${bad.reference} · Lid`)).toContainText('Ready')
  }
})
