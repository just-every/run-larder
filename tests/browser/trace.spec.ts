import { test, expect, type Page } from '@playwright/test'
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { freshCopy, freePort, command as runtimeCommand, startDev, stopDev } from './runtime.mjs'
const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787', today = new Date().toISOString().slice(0, 10)
const evidence = { name: 'count.txt', contentType: 'text/plain', base64: Buffer.from('Counted original inputs for trace').toString('base64') }
async function command(page: Page, type: string, payload: object) { const r = await page.request.post(origin + '/api/larder/commands', { headers: { Origin: origin }, data: { commandId: crypto.randomUUID(), type, payload } }); const b = await r.json(); expect(b.ok, JSON.stringify(b.error)).toBe(true); return b.result }
async function settled(page: Page) { await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false'); await expect(page.getByRole('alert')).toHaveCount(0) }
async function shot(page: Page, name: string) { if (!process.env.LARDER_SCREENSHOTS) return; await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${page.viewportSize()!.width}-TRACE-001-${name}.png`), fullPage: true }) }
test('TRACE-001 legacy disclosure, evidenced allocation and exact continuation at 1440/390', async ({ page }) => {
  if (!process.env.LARDER_OPEN) throw new Error('Private local entry required')
  const temporary = await mkdtemp(join(tmpdir(), 'larder-legacy-browser-')), root = join(temporary, 'installation')
  let runtime
  try {
  await freshCopy(resolve(fileURLToPath(new URL('../..', import.meta.url))), root)
  const port = await freePort(); await runtimeCommand(join(root, 'node_modules/.bin/rer'), ['setup', '--owner-email', 'owner@example.test', '--non-interactive', '--port', String(port)], root)
  runtime = await startDev(root, port); const legacyOrigin = runtime.origin
  await page.goto(runtime.entry); await page.waitForURL(u => ['/app', '/setup'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  await settled(page)
  const archive = JSON.parse(await readFile(new URL('../../fixtures/trace/legacy.json', import.meta.url), 'utf8'))
  const restored = await page.request.post(legacyOrigin + '/api/larder/archive/restore', { headers: { Origin: legacyOrigin }, data: archive }); expect(restored.status()).toBe(200)
  let s = await (await page.request.get(legacyOrigin + '/api/larder/state')).json(), w = s.workOrders[0]
  await page.reload(); await settled(page); await page.evaluate(id => { location.hash = `make/wo/${id}` }, w.id)
  const history = page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'Historical output allocations', exact: true }) })
  for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); await expect(history).toBeVisible(); await shot(page, 'legacy-before') }
  await history.getByLabel(/lot LEGACY-A/).fill('2'); await history.getByLabel('Historical allocation reason').fill('Original batch traveler identifies heat A'); await history.locator('input[type=file]').setInputFiles({ name: 'legacy-traveler.txt', mimeType: 'text/plain', buffer: Buffer.from('Original batch traveler: heat A used for output A') }); await history.getByRole('button', { name: 'Record historical batch inputs' }).click(); await settled(page); await expect(history).toHaveCount(0)
  const outputForm = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Record output', exact: true }) }); await outputForm.getByLabel('Into location').selectOption(s.locations[0].id); await outputForm.getByLabel('Good quantity', { exact: true }).fill('2'); await outputForm.getByLabel('Batch', { exact: true }).fill('LEGACY-OUT-B'); await outputForm.getByLabel(/lot LEGACY-B/).fill('2'); await outputForm.getByRole('button', { name: 'Record output', exact: true }).click(); await settled(page)
  for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); await shot(page, 'legacy-continued') }
  s = await (await page.request.get(legacyOrigin + '/api/larder/state')).json(); w = s.workOrders[0]
  expect(w.outputs[0].allocationRecorded.evidence.sha256).toBeTruthy(); expect(w.outputs[1].allocations[0].lotId).toBe(s.lots.find((l: any) => l.code === 'LEGACY-B').id)
  } finally { await stopDev(root, runtime); await rm(temporary, { recursive: true, force: true }) }
})
for (const width of [1440, 390]) test(`TRACE-001 upstream/downstream trace and matching physical CSV at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 })
  if (!process.env.LARDER_OPEN) throw new Error('Private local entry required')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/app', '/setup'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  await settled(page)
  const loc = await command(page, 'location.save', { name: `Trace workshop ${width}` }), supplier = await command(page, 'party.save', { name: `Metal supplier ${width}`, kind: 'supplier' }), customer = await command(page, 'party.save', { name: `Harbor Instruments ${width}`, kind: 'customer' })
  const part = await command(page, 'item.save', { sku: `TRACE-P-${width}`, name: `Steel blank ${width}`, kind: 'buy', baseUnit: 'each' }), item = await command(page, 'item.save', { sku: `TRACE-F-${width}`, name: `Finished bracket ${width}`, kind: 'make', baseUnit: 'each' })
  await command(page, 'bom.revise', { itemId: item.id, components: [{ itemId: part.id, quantity: '1' }] })
  let po = await command(page, 'po.draft', { supplierId: supplier.id, expectedDate: today, reason: 'Two heats for trace', lines: [{ itemId: part.id, quantity: '4', unitPrice: '5' }] }); po = await command(page, 'po.approve', { poId: po.id, version: po.version })
  for (const lot of [`TRACE-A-${width}`, `TRACE-B-${width}`]) await command(page, 'receipt.create', { poId: po.id, supplierReference: lot, lines: [{ lineId: po.lines[0].id, locationId: loc.id, lot, quantity: '2', inspection: 'accept' }] })
  let w = await command(page, 'wo.draft', { itemId: item.id, quantity: '4', requiredBy: today, reason: 'Trace batch' }); w = await command(page, 'wo.release', { workOrderId: w.id, version: w.version }); w = await command(page, 'wo.issue', { workOrderId: w.id, lines: [{ itemId: part.id, locationId: loc.id, quantity: '4' }] }); await page.reload(); await settled(page); await page.evaluate(id => { location.hash = `make/wo/${id}` }, w.id)
  for (const heat of ['A', 'B']) {
    const outputForm = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Record output', exact: true }) })
    await outputForm.getByLabel('Into location').selectOption(loc.id); await outputForm.getByLabel('Good quantity', { exact: true }).fill('2'); await outputForm.getByLabel('Batch', { exact: true }).fill(`TRACE-OUT-${heat}-${width}`)
    await outputForm.getByLabel(new RegExp(`lot TRACE-${heat}-${width}`)).fill('2'); await shot(page, `production-allocation-${heat}`)
    await outputForm.getByRole('button', { name: 'Record output', exact: true }).click(); await settled(page)
  }
  const q = await command(page, 'so.quote', { customerId: customer.id, promiseDate: today, lines: [{ itemId: item.id, quantity: '2', unitPrice: '20' }] }), so = await command(page, 'so.confirm', { orderId: q.id, version: q.version })
  let s = await (await page.request.get(origin + '/api/larder/state')).json(), output = s.lots.find((l: any) => l.code === `TRACE-OUT-A-${width}`), input = s.lots.find((l: any) => l.code === `TRACE-A-${width}`)
  for (let i = 0; i < 2; i++) { let sh = await command(page, 'shipment.pick', { orderId: so.id, lines: [{ lineId: so.lines[0].id, locationId: loc.id, quantity: '1', lotId: output.id }] }); sh = await command(page, 'shipment.pack', { shipmentId: sh.id, version: sh.version, packages: 1 }); await command(page, 'shipment.ship', { shipmentId: sh.id, version: sh.version, carrier: 'Local collection' }) }
  await command(page, 'return.receive', { orderId: so.id, lineId: so.lines[0].id, quantity: '1', locationId: loc.id, disposition: 'quarantine', reason: 'Returned for repair' })
  let repair = await command(page, 'rework.draft', { kind: 'rework', sourceLotId: output.id, sourceJobId: w.id, locationId: loc.id, sourceStatus: 'quarantine', quantity: '1', disposition: 'Repair damaged bracket', instructions: 'Clean and inspect', evidence: [evidence], outputs: [{ itemId: item.id, quantity: '1', value: '5', lot: `TRACE-REPAIRED-${width}` }] }); repair = await command(page, 'rework.approve', { orderId: repair.id, version: repair.version, reason: 'Repair instructions checked' }); repair = await command(page, 'rework.execute', { orderId: repair.id, version: repair.version })
  await page.reload(); await settled(page); await page.evaluate(() => { location.hash = 'stock' })
  const c = page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'Lot genealogy', exact: true }) })
  await c.getByLabel('Trace lot', { exact: true }).selectOption(repair.outputLots[0].lotId)
  await expect(c.getByLabel('Lot trace results')).toBeVisible(); await expect(c.getByLabel('Lot trace results')).toContainText(`TRACE-A-${width}`); await expect(c.getByLabel('Lot trace results')).not.toContainText(`TRACE-B-${width}`); await expect(c).toContainText(po.reference); await expect(c).toContainText(repair.reference); await shot(page, 'upstream')
  await c.getByLabel('Trace direction').selectOption('downstream'); await c.getByLabel('Trace lot', { exact: true }).selectOption(input.id)
  await expect(c.getByLabel('Lot trace results')).toBeVisible(); await expect(c.getByLabel('Lot trace results')).toContainText(`TRACE-REPAIRED-${width}`); await expect(c.getByLabel('Lot trace results')).not.toContainText(`TRACE-OUT-B-${width}`); await expect(c).toContainText(so.reference); await expect(c).toContainText(customer.name); await expect(c.getByRole('heading', { name: 'Reconciled balances' })).toBeVisible(); await shot(page, 'downstream')
  const json = await (await page.request.get(`${origin}/api/larder/lots/${input.id}/trace?direction=downstream`)).json()
  const csv = await page.request.get(origin + await c.getByRole('link', { name: 'Download trace CSV' }).getAttribute('href')); expect(csv.status()).toBe(200)
  const exported = (await csv.text()).trimEnd().split('\r\n'); expect(exported.length).toBe(json.rows.length + 1)
  for (const row of json.rows.filter((r: any) => r.recordType === 'movement')) expect(exported.some((line: string) => line.includes(`"${row.id}"`) && line.includes(`"${row.quantity}"`))).toBe(true)
  s = await (await page.request.get(origin + '/api/larder/state')).json()
  expect(json.rows.filter((r: any) => r.recordType === 'movement' && r.lotId === output.id && r.kind === 'shipment')).toHaveLength(2)
  expect(json.rows.filter((r: any) => r.recordType === 'balance' && r.lotId === repair.outputLots[0].lotId)[0].quantity).toBe(s.positions.find((p: any) => p.lotId === repair.outputLots[0].lotId).quantity)
})
