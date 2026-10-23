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
  const run = async (type: string, payload: object) => command(page, type, { poId: po.id, version: (await current()).version, reason: 'Reviewed supplier document', ...payload })
  po = await run('po.bill.capture', { reference: `synthetic-larder-${tag}-bill`, currency: 'USD', evidence: { name: 'bill.txt', contentType: 'text/plain', base64: Buffer.from('Supplier bill').toString('base64') }, lines: [{ lineId: po.lines[0].id, quantity: '10', unitPrice: '2' }] })
  const billId = po.bills[0].id, evidence = { name: 'claim.txt', contentType: 'text/plain', base64: Buffer.from('Reviewed RMA evidence').toString('base64') }
  await run('po.bill.resolve', { billId, evidence }); await run('po.bill.approve', { billId })
  po = await run('po.claim.open', { receiptId: receipt.id, movementId: receipt.lines[0].movementId, quantity: '4', purpose: 'rejected', supplierRma: `synthetic-larder-${tag}-rma`, dueDate: day(20), evidence })
  const claimId = po.supplierClaims[0].id
  await run('po.claim.ship', { claimId, quantity: '4', stockStatus: 'quarantine', reference: 'synthetic-larder-461', evidence })
  await run('po.claim.replace', { claimId, quantity: '2', lot: `synthetic-larder-${tag}-replacement`, reference: 'synthetic-larder-462', evidence })
  await run('po.claim.credit', { claimId, quantity: '2', amount: '4', billId, reference: 'synthetic-larder-463', evidence })
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
  await run('po.claim.close', { claimId })

  // A late charge on another exact receipt remains distinct from its physical cost.
  let late = await command(page, 'po.draft', { supplierId: supplier.id, expectedDate: day(3), reason: 'Late freight', lines: [{ itemId: item.id, quantity: '5', unitPrice: '2' }] })
  late = await command(page, 'po.approve', { poId: late.id, version: late.version })
  const second = await command(page, 'receipt.create', { poId: late.id, supplierReference: 'synthetic-larder-465', lines: [{ lineId: late.lines[0].id, locationId: location.id, quantity: '5', lot: `synthetic-larder-${tag}-freight` }] })
  late = (await (await page.request.get(origin + '/api/larder/state')).json()).purchaseOrders.find((x: any) => x.id === late.id)
  late = await command(page, 'po.landed.prepare', { poId: late.id, version: late.version, reason: 'Late freight reviewed', kind: 'freight', policy: 'value', amount: '3', reference: 'synthetic-larder-466', evidence, sources: [{ movementId: second.lines[0].movementId }] })
  await command(page, 'po.landed.approve', { poId: late.id, version: late.version, chargeId: late.landedCharges[0].id, reason: 'Owner approved exact allocation' })
  await page.reload(); await settled(page); await page.goto(origin + '/app#handoff')
  await page.getByRole('button', { name: 'Prepare handoff batch', exact: true }).click(); await settled(page)
  await expect(page.getByText('Landed cost STOCK correction (no stock quantity)', { exact: true })).toBeVisible()
  await shot(page, 'landed-cost', 'BUY-005')
})
