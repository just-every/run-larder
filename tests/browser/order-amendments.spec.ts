import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787'
const date = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
async function command(page: Page, type: string, payload: object) {
  const response = await page.request.post(origin + '/api/larder/commands', { headers: { Origin: origin }, data: { commandId: crypto.randomUUID(), type, payload } })
  const body = await response.json(); expect(body.ok, JSON.stringify(body.error)).toBe(true); return body.result
}
async function open(page: Page, path: string) { await page.goto(origin + '/app#' + path); await page.reload(); await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false') }
async function shot(page: Page, stage: string) {
  if (!process.env.LARDER_SCREENSHOTS) return
  await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true })
  await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${page.viewportSize()!.width}-DEMAND-002-${stage}.png`), fullPage: true })
}
async function submit(page: Page, name: string, type: string) {
  const saved = page.waitForResponse(response => response.url().endsWith('/api/larder/commands') && response.request().postDataJSON()?.type === type)
  await page.getByRole('button', { name, exact: true }).click()
  const body = await (await saved).json(); expect(body.ok, JSON.stringify(body.error)).toBe(true)
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false'); return body.result
}

test('DEMAND-002 customer-approved split dates, prospective prices and cancellation retain shipments and incurred work at 1440/390', async ({ page }) => {
  if (!process.env.LARDER_OPEN) throw new Error('A private local owner entry is required.')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(url => ['/app', '/setup'].includes(url.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(url => url.pathname === '/app') }
  const suffix = crypto.randomUUID().slice(0, 6)
  const raw = await command(page, 'item.save', { sku: `BAR-${suffix}`, name: `Steel bar ${suffix}`, kind: 'buy', baseUnit: 'each', standardCost: '12' })
  const made = await command(page, 'item.save', { sku: `CLAMP-${suffix}`, name: `Mounting clamp ${suffix}`, kind: 'make', baseUnit: 'each', salePrice: '35' })
  const location = await command(page, 'location.save', { name: `Assembly rack ${suffix}` })
  const customer = await command(page, 'party.save', { name: `Ohio Machine Works ${suffix}`, kind: 'customer' }), vendor = await command(page, 'party.save', { name: `Steel supplier ${suffix}`, kind: 'supplier' })
  await command(page, 'bom.revise', { itemId: made.id, components: [{ itemId: raw.id, quantity: '1' }], routing: [{ name: 'Machine clamp', workCentre: 'Mill 1', minutes: 10 }] })
  await command(page, 'opening.record', { locationId: location.id, countedOn: date(0), countedBy: 'Olive', valuationBasis: 'supplier-invoice', evidence: { name: 'count.txt', contentType: 'text/plain', base64: Buffer.from('Counted 20 steel bars').toString('base64') }, lines: [{ itemId: raw.id, quantity: '20', unitCost: '12' }] })
  let work = await command(page, 'wo.draft', { itemId: made.id, quantity: '6', requiredBy: date(5), reason: 'Ohio clamps' })
  work = await command(page, 'wo.release', { workOrderId: work.id, version: work.version })
  work = await command(page, 'wo.issue', { workOrderId: work.id, lines: [{ itemId: raw.id, locationId: location.id, quantity: '6' }] })
  work = await command(page, 'wo.output', { workOrderId: work.id, version: work.version, locationId: location.id, quantity: '2', allocations: [{ movementId: (await (await page.request.get(origin + '/api/larder/state')).json()).movements.find((m: any) => m.kind === 'issue' && m.documentId === work.id).id, quantity: '2' }] })
  const po = await command(page, 'po.draft', { supplierId: vendor.id, expectedDate: date(4), reason: 'Remaining material commitment', lines: [{ itemId: raw.id, quantity: '10', unitPrice: '12' }] })
  await command(page, 'po.approve', { poId: po.id, version: po.version })
  let order = await command(page, 'so.quote', { customerId: customer.id, promiseDate: date(5), shippingAddress: '10 Factory Lane, Dayton, OH 45402', billingAddress: 'Accounts, 10 Factory Lane, Dayton, OH 45402', lines: [{ itemId: made.id, quantity: '6', unitPrice: '35' }] })
  order = await command(page, 'so.confirm', { orderId: order.id, version: order.version })
  let shipment = await command(page, 'shipment.pick', { orderId: order.id, lines: [{ lineId: order.lines[0].id, locationId: location.id, quantity: '1' }] })
  await open(page, `orders/${order.id}`)
  await expect(page.getByRole('button', { name: 'Undo pick', exact: true })).toBeVisible()
  for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); await shot(page, 'undo-pick') }
  await page.getByLabel('Reason for undoing pick', { exact: true }).fill('Customer requests a revised collection')
  await submit(page, 'Undo pick', 'shipment.unpick')
  shipment = await command(page, 'shipment.pick', { orderId: order.id, lines: [{ lineId: order.lines[0].id, locationId: location.id, quantity: '1' }] })
  shipment = await command(page, 'shipment.pack', { shipmentId: shipment.id, version: shipment.version, packages: 1 })
  shipment = await command(page, 'shipment.ship', { shipmentId: shipment.id, version: shipment.version, carrier: 'Customer pickup', tracking: 'PICKUP-1' })
  await open(page, `orders/${order.id}`)
  async function fill(quantity: string, schedules: string, reason: string) {
    await page.getByLabel('Revised billing address', { exact: true }).fill('Accounts, 20 Industrial Way, Dayton, OH 45402')
    await page.getByLabel('Revised shipping address', { exact: true }).fill('20 Industrial Way, Dayton, OH 45402')
    await page.getByLabel('Line 1 agreed quantity', { exact: true }).fill(quantity)
    await page.getByLabel('Line 1 revised unit price', { exact: true }).fill('40')
    await page.getByLabel('Line 1 open delivery quantities and dates', { exact: true }).fill(schedules)
    await page.getByLabel('Customer approver', { exact: true }).fill('Alex Morgan')
    await page.getByLabel('Customer approval reference', { exact: true }).fill('Customer email OH-204')
    await page.getByLabel('Reason for revision', { exact: true }).fill(reason)
  }
  await fill('8', `3, ${date(2)}\n4, ${date(7)}`, 'Increase quantity and split delivery')
  for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); await shot(page, 'prepare-increase') }
  await submit(page, 'Preview order revision', 'so.changePreview')
  await expect(page.getByRole('region', { name: 'Order revision preview' })).toContainText('Changed customer promises: 1')
  await expect(page.getByRole('region', { name: 'Order revision preview' })).toContainText('Previous dates:')
  await expect(page.getByRole('region', { name: 'Order revision preview' })).toContainText('Proposed dates:')
  const impact = page.getByRole('region', { name: 'Order revision impact' })
  await expect(impact).toContainText(work.reference); await expect(impact).toContainText('$72.00'); await expect(impact).toContainText(po.reference)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const account = page.getByLabel('Account menu', { exact: true })
    await page.mouse.move(0, 0); await page.keyboard.press('Tab'); await account.focus()
    await expect(page.getByRole('tooltip', { name: 'Account menu' })).toBeVisible({ timeout: 100 })
    await account.blur(); await account.hover()
    await expect(account.locator('[role=tooltip]')).toHaveCSS('transition-delay', '0.3s, 0.3s')
    await expect(page.getByRole('tooltip', { name: 'Account menu' })).toBeVisible()
    await shot(page, 'impact-increase')
  }
  // Any intervening business write invalidates the review; the screen exposes it.
  await command(page, 'party.save', { name: `Unrelated customer ${suffix}`, kind: 'customer' })
  await page.reload(); await expect(page.getByText('Business records changed. Create a new preview before approval.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Apply customer-approved revision', exact: true })).toBeDisabled()
  await fill('8', `3, ${date(2)}\n4, ${date(7)}`, 'Increase quantity and split delivery')
  await submit(page, 'Preview order revision', 'so.changePreview')
  await submit(page, 'Apply customer-approved revision', 'so.changeApprove')
  await expect(page.getByRole('region', { name: 'Order revision preview' })).toHaveCount(0)
  let state = await (await page.request.get(origin + '/api/larder/state')).json()
  const changed = state.salesOrders.find((record: any) => record.id === order.id)
  expect(changed.lines[0].schedules).toEqual([{ quantity: '3', date: date(2) }, { quantity: '4', date: date(7) }])
  expect(state.shipments.find((record: any) => record.id === shipment.id).lines[0].unitPrice).toBe('35')
  await fill('1', '', 'Customer cancels remaining seven clamps')
  await submit(page, 'Preview order revision', 'so.changePreview')
  await expect(impact).toContainText('$72.00')
  for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); await shot(page, 'cancel-impact') }
  await submit(page, 'Apply customer-approved revision', 'so.changeApprove')
  state = await (await page.request.get(origin + '/api/larder/state')).json()
  const final = state.salesOrders.find((record: any) => record.id === order.id), retained = state.workOrders.find((record: any) => record.id === work.id)
  expect([final.lines[0].shipped, final.lines[0].cancelled]).toEqual(['1', '7'])
  expect(state.reservations.filter((record: any) => record.demandId === order.id)).toHaveLength(0)
  expect([retained.status, retained.quantity, retained.output]).toEqual(['released', '6', '2'])
  expect(state.movements.filter((record: any) => record.documentId === work.id && record.kind === 'issue')).toHaveLength(1)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 }); await open(page, `orders/${order.id}`)
    await expect(page.getByRole('region', { name: 'Order revision history' })).toContainText('Customer cancels remaining seven clamps')
    await expect(page.getByRole('region', { name: 'Order revision history' })).toContainText('Increase quantity and split delivery')
    await expect(page.getByRole('region', { name: 'Order revision preview' })).toHaveCount(0)
    await shot(page, 'retained-history')
    await open(page, 'orders')
    await expect(page.getByRole('row').filter({ has: page.getByRole('link', { name: order.reference, exact: true }) })).toContainText('$35.00')
    await shot(page, 'issued-order-value')
  }
})
