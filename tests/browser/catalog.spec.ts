import { test, expect, type Page } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787'
const csv = (rows: any[][]) => rows.map(row => row.map(v => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n'
function readCsv(input: string) {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < input.length; i++) { const c = input[i]; if (c === '"') { if (quoted && input[i + 1] === '"') { cell += '"'; i++ } else quoted = !quoted } else if (c === ',' && !quoted) { row.push(cell); cell = '' } else if (c === '\n' && !quoted) { row.push(cell); rows.push(row); row = []; cell = '' } else if (c !== '\r' || quoted) cell += c }
  return rows.map(row => row.map(v => v.startsWith("'") ? v.slice(1) : v))
}
async function command(page: Page, type: string, payload: object) {
  const res = await page.request.post(origin + '/api/larder/commands', { headers: { Origin: origin }, data: { commandId: crypto.randomUUID(), type, payload } })
  const body = await res.json(); expect(body.ok, JSON.stringify(body.error)).toBe(true); return body.result
}
async function settled(page: Page) { await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false'); await expect(page.getByRole('alert')).toHaveCount(0) }
async function shots(page: Page, stage: string, region: ReturnType<Page['locator']>) {
  if (!process.env.LARDER_SCREENSHOTS) return
  await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true })
  for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); await region.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${width}-ENG-007-${stage}.png`) }) }
}

test('ENG-007 real catalog export/edit/preview/approve/re-export with two locations, errors, preserved history and stale refusal at 1440/390', async ({ page }) => {
  if (!process.env.LARDER_OPEN) throw new Error('Private local owner entry required.')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/app', '/setup'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  const suffix = crypto.randomUUID().slice(0, 6), ohio = await command(page, 'location.save', { name: `Ohio stores ${suffix}` }), dispatch = await command(page, 'location.save', { name: `Dispatch bin ${suffix}` })
  const supplier = await command(page, 'party.save', { name: `Components Co ${suffix}`, kind: 'supplier' }), customer = await command(page, 'party.save', { name: `Equipment Works ${suffix}`, kind: 'customer' })
  const item = async (sku: string, finish?: string) => command(page, 'item.save', { sku: `${sku}-${suffix}`, name: `${sku} bracket ${suffix}`, kind: 'buy', baseUnit: 'each', template: finish ? `Bracket ${suffix}` : '', attributes: finish ? { Finish: finish } : {}, salePrice: '20', category: 'Hardware', conversions: [{ unit: 'pair', factor: '2' }] })
  const left = await item('Left', 'Black'), right = await item('Right', 'White'), invalid = await item('Invalid supplier'), fixed = await item('Fixed unit')
  await command(page, 'opening.record', { locationId: ohio.id, countedOn: new Date().toISOString().slice(0, 10), countedBy: 'Olive', valuationBasis: 'supplier-invoice', evidence: { name: 'opening.txt', contentType: 'text/plain', base64: Buffer.from('Counted bracket stock').toString('base64') }, lines: [{ itemId: left.id, quantity: '10', unitCost: '3' }, { itemId: fixed.id, quantity: '2', unitCost: '3' }] })
  const quote = await command(page, 'so.quote', { customerId: customer.id, promiseDate: '2026-12-15', lines: [{ itemId: left.id, quantity: '2' }] })
  const confirmed = await command(page, 'so.confirm', { orderId: quote.id, version: quote.version, reserve: true })
  await page.goto(origin + '/app#more/setup'); await page.reload(); await settled(page)
  const catalog = page.getByRole('heading', { name: 'Catalog CSV', exact: true }).locator('../..')
  const download = page.waitForEvent('download'); await catalog.getByRole('link', { name: 'Download active catalog CSV', exact: true }).click()
  const file = await download, path = await file.path(), original = await readFile(path!, 'utf8'), header = readCsv(original)[0]
  const ownRows = readCsv(original).slice(1).filter(row => [left.id, right.id].includes(row[header.indexOf('larder_id')]))
  expect(ownRows.some(row => row[header.indexOf('location_id')] === ohio.id)).toBe(true); expect(ownRows.some(row => row[header.indexOf('location_id')] === dispatch.id)).toBe(true)
  const change = (i: any, loc: any, values: any) => header.map(k => ({ larder_id: i.id, location_id: loc.id, ...values })[k] ?? '')
  const content = csv([header, change(left, ohio, { sale_price: '29.5', reorder_point: '5', preferred_supplier_id: supplier.id, supplier_code: `LEFT-${suffix}`, purchase_price: '8', purchase_unit: 'pair' }), change(left, dispatch, { reorder_point: '7' }), change(right, ohio, { sale_price: '31', reorder_point: '6', preferred_supplier_id: supplier.id, supplier_code: `RIGHT-${suffix}`, purchase_price: '9', purchase_unit: 'pair' }), change(right, dispatch, { reorder_point: '8' }), change(invalid, ohio, { preferred_supplier_id: 'not-a-supplier', supplier_code: 'BAD' }), change(fixed, ohio, { base_unit: 'feet' })])
  const filename = `catalog-${suffix}.csv`
  async function upload(name: string, data: string) {
    await catalog.getByLabel('Edited catalog CSV', { exact: true }).setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(data) })
    const response = page.waitForResponse(r => r.url().endsWith('/api/larder/commands') && r.request().postDataJSON()?.type === 'catalog.bulkPreview')
    await catalog.getByRole('button', { name: 'Preview catalog changes', exact: true }).click(); expect((await (await response).json()).ok).toBe(true); await settled(page)
  }
  await shots(page, 'upload', catalog); await upload(filename, content)
  let preview = page.getByRole('heading', { name: `${filename} · preview`, exact: true }).locator('../..')
  await expect(preview).toContainText('2 row errors'); await expect(preview).toContainText('Unknown supplier'); await expect(preview).toContainText('already in use')
  await expect(preview).toContainText('29.5'); await expect(preview).toContainText('Sales price'); await expect(preview).toContainText('Reorder point')
  await preview.getByText(`Affected records for ${left.sku}`, { exact: true }).click(); await expect(preview).toContainText(confirmed.reference)
  await shots(page, 'preview-errors-impact', preview)
  const before = await (await page.request.get(origin + '/api/larder/state')).json()
  await preview.getByRole('checkbox').check(); await preview.getByRole('button', { name: 'Approve catalog changes', exact: true }).click(); await settled(page)
  const approved = page.getByRole('heading', { name: `${filename} · approved`, exact: true }).locator('../..'); await shots(page, 'approved', approved)
  const after = await (await page.request.get(origin + '/api/larder/state')).json()
  expect(after.items.find((i: any) => i.id === left.id).salePrice).toBe('29.5'); expect(after.items.find((i: any) => i.id === left.id).category).toBe('Hardware')
  expect(after.movements).toEqual(before.movements); expect(after.reservations).toEqual(before.reservations); expect(after.salesOrders).toEqual(before.salesOrders)
  const again = page.waitForEvent('download'); await catalog.getByRole('link', { name: 'Download active catalog CSV', exact: true }).click()
  const result = await again, resultPath = await result.path(), reexport = readCsv(await readFile(resultPath!, 'utf8'))
  const exported = reexport.slice(1).find(row => row[header.indexOf('larder_id')] === left.id && row[header.indexOf('location_id')] === ohio.id)!
  expect(exported[header.indexOf('sale_price')]).toBe('29.5'); expect(exported[header.indexOf('reorder_point')]).toBe('5'); expect(exported[header.indexOf('preferred_supplier_id')]).toBe(supplier.id)
  const staleName = `stale-${suffix}.csv`; await upload(staleName, csv([header, change(right, ohio, { sale_price: '40' })]))
  await command(page, 'location.save', { name: `New receiving bay ${suffix}` }); await page.reload(); await settled(page)
  preview = page.getByRole('heading', { name: `${staleName} · preview`, exact: true }).locator('../..')
  await expect(preview).toContainText('Records changed'); await expect(preview.getByRole('button', { name: 'Approve catalog changes', exact: true })).toBeDisabled(); await shots(page, 'stale-refusal', preview)
  const final = await (await page.request.get(origin + '/api/larder/state')).json(); expect(final.items.find((i: any) => i.id === right.id).salePrice).toBe('31')
  const serial = await item('Serial configuration')
  const serialFile = `serial-${suffix}.csv`
  await upload(serialFile, csv([header, change(serial, ohio, { tracking: 'serial' })]))
  const serialPreview = page.getByRole('heading', { name: `${serialFile} · preview`, exact: true }).locator('../..')
  await expect(serialPreview).toContainText('serial policy configured; serial execution not yet available')
  await shots(page, 'serial-preview', serialPreview)
  await serialPreview.getByRole('button', { name: 'Approve catalog changes', exact: true }).click(); await settled(page)
  await expect(catalog).toContainText('serial policy configured; serial execution not yet available'); await shots(page, 'serial-configured', catalog)
  const policy = await (await page.request.get(origin + '/api/larder/state')).json(); expect(policy.items.find((i: any) => i.id === serial.id).tracking).toBe('serial')
})
