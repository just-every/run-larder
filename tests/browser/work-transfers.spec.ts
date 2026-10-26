import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787', today = new Date().toISOString().slice(0, 10)
async function command(page: Page, type: string, payload: object) { const r = await page.request.post(origin + '/api/larder/commands', { headers: { Origin: origin }, data: { commandId: crypto.randomUUID(), type, payload } }); const b = await r.json(); expect(b.ok, JSON.stringify(b.error)).toBe(true); return b.result }
async function settled(page: Page) { await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false'); await expect(page.getByRole('alert')).toHaveCount(0) }
const card = (page: Page, title: string) => page.locator('section.card').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
async function open(page: Page, id: string) { await page.goto(origin + `/app#make/wo/${id}`); await page.reload(); await settled(page) }
async function shot(page: Page, name: string) { if (!process.env.LARDER_SCREENSHOTS) return; await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${page.viewportSize()!.width}-FLOOR-005-${name}.png`), fullPage: true }); await card(page, 'Split and merge work').screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${page.viewportSize()!.width}-FLOOR-005-${name}-detail.png`) }) }

test('FLOOR-005 split partly completed work across two centers, merge remaining WIP and reconcile original demand, lots, time and costs at 1440/390', async ({ page }) => {
  if (!process.env.LARDER_OPEN) throw new Error('Private entry required')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/app', '/setup'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  await settled(page)
  const state = async () => (await (await page.request.get(origin + '/api/larder/state')).json()), me = (await state()).actor.id
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 }); const tag = `${width}-${crypto.randomUUID().slice(0, 5)}`
    const loc = await command(page, 'location.save', { name: `Machine shop ${tag}` })
    const part = await command(page, 'item.save', { sku: `BLANK-${tag}`, name: `Machining blank ${tag}`, kind: 'buy', baseUnit: 'each' })
    const item = await command(page, 'item.save', { sku: `BRACKET-${tag}`, name: `Machined bracket ${tag}`, kind: 'make', baseUnit: 'each' })
    const customer = await command(page, 'party.save', { name: `Harbor Instruments ${tag}`, kind: 'customer' })
    await command(page, 'bom.revise', { itemId: item.id, components: [{ itemId: part.id, quantity: '1' }], routing: [{ name: 'Prepare', workCentre: 'Mill A', eligibleCentres: ['Mill A', 'Mill B'], minutes: 1 }, { name: 'Finish', workCentre: 'Bench A', eligibleCentres: ['Bench A', 'Bench B'], minutes: 1 }] })
    await command(page, 'opening.record', { locationId: loc.id, countedOn: today, valuationBasis: 'supplier-invoice', countedBy: 'Olive', evidence: { name: 'count.txt', contentType: 'text/plain', base64: Buffer.from('Shop count').toString('base64') }, lines: [{ itemId: part.id, quantity: '20', unitCost: '5', lot: `BLANKS-${tag}` }] })
    const quote = await command(page, 'so.quote', { customerId: customer.id, promiseDate: today, lines: [{ itemId: item.id, quantity: '10', unitPrice: '20' }] })
    const order = await command(page, 'so.confirm', { orderId: quote.id, version: quote.version })
    let work = await command(page, 'plan.draft', { itemId: item.id })
    work = await command(page, 'wo.release', { workOrderId: work.id, version: work.version }); work = await command(page, 'wo.issue', { workOrderId: work.id, lines: [{ itemId: part.id, locationId: loc.id, quantity: '6' }] })
    work = await command(page, 'wo.operation.assign', { workOrderId: work.id, version: work.version, sequence: 1, operatorId: me })
    work = await command(page, 'wo.operation.start', { workOrderId: work.id, version: work.version, sequence: 1, workCentre: 'Mill A', station: 'Mill 1', reason: 'Prepare batch' })
    work = await command(page, 'wo.operation.complete', { workOrderId: work.id, version: work.version, sequence: 1, reason: 'Prepared batch' })
    work = await command(page, 'wo.output', { workOrderId: work.id, version: work.version, quantity: '2', locationId: loc.id, lot: `FIRST-${tag}`, allocations: [{ movementId: (await state()).movements.find((m: any) => m.kind === 'issue' && m.documentId === work.id).id, quantity: '2' }] })
    const originalEvents = structuredClone(work.operationStates[0].events), before = await state()
    await open(page, work.id)
    const transfers = card(page, 'Split and merge work')
    await transfers.getByLabel('Batch 1 quantity', { exact: true }).fill('4'); await transfers.getByLabel('Batch 2 quantity', { exact: true }).fill('4')
    await transfers.getByLabel('Batch 1 step 2 center', { exact: true }).selectOption('Bench A'); await transfers.getByLabel('Batch 2 step 2 center', { exact: true }).selectOption('Bench B')
    await transfers.getByLabel('Split reason', { exact: true }).fill('Finish remaining batch on two benches')
    await shot(page, 'split-review')
    await transfers.getByRole('button', { name: 'Split work', exact: true }).click(); await expect(transfers.getByRole('heading', { name: /^Split ·/ })).toBeVisible(); await settled(page)
    const split = (await state()).workTransfers.find((t: any) => t.kind === 'split' && t.transfers.some((a: any) => a.sourceId === work.id)), [leftId, rightId] = split.destinations
    await expect(transfers).toContainText('Material cost attributed to this job: $10.00'); await expect(transfers).toContainText('0 + 2'); await shot(page, 'source-retained')
    await open(page, leftId)
    await expect(page.getByText('No execution time is copied.', { exact: false })).toBeVisible(); await expect(card(page, 'Split and merge work')).toContainText(order.reference)
    await expect(page.getByLabel('Batch 1 step 2 center', { exact: true })).toHaveValue('Bench A'); await shot(page, 'left-work')
    await open(page, rightId); await expect(page.getByLabel('Batch 1 step 2 center', { exact: true })).toHaveValue('Bench B'); await shot(page, 'right-work')
    await open(page, leftId)
    const merge = card(page, 'Split and merge work')
    await merge.getByLabel('Other job', { exact: true }).selectOption(rightId); await merge.getByLabel('Merge reason', { exact: true }).fill('Compatible remaining WIP at common bench')
    await shot(page, 'merge-review')
    await merge.getByRole('button', { name: 'Merge work', exact: true }).click(); await expect(merge.getByRole('heading', { name: /^Merge ·/ })).toBeVisible(); await settled(page)
    await expect(merge).toContainText('Material cost attributed to this job: $0.00'); await shot(page, 'source-transferred')
    let s = await state(); const record = s.workTransfers.find((t: any) => t.kind === 'merge' && t.transfers.some((a: any) => a.sourceId === leftId)), mergedId = record.destinations[0]
    await open(page, mergedId)
    await expect(card(page, 'Split and merge work')).toContainText('Material cost attributed to this job: $20.00'); await expect(card(page, 'Split and merge work')).toContainText(order.reference)
    await expect(page.getByText('No execution time is copied.', { exact: false })).toBeVisible(); await shot(page, 'merged-wip')
    s = await state(); let merged = s.workOrders.find((w: any) => w.id === mergedId)
    expect(s.movements).toEqual(before.movements); expect(merged.quantity).toBe('8'); expect(merged.components[0].issued).toBe('4')
    expect(s.workOrders.find((w: any) => w.id === work.id).operationStates[0].events).toEqual(originalEvents)
    merged = await command(page, 'wo.issue', { workOrderId: merged.id, lines: [{ itemId: part.id, locationId: loc.id, quantity: '4' }] })
    merged = await command(page, 'wo.output', { workOrderId: merged.id, version: merged.version, quantity: '8', locationId: loc.id, lot: `MERGED-${tag}` })
    merged = await command(page, 'wo.close', { workOrderId: merged.id, version: merged.version })
    expect(merged.cost.materials).toBe('40')
    await open(page, mergedId); await expect(card(page, 'Split and merge work')).toContainText('Material cost attributed to this job: $40.00'); await shot(page, 'merged-closed')
  }
})

test('CAP-008 grouped nesting preserves three customer jobs and their allocated material costs at both widths', async ({ page }) => {
  if (!process.env.LARDER_OPEN) throw new Error('Private entry required')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/app', '/setup'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  await settled(page)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const tag = `${width}-${crypto.randomUUID().slice(0, 6)}`, jobs: any[] = [], orders: any[] = []
    const loc = await command(page, 'location.save', { name: `Sheet store ${tag}` })
    const sheet = await command(page, 'item.save', { sku: `synthetic-larder-sheet-${tag}`, name: `Steel sheet ${tag}`, kind: 'buy', baseUnit: 'm2' })
    const customer = await command(page, 'party.save', { name: `Sheet customer ${tag}`, kind: 'customer' })
    await command(page, 'opening.record', { locationId: loc.id, countedOn: today, valuationBasis: 'supplier-invoice', countedBy: 'Olive', evidence: { name: 'count.txt', contentType: ['text', 'plain'].join('/'), base64: Buffer.from('Sheet count').toString('base64') }, lines: [{ itemId: sheet.id, quantity: '10', unitCost: '10', lot: `synthetic-larder-source-${tag}` }] })
    for (let i = 0; i < 3; i++) {
      const item = await command(page, 'item.save', { sku: `synthetic-larder-job-${i}-${tag}`, name: `Bracket ${i + 1} ${tag}`, kind: 'make', baseUnit: 'each' })
      await command(page, 'bom.revise', { itemId: item.id, components: [{ itemId: sheet.id, quantity: '2' }], routing: [{ name: 'Cut', workCentre: 'Laser', setupMinutes: 20, runMinutes: 1 }] })
      const quote = await command(page, 'so.quote', { customerId: customer.id, promiseDate: today, lines: [{ itemId: item.id, quantity: '1', unitPrice: '50' }] })
      orders.push(await command(page, 'so.confirm', { orderId: quote.id, version: quote.version }))
      const draft = await command(page, 'plan.draft', { itemId: item.id })
      jobs.push(await command(page, 'wo.release', { workOrderId: draft.id, version: draft.version }))
    }
    const before = await (await page.request.get(origin + '/api/larder/state')).json(), lot = before.lots.find((l: any) => l.itemId === sheet.id)
    await open(page, jobs[0].id)
    const nesting = card(page, 'Grouped nesting')
    const account = page.getByLabel('Account menu', { exact: true })
    await account.focus()
    await expect(page.getByRole('tooltip', { name: 'Account menu', exact: true })).toBeVisible()
    if (process.env.LARDER_SCREENSHOTS) await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${width}-CAP-008-grouping-tooltip.png`), fullPage: true })
    await nesting.getByLabel('Group material', { exact: true }).selectOption(sheet.id)
    for (const job of jobs.slice(1)) await nesting.getByRole('checkbox', { name: `Include ${job.reference}`, exact: true }).check()
    await nesting.getByLabel('Grouping reason', { exact: true }).fill('Cut customer jobs together')
    const prepared = page.waitForResponse(r => r.url() === origin + '/api/larder/commands' && r.request().postDataJSON().type === 'nest.prepare')
    await nesting.getByRole('button', { name: 'Prepare nesting group', exact: true }).click()
    const group = (await (await prepared).json()).result
    expect(group.members.map((m: any) => m.workOrderId)).toEqual(jobs.map(w => w.id))
    await settled(page)
    if (process.env.LARDER_SCREENSHOTS) await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${width}-CAP-008-import-file.png`), fullPage: true })

    const report = { format: 'larder-nesting-v1', source: { itemId: sheet.id, locationId: loc.id, lotId: lot.id, quantity: '10' }, offcut: { quantity: '2', code: `synthetic-larder-offcut-${tag}`, locationId: loc.id }, sharedSetupMinutes: '30', jobs: jobs.map((w, i) => ({ workOrderId: w.id, quantity: '1', materialQuantity: i ? '3' : '2', goodMaterialQuantity: i ? '2.5' : '1.5', setupMinutes: '10' })) }
    const section = nesting.getByRole('region', { name: `Nesting ${group.reference}`, exact: true })
    await section.getByLabel('Nesting result file', { exact: true }).setInputFiles({ name: 'nesting.json', mimeType: ['application', 'json'].join('/'), buffer: Buffer.from(JSON.stringify(report)) })
    const imported = page.waitForResponse(r => r.url() === origin + '/api/larder/commands' && r.request().postDataJSON().type === 'nest.import')
    await section.getByRole('button', { name: 'Import nesting result', exact: true }).click()
    const review = (await (await imported).json()).result
    await settled(page)
    await expect(section).toContainText('Finite bookings remain unchanged.')
    await expect(section).toContainText('recoverable offcut 2')
    for (const order of orders) await expect(section).toContainText(order.reference)
    if (process.env.LARDER_SCREENSHOTS) await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${width}-CAP-008-nesting-review.png`), fullPage: true })

    expect(review.review.materialYield).toBe('0.65')
    await section.getByLabel('Nesting approval reason', { exact: true }).fill('Approve observed cut consumption and reusable offcut')
    await section.getByRole('button', { name: 'Approve exact nesting', exact: true }).click()
    await expect(section).toContainText('Physical nest approved')
    await settled(page)
    if (process.env.LARDER_SCREENSHOTS) await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${width}-CAP-008-nesting-approved.png`), fullPage: true })

    for (let i = 0; i < jobs.length; i++) {
      let s = await (await page.request.get(origin + '/api/larder/state')).json(), w = s.workOrders.find((w: any) => w.id === jobs[i].id)
      w = await command(page, 'wo.output', { workOrderId: w.id, version: w.version, locationId: loc.id, quantity: '1', lot: `synthetic-larder-output-${i}-${tag}` })
      w = await command(page, 'wo.close', { workOrderId: w.id, version: w.version })
      await open(page, w.id)
      await expect(card(page, 'Split and merge work')).toContainText(`Material cost attributed to this job: $${i ? '30' : '20'}.00`)
      await expect(card(page, 'Split and merge work')).toContainText(orders[i].reference)
      await expect(page.getByText('pinned to BOM revision 1', { exact: false })).toBeVisible()
      expect(w.demandSources).toEqual(jobs[i].demandSources)
      if (process.env.LARDER_SCREENSHOTS) {
        await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true })
        await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${width}-CAP-008-job-${i + 1}.png`), fullPage: true })
      }
    }
    const after = await (await page.request.get(origin + '/api/larder/state')).json()
    expect(after.scheduleBookings).toEqual(before.scheduleBookings)
    expect(after.salesOrders).toEqual(before.salesOrders)
    expect(after.positions.find((p: any) => p.lotId === after.workGroups.find((g: any) => g.id === group.id).offcutLotId).quantity).toBe('2')
  }
})

test('FLOOR-006 plan, review and approve two co-products and a reusable by-product at both widths', async ({ page }) => {
  if (!process.env.LARDER_OPEN) throw new Error('Private entry required')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/app', '/setup'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  await settled(page)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const tag = `${width}-${crypto.randomUUID().slice(0, 6)}`, state = async () => (await (await page.request.get(origin + '/api/larder/state')).json())
    const screenshot = async (name: string) => { if (process.env.LARDER_SCREENSHOTS) { await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${width}-FLOOR-006-${name}.png`), fullPage: true }); await card(page, 'Co-products and by-products').screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${width}-FLOOR-006-${name}-detail.png`) }) } }
    const loc = await command(page, 'location.save', { name: `Batch store ${tag}` }), items: any[] = []
    for (let i = 0; i < 4; i++) items.push(await command(page, 'item.save', { sku: `synthetic-larder-${i}-${tag}`, name: `Batch output ${i} ${tag}`, kind: i === 1 || i === 2 ? 'make' : 'buy', baseUnit: 'kg' }))
    const policy = await command(page, 'costing.policy.prepare', { standardLaborRate: '0', machineRate: '0', overheadRate: '0', overtimeAfterHours: '8', overtimeMultiplier: '1', reason: 'Material only' })
    await command(page, 'costing.policy.approve', { policyId: policy.id, version: policy.version, reason: 'Owner approves zero time tariffs' })
    await command(page, 'opening.record', { locationId: loc.id, countedOn: '2026-10-25', valuationBasis: 'supplier-invoice', countedBy: 'Olive', evidence: { name: 'count.txt', contentType: ['text', 'plain'].join('/'), base64: Buffer.from('Measured batch inputs').toString('base64') }, lines: [{ itemId: items[0].id, quantity: '3', unitCost: '10', lot: `synthetic-larder-input-${tag}` }] })
    await command(page, 'bom.revise', { itemId: items[1].id, components: [{ itemId: items[0].id, quantity: '3' }], routing: [] })
    let work = await command(page, 'wo.draft', { itemId: items[1].id, quantity: '1', requiredBy: '2026-10-25', reason: 'One measured batch' })
    await open(page, work.id)
    const batch = card(page, 'Co-products and by-products')
    for (let i = 0; i < 3; i++) {
      await batch.getByLabel(`Output ${i + 1} item`, { exact: true }).selectOption(items[i + 1].id)
      await batch.getByLabel(`Output ${i + 1} planned quantity`, { exact: true }).fill(i === 1 ? '2' : '1')
      await batch.getByLabel(`Output ${i + 1} lot`, { exact: true }).fill(`synthetic-larder-output-${i}-${tag}`)
      await batch.getByLabel(`Output ${i + 1} destination`, { exact: true }).selectOption(loc.id)
    }
    await batch.getByLabel('Output plan reason', { exact: true }).fill('Two co-products and reusable by-product')
    await screenshot('planned')
    await batch.getByRole('button', { name: 'Save output plan', exact: true }).click(); await settled(page)
    work = (await state()).workOrders.find((w: any) => w.id === work.id)
    expect(work.coProductPlan.outputs.map((o: any) => o.kind)).toEqual(['co-product', 'co-product', 'by-product'])
    work = await command(page, 'wo.release', { workOrderId: work.id, version: work.version })
    work = await command(page, 'wo.issue', { workOrderId: work.id, lines: [{ itemId: items[0].id, locationId: loc.id, quantity: '3' }] })
    const charge = await command(page, 'costing.charge.prepare', { workOrderId: work.id, amount: '0.000003', reference: 'synthetic-larder-residue', evidence: { name: 'charge.txt', contentType: ['text', 'plain'].join('/'), base64: Buffer.from('Measured service').toString('base64') }, reason: 'Six-place actual cost' })
    await command(page, 'costing.charge.approve', { chargeId: charge.id, version: charge.version, reason: 'Approve exact actual cost' })
    const before = await state()
    await open(page, work.id)
    for (let i = 0; i < 3; i++) {
      await batch.getByLabel(`Output ${i + 1} standard USD value`, { exact: true }).fill(['8', '12', '4'][i])
      await batch.getByLabel(`Output ${i + 1} input synthetic-larder-input-${tag}`, { exact: true }).fill(['1', '1.5', '0.5'][i])
    }
    await batch.getByLabel('Batch allocation policy', { exact: true }).fill('Fixed batch values USD 10, 15 and 5, explicitly approved by owner')
    await batch.getByLabel('Allocation review reason', { exact: true }).fill('Measured actual consumption')
    await batch.getByRole('button', { name: 'Review batch allocation', exact: true }).click(); await expect(batch.getByRole('heading', { name: 'Exact batch review', exact: true })).toBeVisible(); await settled(page)
    await expect(batch).toContainText('Standard cost USD 24 · Variance USD 6.000003')
    await expect(batch).toContainText('Allocate actual cost in proportion')
    expect((await state()).movements).toEqual(before.movements)
    await expect(batch).toContainText('Actual cost USD 30')
    await batch.getByRole('button', { name: 'Exact input lots and cost sources', exact: true }).click()
    await expect(batch).toContainText('synthetic-larder-input')
    const account = page.getByLabel('Account menu', { exact: true })
    await account.hover(); await expect(page.getByRole('tooltip', { name: 'Account menu', exact: true })).toBeVisible()
    await page.mouse.move(0, 0); await page.keyboard.press('Tab'); await account.focus()
    await expect(page.getByRole('tooltip', { name: 'Account menu', exact: true })).toBeVisible()
    await expect(batch).toContainText('Variance allocation rounding residue USD 0.000002')
    await expect(batch).toContainText('final planned output')
    await screenshot('review')
    await batch.getByLabel('Batch allocation policy', { exact: true }).fill('Changed policy requires fresh owner approval')
    await expect(batch.getByRole('button', { name: 'Approve and post exact batch', exact: true })).toHaveCount(0)
    await expect(batch).toContainText('Draft void: inputs changed')
    await screenshot('edited-draft-void')
    await settled(page)
    for (let i = 0; i < 3; i++) {
      await batch.getByLabel(`Output ${i + 1} standard USD value`, { exact: true }).fill(['8', '12', '4'][i])
      await batch.getByLabel(`Output ${i + 1} input synthetic-larder-input-${tag}`, { exact: true }).fill(['1', '1.5', '0.5'][i])
    }
    await batch.getByLabel('Allocation review reason', { exact: true }).fill('Fresh edited policy review')
    await batch.getByRole('button', { name: 'Review batch allocation', exact: true }).click(); await settled(page)
    const firstReview = (await state()).workOrders.find((w: any) => w.id === work.id).coProductReviews.at(-1).id
    await command(page, 'location.save', { name: `Changed batch evidence ${tag}` })
    await open(page, work.id)
    await expect(batch).toContainText('Draft void: inputs changed')
    await expect(batch.getByRole('button', { name: 'Approve and post exact batch', exact: true })).toHaveCount(0)
    await screenshot('business-change-void')
    for (let i = 0; i < 3; i++) {
      await batch.getByLabel(`Output ${i + 1} standard USD value`, { exact: true }).fill(['8', '12', '4'][i])
      await batch.getByLabel(`Output ${i + 1} input synthetic-larder-input-${tag}`, { exact: true }).fill(['1', '1.5', '0.5'][i])
    }
    await batch.getByLabel('Batch allocation policy', { exact: true }).fill('Fresh exact batch policy')
    await batch.getByLabel('Allocation review reason', { exact: true }).fill('Review changed inputs again')
    await batch.getByRole('button', { name: 'Review batch allocation', exact: true }).click(); await settled(page)
    expect((await state()).workOrders.find((w: any) => w.id === work.id).coProductReviews.at(-1).id).not.toBe(firstReview)
    await batch.getByLabel('Batch approval reason', { exact: true }).fill('Approve exact per-output values and physical posting')
    await batch.getByRole('button', { name: 'Approve and post exact batch', exact: true }).click(); await expect(batch).toContainText('posted'); await settled(page)
    work = (await state()).workOrders.find((w: any) => w.id === work.id)
    expect(work.outputs).toHaveLength(3); expect(work.status).toBe('closed')
    for (const output of work.outputs) {
      const trace = await (await page.request.get(origin + `/api/larder/lots/${output.lotId}/trace`)).json()
      expect(trace.rows.some((r: any) => r.kind === 'output' && r.itemId === output.itemId)).toBe(true)
      expect(trace.rows.some((r: any) => r.kind === 'component consumed' && r.quantity === output.allocations[0].quantity)).toBe(true)
    }
    await expect(batch).toContainText('Variance allocation rounding residue USD 0.000002')
    await screenshot('quarantined')
    const lot = `synthetic-larder-output-2-${tag}`
    let inspection = await command(page, 'quality.plan.save', { itemId: items[3].id, stage: 'receipt', name: `Reuse purity ${tag}`, sampleSize: 1, measurements: [{ name: 'Purity', unit: '%', target: '100', lower: '99', upper: '100' }] })
    await command(page, 'quality.plan.approve', { planId: inspection.id, version: inspection.version })
    await open(page, work.id)
    const outputSection = batch.getByRole('region', { name: `Batch lot ${lot}`, exact: true })
    await outputSection.getByLabel('Purity samples (%)', { exact: true }).fill('100')
    await outputSection.getByRole('button', { name: 'Record inspection', exact: true }).click(); await settled(page)
    await expect(outputSection).toContainText('Passed')
    await screenshot('inspected')
    await batch.getByLabel(`Release reason for ${lot}`, { exact: true }).fill('Measured reusable by-product cleared')
    await batch.getByLabel(`Release evidence for ${lot}`, { exact: true }).setInputFiles({ name: 'release.txt', mimeType: ['text', 'plain'].join('/'), buffer: Buffer.from('Output is reusable and free from contamination') })
    await batch.getByRole('button', { name: `Release ${lot}`, exact: true }).click(); await expect(batch.getByRole('heading', { name: `${lot} · released`, exact: true })).toBeVisible(); await settled(page)
    const after = await state(), valuation = after.costValuations.find((v: any) => v.workOrderId === work.id && v.batchAllocation)
    expect(valuation.lines.map((l: any) => l.targetValue)).toEqual(['10.000001', '15', '5.000002'])
    expect(after.positions.find((p: any) => p.lotId === work.outputs[2].lotId && p.status === 'available').quantity).toBe('1')
    await screenshot('reusable')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

test('STOCK-004 review a bin-sequenced three-order wave and sort exact picks at both widths', async ({ page }) => {
  if (!process.env.LARDER_OPEN) throw new Error('Private entry required')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/app', '/setup'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  await settled(page)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const tag = `${width}-${crypto.randomUUID().slice(0, 6)}`, state = async () => (await (await page.request.get(origin + '/api/larder/state')).json())
    const shot = async (name: string) => { if (process.env.LARDER_SCREENSHOTS) await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${width}-STOCK-004-${name}.png`), fullPage: true }) }
    await page.goto(origin + '/app#' + ['more', 'setup'].join('/')); await settled(page)
    const sites = card(page, 'Sites'); await sites.getByLabel('Site name', { exact: true }).fill(`Site ${tag}`); await sites.getByRole('button', { name: 'Add site', exact: true }).click(); await settled(page)
    const site = (await state()).sites.find((x: any) => x.name === `Site ${tag}`), bins: any[] = [], orders: any[] = []
    const item = await command(page, 'item.save', { sku: `synthetic-larder-wave-${tag}`, name: `Wave item ${tag}`, kind: 'buy', baseUnit: 'each' })
    const customer = await command(page, 'party.save', { name: `Wave customer ${tag}`, kind: 'customer' })
    for (let i = 0; i < 3; i++) {
      const locations = card(page, 'Locations')
      await locations.getByLabel('Name', { exact: true }).fill(`Bin ${i} ${tag}`)
      await locations.getByLabel('Site', { exact: true }).selectOption(site.id)
      await locations.getByLabel('Bin code', { exact: true }).fill(`B${i}`)
      await locations.getByLabel('Bin sequence', { exact: true }).fill(String(3 - i))
      await locations.getByRole('button', { name: 'Add location', exact: true }).click(); await settled(page)
      bins.push((await state()).locations.find((x: any) => x.name === `Bin ${i} ${tag}`))
      await command(page, 'opening.record', { locationId: bins[i].id, countedOn: today, valuationBasis: 'supplier-invoice', countedBy: 'Olive', evidence: { name: 'count.txt', contentType: ['text', 'plain'].join('/'), base64: Buffer.from('Counted stock').toString('base64') }, lines: [{ itemId: item.id, quantity: '4', unitCost: '1' }] })
      let order = await command(page, 'so.quote', { customerId: customer.id, promiseDate: today, lines: [{ itemId: item.id, quantity: '4', unitPrice: '5' }] })
      orders.push(await command(page, 'so.confirm', { orderId: order.id, version: order.version }))
    }
    await page.reload(); await settled(page)
    await shot('site-bin-settings')
    await page.goto(origin + '/app#' + ['more', 'people'].join('/')); await settled(page)
    await expect(page.getByLabel('Sites including future bins', { exact: true })).toBeVisible(); await shot('site-scope-settings')
    await page.goto(origin + '/app#orders'); await settled(page)
    const waves = card(page, 'Wave picking')
    for (const [i, order] of orders.entries()) { await waves.getByLabel(`Include ${order.reference}`, { exact: true }).check(); await waves.getByLabel(`Pick quantity ${order.reference} ${bins[i].name}`, { exact: true }).fill('2') }
    await waves.getByLabel('Wave review reason', { exact: true }).fill('Collect three orders in one walk')
    await waves.getByRole('button', { name: 'Review pick wave', exact: true }).click(); await settled(page)
    const wave = (await state()).pickWaves.at(-1), section = waves.getByRole('region', { name: `Wave ${wave.reference}`, exact: true })
    expect(wave.lines.map((l: any) => l.locationId)).toEqual([...bins].reverse().map(b => b.id))
    for (const order of orders) await expect(section).toContainText(order.reference)
    const before = await state(); expect(before.shipments.some((s: any) => orders.some(o => o.id === s.orderId))).toBe(false)
    const account = page.getByLabel('Account menu', { exact: true }); await account.hover(); await expect(page.getByRole('tooltip', { name: 'Account menu', exact: true })).toBeVisible(); await account.focus(); await expect(page.getByRole('tooltip', { name: 'Account menu', exact: true })).toBeVisible()
    await shot('bin-list')
    await section.getByLabel(`Sort confirmation reason for ${wave.reference}`, { exact: true }).fill('Collected and sorted exact quantities to each order')
    await section.getByRole('button', { name: 'Confirm picked and sorted wave', exact: true }).click(); await settled(page)
    await expect(section.getByRole('heading', { name: `${wave.reference} · picked`, exact: true })).toBeVisible()
    const after = await state(); expect(after.movements).toEqual(before.movements)
    for (const order of orders) {
      const shipment = after.shipments.find((s: any) => s.orderId === order.id)
      expect(shipment.lines[0].quantity).toBe('2')
      expect(after.reservations.find((r: any) => r.demandId === order.id).quantity).toBe('4')
      await expect(section).toContainText('reservation retained until shipment')
      await expect(section).toContainText('unpicked reserved 2')
    }
    await shot('sorted-orders')
  }
})
