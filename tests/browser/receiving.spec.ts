import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

// BUY-002, BUY-008 and MRP-002 through the built app: a short delivery with damaged units and a delivery note, allocation of the
// accepted stock to two jobs, and the late remainder's expedite recorded as a request, at desktop and phone widths.
const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787'
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

async function command(page: Page, type: string, payload: object) {
  const r = await page.request.post(origin + '/api/larder/commands', { headers: { Origin: origin }, data: { commandId: crypto.randomUUID(), type, payload } })
  const b = await r.json(); expect(b.ok, JSON.stringify(b.error)).toBe(true); return b.result
}
async function settled(page: Page) { await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false'); await expect(page.getByRole('alert')).toHaveCount(0) }
async function shot(page: Page, stage: string, clause = 'BUY-002') {
  if (!process.env.LARDER_SCREENSHOTS) return
  await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${width}-${clause}-${stage}.png`), fullPage: true })
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

test('A person allocates a receipt\'s accepted stock to a released job by hand and the allocation is read back at 1440/390', async ({ page }) => {
  if (!process.env.LARDER_OPEN) throw new Error('Private local entry required.')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/setup', '/app'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  const tag = crypto.randomUUID().slice(0, 6)
  const raw = await command(page, 'item.save', { sku: `synthetic-larder-${tag}`, name: `Job steel ${tag}`, kind: 'buy', baseUnit: 'each' })
  const part = await command(page, 'item.save', { sku: `synthetic-larder-${tag}-p`, name: `Job part ${tag}`, kind: 'make', baseUnit: 'each' })
  await command(page, 'bom.revise', { itemId: part.id, components: [{ itemId: raw.id, quantity: '1' }] })
  const dock = await command(page, 'location.save', { name: `Job dock ${tag}` }), supplier = await command(page, 'party.save', { name: `Job supplier ${tag}`, kind: 'supplier' })
  const drafted = await command(page, 'wo.draft', { itemId: part.id, quantity: '3', requiredBy: day(6), reason: 'Job allocation journey' })
  const job = await command(page, 'wo.release', { workOrderId: drafted.id, version: drafted.version })
  const draft = await command(page, 'po.draft', { supplierId: supplier.id, expectedDate: day(3), reason: 'Job allocation supply', lines: [{ itemId: raw.id, quantity: '5', unitPrice: '2' }] })
  const po = await command(page, 'po.approve', { poId: draft.id, version: draft.version })
  await command(page, 'receipt.create', { poId: po.id, supplierReference: 'JA-1', lines: [{ lineId: po.lines[0].id, locationId: dock.id, quantity: '5', lot: `synthetic-larder-${tag}-lot`, damage: { quantity: '1', reason: 'Crushed' } }] })
  await page.goto(origin + '/app'); await settled(page)
  await page.goto(origin + `/app#make/po/${po.id}`)
  const form = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Allocate to a job', exact: true }) })
  await expect(form).toBeVisible()
  await form.getByLabel('Job', { exact: true }).selectOption({ index: 1 })
  await form.getByLabel('Quantity', { exact: true }).fill('3')
  await form.getByLabel('Reason', { exact: true }).fill('The job starts first')
  await shot(page, 'job-allocation-form', 'BUY-008')
  const reply = page.waitForResponse(r => r.url() === `${origin}/api/larder/commands` && r.request().method() === 'POST')
  await form.getByRole('button', { name: 'Allocate to job', exact: true }).click()
  expect((await (await reply).json()).ok).toBe(true); await settled(page)
  await expect(page.locator('p.muted').filter({ hasText: 'JA-1' })).toContainText(`Allocated 3 to ${job.reference}`)
  const live = await (await page.request.get(origin + '/api/larder/state')).json()
  expect(live.reservations.filter((r: any) => r.demandId === job.id).map((r: any) => r.quantity)).toEqual(['3'])
  await shot(page, 'job-allocated', 'BUY-008')
})

// FLOOR-008: a USB or Bluetooth scanner types its code and Enter; GS1 labels carry identifier, lot, expiry and serial.
const gtin = (body: string) => body + (10 - body.split('').reverse().map(Number).reduce((n, d, i) => n + d * (i % 2 === 0 ? 3 : 1), 0) % 10) % 10
test('FLOOR-008 hardware-scanner receipt, issue and pick refuse a wrong item, held lot and duplicate scan without an extra movement at 1440/390', async ({ page }) => {
  if (!process.env.LARDER_OPEN) throw new Error('Private local entry required.')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/setup', '/app'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  await settled(page)
  const tag = crypto.randomUUID().slice(0, 6), base = `0${String(Date.now()).slice(-9)}`, [resinCode, pumpCode, hardenerCode] = ['001', '002', '003'].map(n => gtin(base + n))
  const dock = await command(page, 'location.save', { name: `Scan dock ${tag}` }), supplier = await command(page, 'party.save', { name: `Resin works ${tag}`, kind: 'supplier' }), customer = await command(page, 'party.save', { name: `Boat shop ${tag}`, kind: 'customer' })
  const resin = await command(page, 'item.save', { sku: `RESIN-${tag}`, name: `Epoxy resin ${tag}`, kind: 'buy', baseUnit: 'each', barcode: resinCode, tracking: 'batch' })
  await command(page, 'item.save', { sku: `HARD-${tag}`, name: `Hardener ${tag}`, kind: 'buy', baseUnit: 'each', barcode: hardenerCode })
  const pump = await command(page, 'item.save', { sku: `PUMP-${tag}`, name: `Bilge pump ${tag}`, kind: 'buy', baseUnit: 'each', barcode: pumpCode, tracking: 'serial' })
  const kit = await command(page, 'item.save', { sku: `KIT-${tag}`, name: `Repair kit ${tag}`, kind: 'make', baseUnit: 'each' })
  await command(page, 'bom.revise', { itemId: kit.id, components: [{ itemId: resin.id, quantity: '1' }] })
  let po = await command(page, 'po.draft', { supplierId: supplier.id, expectedDate: day(0), reason: 'Scanned delivery', lines: [{ itemId: resin.id, quantity: '4', unitPrice: '9' }, { itemId: pump.id, quantity: '1', unitPrice: '80' }] }); po = await command(page, 'po.approve', { poId: po.id, version: po.version })
  const movements = async () => (await (await page.request.get(origin + '/api/larder/state')).json()).movements.length
  const scan = async (panel: ReturnType<Page['getByRole']>, code: string) => { await panel.getByLabel('Scan code', { exact: true }).focus(); await page.keyboard.type(code); await page.keyboard.press('Enter') }
  await page.goto(origin + `/app#make/po/${po.id}`); await page.reload(); await settled(page)
  let panel = page.getByRole('region', { name: 'Scan this delivery', exact: true })
  await panel.getByLabel('Scan into location', { exact: true }).selectOption(dock.id); await panel.getByLabel('Scanned packing slip', { exact: true }).fill(`Slip ${tag}`)
  await scan(panel, hardenerCode); await expect(panel).toContainText(`Not accepted: Hardener ${tag} is not expected on ${po.reference}`)
  for (let i = 0; i < 2; i++) { await scan(panel, `(01)${resinCode}(17)271231(10)RES-${tag}`); await expect(panel).toContainText(`Scanned Epoxy resin ${tag} · lot RES-${tag}.`) }
  await scan(panel, `(01)${pumpCode}(21)SN-${tag}`); await scan(panel, `(01)${pumpCode}(21)SN-${tag}`); await expect(panel).toContainText(`Duplicate scan: serial SN-${tag} is already on this list.`)
  await expect(panel.locator('tr').filter({ hasText: `RES-${tag}` })).toContainText('2'); await expect(panel.locator('tr').filter({ hasText: `RES-${tag}` })).toContainText('Expires 2027-12-31')
  await shot(page, 'receipt-scanned', 'FLOOR-008')
  let before = await movements()
  await panel.getByRole('button', { name: 'Receive scanned', exact: true }).click(); await settled(page)
  let s = await (await page.request.get(origin + '/api/larder/state')).json()
  const receipt = s.receipts.find((r: any) => r.poId === po.id)
  expect(receipt.lines.map((l: any) => [l.quantity, s.lots.find((x: any) => x.id === l.lotId).code])).toEqual([['2', `RES-${tag}`], ['1', `SN-${tag}`]])
  expect(await movements()).toBe(before + 2)
  await command(page, 'receipt.create', { poId: po.id, supplierReference: `Held ${tag}`, lines: [{ lineId: po.lines[0].id, locationId: dock.id, quantity: '2', lot: `HELD-${tag}`, inspection: 'quarantine' }] })
  let w = await command(page, 'wo.draft', { itemId: kit.id, quantity: '2', requiredBy: day(1), reason: 'Scanned issue' }); w = await command(page, 'wo.release', { workOrderId: w.id, version: w.version })
  await page.goto(origin + `/app#make/wo/${w.id}`); await page.reload(); await settled(page)
  panel = page.getByRole('region', { name: 'Scan materials to issue', exact: true })
  await panel.getByLabel('Scan from location', { exact: true }).selectOption(dock.id)
  await scan(panel, `HELD-${tag}`); await expect(panel).toContainText(`Not accepted: Lot HELD-${tag} is in quarantine`)
  await scan(panel, `RES-${tag}`); await scan(panel, `RES-${tag}`); await expect(panel.locator('tr').filter({ hasText: `RES-${tag}` })).toContainText('2')
  await shot(page, 'issue-scanned', 'FLOOR-008')
  await panel.getByRole('button', { name: 'Issue scanned', exact: true }).click(); await settled(page)
  s = await (await page.request.get(origin + '/api/larder/state')).json()
  expect(s.movements.filter((m: any) => m.kind === 'issue' && m.documentId === w.id).map((m: any) => [m.quantity, s.lots.find((x: any) => x.id === m.lotId).code])).toEqual([['-2', `RES-${tag}`]])
  let order = await command(page, 'so.quote', { customerId: customer.id, promiseDate: day(1), lines: [{ itemId: pump.id, quantity: '1', unitPrice: '120' }] }); order = await command(page, 'so.confirm', { orderId: order.id, version: order.version }); await command(page, 'so.reserve', { orderId: order.id })
  await page.goto(origin + `/app#orders/${order.id}`); await page.reload(); await settled(page)
  panel = page.getByRole('region', { name: 'Scan the pick', exact: true })
  await panel.getByLabel('Scan from location', { exact: true }).selectOption(dock.id)
  before = await movements()
  await scan(panel, `(01)${pumpCode}(21)SN-${tag}`); await scan(panel, `(01)${pumpCode}(21)SN-${tag}`); await expect(panel).toContainText(`Duplicate scan: serial SN-${tag} is already on this list.`)
  await shot(page, 'pick-scanned', 'FLOOR-008')
  await panel.getByRole('button', { name: 'Pick scanned', exact: true }).click(); await settled(page)
  await expect(page.locator('article.shipment')).toContainText(`1 Bilge pump ${tag} from Scan dock ${tag}, serial SN-${tag}`)
  expect(await movements()).toBe(before)
})
