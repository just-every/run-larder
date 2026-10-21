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
      const paused = (await state(station)).workOrders.find((w: any) => w.id === first.id), interval = paused.operationStates[0].downtime.at(-1)
      await command(page, 'wo.operation.escalationAck', { workOrderId: first.id, version: paused.version, sequence: 1, downtimeId: interval.id, note: 'Supervisor checked the bore gauge and owns follow-up' })
      await station.getByRole('button', { name: 'Refresh dispatch', exact: true }).click(); await settled(station)
      await expect(active).toContainText('acknowledged by')
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

test('CAP-003 configure and execute material, transfer, overlap and QC dependencies through tablet dispatch at 1440/390', async ({ page }) => {
  if (!process.env.LARDER_OPEN) throw new Error('A private local owner entry is required.')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/setup', '/app'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  await settled(page)
  const today = new Date().toISOString().slice(0, 10), suffix = crypto.randomUUID().slice(0, 7)
  const raw = await command(page, 'item.save', { sku: `CAP-BLANK-${suffix}`, name: `Plate blank ${suffix}`, kind: 'buy', baseUnit: 'each' })
  const product = await command(page, 'item.save', { sku: `CAP-PART-${suffix}`, name: `Coated plate ${suffix}`, kind: 'make', baseUnit: 'each' })
  const location = await command(page, 'location.save', { name: `Material rack ${suffix}` })
  await command(page, 'opening.record', { locationId: location.id, countedOn: today, countedBy: 'Olive', valuationBasis: 'supplier-invoice', evidence: { name: 'blank-count.txt', contentType: 'text/plain', base64: Buffer.from('Counted twenty plate blanks').toString('base64') }, lines: [{ itemId: raw.id, quantity: '20', unitCost: '4' }] })
  const owner = (await state(page)).actor
  const shotCap = async (name: string, detail?: Locator) => {
    expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    if (process.env.LARDER_SCREENSHOTS) {
      await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${page.viewportSize()!.width}-CAP-003-${name}.png`), fullPage: true })
      if (detail) await detail.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${page.viewportSize()!.width}-CAP-003-${name}-detail.png`) })
    }
  }
  const refresh = async () => { await page.getByRole('button', { name: 'Refresh dispatch', exact: true }).click(); await settled(page) }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.reload(); await settled(page); await page.goto(origin + '/app#make/boms'); await settled(page)
    const form = page.getByRole('heading', { name: 'New revision', exact: true }).locator('../..')
    await form.getByLabel('Item', { exact: true }).selectOption(product.id)
    await form.getByLabel('Component 1', { exact: true }).selectOption(raw.id)
    await form.getByLabel('Quantity', { exact: true }).first().fill('1')
    await form.locator('textarea[name=routing]').fill('Machine plate, Mill, 3\nCoat plate, Coating booth, 2\nPack plate, Packing bench, 1')
    await form.getByLabel('Step 1 require all job materials issued before start', { exact: true }).check()
    await form.getByLabel('Step 2 transfer batch', { exact: true }).fill('2')
    await form.getByLabel('Step 2 allow overlap with predecessors', { exact: true }).check()
    await form.getByLabel('Step 3 transfer batch', { exact: true }).fill('2')
    await expect(form.getByLabel('Step 3 allow overlap with predecessors', { exact: true })).not.toBeChecked()
    await shotCap('routing-configured', form.locator('fieldset').filter({ has: page.getByText('Step 2: Coat plate', { exact: true }) }).last())
    await act(page, form.getByRole('button', { name: 'Save new revision', exact: true }))
    let work = await command(page, 'wo.draft', { itemId: product.id, quantity: '4', requiredBy: today, reason: `Coated plate batch ${width}` })
    work = await command(page, 'wo.release', { workOrderId: work.id, version: work.version })
    for (const sequence of [1, 2, 3]) work = await command(page, 'wo.operation.assign', { workOrderId: work.id, version: work.version, sequence, operatorId: owner.id })
    await open(page)
    const machine = task(page, work.reference, 'Machine plate'), coat = task(page, work.reference, 'Coat plate'), pack = task(page, work.reference, 'Pack plate')
    await expect(machine).toContainText(`Issue 4 more each of Plate blank ${suffix}`)
    await expect(machine).toContainText(`Owner: ${owner.name}`)
    await expect(machine.getByRole('button', { name: 'Start step 1', exact: true })).toBeDisabled()
    await shotCap('material-blocked', machine)
    const current = async () => (await state(page)).workOrders.find((w: any) => w.id === work.id)
    const refuse = async (sequence: number, code: string, workCentre: string) => {
      const w = await current(), before = await state(page)
      const response = await page.request.post(origin + '/api/larder/commands', { headers: { Origin: origin }, data: { commandId: crypto.randomUUID(), type: 'wo.operation.start', payload: { workOrderId: w.id, version: w.version, sequence, workCentre, station: 'Tablet', reason: 'Attempt blocked work' } } })
      const body = await response.json(); expect(body.error.code).toBe(code)
      await expect(task(page, work.reference, ['Machine plate', 'Coat plate', 'Pack plate'][sequence - 1])).toContainText(body.error.message)
      expect((await state(page)).movements).toEqual(before.movements)
    }
    await refuse(1, 'MATERIAL', 'Mill')
    await command(page, 'wo.issue', { workOrderId: work.id, lines: [{ itemId: raw.id, locationId: location.id, quantity: '4' }] }); await refresh()
    const start = async (card: Locator, sequence: number, reason: string) => {
      await card.getByLabel(`Step ${sequence} station`, { exact: true }).fill(`${width} shared tablet`)
      await card.getByLabel(`Step ${sequence} start reason`, { exact: true }).fill(reason)
      await act(page, card.getByRole('button', { name: `Start step ${sequence}`, exact: true }))
    }
    const transfer = async (card: Locator, sequence: number, quantity: string) => {
      await card.getByLabel(`Step ${sequence} transfer quantity`, { exact: true }).fill(quantity)
      await card.getByLabel(`Step ${sequence} transfer reason`, { exact: true }).fill('Measured units physically handed to next station')
      await act(page, card.getByRole('button', { name: `Record step ${sequence} transfer`, exact: true }))
    }
    const complete = async (card: Locator, sequence: number) => {
      await card.getByLabel(`Step ${sequence} completion reason`, { exact: true }).fill('All four units finished at this station')
      await act(page, card.getByRole('button', { name: `Complete step ${sequence}`, exact: true }))
    }
    await start(machine, 1, 'Full material issue checked')
    await refuse(2, 'TRANSFER_BATCH', 'Coating booth')
    await transfer(machine, 1, '1'); await expect(coat.getByRole('button', { name: 'Start step 2', exact: true })).toBeDisabled()
    await transfer(machine, 1, '1')
    let plan = await command(page, 'quality.plan.save', { itemId: product.id, revision: work.bomRevision, stage: 'in-process', operationSequence: 1, name: `Bore check ${width}`, sampleSize: 1, measurements: [{ name: 'Bore', unit: 'mm', target: '10', lower: '9.9', upper: '10.1' }] })
    plan = await command(page, 'quality.plan.approve', { planId: plan.id, version: plan.version }); await refresh()
    await refuse(2, 'QUALITY_CHECK', 'Coating booth')
    const inspect = (value: string) => command(page, 'quality.inspect', { planId: plan.id, planVersion: plan.version, workOrderId: work.id, samples: { Bore: [value] } })
    await inspect('10.2'); await refresh(); await refuse(2, 'QUALITY_HOLD', 'Coating booth'); await shotCap('qc-blocked', coat)
    await inspect('10')
    const hold = (await state(page)).qualityHolds.find((h: any) => h.subjectId === work.id)
    await command(page, 'quality.release', { holdId: hold.id, version: hold.version, reason: 'Bore retest accepted', evidence: [{ name: 'release.txt', contentType: 'text/plain', base64: Buffer.from('Qualified retest and release').toString('base64') }] }); await refresh()
    await start(coat, 2, 'Batch handed off and QC released')
    expect((await current()).operationStates[0].status).toBe('running')
    await expect(coat.getByRole('button', { name: 'Complete step 2', exact: true })).toBeDisabled()
    await transfer(coat, 2, '2'); await refuse(3, 'DEPENDENCY', 'Packing bench'); await shotCap('overlapping-batch', coat)
    await transfer(machine, 1, '2'); await complete(machine, 1)
    await transfer(coat, 2, '2'); await complete(coat, 2)
    await expect(pack.getByRole('button', { name: 'Start step 3', exact: true })).toBeEnabled()
    await start(pack, 3, 'Predecessor complete and full batch received'); await complete(pack, 3)
    await page.reload(); await settled(page)
    await machine.getByText('Step 1 transfer history', { exact: true }).click()
    await expect(machine).toContainText('Measured units physically handed to next station')
    await expect(pack).toContainText('Done'); await shotCap('completed-reloaded', pack)
    const end = await current(); expect(end.output).toBe('0'); expect(end.scrap).toBe('0')
    expect(end.operationStates.map((t: any) => t.status)).toEqual(['done', 'done', 'done'])
    await page.goto(origin + `/app#make/wo/${work.id}`); await settled(page)
    const detail = page.getByRole('region', { name: 'Pinned operation tasks' })
    await expect(detail).toContainText('Overlap allowed')
    await expect(detail).toContainText('All four units finished at this station')
    await shotCap('work-detail-completed', detail.locator('fieldset').filter({ has: page.getByText('Step 2: Coat plate', { exact: true }) }).last())
  }
})
