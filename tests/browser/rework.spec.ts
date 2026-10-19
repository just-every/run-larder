import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787', today = new Date().toISOString().slice(0, 10)
const file = { name: 'repair-sheet.txt', mimeType: 'text/plain', buffer: Buffer.from('Repair instructions and inspected results') }
const evidence = { name: file.name, contentType: file.mimeType, base64: file.buffer.toString('base64') }
async function command(page: Page, type: string, payload: object) { const r = await page.request.post(origin + '/api/larder/commands', { headers: { Origin: origin }, data: { commandId: crypto.randomUUID(), type, payload } }); const b = await r.json(); expect(b.ok, JSON.stringify(b.error)).toBe(true); return b.result }
async function settled(page: Page) { await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false'); await expect(page.getByRole('alert')).toHaveCount(0) }
const card = (page: Page, title: string) => page.locator('section.card').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
async function shot(page: Page, name: string) { if (!process.env.LARDER_SCREENSHOTS) return; await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${page.viewportSize()!.width}-FLOOR-004-${name}.png`), fullPage: true }) }

test('FLOOR-004 return defective assemblies, authorize unbuild and repair, recover parts, add material/labor and ship approved repair at 1440/390', async ({ page }) => {
  if (!process.env.LARDER_OPEN) throw new Error('Private local entry required')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/app', '/setup'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  await settled(page)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const tag = `${width}-${crypto.randomUUID().slice(0, 5)}`
    const loc = await command(page, 'location.save', { name: `Repair bench ${tag}` })
    const core = await command(page, 'item.save', { sku: `CORE-${tag}`, name: `Motor core ${tag}`, kind: 'buy', baseUnit: 'each' })
    const seal = await command(page, 'item.save', { sku: `SEAL-${tag}`, name: `Seal ${tag}`, kind: 'buy', baseUnit: 'each' })
    const motor = await command(page, 'item.save', { sku: `MOTOR-${tag}`, name: `Workshop motor ${tag}`, kind: 'make', baseUnit: 'each' })
    const buyer = await command(page, 'party.save', { name: `Harbor Tools ${tag}`, kind: 'customer' })
    await command(page, 'bom.revise', { itemId: motor.id, components: [{ itemId: core.id, quantity: '1' }] })
    await command(page, 'opening.record', { locationId: loc.id, countedOn: today, valuationBasis: 'supplier-invoice', countedBy: 'Olive', evidence, lines: [{ itemId: core.id, quantity: '3', unitCost: '10' }, { itemId: seal.id, quantity: '5', unitCost: '2' }] })
    const draft = await command(page, 'wo.draft', { itemId: motor.id, quantity: '3', requiredBy: today, reason: 'Customer motors' })
    let work = await command(page, 'wo.release', { workOrderId: draft.id, version: draft.version })
    work = await command(page, 'wo.issue', { workOrderId: work.id, lines: [{ itemId: core.id, locationId: loc.id, quantity: '3' }] })
    work = await command(page, 'wo.output', { workOrderId: work.id, version: work.version, locationId: loc.id, quantity: '3', lot: `ORIGINAL-${tag}` })
    const state = async () => (await (await page.request.get(origin + '/api/larder/state')).json())
    const source = (await state()).lots.find((l: any) => l.documentId === work.id)
    const ship = async (q: string, lotId: string) => {
      const quote = await command(page, 'so.quote', { customerId: buyer.id, promiseDate: today, lines: [{ itemId: motor.id, quantity: q, unitPrice: '30' }] })
      const order = await command(page, 'so.confirm', { orderId: quote.id, version: quote.version })
      let shipment = await command(page, 'shipment.pick', { orderId: order.id, lines: [{ lineId: order.lines[0].id, locationId: loc.id, quantity: q, lotId }] })
      shipment = await command(page, 'shipment.pack', { shipmentId: shipment.id, version: shipment.version, packages: 1 })
      await command(page, 'shipment.ship', { shipmentId: shipment.id, version: shipment.version, carrier: 'Customer collection' }); return order
    }
    const originalOrder = await ship('3', source.id)
    await command(page, 'return.receive', { orderId: originalOrder.id, lineId: originalOrder.lines[0].id, quantity: '3', locationId: loc.id, disposition: 'quarantine', reason: 'Defective seals and damaged housing' })
    await page.goto(origin + `/app#make/wo/${work.id}`); await page.reload(); await settled(page)
    for (const kind of ['unbuild', 'rework']) {
      const repair = kind === 'rework', form = card(page, 'New repair or unbuild order')
      await form.getByLabel('Original production lot', { exact: true }).selectOption(source.id)
      await form.getByLabel('Order kind', { exact: true }).selectOption(kind)
      await form.getByLabel('Source location', { exact: true }).selectOption(loc.id)
      await form.getByLabel('Source stock status', { exact: true }).selectOption('quarantine')
      await form.getByLabel('Source quantity', { exact: true }).fill('1')
      await form.getByLabel('Disposition', { exact: true }).fill(repair ? 'Repair one motor; damaged remainder stays quarantined' : 'Recover usable core; scrap damaged housing')
      await form.getByLabel('Authorized instructions', { exact: true }).fill(repair ? 'Replace seal and function test' : 'Disassemble and inspect usable core')
      await form.locator('input[type=file]').setInputFiles(file)
      await form.getByLabel('Output 1 item', { exact: true }).selectOption(repair ? motor.id : core.id)
      await form.getByLabel('Output 1 quantity', { exact: true }).fill('1')
      await form.getByLabel('Output 1 lot', { exact: true }).fill(`${repair ? 'REPAIRED' : 'RECOVERED'}-${tag}`)
      await form.getByLabel('Output 1 value', { exact: true }).fill(repair ? '17' : '8')
      await form.getByLabel('Scrap value', { exact: true }).fill(repair ? '0' : '2')
      if (repair) {
        await form.getByLabel('Extra material', { exact: true }).selectOption(seal.id); await form.getByLabel('Material location', { exact: true }).selectOption(loc.id)
        for (const [label, value] of [['Material quantity', '1'], ['Labor person', 'Riley'], ['Labor hours', '0.25'], ['Hourly rate', '20'], ['Labor description', 'Seal replacement and function test']]) await form.getByLabel(label, { exact: true }).fill(value)
      }
      await shot(page, `${kind}-draft-form`)
      await form.getByRole('button', { name: 'Save repair draft', exact: true }).click()
      await expect(page.getByRole('heading', { name: repair ? /^RW-\d+ · Rework$/ : /^UB-\d+ · Unbuild$/ })).toBeVisible(); await settled(page)
      const row = (await state()).reworkOrders.find((w: any) => w.sourceJobId === work.id && w.kind === kind), detail = card(page, `${row.reference} · ${repair ? 'Rework' : 'Unbuild'}`)
      await expect(detail).toContainText(`Original lot ORIGINAL-${tag}`); await expect(detail).toContainText(work.reference)
      await detail.getByLabel('Approval reason', { exact: true }).fill('Reviewed pinned instructions, quantities and cost allocation')
      await detail.getByRole('button', { name: 'Approve instructions', exact: true }).click(); await settled(page)
      await shot(page, `${kind}-approved`)
      await detail.getByRole('button', { name: 'Execute approved order', exact: true }).click(); await settled(page)
      await expect(detail).toContainText('Quarantine'); await expect(detail).toContainText(repair ? 'Labor: Riley' : 'scrap $2.00')
      if (repair) { await expect(detail).toContainText('extra material $2.00'); await expect(detail).toContainText('labor $5.00'); await expect(detail).toContainText('total $17.00') }
      await shot(page, `${kind}-quarantine`)
      await detail.getByLabel('Release reason', { exact: true }).fill('Passing inspection and function test; usable stock only')
      await detail.locator('input[type=file]').setInputFiles(file)
      await detail.getByRole('button', { name: 'Approve repair and recovery release', exact: true }).click(); await settled(page)
      await expect(detail).toContainText('Approved release by'); await shot(page, `${kind}-released`)
      if (repair) {
        const current = (await state()).reworkOrders.find((w: any) => w.id === row.id)
        await ship('1', current.outputLots[0].lotId)
      }
    }
    const final = await state()
    expect(final.positions.filter((p: any) => p.lotId === source.id).map((p: any) => [p.status, p.quantity])).toEqual([['quarantine', '1']])
    const repair = final.reworkOrders.find((w: any) => w.sourceJobId === work.id && w.kind === 'rework')
    expect(final.movements.find((m: any) => m.lotId === repair.outputLots[0].lotId && m.kind === 'shipment').unitCost).toBe('17')
    await page.reload(); await settled(page); await expect(card(page, `${repair.reference} · Rework`)).toContainText('Approved release by'); await shot(page, 'repair-shipped')
  }
})
