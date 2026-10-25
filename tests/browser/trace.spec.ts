import { test, expect, type Page } from '@playwright/test'
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { freshCopy, freePort, setupLocal, startDev, stopDev } from './runtime.mjs'
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
  const port = await freePort(); await setupLocal(root, port)
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
test('TRACE-001 upstream/downstream trace and matching physical CSV at 1440/390', async ({ page }) => {
  const tag = crypto.randomUUID().slice(0, 8)
  await page.setViewportSize({ width: 1440, height: 1000 })
  if (!process.env.LARDER_OPEN) throw new Error('Private local entry required')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/app', '/setup'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  await settled(page)
  const loc = await command(page, 'location.save', { name: `Trace workshop ${tag}` }), supplier = await command(page, 'party.save', { name: `Metal supplier ${tag}`, kind: 'supplier' }), customer = await command(page, 'party.save', { name: `Harbor Instruments ${tag}`, kind: 'customer' })
  const part = await command(page, 'item.save', { sku: `TRACE-P-${tag}`, name: `Steel blank ${tag}`, kind: 'buy', baseUnit: 'each' }), item = await command(page, 'item.save', { sku: `TRACE-F-${tag}`, name: `Finished bracket ${tag}`, kind: 'make', baseUnit: 'each' })
  await command(page, 'bom.revise', { itemId: item.id, components: [{ itemId: part.id, quantity: '1' }] })
  let po = await command(page, 'po.draft', { supplierId: supplier.id, expectedDate: today, reason: 'Two heats for trace', lines: [{ itemId: part.id, quantity: '4', unitPrice: '5' }] }); po = await command(page, 'po.approve', { poId: po.id, version: po.version })
  for (const lot of [`TRACE-A-${tag}`, `TRACE-B-${tag}`]) await command(page, 'receipt.create', { poId: po.id, supplierReference: lot, lines: [{ lineId: po.lines[0].id, locationId: loc.id, lot, quantity: '2', inspection: 'accept' }] })
  let w = await command(page, 'wo.draft', { itemId: item.id, quantity: '4', requiredBy: today, reason: 'Trace batch' }); w = await command(page, 'wo.release', { workOrderId: w.id, version: w.version }); w = await command(page, 'wo.issue', { workOrderId: w.id, lines: [{ itemId: part.id, locationId: loc.id, quantity: '4' }] }); await page.reload(); await settled(page); await page.evaluate(id => { location.hash = `make/wo/${id}` }, w.id)
  for (const heat of ['A', 'B']) {
    const outputForm = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Record output', exact: true }) })
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await outputForm.getByLabel('Into location').selectOption(loc.id); await outputForm.getByLabel('Good quantity', { exact: true }).fill('2'); await outputForm.getByLabel('Batch', { exact: true }).fill(`TRACE-OUT-${heat}-${tag}`)
      await outputForm.getByLabel(new RegExp(`lot TRACE-${heat}-${tag}`)).fill('2'); await shot(page, `production-allocation-${heat}`)
    }
    await page.setViewportSize({ width: heat === 'A' ? 1440 : 390, height: 1000 })
    await outputForm.getByRole('button', { name: 'Record output', exact: true }).click(); await settled(page)
  }
  const q = await command(page, 'so.quote', { customerId: customer.id, promiseDate: today, lines: [{ itemId: item.id, quantity: '2', unitPrice: '20' }] }), so = await command(page, 'so.confirm', { orderId: q.id, version: q.version })
  let s = await (await page.request.get(origin + '/api/larder/state')).json(), output = s.lots.find((l: any) => l.code === `TRACE-OUT-A-${tag}`), input = s.lots.find((l: any) => l.code === `TRACE-A-${tag}`)
  for (let i = 0; i < 2; i++) { let sh = await command(page, 'shipment.pick', { orderId: so.id, lines: [{ lineId: so.lines[0].id, locationId: loc.id, quantity: '1', lotId: output.id }] }); sh = await command(page, 'shipment.pack', { shipmentId: sh.id, version: sh.version, packages: 1 }); await command(page, 'shipment.ship', { shipmentId: sh.id, version: sh.version, carrier: 'Local collection' }) }
  await command(page, 'return.receive', { orderId: so.id, lineId: so.lines[0].id, quantity: '1', locationId: loc.id, disposition: 'quarantine', reason: 'Returned for repair' })
  let repair = await command(page, 'rework.draft', { kind: 'rework', sourceLotId: output.id, sourceJobId: w.id, locationId: loc.id, sourceStatus: 'quarantine', quantity: '1', disposition: 'Repair damaged bracket', instructions: 'Clean and inspect', evidence: [evidence], outputs: [{ itemId: item.id, quantity: '1', value: '5', lot: `TRACE-REPAIRED-${tag}` }] }); repair = await command(page, 'rework.approve', { orderId: repair.id, version: repair.version, reason: 'Repair instructions checked' }); repair = await command(page, 'rework.execute', { orderId: repair.id, version: repair.version })
  await page.reload(); await settled(page); await page.evaluate(() => { location.hash = 'stock' })
  const c = page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'Lot genealogy', exact: true }) })
  // The same physical history is inspected at both widths; posting it twice adds no coverage.
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await c.getByLabel('Trace direction').selectOption('upstream')
    await c.getByLabel('Trace lot', { exact: true }).selectOption(repair.outputLots[0].lotId)
    await expect(c.getByLabel('Lot trace results').locator('strong').first()).toHaveText(`TRACE-REPAIRED-${tag}`); await expect(c.getByLabel('Lot trace results')).toContainText(`TRACE-A-${tag}`); await expect(c.getByLabel('Lot trace results')).not.toContainText(`TRACE-B-${tag}`); await expect(c).toContainText(po.reference); await expect(c).toContainText(repair.reference); await shot(page, 'upstream')
    await c.getByLabel('Trace direction').selectOption('downstream'); await c.getByLabel('Trace lot', { exact: true }).selectOption(input.id)
    await expect(c.getByLabel('Lot trace results').locator('strong').first()).toHaveText(input.code); await expect(c.getByLabel('Lot trace results')).toContainText(`TRACE-REPAIRED-${tag}`); await expect(c.getByLabel('Lot trace results')).not.toContainText(`TRACE-OUT-B-${tag}`); await expect(c).toContainText(so.reference); await expect(c).toContainText(customer.name); await expect(c.getByRole('heading', { name: 'Reconciled balances' })).toBeVisible(); await shot(page, 'downstream')
    const json = await (await page.request.get(`${origin}/api/larder/lots/${input.id}/trace?direction=downstream`)).json()
    const csv = await page.request.get(origin + await c.getByRole('link', { name: 'Download trace CSV' }).getAttribute('href')); expect(csv.status()).toBe(200)
    const exported = (await csv.text()).trimEnd().split('\r\n'); expect(exported.length).toBe(json.rows.length + 1)
    for (const row of json.rows.filter((r: any) => r.recordType === 'movement')) expect(exported.some((line: string) => line.includes(`"${row.id}"`) && line.includes(`"${row.quantity}"`))).toBe(true)
    s = await (await page.request.get(origin + '/api/larder/state')).json()
    expect(json.rows.filter((r: any) => r.recordType === 'movement' && r.lotId === output.id && r.kind === 'shipment')).toHaveLength(2)
    expect(json.rows.filter((r: any) => r.recordType === 'balance' && r.lotId === repair.outputLots[0].lotId)[0].quantity).toBe(s.positions.find((p: any) => p.lotId === repair.outputLots[0].lotId).quantity)
  }
})

const form = (page: Page, title: string) => page.locator('form').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
async function serialShot(page: Page, name: string) { if (!process.env.LARDER_SCREENSHOTS) return; await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${page.viewportSize()!.width}-TRACE-002-${name}.png`), fullPage: true }) }
test('TRACE-002 receive, assemble, ship, return and service serials with exact customer and component history at 1440/390', async ({ page }) => {
  const runId = crypto.randomUUID().slice(0, 6)
  if (!process.env.LARDER_OPEN) throw new Error('Private local entry required')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/app', '/setup'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  await settled(page)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const tag = `${width}-${runId}`, cage = await command(page, 'location.save', { name: `Serial cage ${tag}` })
    const supplier = await command(page, 'party.save', { name: `Encoder works ${tag}`, kind: 'supplier' }), customer = await command(page, 'party.save', { name: `Ridge Mills ${tag}`, kind: 'customer' })
    const encoder = await command(page, 'item.save', { sku: `ENC-${tag}`, name: `Encoder ${tag}`, kind: 'buy', baseUnit: 'each', tracking: 'serial' }), drive = await command(page, 'item.save', { sku: `DRV-${tag}`, name: `Servo drive ${tag}`, kind: 'make', baseUnit: 'each', tracking: 'serial' })
    await command(page, 'bom.revise', { itemId: drive.id, components: [{ itemId: encoder.id, quantity: '1' }] })
    let po = await command(page, 'po.draft', { supplierId: supplier.id, expectedDate: today, reason: 'Serialized encoders', lines: [{ itemId: encoder.id, quantity: '2', unitPrice: '40' }] }); po = await command(page, 'po.approve', { poId: po.id, version: po.version })
    await page.goto(origin + `/app#make/po/${po.id}`); await page.reload(); await settled(page)
    const receive = form(page, 'Receive delivery')
    await receive.getByLabel('Packing slip', { exact: true }).fill(`Slip ${tag}`); await receive.getByLabel('Into location', { exact: true }).selectOption(cage.id); await receive.getByLabel('Inspection', { exact: true }).selectOption('accept')
    await receive.getByLabel(/^Encoder .* \(outstanding/).fill('2'); await receive.getByLabel('Serials', { exact: true }).fill(`E1-${tag}, e1-${tag}`)
    await receive.getByRole('button', { name: 'Receive', exact: true }).click(); await expect(page.getByRole('alert')).toContainText(`Serial e1-${tag} is listed twice`)
    await receive.getByLabel('Serials', { exact: true }).fill(`E1-${tag}, E2-${tag}`); await serialShot(page, 'receive')
    await receive.getByRole('button', { name: 'Receive', exact: true }).click(); await settled(page)
    let w = await command(page, 'wo.draft', { itemId: drive.id, quantity: '2', requiredBy: today, reason: 'Two serialized drives' }); w = await command(page, 'wo.release', { workOrderId: w.id, version: w.version })
    await page.evaluate(id => { location.hash = `make/wo/${id}` }, w.id); await page.reload(); await settled(page)
    const issue = form(page, 'Issue materials')
    await issue.getByLabel('From location', { exact: true }).selectOption(cage.id); await issue.getByLabel(`Encoder ${tag} actually used (each)`, { exact: true }).fill('2'); await issue.getByLabel(`Encoder ${tag} serials`, { exact: true }).fill(`E1-${tag}, E2-${tag}`)
    await issue.getByRole('button', { name: 'Issue', exact: true }).click(); await settled(page)
    for (const [serial, component] of [[`D1-${tag}`, `E1-${tag}`], [`D2-${tag}`, `E2-${tag}`]]) {
      const output = form(page, 'Record output')
      await output.getByLabel('Into location', { exact: true }).selectOption(cage.id); await output.getByLabel('Good quantity', { exact: true }).fill('1'); await output.getByLabel('Serial', { exact: true }).fill(serial)
      await output.getByLabel(new RegExp(`lot ${component}`)).fill('1'); if (serial.startsWith('D1')) await serialShot(page, 'assemble')
      await output.getByRole('button', { name: 'Record output', exact: true }).click(); await settled(page)
    }
    let order = await command(page, 'so.quote', { customerId: customer.id, promiseDate: today, lines: [{ itemId: drive.id, quantity: '1', unitPrice: '900' }] }); order = await command(page, 'so.confirm', { orderId: order.id, version: order.version }); await command(page, 'so.reserve', { orderId: order.id })
    await page.goto(origin + `/app#orders/${order.id}`); await page.reload(); await settled(page)
    const pick = form(page, 'Pick reserved stock')
    await pick.getByLabel(`Servo drive ${tag} serials`, { exact: true }).fill(`D1-${tag}`); await serialShot(page, 'pick')
    await pick.getByRole('button', { name: 'Pick', exact: true }).click(); await settled(page)
    await expect(page.locator('article.shipment')).toContainText(`1 Servo drive ${tag} from Serial cage ${tag}, serial D1-${tag}`)
    let s = await (await page.request.get(origin + '/api/larder/state')).json(), shipment = s.shipments.find((x: any) => x.orderId === order.id)
    shipment = await command(page, 'shipment.pack', { shipmentId: shipment.id, version: shipment.version, packages: 1 }); shipment = await command(page, 'shipment.ship', { shipmentId: shipment.id, version: shipment.version, carrier: 'UPS', tracking: `1Z-${tag}` })
    let again = await command(page, 'so.quote', { customerId: customer.id, promiseDate: today, lines: [{ itemId: drive.id, quantity: '1', unitPrice: '900' }] }); again = await command(page, 'so.confirm', { orderId: again.id, version: again.version }); await command(page, 'so.reserve', { orderId: again.id })
    await page.goto(origin + `/app#orders/${again.id}`); await page.reload(); await settled(page)
    await form(page, 'Pick reserved stock').getByLabel(`Servo drive ${tag} serials`, { exact: true }).fill(`D1-${tag}`); await form(page, 'Pick reserved stock').getByRole('button', { name: 'Pick', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText(`shipped on ${shipment.reference} to Ridge Mills ${tag}`); await serialShot(page, 'shipped-refused')
    await page.goto(origin + `/app#orders/${order.id}`); await page.reload(); await settled(page)
    const back = form(page, 'Receive a return')
    await back.getByLabel('Line', { exact: true }).selectOption(order.lines[0].id); await back.getByLabel('Condition', { exact: true }).selectOption('quarantine'); await back.getByLabel('Quantity', { exact: true }).fill('1'); await back.getByLabel('Returned serials', { exact: true }).fill(`D1-${tag}`); await back.getByLabel('Into', { exact: true }).selectOption(cage.id); await back.getByLabel('Reason', { exact: true }).fill('Warranty return')
    await back.getByRole('button', { name: 'Receive return', exact: true }).click(); await settled(page)
    await page.goto(origin + '/app#stock'); await page.reload(); await settled(page)
    const serials = page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'Serial numbers', exact: true }) })
    await serials.getByLabel('Find a serial', { exact: true }).fill(`d1-${tag}`); await serials.getByRole('button', { name: 'Find serial', exact: true }).click()
    const history = serials.getByRole('article', { name: `Serial D1-${tag}`, exact: true })
    await expect(history).toContainText('Quarantine'); await expect(history.locator('tr').filter({ hasText: 'Component' })).toContainText(`E1-${tag}`)
    await expect(history.locator('tr').filter({ hasText: 'Shipped to' })).toContainText(`Ridge Mills ${tag}`); await expect(history.locator('tr').filter({ hasText: 'Shipped to' })).toContainText(`1Z-${tag}`)
    const service = form(page, `Record service on D1-${tag}`)
    await service.getByLabel('Service kind', { exact: true }).selectOption('warranty repair'); await service.getByLabel('What was done', { exact: true }).fill('Replaced cooling fan under warranty')
    await service.getByRole('button', { name: 'Record service', exact: true }).click(); await settled(page)
    await expect(history.locator('tr').filter({ hasText: 'Warranty repair' })).toContainText('Replaced cooling fan under warranty'); await serialShot(page, 'history')
    await serials.getByLabel('Find a serial', { exact: true }).fill(`E1-${tag}`); await serials.getByRole('button', { name: 'Find serial', exact: true }).click()
    await expect(serials.getByRole('article', { name: `Serial E1-${tag}`, exact: true }).locator('tr').filter({ hasText: 'Assembled into' })).toContainText(`D1-${tag}`)
    s = await (await page.request.get(origin + '/api/larder/state')).json()
    expect(s.lots.filter((l: any) => l.serial && [encoder.id, drive.id].includes(l.itemId)).map((l: any) => l.code).sort()).toEqual([`D1-${tag}`, `D2-${tag}`, `E1-${tag}`, `E2-${tag}`])
  }
})
