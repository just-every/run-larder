import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787'
const date = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
const state = (page: Page) => page.evaluate(async () => (await fetch('/api/larder/state')).json())
async function command(page: Page, type: string, payload: object) {
  const res = await page.request.post(origin + '/api/larder/commands', { headers: { Origin: origin }, data: { commandId: crypto.randomUUID(), type, payload } })
  const body = await res.json(); expect(body.ok, JSON.stringify(body.error)).toBe(true); return body.result
}
async function shot(page: Page, stage: string, kind: string) {
  if (!process.env.LARDER_SCREENSHOTS) return
  await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true })
  await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${page.viewportSize()!.width}-DEMAND-006-${stage}-${kind}.png`), fullPage: true })
}
async function act(page: Page, click: () => Promise<unknown>) {
  const response = page.waitForResponse(r => r.url() === origin + '/api/larder/commands' && r.request().method() === 'POST')
  await click(); const body = await (await response).json(); expect(body.ok, JSON.stringify(body.error)).toBe(true)
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false'); return body.result
}

test('DEMAND-006 both ranked lists update material and production status after receipt, ETA and re-rank at 1440/390', async ({ page }) => {
  const entry = process.env.LARDER_OPEN
  if (!entry) throw new Error('A private local entry is required.')
  try { await page.goto(entry); await page.waitForURL(u => ['/app', '/setup'].includes(u.pathname)) } catch { throw new Error('Local owner entry failed.') }
  if (new URL(page.url()).pathname === '/setup') {
    await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app')
  }
  const suffix = crypto.randomUUID().slice(0, 6)
  const location = await command(page, 'location.save', { name: `Alloy rack ${suffix}` })
  const raw = await command(page, 'item.save', { sku: `ALLOY-${suffix}`, name: 'Alloy bar stock', kind: 'buy', baseUnit: 'each', standardCost: '5' })
  const supplier = await command(page, 'party.save', { name: `Industrial metals ${suffix}`, kind: 'supplier' })
  const customer = await command(page, 'party.save', { name: `Equipment workshop ${suffix}`, kind: 'customer' })
  await command(page, 'opening.record', { locationId: location.id, countedOn: date(0), countedBy: 'Olive', valuationBasis: 'supplier-invoice', evidence: { name: 'stock.txt', contentType: 'text/plain', base64: Buffer.from('Verified alloy rack opening').toString('base64') }, lines: [{ itemId: raw.id, quantity: '2', unitCost: '5' }] })
  const works: any[] = [], sales: any[] = [], purchases: any[] = []
  for (let i = 0; i < 3; i++) {
    const item = await command(page, 'item.save', { sku: `PEG-${suffix}-${i}`, name: ['Turned pin', 'Machined spacer', 'Locating peg'][i], kind: 'make', baseUnit: 'each', salePrice: '20' })
    await command(page, 'bom.revise', { itemId: item.id, components: [{ itemId: raw.id, quantity: '1' }] })
    let work = await command(page, 'wo.draft', { itemId: item.id, quantity: '2', requiredBy: date(5 + i), reason: 'Customer machined parts' })
    work = await command(page, 'wo.release', { workOrderId: work.id, version: work.version })
    work = await command(page, 'order.rank', { kind: 'work', orderId: work.id, version: work.version, rank: i + 1 }); works.push(work)
    let sale = await command(page, 'so.quote', { customerId: customer.id, promiseDate: date(10), lines: [{ itemId: item.id, quantity: '2' }] })
    sale = await command(page, 'so.confirm', { orderId: sale.id, version: sale.version, reserve: false })
    sale = await command(page, 'order.rank', { kind: 'sales', orderId: sale.id, version: sale.version, rank: i + 1 }); sales.push(sale)
  }
  for (let i = 1; i <= 2; i++) {
    const po = await command(page, 'po.draft', { supplierId: supplier.id, expectedDate: date(i), reason: 'Common alloy demand', lines: [{ itemId: raw.id, quantity: '2', unitPrice: '5' }] })
    purchases.push(await command(page, 'po.approve', { poId: po.id, version: po.version }))
  }
  async function lists(stage: string, expected: string[]) {
    const s = await state(page)
    for (const width of [1440, 390]) for (const kind of ['sales', 'work']) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(origin + (kind === 'sales' ? '/app#orders' : '/app#make/wo')); await page.reload()
      const records = kind === 'sales' ? sales : works
      const prefix = kind === 'sales' ? 'SO' : 'MO'
      await expect(page.getByLabel(`${prefix} sort`, { exact: true })).toBeVisible()
      for (let i = 0; i < 3; i++) {
        const record = records[i], current = s.orderStatuses[kind].find((o: any) => o.id === record.id)
        expect(current.ingredientStatus).toBe(expected[i])
        const row = page.getByRole('row').filter({ has: page.locator(`a[href="${kind === 'sales' ? '#orders/' : '#make/wo/'}${record.id}"]`) })
        await expect(row.getByText(expected[i], { exact: true }).first()).toBeVisible()
        for (const line of current.lines) for (const supply of [...line.supplies, ...(line.supplyingWork ?? []).flatMap((w: any) => w.lines.flatMap((l: any) => l.supplies))]) {
          if (supply.kind !== 'purchase' || expected[i] !== 'Expected') continue
          expect(supply.date).toBe(s.purchaseOrders.find((p: any) => p.id === supply.documentId).expectedDate)
          await expect(row.getByRole('link', { name: supply.reference, exact: true }).first()).toBeVisible()
        }
      }
      const ownRows = page.getByRole('row').filter({ has: page.locator(records.map(record => `a[href="${kind === 'sales' ? '#orders/' : '#make/wo/'}${record.id}"]`).join(',')) })
      const orderedReferences = () => ownRows.locator('td:first-child > a').allTextContents()
      const ranked = [...records].sort((a, b) => s.orderStatuses[kind].find((o: any) => o.id === a.id).rank - s.orderStatuses[kind].find((o: any) => o.id === b.id).rank)
      expect(await orderedReferences()).toEqual(ranked.map(r => r.reference))
      await page.getByLabel(`${prefix} sort`, { exact: true }).selectOption('material')
      const materialOrder = ['In stock', 'Expected', 'Not available', 'No BOM']
      const byMaterial = [...ranked].sort((a, b) => materialOrder.indexOf(expected[records.indexOf(a)]) - materialOrder.indexOf(expected[records.indexOf(b)]))
      expect(await orderedReferences()).toEqual(byMaterial.map(r => r.reference))
      await page.getByLabel(`${prefix} sort`, { exact: true }).selectOption('rank')
      await shot(page, stage, kind)
      await page.getByLabel(`${prefix} ingredient status`, { exact: true }).selectOption('Expected')
      for (let i = 0; i < 3; i++) {
        const link = page.locator(`a[href="${kind === 'sales' ? '#orders/' : '#make/wo/'}${records[i].id}"]`).first()
        if (expected[i] === 'Expected') await expect(link).toBeVisible(); else await expect(link).toHaveCount(0)
      }
      await page.getByLabel(`${prefix} ingredient status`, { exact: true }).selectOption('all')
      await page.getByLabel(`${prefix} maximum rank`, { exact: true }).fill('1')
      for (const record of records) {
        const link = page.locator(`a[href="${kind === 'sales' ? '#orders/' : '#make/wo/'}${record.id}"]`).first()
        if (s.orderStatuses[kind].find((o: any) => o.id === record.id).rank <= 1) await expect(link).toBeVisible(); else await expect(link).toHaveCount(0)
      }
      await page.getByLabel(`${prefix} sort`, { exact: true }).selectOption('production')
      await page.getByLabel(`${prefix} maximum rank`, { exact: true }).fill('')
      await page.getByLabel(`${prefix} production status`, { exact: true }).selectOption('not started')
      await page.getByLabel(`${prefix} production status`, { exact: true }).selectOption('all')
    }
  }
  await lists('initial', ['In stock', 'Expected', 'Expected'])
  await command(page, 'receipt.create', { poId: purchases[0].id, supplierReference: 'PARTIAL', lines: [{ lineId: purchases[0].lines[0].id, quantity: '1', locationId: location.id, inspection: 'accept' }] })
  await command(page, 'receipt.create', { poId: purchases[1].id, supplierReference: 'HELD', lines: [{ lineId: purchases[1].lines[0].id, quantity: '1', locationId: location.id, inspection: 'quarantine', lot: 'REJECTED-HEAT' }] })
  await lists('receipt', ['In stock', 'Expected', 'Not available'])
  let s = await state(page)
  await command(page, 'po.revise', { poId: purchases[0].id, version: s.purchaseOrders.find((p: any) => p.id === purchases[0].id).version, expectedDate: date(8), note: 'Mill delay' })
  await lists('eta', ['In stock', 'Expected', 'Not available'])
  // Re-rank in the actual list UI; the protected reservation stays with the
  // first job while the other two exchange scarce future supply.
  await page.goto(origin + '/app#make/wo'); await page.reload()
  const rankRow = page.getByRole('row').filter({ has: page.locator(`a[href="#make/wo/${works[2].id}"]`) })
  await rankRow.getByText(`Update ${works[2].reference}`, { exact: true }).click()
  await rankRow.getByLabel(`${works[2].reference} rank`, { exact: true }).fill('2')
  await act(page, () => rankRow.getByRole('button', { name: 'Save rank', exact: true }).click())
  s = await state(page)
  await command(page, 'order.rank', { kind: 'work', orderId: works[1].id, version: s.workOrders.find((w: any) => w.id === works[1].id).version, rank: 4 })
  await lists('reranked', ['In stock', 'Not available', 'Expected'])
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 }); await page.goto(origin + '/app#make/wo'); await page.reload()
    const row = page.getByRole('row').filter({ has: page.locator(`a[href="#make/wo/${works[2].id}"]`) })
    await row.getByText(`Update ${works[2].reference}`, { exact: true }).click()
    await shot(page, 'completion-edit', 'work')
    if (width === 390) {
      await row.getByLabel(`${works[2].reference} expected completion`, { exact: true }).fill(date(9))
      await act(page, () => row.getByRole('button', { name: 'Save expected completion', exact: true }).click())
    }
  }
  await lists('completion-eta', ['In stock', 'Not available', 'Expected'])
  s = await state(page)
  expect(s.workOrders.find((w: any) => w.id === works[2].id).expectedOn).toBe(date(9))
  expect(s.orderStatuses.sales.find((o: any) => o.id === sales[2].id).lines[0].supplies.find((p: any) => p.kind === 'work').date).toBe(date(9))
  expect(s.reservations.filter((r: any) => r.demandId === works[0].id).reduce((n: number, r: any) => n + Number(r.quantity), 0)).toBe(2)
  expect(s.salesOrders.filter((o: any) => sales.some(x => x.id === o.id)).every((o: any) => o.promiseDate === date(10))).toBe(true)
})
