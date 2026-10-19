import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787'
async function command(page: Page, type: string, payload: object) {
  const r = await page.request.post(origin + '/api/larder/commands', { headers: { Origin: origin }, data: { commandId: crypto.randomUUID(), type, payload } })
  const body = await r.json(); expect(body.ok, JSON.stringify(body.error)).toBe(true); return body.result
}
async function settled(page: Page) { await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false'); await expect(page.getByRole('alert')).toHaveCount(0) }
async function shots(page: Page, stage: string, region?: ReturnType<Page['locator']>) {
  if (!process.env.LARDER_SCREENSHOTS) return
  await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    const path = join(process.env.LARDER_SCREENSHOTS, `${width}-ENG-005-${stage}.png`)
    if (region) await region.screenshot({ path }); else await page.screenshot({ path, fullPage: true })
  }
}

test('ENG-005 review a safety replacement, evidence and stock/work dispositions, approve effectivity, acknowledge and release at 1440/390', async ({ page }) => {
  if (!process.env.LARDER_OPEN) throw new Error('Private local entry required.')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/setup', '/app'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  const suffix = crypto.randomUUID().slice(0, 6), today = new Date().toISOString().slice(0, 10), tomorrow = new Date(Date.parse(today + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)
  const old = await command(page, 'item.save', { sku: `OLD-${suffix}`, name: `Original fastener ${suffix}`, kind: 'buy', baseUnit: 'each' })
  const replacement = await command(page, 'item.save', { sku: `RATED-${suffix}`, name: `Rated fastener ${suffix}`, kind: 'buy', baseUnit: 'each' })
  const product = await command(page, 'item.save', { sku: `SAFE-${suffix}`, name: `Ohio safety bracket ${suffix}`, kind: 'make', baseUnit: 'each' })
  const location = await command(page, 'location.save', { name: `Fastener shelf ${suffix}` })
  const source = await command(page, 'bom.revise', { itemId: product.id, components: [{ itemId: old.id, quantity: '2' }], routing: [{ name: 'Fasten', workCentre: `Bench ${suffix}`, minutes: 2 }] })
  const file = { name: 'count.txt', contentType: 'text/plain', base64: Buffer.from('Reviewed shelf count').toString('base64') }
  await command(page, 'opening.record', { locationId: location.id, countedOn: today, countedBy: 'Olive', valuationBasis: 'owner-estimate', evidence: file, lines: [{ itemId: old.id, quantity: '20', unitCost: '1' }, { itemId: replacement.id, quantity: '20', unitCost: '2' }] })
  const draft = () => command(page, 'wo.draft', { itemId: product.id, quantity: '2', requiredBy: tomorrow, reason: 'Customer safe bracket production' })
  const releasedDraft = await draft(), released = await command(page, 'wo.release', { workOrderId: releasedDraft.id, version: releasedDraft.version })
  const keep = await draft(), adopt = await draft(), cancel = await draft()
  await page.goto(origin + '/app#make/boms'); await page.reload(); await settled(page)
  await page.getByLabel('Engineering item', { exact: true }).selectOption(source.id)
  const proposal = page.getByRole('heading', { name: 'Propose engineering change', exact: true }).locator('../..')
  await proposal.getByLabel(`Replace ${old.name}`, { exact: true }).selectOption(replacement.id)
  await proposal.getByLabel('Component 1 quantity', { exact: true }).fill('3')
  await proposal.getByLabel('Component 1 eligibility reason', { exact: true }).fill('Required shear rating proven by load test')
  await proposal.getByLabel('Engineering reason', { exact: true }).fill('Safety containment after fastener failure')
  await proposal.getByLabel('Change effective on (UTC)', { exact: true }).fill(tomorrow)
  await proposal.getByRole('checkbox', { name: 'Safety-related change', exact: true }).check()
  await proposal.getByLabel('Change evidence file', { exact: true }).setInputFiles({ name: 'load-test.txt', mimeType: 'text/plain', buffer: Buffer.from('Rated replacement load-test result') })
  await proposal.getByLabel('Stock 1 disposition', { exact: true }).selectOption('retain')
  await proposal.getByLabel('Stock 1 reason', { exact: true }).fill('Use only on already released work')
  for (const [w, action] of [[keep, 'keep'], [adopt, 'adopt'], [cancel, 'cancel']] as const) {
    await proposal.getByLabel(`${w.reference} treatment`, { exact: true }).selectOption(action)
    await proposal.getByLabel(`${w.reference} reason`, { exact: true }).fill('Customer-specific disposition reviewed')
  }
  await shots(page, 'proposal', proposal)
  await proposal.getByRole('button', { name: 'Submit engineering proposal', exact: true }).click(); await settled(page)
  let review = page.getByRole('heading', { name: new RegExp(`Engineering change · ${product.name}`) }).first().locator('../..')
  await expect(review).toContainText('Required shear rating proven by load test'); await expect(review).toContainText('20'); await expect(review).toContainText(released.reference)
  const download = await page.request.get(origin + await review.getByRole('link', { name: 'load-test.txt' }).getAttribute('href'))
  expect(await download.text()).toBe('Rated replacement load-test result')
  await shots(page, 'pending-review', review)
  await page.goto(origin + `/app#make/wo/${adopt.id}`); await settled(page)
  await page.getByRole('button', { name: 'Release and reserve materials', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('safety-related engineering change'); await shots(page, 'pending-refusal')
  await page.goto(origin + '/app#make/boms'); await page.reload(); await settled(page)
  review = page.getByRole('heading', { name: new RegExp(`Engineering change · ${product.name}`) }).first().locator('../..')
  await review.getByRole('button', { name: 'Approve engineering change', exact: true }).click(); await settled(page)
  await expect(review).toContainText('Approved by'); await shots(page, 'approved', review)
  await review.getByLabel('Acknowledgment note', { exact: true }).fill('Replacement instructions and work treatments read')
  await review.getByRole('button', { name: 'Acknowledge approved change', exact: true }).click(); await settled(page)
  await expect(review).toContainText('Acknowledged by'); await shots(page, 'acknowledged', review)
  await page.reload(); await settled(page); await expect(review).toContainText('Replacement instructions and work treatments read')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(origin + '/app#schedule'); await settled(page)
  await page.getByRole('group', { name: 'Schedule span' }).getByRole('button', { name: 'Week', exact: true }).click()
  await page.locator('.gantt .bar').filter({ hasText: adopt.reference }).first().click()
  const adoptedStart = new Date((await page.locator('.job-panel .operations time').first().getAttribute('datetime'))!)
  const plannedLocalDay = [adoptedStart.getFullYear(), String(adoptedStart.getMonth() + 1).padStart(2, '0'), String(adoptedStart.getDate()).padStart(2, '0')].join('-')
  expect(plannedLocalDay >= tomorrow).toBe(true)
  await shots(page, 'reviewed-schedule')
  const s = await (await page.request.get(origin + '/api/larder/state')).json()
  expect(s.workOrders.find((w: any) => w.id === released.id)).toEqual(released)
  expect(s.workOrders.find((w: any) => w.id === cancel.id).status).toBe('cancelled')
  await page.goto(origin + `/app#make/wo/${keep.id}`); await settled(page)
  await page.getByRole('button', { name: 'Release and reserve materials', exact: true }).click(); await settled(page)
  await expect(page.locator('main')).toContainText('pinned to BOM revision 1'); await expect(page.locator('main')).toContainText(old.name)
  await shots(page, 'kept-work')
  await page.goto(origin + `/app#make/wo/${adopt.id}`); await settled(page)
  await page.getByRole('button', { name: 'Release and reserve materials', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('becomes effective'); await shots(page, 'future-effective-refusal')
  // Adopt today through another exact review; approved history stays retained.
  let immediate = await command(page, 'engineering.propose', { itemId: product.id, safety: true, reason: 'Immediate safe replacement authorized', effectiveOn: today, components: [{ itemId: replacement.id, quantity: '3' }], substitutes: [{ fromItemId: old.id, toItemId: replacement.id, reason: 'Same qualified replacement' }], dispositions: [{ itemId: old.id, locationId: location.id, lotId: '', status: 'available', quantity: '20', action: 'retain', reason: 'Keep for existing jobs' }], workTreatments: [{ workOrderId: adopt.id, version: s.workOrders.find((w: any) => w.id === adopt.id).version, action: 'adopt', reason: 'Immediate containment' }] })
  immediate = await command(page, 'engineering.approve', { changeId: immediate.id, version: immediate.version })
  await command(page, 'engineering.acknowledge', { changeId: immediate.id, version: immediate.version, bomId: immediate.bomId, note: 'Immediate containment read' })
  await page.reload(); await settled(page)
  await page.getByRole('button', { name: 'Release and reserve materials', exact: true }).click(); await settled(page)
  await expect(page.locator('main')).toContainText('pinned to BOM revision 3'); await expect(page.locator('main')).toContainText(replacement.name)
  await shots(page, 'adopted-work')
})
