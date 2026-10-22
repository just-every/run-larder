import { test, expect } from '@playwright/test'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787'

test('MOVE-007 preview shows the stock valuation to the cent and the cutover is rehearsed twice at 1440/390', async ({ page }) => {
  if (!process.env.LARDER_OPEN) throw new Error('Private local entry required.')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/setup', '/app'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  const settled = async () => { await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false'); await expect(page.getByRole('alert')).toHaveCount(0) }
  const shots = async (stage: string) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      if (process.env.LARDER_SCREENSHOTS) { await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${width}-MOVE-007-${stage}.png`), fullPage: true }) }
    }
  }
  // Nothing here commits: later journeys move the same Odoo files in.
  const files = await Promise.all((await readdir('fixtures/odoo')).filter(n => n.endsWith('.csv')).map(async name => ({ name, mimeType: 'text/csv', buffer: await readFile(join('fixtures/odoo', name)) })))
  const clean = files.map(f => f.name === 'stock.quant.csv' ? { ...f, buffer: Buffer.from(f.buffer.toString('utf8').split('\n').slice(0, 4).join('\n') + '\n') } : f)
  const preview = async (label: string, upload: typeof files) => {
    await page.goto(origin + '/app#more/move-in'); await settled()
    const form = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Preview an Odoo export', exact: true }) })
    await form.getByLabel('Label', { exact: true }).fill(label)
    await form.locator('input[name="files"]').setInputFiles(upload)
    await form.getByLabel('Opening count date', { exact: true }).fill('2026-10-01')
    await form.getByLabel('Counted by', { exact: true }).fill('Olive')
    await form.getByLabel('Valuation basis', { exact: true }).selectOption('standard-cost')
    await form.getByRole('button', { name: 'Preview move-in', exact: true }).click(); await settled()
    return page.getByRole('region', { name: 'Stock valuation' })
  }
  // Matched shows only at a zero difference.
  const matched = await preview('Clean Odoo source', clean)
  await expect(matched).toContainText('Matched to the cent'); await expect(matched).not.toContainText('Difference blocks cutover')
  await expect(matched).toContainText('430.00'); await expect(matched).toContainText('0.00')
  await shots('matched')
  // A nonzero difference shows both totals, the exact difference and the rows to review, and blocks cutover.
  const valuation = await preview('Odoo October cutover', files)
  await expect(valuation).toContainText('Difference blocks cutover'); await expect(valuation).not.toContainText('Matched to the cent')
  await expect(valuation).toContainText('446.00'); await expect(valuation).toContainText('430.00'); await expect(valuation).toContainText('−$16.00')
  await expect(valuation.getByText('Rows to review', { exact: true })).toBeVisible()
  await expect(valuation.getByRole('cell', { name: 'Not moved', exact: true })).toBeVisible(); await expect(valuation.getByRole('cell', { name: 'Unvalued', exact: true })).toBeVisible()
  await shots('valuation')
  await page.goto(origin + '/app#more/cutover'); await settled()
  const plan = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Plan a cutover', exact: true }) })
  await plan.getByLabel('Label', { exact: true }).fill('Odoo cutover')
  await plan.getByLabel('Move-in', { exact: true }).selectOption({ label: 'Odoo October cutover (Previewed)' })
  await plan.getByRole('button', { name: 'Plan cutover', exact: true }).click(); await settled()
  for (let n = 1; n <= 2; n++) { await page.getByRole('button', { name: 'Rehearse again (changes nothing)', exact: true }).click(); await settled() }
  await expect(page.getByText('2 · last two identical')).toBeVisible()
  await expect(page.getByText('rows to review').first()).toBeVisible()
  await shots('rehearsed')
})
