import { drawing } from './drawing'
import { test, expect, type Page, type Locator } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787'
async function command(page: Page, type: string, payload: object) {
  const response = await page.request.post(origin + '/api/larder/commands', { headers: { Origin: origin }, data: { commandId: crypto.randomUUID(), type, payload } })
  const body = await response.json(); expect(body.ok, JSON.stringify(body.error)).toBe(true); return body.result
}
async function state(page: Page) { return (await page.request.get(origin + '/api/larder/state')).json() }
async function settled(page: Page) { await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false'); await expect(page.getByRole('alert')).toHaveCount(0) }
async function open(page: Page) { await page.goto(origin + '/app#make/dispatch'); await page.reload(); await settled(page) }
function task(page: Page, reference: string, name: string) { return page.locator('section.card').filter({ has: page.getByRole('heading', { name: `${reference} · ${name}`, exact: true }) }) }
async function act(page: Page, button: Locator) {
  const saved = page.waitForResponse(r => r.url() === origin + '/api/larder/commands' && r.request().method() === 'POST')
  await button.click(); const result = await (await saved).json(); expect(result.ok, JSON.stringify(result.error)).toBe(true); await settled(page)
}
async function shot(page: Page, name: string) {
  expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  if (!process.env.LARDER_SCREENSHOTS) return
  await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true })
  await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${page.viewportSize()!.width}-FLOOR-001-${name}.png`), fullPage: true })
}

test('FLOOR-001 dispatch two jobs, deny blocked work, execute named station reasons and reauthenticate a shared station at 1440/390', async ({ page, browser }) => {
  if (!process.env.LARDER_OPEN) throw new Error('A private local owner entry is required.')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/setup', '/app'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  const suffix = crypto.randomUUID().slice(0, 7), today = new Date().toISOString().slice(0, 10)
  const raw = await command(page, 'item.save', { sku: `DISPATCH-BLANK-${suffix}`, name: `Aluminum blank ${suffix}`, kind: 'buy', baseUnit: 'each' })
  const product = await command(page, 'item.save', { sku: `DISPATCH-PART-${suffix}`, name: `Mounting plate ${suffix}`, kind: 'make', baseUnit: 'each' })
  const location = await command(page, 'location.save', { name: `Dispatch material rack ${suffix}` })
  await command(page, 'opening.record', { locationId: location.id, countedOn: today, countedBy: 'Olive', valuationBasis: 'supplier-invoice', evidence: { name: 'count.txt', contentType: 'text/plain', base64: Buffer.from('Counted 20 aluminum blanks').toString('base64') }, lines: [{ itemId: raw.id, quantity: '20', unitCost: '4' }] })
  const blueprint = drawing('MOUNTING PLATE rev A')
  await command(page, 'bom.revise', { itemId: product.id, components: [{ itemId: raw.id, quantity: '1' }], routing: [
    { name: 'Machine plate', workCentre: `Dispatch mill ${suffix}`, minutes: 5, instructions: 'Clamp securely. Keep hands clear. Measure the bore before release.', drawings: [{ name: 'plate-drawing.pdf', contentType: 'application/pdf', base64: blueprint.toString('base64') }] },
    { name: 'Inspect plate', workCentre: `Inspection bench ${suffix}`, minutes: 2, instructions: 'Inspect bore and deburr all edges.' },
  ] })
  const owner = (await state(page)).actor
  const people = [{ email: `dispatch-one-${suffix}@example.test`, name: `Alex Dispatch ${suffix}` }, { email: `dispatch-two-${suffix}@example.test`, name: `Bea Dispatch ${suffix}` }]
  for (const person of people) {
    const invited = await page.request.post(origin + '/auth/invite', { headers: { Origin: origin }, data: { email: person.email, displayName: person.name, role: 'member' } })
    expect(invited.status()).toBe(202)
  }
  // The same native local sign-in door as STOCK-002 accepts the real invites.
  const setupContext = await browser.newContext({ storageState: await page.context().storageState() })
  const setup = await setupContext.newPage(), ids: string[] = []
  try {
    for (const person of people) {
      await setup.goto(origin + '/auth/dev/enter?as=' + encodeURIComponent(person.email)); await setup.waitForURL(u => u.pathname === '/app')
      const native = await (await setup.request.get(origin + '/auth/session')).json(); ids.push(native.operator.id)
      await command(page, 'role.set', { operatorId: native.operator.id, role: 'production' })
    }
  } finally { await setupContext.close() }
  for (const width of [1440, 390]) {
    const contexts = await Promise.all([browser.newContext({ storageState: await page.context().storageState(), viewport: { width, height: 1000 } }), browser.newContext({ storageState: await page.context().storageState(), viewport: { width, height: 1000 } })])
    const station = await contexts[0].newPage(), observer = await contexts[1].newPage()
    try {
      await station.goto(origin + '/auth/dev/enter?as=' + encodeURIComponent(people[0].email)); await station.waitForURL(u => u.pathname === '/app')
      await observer.goto(origin + '/auth/dev/enter?as=' + encodeURIComponent(people[1].email)); await observer.waitForURL(u => u.pathname === '/app')
      const jobs: any[] = []
      for (const rank of [1, 2]) {
        const draft = await command(page, 'wo.draft', { itemId: product.id, quantity: '2', requiredBy: today, reason: `Dispatch ${width} order ${rank}` })
        let work = await command(page, 'wo.release', { workOrderId: draft.id, version: draft.version })
        work = await command(page, 'order.rank', { kind: 'work', orderId: work.id, version: work.version, rank })
        for (const sequence of [1, 2]) work = await command(page, 'wo.operation.assign', { workOrderId: work.id, version: work.version, sequence, operatorId: ids[sequence - 1] })
        jobs.push(work)
      }
      const [first, second] = jobs
      await open(observer)
      const blocked = task(observer, first.reference, 'Inspect plate')
      await act(observer, blocked.getByRole('button', { name: 'Acknowledge step 2 instructions and drawings', exact: true }))
      await expect(blocked.getByRole('button', { name: 'Start step 2', exact: true })).toBeDisabled()
      const live = (await state(observer)).workOrders.find((w: any) => w.id === first.id)
      const refused = await observer.request.post(origin + '/api/larder/commands', { headers: { Origin: origin }, data: { commandId: crypto.randomUUID(), type: 'wo.operation.start', payload: { workOrderId: first.id, version: live.version, sequence: 2, workCentre: `Inspection bench ${suffix}`, station: 'Inspection tablet', reason: 'Attempt before machining' } } })
      expect((await refused.json()).error.code).toBe('DEPENDENCY')
      await shot(observer, 'blocked-next-operator')
      await open(station)
      const active = task(station, first.reference, 'Machine plate'), waiting = task(station, second.reference, 'Machine plate')
      await expect(active).toContainText('BOM revision 1'); await expect(active).toContainText('job quantity 2 each')
      await active.getByText(/Materials and quality context/).click(); await expect(active).toContainText('Aluminum blank')
      await expect(active.getByRole('region', { name: 'Step 1 safety and quality checks' })).toContainText('not configured')
      const download = station.waitForEvent('download'); await active.getByRole('link', { name: 'Open drawing: plate-drawing.pdf' }).click(); await download
      await act(station, active.getByRole('button', { name: 'Acknowledge step 1 instructions and drawings', exact: true }))
      await act(station, waiting.getByRole('button', { name: 'Acknowledge step 1 instructions and drawings', exact: true }))
      await expect(active.getByRole('button', { name: 'Start step 1', exact: true })).toBeEnabled()
      await expect(waiting.getByRole('button', { name: 'Start step 1', exact: true })).toBeEnabled()
      const cards = station.locator('section.card').filter({ has: station.getByRole('heading', { name: new RegExp(`^(${first.reference}|${second.reference}) · Machine plate$`) }) })
      expect(await cards.first().textContent()).toContain(first.reference)
      for (const button of await active.getByRole('button').all()) { const box = await button.boundingBox(); if (box) expect(box.height).toBeGreaterThanOrEqual(48) }
      await shot(station, 'ready-two-jobs')
      await active.getByLabel('Step 1 station', { exact: true }).fill(`Shared mill tablet ${width}`)
      await active.getByLabel('Step 1 start reason', { exact: true }).fill('Fixture secure, guards checked')
      await act(station, active.getByRole('button', { name: 'Start step 1', exact: true }))
      await active.getByLabel('Step 1 downtime reason', { exact: true }).selectOption('quality')
      await active.getByLabel('Step 1 downtime note', { exact: true }).fill('Verify bore gauge with supervisor')
      await active.getByLabel('Step 1 escalation owner', { exact: true }).selectOption(owner.id)
      await act(station, active.getByRole('button', { name: 'Pause step 1', exact: true }))
      await expect(active).toContainText('Paused'); await expect(active.getByRole('button', { name: 'Complete step 1', exact: true })).toHaveCount(0)
      await active.getByLabel('Step 1 resume reason', { exact: true }).fill('Gauge checked and approved for use')
      await act(station, active.getByRole('button', { name: 'Resume step 1', exact: true }))
      await active.getByLabel('Step 1 completion reason', { exact: true }).fill('Bore measured, edges deburred')
      await act(station, active.getByRole('button', { name: 'Complete step 1', exact: true }))
      await station.reload(); await settled(station); await expect(active).toContainText('Done'); await expect(active).toContainText(`Shared mill tablet ${width}`)
      await active.getByText('Step 1 execution history', { exact: true }).click(); await expect(active).toContainText('Bore measured, edges deburred')
      await shot(station, 'completed-reloaded')
      await observer.reload(); await settled(observer); await expect(blocked.getByRole('button', { name: 'Start step 2', exact: true })).toBeEnabled()
      await expect(task(observer, second.reference, 'Inspect plate').getByRole('button', { name: 'Start step 2', exact: true })).toBeDisabled()
      await shot(observer, 'next-operator-sees-update')
      const oldCookie = (await station.context().cookies(origin)).map(c => `${c.name}=${c.value}`).join('; ')
      await station.getByRole('button', { name: 'Sign out shared station', exact: true }).click(); await station.waitForURL(u => u.pathname === '/signin')
      expect((await station.request.get(origin + '/api/larder/state', { headers: { Cookie: oldCookie } })).status()).toBe(401)
      await station.getByRole('link', { name: `Sign in as ${people[1].name}`, exact: true }).click(); await station.waitForURL(u => u.pathname === '/app')
      await open(station); const nextTask = task(station, first.reference, 'Inspect plate')
      await expect(station.getByRole('heading', { name: 'Dispatch', exact: true })).toBeVisible(); await expect(station.locator('.dispatch')).toContainText(people[1].name)
      await expect(nextTask.getByRole('button', { name: 'Start step 2', exact: true })).toBeEnabled()
      await shot(station, 'shared-station-next-person')
      const end = (await state(station)).workOrders.find((w: any) => w.id === first.id)
      expect(end.operationStates[0].startedBy).toBe(ids[0]); expect(end.operationStates[0].completedBy).toBe(ids[0]); expect(end.output).toBe('0'); expect(end.scrap).toBe('0')
    } finally { await Promise.all(contexts.map(context => context.close())) }
  }
})
