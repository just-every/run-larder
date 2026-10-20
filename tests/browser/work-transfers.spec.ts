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
