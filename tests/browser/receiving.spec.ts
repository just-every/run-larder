import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import QRCode from 'qrcode'

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
  const viewport = page.viewportSize()!
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    if (clause === 'FLOOR-008' && /receipt-scanned|issue-scanned|pick-scanned/.test(stage)) {
      const account = page.getByLabel('Account menu', { exact: true }); await page.keyboard.press('Tab'); await account.focus()
      await expect(page.getByRole('tooltip', { name: 'Account menu' })).toBeVisible({ timeout: 100 }); await account.blur(); await account.hover()
      await expect(account.locator('[role=tooltip]')).toHaveCSS('transition-delay', '0.3s, 0.3s')
      await page.mouse.move(0, 0)
    }
    await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${width}-${clause}-${stage}.png`), fullPage: true })
  }
  await page.setViewportSize(viewport)
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
test('FLOOR-008 hardware and camera receipt, issue and pick refuse wrong, held, stale and duplicate scans without an extra movement at 1440/390', async ({ page }) => {
  test.setTimeout(240_000)
  await page.addInitScript(() => {
    // A deterministic camera supplies real QR pixels to the production decoder.
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 640
      const image = new Image(); image.src = (window as any).__cameraFrame; await image.decode()
      // An identical axis-aligned QR can repeatedly miss ZXing's finder-pattern
      // checks for some payloads. Supply deterministic camera motion rather
      // than retrying the same undecodable pixels forever (e.g. HELD-000034).
      const context = canvas.getContext('2d')!, angles = [0, 0.12, -0.12, 0.25]
      let frame = 0
      const draw = () => {
        context.fillStyle = 'white'; context.fillRect(0, 0, 640, 640)
        context.save(); context.translate(320, 320); context.rotate(angles[frame++ % angles.length])
        context.drawImage(image, -260, -260, 520, 520); context.restore()
      }
      draw()
      const stream = canvas.captureStream(15), track = stream.getVideoTracks()[0]
      const frames = setInterval(() => {
        if (track.readyState === 'ended') { clearInterval(frames); return }
        draw()
      }, 60)
      return stream
    } })
  })
  for (const mode of ['hardware', 'camera-desktop', 'camera-phone']) {
  await page.setViewportSize({ width: mode === 'camera-phone' ? 390 : 1440, height: 1000 })
  if (!process.env.LARDER_OPEN) throw new Error('Private local entry required.')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/setup', '/app'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  await settled(page)
  const tag = crypto.randomUUID().slice(0, 6), base = `0${String(Date.now()).slice(-9)}`, [resinCode, pumpCode, hardenerCode] = ['001', '002', '003'].map(n => gtin(base + n))
  const dock = await command(page, 'location.save', { name: `Scan dock ${tag}` }), supplier = await command(page, 'party.save', { name: `Resin works ${tag}`, kind: 'supplier' }), customer = await command(page, 'party.save', { name: `Boat shop ${tag}`, kind: 'customer' })
  const resin = await command(page, 'item.save', { sku: `RESIN-${tag}`, name: `Epoxy resin ${tag}`, kind: 'buy', baseUnit: 'each', barcode: resinCode, tracking: 'batch' })
  await command(page, 'item.save', { sku: `HARD-${tag}`, name: `Hardener ${tag}`, kind: 'buy', baseUnit: 'each', barcode: hardenerCode })
  const pump = await command(page, 'item.save', { sku: `PUMP-${tag}`, name: `Bilge pump ${tag}`, kind: 'buy', baseUnit: 'each', barcode: pumpCode, tracking: 'serial' })
  const kitCode = gtin(base + '004'), kit = await command(page, 'item.save', { sku: `KIT-${tag}`, name: `Repair kit ${tag}`, kind: 'make', baseUnit: 'each', barcode: kitCode, tracking: 'serial' })
  await command(page, 'bom.revise', { itemId: kit.id, components: [{ itemId: resin.id, quantity: '1' }] })
  let po = await command(page, 'po.draft', { supplierId: supplier.id, expectedDate: day(0), reason: 'Scanned delivery', lines: [{ itemId: resin.id, quantity: '6', unitPrice: '9' }, { itemId: pump.id, quantity: '1', unitPrice: '80' }] }); po = await command(page, 'po.approve', { poId: po.id, version: po.version })
  const movements = async () => (await (await page.request.get(origin + '/api/larder/state')).json()).movements.length
  const scan = async (panel: ReturnType<Page['getByRole']>, code: string) => {
    const before = await movements()
    const bin = code.startsWith('Scan dock ') || code.startsWith('Scan shelf ')
    const resolved = bin ? null : page.waitForResponse(r => r.url().includes('/api/larder/scan?') && new URL(r.url()).searchParams.get('code') === code)
    if (mode === 'hardware') { await panel.getByLabel('Scan code', { exact: true }).focus(); await page.keyboard.type(code); await page.keyboard.press('Enter') }
    else {
      await page.evaluate(frame => { (window as any).__cameraFrame = frame }, await QRCode.toDataURL(code, { width: 640, margin: 4, errorCorrectionLevel: 'H' }))
      await panel.getByRole('button', { name: 'Scan with camera', exact: true }).click()
      await expect(panel.getByRole('button', { name: 'Scan with camera', exact: true })).toBeVisible()
    }
    if (resolved) await resolved
    await expect(panel.getByRole('status')).not.toHaveCount(0)
    expect(await movements()).toBe(before)
  }
  await page.goto(origin + `/app#make/po/${po.id}`); await page.reload(); await settled(page)
  let panel = page.getByRole('region', { name: 'Scan this delivery', exact: true })
  await panel.getByLabel('Scan into location', { exact: true }).selectOption(dock.id); await panel.getByLabel('Scanned packing slip', { exact: true }).fill(`Slip ${tag}`)
  await scan(panel, hardenerCode); await expect(panel).toContainText(`Not accepted: Hardener ${tag} is not expected on ${po.reference}`); await shot(page, `wrong-${mode}`, 'FLOOR-008')
  for (let i = 0; i < 2; i++) { await scan(panel, `(01)${resinCode}(17)271231(10)RES-${tag}`); await expect(panel).toContainText(`Scanned Epoxy resin ${tag} · lot RES-${tag}.`) }
  await scan(panel, `(01)${pumpCode}(21)SN-${tag}`); await scan(panel, `(01)${pumpCode}(21)SN-${tag}`); await expect(panel).toContainText(`Duplicate scan: serial SN-${tag} is already on this list.`)
  await expect(panel.locator('tr').filter({ hasText: `RES-${tag}` })).toContainText('2'); await expect(panel.locator('tr').filter({ hasText: `RES-${tag}` })).toContainText('Expires 2027-12-31')
  await shot(page, `receipt-scanned-${mode}`, 'FLOOR-008')
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
  await scan(panel, `HELD-${tag}`); await expect(panel).toContainText(`Not accepted: Lot HELD-${tag} is in quarantine`); await shot(page, `held-${mode}`, 'FLOOR-008')
  await scan(panel, `RES-${tag}`); await scan(panel, `RES-${tag}`); await expect(panel.locator('tr').filter({ hasText: `RES-${tag}` })).toContainText('2')
  await shot(page, `issue-scanned-${mode}`, 'FLOOR-008')
  await panel.getByRole('button', { name: 'Issue scanned', exact: true }).click(); await settled(page)
  s = await (await page.request.get(origin + '/api/larder/state')).json()
  expect(s.movements.filter((m: any) => m.kind === 'issue' && m.documentId === w.id).map((m: any) => [m.quantity, s.lots.find((x: any) => x.id === m.lotId).code])).toEqual([['-2', `RES-${tag}`]])
  await scan(panel, `RES-${tag}`); await expect(panel).toContainText(`Lot RES-${tag} has no stock left`)
  await shot(page, `stale-${mode}`, 'FLOOR-008')
  // The job's own GS1 label fills the output batch and expiry.
  const output = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Record output', exact: true }) })
  await output.getByLabel('Scan output label', { exact: true }).focus(); await page.keyboard.type(`(01)${resinCode}(10)WRONG-${tag}`); await page.keyboard.press('Enter')
  await expect(output).toContainText(`Not accepted: Epoxy resin ${tag} is not what ${w.reference} makes`)
  await output.getByLabel('Scan output label', { exact: true }).focus(); await page.keyboard.type(`(01)${kitCode}(10)KIT-${tag}(17)271130(21)OUT-${tag}`); await page.keyboard.press('Enter')
  await expect(output.getByLabel('Serial', { exact: true })).toHaveValue(`OUT-${tag}`); await expect(output.getByLabel('Batch', { exact: true })).toHaveValue(`KIT-${tag}`); await expect(output.getByLabel('Expires', { exact: true })).toHaveValue('2027-11-30')
  await output.getByLabel('Into location', { exact: true }).selectOption(dock.id); await output.getByLabel('Good quantity', { exact: true }).fill('1')
  await output.locator('input[name^="allocation."]').first().fill('1')
  await shot(page, 'output-label', 'FLOOR-008')
  await output.getByRole('button', { name: 'Record output', exact: true }).click(); await settled(page)
  s = await (await page.request.get(origin + '/api/larder/state')).json(); expect(s.lots.some((l: any) => l.code === `OUT-${tag}` && l.itemId === kit.id && l.serial === true)).toBe(true)
  before = await movements()
  await output.getByLabel('Scan output label', { exact: true }).fill(`(01)${kitCode}(21)OUT-${tag}`); await output.getByLabel('Scan output label', { exact: true }).press('Enter')
  await expect(output).toContainText(`Serial OUT-${tag} of Repair kit ${tag} already exists`)
  expect(await movements()).toBe(before)
  // A transfer scans the bin it leaves, the bin it reaches and the stock it moves.
  const shelf = await command(page, 'location.save', { name: `Scan shelf ${tag}` })
  await command(page, 'receipt.create', { poId: po.id, supplierReference: `Move ${tag}`, lines: [{ lineId: po.lines[0].id, locationId: dock.id, quantity: '2', lot: `MOVE-${tag}`, inspection: 'accept' }] })
  await page.goto(origin + '/app#stock'); await page.reload(); await settled(page)
  panel = page.getByRole('region', { name: 'Scan a transfer', exact: true })
  await scan(panel, `Scan dock ${tag}`); await scan(panel, `Scan shelf ${tag}`); await panel.getByLabel('Transfer reason', { exact: true }).fill('Move to the shelf')
  await expect(panel.getByLabel('Scan from location', { exact: true })).toHaveValue(dock.id); await expect(panel.getByLabel('Move to location', { exact: true })).toHaveValue(shelf.id)
  await scan(panel, `HELD-${tag}`); await expect(panel).toContainText(`Not accepted: Lot HELD-${tag} is in quarantine`)
  await scan(panel, `MOVE-${tag}`); await scan(panel, `MOVE-${tag}`); await expect(panel.locator('tr').filter({ hasText: `MOVE-${tag}` })).toContainText('2')
  await shot(page, 'transfer-scanned', 'FLOOR-008')
  await panel.getByRole('button', { name: 'Transfer scanned', exact: true }).click(); await settled(page)
  s = await (await page.request.get(origin + '/api/larder/state')).json()
  expect(s.transfers.filter((x: any) => x.toLocationId === shelf.id).map((x: any) => [x.quantity, s.lots.find((l: any) => l.id === x.lotId).code])).toEqual([['2', `MOVE-${tag}`]])
  let order = await command(page, 'so.quote', { customerId: customer.id, promiseDate: day(1), lines: [{ itemId: pump.id, quantity: '1', unitPrice: '120' }] }); order = await command(page, 'so.confirm', { orderId: order.id, version: order.version }); await command(page, 'so.reserve', { orderId: order.id })
  await page.goto(origin + `/app#orders/${order.id}`); await page.reload(); await settled(page)
  panel = page.getByRole('region', { name: 'Scan the pick', exact: true })
  await panel.getByLabel('Scan from location', { exact: true }).selectOption(dock.id)
  before = await movements()
  await scan(panel, hardenerCode); await expect(panel).toContainText(`Not accepted: Hardener ${tag} is not open on ${order.reference}`)
  await scan(panel, `(01)${pumpCode}(21)SN-${tag}`); await scan(panel, `(01)${pumpCode}(21)SN-${tag}`); await expect(panel).toContainText(`Duplicate scan: serial SN-${tag} is already on this list.`)
  await shot(page, `pick-scanned-${mode}`, 'FLOOR-008')
  await panel.getByRole('button', { name: 'Pick scanned', exact: true }).click(); await settled(page)
  await expect(page.locator('article.shipment')).toContainText(`1 Bilge pump ${tag} from Scan dock ${tag}, serial SN-${tag}`)
  expect(await movements()).toBe(before)
  await scan(panel, `(01)${pumpCode}(21)SN-${tag}`); await expect(panel).toContainText(`Serial SN-${tag} is already picked`)
  await shot(page, `picked-refusal-${mode}`, 'FLOOR-008')
  for (const [doc, path] of [[w, `make/wo/${w.id}`], [order, `orders/${order.id}`], [po, `make/po/${po.id}`]] as const) {
    await page.goto(origin + '/app#today'); await page.reload(); await settled(page)
    const search = page.getByRole('searchbox', { name: 'Search order, SKU, lot', exact: true })
    await search.fill(doc.reference); await search.press('Enter')
    await expect(page).toHaveURL(origin + '/app#' + path); await settled(page)
    await expect(page.locator('main')).toContainText(doc.reference)
    await shot(page, `search-${doc.reference}-${mode}`, 'FLOOR-008')
  }
  }
})


test('Supplier credit and landed-cost corrections reach the accountant handoff with source links at 1440 and 390', async ({ page }) => {
  if (!process.env.LARDER_OPEN) throw new Error('Private local entry required.')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/setup', '/app'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  const tag = crypto.randomUUID().slice(0, 6)
  const item = await command(page, 'item.save', { sku: `synthetic-larder-${tag}`, name: `Supplier claim ${tag}`, kind: 'buy', baseUnit: 'each' })
  const location = await command(page, 'location.save', { name: `Claim dock ${tag}` }), supplier = await command(page, 'party.save', { name: `Claim supplier ${tag}`, kind: 'supplier' })
  let po = await command(page, 'po.draft', { supplierId: supplier.id, expectedDate: day(3), reason: 'Claim journey', lines: [{ itemId: item.id, quantity: '10', unitPrice: '2' }] })
  po = await command(page, 'po.approve', { poId: po.id, version: po.version })
  const receipt = await command(page, 'receipt.create', { poId: po.id, supplierReference: 'synthetic-larder-460', lines: [{ lineId: po.lines[0].id, locationId: location.id, quantity: '10', lot: `synthetic-larder-${tag}-lot`, inspection: 'quarantine' }] })
  const current = async () => (await (await page.request.get(origin + '/api/larder/state')).json()).purchaseOrders.find((x: any) => x.id === po.id)
  await page.goto(origin + '/app'); await settled(page); await page.goto(origin + '/app#make/po/' + po.id)
  await expect(page.getByRole('heading', { name: 'Supplier invoices', exact: true })).toBeVisible()
  const fillProof = async (form: ReturnType<Page['locator']>) => {
    await form.getByLabel('Decision reason', { exact: true }).fill('Reviewed original supplier evidence')
    await form.getByLabel('Evidence file', { exact: true }).setInputFiles({ name: 'synthetic-larder.txt', mimeType: 'text/plain', buffer: Buffer.from('Reviewed supplier evidence') })
  }
  const formFor = (submit: string) => page.locator('form').filter({ has: page.getByRole('button', { name: submit, exact: true }) })
  const submit = async (name: string) => {
    const response = page.waitForResponse(r => r.url().endsWith('/api/larder/commands') && r.request().method() === 'POST')
    await formFor(name).getByRole('button', { name, exact: true }).click()
    expect((await (await response).json()).ok).toBe(true)
    await settled(page)
  }
  await page.locator('summary').filter({ hasText: /^Capture invoice$/ }).click()
  let form = formFor('Capture invoice')
  await form.getByLabel('Invoice reference', { exact: true }).fill('synthetic-larder-' + tag + '-bill')
  await form.getByLabel('Invoice quantity for Supplier claim ' + tag, { exact: true }).fill('10')
  await fillProof(form); await submit('Capture invoice')
  form = formFor('Resolve reviewed variances'); await fillProof(form); await submit('Resolve reviewed variances')
  await formFor('Approve invoice handoff').getByLabel('Invoice approval reason', { exact: true }).fill('Owner reviewed exact invoice')
  await shot(page, 'invoice-review', 'BUY-003'); await submit('Approve invoice handoff')
  po = await current(); const billId = po.bills[0].id
  await page.getByText('Open supplier return', { exact: true }).click()
  form = formFor('Open claim')
  await form.getByLabel('Original receipt and lot', { exact: true }).selectOption(receipt.lines[0].movementId)
  await form.getByLabel('Return purpose', { exact: true }).selectOption('rejected')
  await form.getByLabel('Claim quantity', { exact: true }).fill('4')
  await form.getByLabel('Supplier RMA reference', { exact: true }).fill('synthetic-larder-' + tag + '-rma')
  await form.getByLabel('Follow-up due', { exact: true }).fill(day(20)); await fillProof(form)
  await shot(page, 'claim-form', 'BUY-006'); await submit('Open claim')
  po = await current(); const claimId = po.supplierClaims[0].id
  await page.getByText('Record return dispatch', { exact: true }).click()
  form = formFor('Record dispatch')
  await form.getByLabel('Dispatch quantity', { exact: true }).fill('4')
  await form.getByLabel('Dispatch stock status', { exact: true }).selectOption('quarantine')
  await form.getByLabel('Dispatch reference', { exact: true }).fill('synthetic-larder-461')
  await fillProof(form); await submit('Record dispatch')
  await page.getByText('Receive replacement', { exact: true }).click()
  form = formFor('Record replacement')
  await form.getByLabel('Replacement quantity', { exact: true }).fill('2')
  await form.getByLabel('Replacement lot or serial', { exact: true }).fill('synthetic-larder-' + tag + '-replacement')
  await form.getByLabel('Replacement reference', { exact: true }).fill('synthetic-larder-462')
  await fillProof(form); await shot(page, 'replacement-form', 'BUY-006'); await submit('Record replacement')
  await page.getByText('Match supplier credit', { exact: true }).click()
  form = formFor('Record credit')
  await form.getByLabel('Credit quantity', { exact: true }).fill('2')
  await form.getByLabel('Credit amount', { exact: true }).fill('4')
  await form.getByLabel('Original approved bill', { exact: true }).selectOption(billId)
  await form.getByLabel('Credit reference', { exact: true }).fill('synthetic-larder-463')
  await fillProof(form); await submit('Record credit')
  po = await current()
  expect(po.supplierClaims[0].shipments.map((x: any) => x.quantity)).toEqual(['4'])
  expect(po.supplierClaims[0].replacements.map((x: any) => x.quantity)).toEqual(['2'])
  expect(po.supplierClaims[0].credits.map((x: any) => [x.quantity, x.amount, x.billId])).toEqual([['2', '4', billId]])
  await page.goto(origin + '/app#stock')
  await page.getByLabel('Trace lot', { exact: true }).selectOption(po.supplierClaims[0].replacements[0].lotId)
  const genealogy = page.getByLabel('Lot trace results', { exact: true })
  await expect(genealogy).toContainText('synthetic-larder-' + tag + '-lot')
  await expect(genealogy).toContainText('synthetic-larder-' + tag + '-replacement')
  await expect(genealogy).toContainText('recorded supplier replacement; quarantined on receipt')
  await shot(page, 'replacement-genealogy', 'BUY-006')
  // The existing handoff screen is the public review and reconciliation door.
  await page.goto(origin + '/app'); await settled(page); await page.goto(origin + '/app#handoff')
  await expect(page.getByRole('heading', { name: 'Accountant handoff', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Prepare handoff batch', exact: true }).click(); await settled(page)
  await expect(page.getByRole('cell', { name: 'Supplier credit (payable correction; no stock quantity)', exact: true })).toBeVisible()
  await expect(page.getByText('Supplier return stock correction', { exact: true })).toBeVisible()
  await expect(page.getByText('Supplier replacement receipt', { exact: true })).toBeVisible()
  const batch = (await (await page.request.get(origin + '/api/larder/state')).json()).handoffs.at(-1)
  const credit = batch.lines.find((l: any) => l.claimId === claimId)
  await page.getByLabel('Acknowledged lines', { exact: true }).fill(`${credit.id},synthetic-larder-464,-4.00`)
  await page.getByRole('button', { name: 'Reconcile', exact: true }).click(); await settled(page)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const account = page.getByLabel('Account menu', { exact: true }), tooltip = account.locator('[role=tooltip]')
    await account.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab')
    await expect(account).toBeFocused(); await expect(tooltip).toHaveText('Account menu'); expect(await tooltip.isVisible()).toBe(true)
    if (process.env.LARDER_SCREENSHOTS) await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${width}-BUY-006-tooltip.png`), fullPage: true })
    await page.getByLabel('Acknowledged lines', { exact: true }).focus(); await expect(tooltip).toBeHidden()
    await account.hover(); await page.waitForTimeout(100); await expect(tooltip).toBeHidden(); await expect(tooltip).toBeVisible()
    await page.mouse.move(0, 900)
    await expect(page.getByText('synthetic-larder-464', { exact: true })).toBeVisible()
    await expect(page.getByText('undefined: $0.00', { exact: true })).toHaveCount(0)
  }
  await shot(page, 'credit-reconciled', 'BUY-006')
  await page.goto(origin + '/app#make/po/' + po.id)
  await formFor('Close locally settled claim').getByLabel('Closure reason', { exact: true }).fill('Every unit locally settled with matched accountant acknowledgement')
  await submit('Close locally settled claim')
  expect((await current()).supplierClaims[0].status).toBe('closed')
  await shot(page, 'closed-claim', 'BUY-006')

  // A late charge on another exact receipt remains distinct from its physical cost.
  let late = await command(page, 'po.draft', { supplierId: supplier.id, expectedDate: day(3), reason: 'Late freight', lines: [{ itemId: item.id, quantity: '5', unitPrice: '2' }] })
  late = await command(page, 'po.approve', { poId: late.id, version: late.version })
  const second = await command(page, 'receipt.create', { poId: late.id, supplierReference: 'synthetic-larder-465', lines: [{ lineId: late.lines[0].id, locationId: location.id, quantity: '5', lot: `synthetic-larder-${tag}-freight` }] })
  late = (await (await page.request.get(origin + '/api/larder/state')).json()).purchaseOrders.find((x: any) => x.id === late.id)
  await page.goto(origin + '/app#make/po/' + late.id)
  await page.locator('summary').filter({ hasText: /^Prepare allocation$/ }).click()
  form = formFor('Prepare allocation')
  await form.getByLabel('Charge kind', { exact: true }).selectOption('freight')
  await form.getByLabel('Allocation basis', { exact: true }).selectOption('value')
  await form.getByLabel('Signed charge amount', { exact: true }).fill('3')
  await form.getByLabel('Charge reference', { exact: true }).fill('synthetic-larder-466')
  await form.locator('input[type=checkbox]').check(); await fillProof(form)
  await shot(page, 'allocation-form', 'BUY-005'); await submit('Prepare allocation')
  const allocation = page.getByLabel('Allocation synthetic-larder-466', { exact: true })
  await expect(allocation).toContainText('draft')
  expect(await allocation.locator('tbody td').allTextContents()).toEqual(['synthetic-larder-' + tag + '-freight', '3', '3', '0', '0'])
  await formFor('Approve exact allocation').getByLabel('Approval reason', { exact: true }).fill('Owner reviewed exact allocation')
  await shot(page, 'allocation-review', 'BUY-005'); await submit('Approve exact allocation')
  await page.goto(origin + '/app#make/po')
  await page.getByLabel('Filter billing status', { exact: true }).selectOption('Billed')
  let poRows = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Purchase orders', exact: true }) }).locator('tbody tr')
  await expect(poRows).toHaveCount(1); await expect(poRows).toContainText(po.reference)
  await expect(poRows).toContainText('not connected')
  await page.getByLabel('Filter billing status', { exact: true }).selectOption('Not billed')
  await expect(poRows).toHaveCount(1); await expect(poRows).toContainText(late.reference)
  await page.getByLabel('Filter billing status', { exact: true }).selectOption('all')
  await page.getByLabel('Sort purchase orders', { exact: true }).selectOption('billing')
  expect(await poRows.locator('td:first-child').allTextContents()).toEqual([po.reference, late.reference])
  await shot(page, 'billing-list', 'BUY-003')
  await page.reload(); await settled(page); await page.goto(origin + '/app#handoff')
  await page.getByRole('button', { name: 'Prepare handoff batch', exact: true }).click(); await settled(page)
  await expect(page.getByText('Landed cost STOCK correction (no stock quantity)', { exact: true })).toBeVisible()
  await shot(page, 'landed-cost', 'BUY-005')
})
