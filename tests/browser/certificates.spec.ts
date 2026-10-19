import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787'
async function command(page: Page, type: string, payload: object) {
  const r = await page.request.post(origin + '/api/larder/commands', { headers: { Origin: origin }, data: { commandId: crypto.randomUUID(), type, payload } })
  const b = await r.json(); expect(b.ok, JSON.stringify(b.error)).toBe(true); return b.result
}
async function settled(page: Page) { await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false'); await expect(page.getByRole('alert')).toHaveCount(0) }
async function shots(page: Page, stage: string, region?: ReturnType<Page['locator']>) {
  if (!process.env.LARDER_SCREENSHOTS) return
  await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 }); expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    const path = join(process.env.LARDER_SCREENSHOTS, `${width}-TRACE-007-${stage}.png`)
    if (region) await region.screenshot({ path }); else await page.screenshot({ path, fullPage: true })
  }
}

test('TRACE-007 require CoA and CoC, refuse a mismatched lot, approve exact records, release/ship and download pinned versions at 1440/390', async ({ page }) => {
  if (!process.env.LARDER_OPEN) throw new Error('Private local entry required.')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/setup', '/app'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  const tag = crypto.randomUUID().slice(0, 6), today = new Date().toISOString().slice(0, 10), lotCode = `FIN-${tag}`
  const location = await command(page, 'location.save', { name: `QC shelf ${tag}` })
  const raw = await command(page, 'item.save', { sku: `STOCK-${tag}`, name: `Steel blank ${tag}`, kind: 'buy', baseUnit: 'each' })
  const item = await command(page, 'item.save', { sku: `FITTING-${tag}`, name: `Ohio instrument fitting ${tag}`, kind: 'make', baseUnit: 'each' })
  const customer = await command(page, 'party.save', { name: `Dayton Instruments ${tag}`, kind: 'customer' })
  await command(page, 'bom.revise', { itemId: item.id, components: [{ itemId: raw.id, quantity: '1' }] })
  await command(page, 'opening.record', { locationId: location.id, countedOn: today, valuationBasis: 'supplier-invoice', countedBy: 'Olive', evidence: { name: 'steel-count.txt', contentType: 'text/plain', base64: Buffer.from('Counted two steel blanks at invoiced cost').toString('base64') }, lines: [{ itemId: raw.id, quantity: '2', unitCost: '8' }] })
  await page.goto(origin + '/app#stock'); await page.reload(); await settled(page)
  const card = page.getByRole('heading', { name: 'Controlled lot documents', exact: true }).locator('../..')
  await card.getByText('Configure required certificates', { exact: true }).click()
  await card.getByLabel('Certificate requirement SKU', { exact: true }).selectOption(item.id)
  await card.getByLabel('CoA', { exact: true }).check(); await card.getByLabel('CoC', { exact: true }).check()
  await card.getByLabel('Certificate requirement reason', { exact: true }).fill('Customer requires lot analysis and final conformance')
  await shots(page, 'requirements', card)
  await card.getByRole('button', { name: 'Save certificate requirements', exact: true }).click(); await settled(page)
  let work = await command(page, 'wo.draft', { itemId: item.id, quantity: '2', requiredBy: today, reason: 'Controlled fittings' }); work = await command(page, 'wo.release', { workOrderId: work.id, version: work.version })
  work = await command(page, 'wo.issue', { workOrderId: work.id, lines: [{ itemId: raw.id, locationId: location.id, quantity: '2' }] })
  await command(page, 'wo.output', { workOrderId: work.id, version: work.version, locationId: location.id, quantity: '2', lot: lotCode })
  let state = await (await page.request.get(origin + '/api/larder/state')).json(), lot = state.lots.find((l: any) => l.code === lotCode)
  expect(state.positions.find((p: any) => p.lotId === lot.id && p.status === 'quarantine').quantity).toBe('2')
  await page.reload(); await settled(page)
  const quality = page.getByRole('heading', { name: 'Quality decisions', exact: true }).locator('../..'), decision = quality.locator('form').filter({ hasText: lotCode })
  await decision.getByLabel('Decision', { exact: true }).selectOption('release'); await decision.getByLabel('Reason', { exact: true }).fill('Documents not yet present')
  await decision.getByRole('button', { name: 'Record decision', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('approved coa')
  await shots(page, 'missing-refusal', quality)
  await page.reload(); await settled(page)
  async function prepare(type: string, declaredLot: string, name: string) {
    const upload = card.locator('details').filter({ has: page.getByText('Upload a lot document', { exact: true }) }).first()
    if (!(await upload.evaluate(el => (el as HTMLDetailsElement).open))) await upload.locator('summary').click()
    await upload.getByLabel('Certificate stock lot', { exact: true }).selectOption(lot.id)
    await upload.getByLabel('Certificate document type', { exact: true }).selectOption(type)
    await upload.getByLabel('Lot printed on document', { exact: true }).fill(declaredLot)
    await upload.getByLabel('Document issuer', { exact: true }).fill('Ohio Workshop QA')
    await upload.getByLabel('Document version', { exact: true }).fill(`Revision A ${tag}`)
    await upload.getByLabel('Document expiry (UTC date)', { exact: true }).fill(`${new Date().getUTCFullYear() + 1}-12-31`)
    await upload.getByLabel('Original certificate file', { exact: true }).setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(`${type} original; declared lot ${declaredLot}; revision A`) })
    await shots(page, `upload-${type}-${declaredLot === lotCode ? 'correct' : 'wrong'}`, upload)
    await upload.getByRole('button', { name: 'Prepare certificate', exact: true }).click()
    await expect(card.getByRole('link', { name: `Original certificate: ${name}`, exact: true })).toBeVisible(); await settled(page)
    const current = await (await page.request.get(origin + '/api/larder/state')).json()
    return current.certificates.find((d: any) => d.file.name === name)
  }
  const wrong = await prepare('coa', 'OTHER-LOT', `wrong-${tag}.txt`)
  const wrongRecord = page.getByRole('article', { name: `Certificate ${wrong.reference}`, exact: true })
  await wrongRecord.getByLabel(`${wrong.reference} approval reason`, { exact: true }).fill('Compare the printed lot before release')
  await wrongRecord.getByRole('button', { name: `Approve ${wrong.reference}`, exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('different lot'); await shots(page, 'wrong-refusal', wrongRecord)
  await page.reload(); await settled(page)
  const docs = []
  for (const type of ['coa', 'coc']) {
    const doc = await prepare(type, lotCode, `${type}-${tag}.txt`), record = page.getByRole('article', { name: `Certificate ${doc.reference}`, exact: true })
    await record.getByLabel(`${doc.reference} approval reason`, { exact: true }).fill('Exact SKU, lot and original evidence checked')
    await record.getByRole('button', { name: `Approve ${doc.reference}`, exact: true }).click(); await settled(page)
    await expect(record).toContainText('approved locally'); await record.getByText(`${doc.reference} digest and decisions`, { exact: true }).click()
    await expect(record).toContainText(doc.file.sha256); await shots(page, `approved-${type}`, record); docs.push(doc)
  }
  await decision.getByLabel('Decision', { exact: true }).selectOption('release'); await decision.getByLabel('Reason', { exact: true }).fill('Matching CoA and final CoC approved')
  await shots(page, 'release-prepared', quality)
  await decision.getByRole('button', { name: 'Record decision', exact: true }).click(); await settled(page)
  await expect(decision).toHaveCount(0)
  let order = await command(page, 'so.quote', { customerId: customer.id, promiseDate: today, lines: [{ itemId: item.id, quantity: '2', unitPrice: '40' }] }); order = await command(page, 'so.confirm', { orderId: order.id, version: order.version })
  await page.goto(origin + `/app#orders/${order.id}`); await page.reload(); await settled(page)
  const shipping = page.getByRole('heading', { name: 'Pick, pack and ship', exact: true }).locator('../..')
  await shipping.getByRole('button', { name: 'Pick', exact: true }).click(); await settled(page)
  await shipping.getByRole('button', { name: 'Mark packed', exact: true }).click(); await settled(page)
  await shipping.getByLabel('Carrier', { exact: true }).fill('UPS'); await shipping.getByLabel('Tracking', { exact: true }).fill(`OH-${tag}`)
  await shipping.getByRole('button', { name: 'Ship', exact: true }).click(); await settled(page)
  state = await (await page.request.get(origin + '/api/larder/state')).json(); const shipment = state.shipments.find((s: any) => s.orderId === order.id)
  const retained = page.getByRole('region', { name: `${shipment.reference} retained certificates`, exact: true })
  await expect(retained).toContainText(`Revision A ${tag}`); await expect(retained).toContainText(lotCode)
  await shots(page, 'shipped-packet', shipping)
  const path = await retained.getByRole('link', { name: `Download ${shipment.reference} certificate trace and originals`, exact: true }).getAttribute('href')
  const packet = await (await page.request.get(origin + path)).json()
  expect(packet.trace[0].lot).toBe(lotCode); expect(packet.trace[0].quantity).toBe('2'); expect(packet.files).toHaveLength(2)
  expect(packet.trace[0].documents.map((d: any) => d.id).sort()).toEqual(docs.map((d: any) => d.id).sort())
  expect(Buffer.from(packet.files.find((f: any) => f.id === docs[0].file.id).base64, 'base64').toString()).toBe(`coa original; declared lot ${lotCode}; revision A`)
  await page.reload(); await settled(page); await expect(retained).toContainText(`Revision A ${tag}`)
})
