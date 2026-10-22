import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787'

async function start(page: Page, journey: string) {
  if (!process.env.LARDER_OPEN) throw new Error('Private local entry required.')
  await page.goto(process.env.LARDER_OPEN); await page.waitForURL(u => ['/setup', '/app'].includes(u.pathname))
  if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app') }
  const send = async (type: string, payload: object) => { const res = await page.request.post(origin + '/api/larder/commands', { headers: { origin }, data: { commandId: crypto.randomUUID(), type, payload } }); const body = await res.json(); expect(body.ok, JSON.stringify(body)).toBe(true); return body.result }
  const settled = async () => { await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false'); await expect(page.getByRole('alert')).toHaveCount(0) }
  const shots = async (stage: string) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      if (process.env.LARDER_SCREENSHOTS) { await mkdir(process.env.LARDER_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: join(process.env.LARDER_SCREENSHOTS, `${width}-${journey}-${stage}.png`), fullPage: true }) }
    }
  }
  return { send, settled, shots }
}

test('GOV-002 the owner sets a two-signature policy, a signature is given and then invalidated by a changed input at 1440/390', async ({ page }) => {
  const { send, settled, shots } = await start(page, 'GOV-002')
  const supplier = await send('party.save', { name: 'Approval Timber', kind: 'supplier' })
  const item = await send('item.save', { sku: 'APR-1', name: 'Approval blank', kind: 'buy', baseUnit: 'each' })
  try {
    await page.goto(origin + '/app#more/approvals'); await settled()
    const policy = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Approval policies', exact: true }) })
    await policy.getByLabel('Approval', { exact: true }).selectOption('spend')
    await policy.getByLabel('Threshold', { exact: true }).fill('100')
    await policy.getByLabel('Signatures needed', { exact: true }).selectOption('2')
    await policy.getByLabel('Reason', { exact: true }).fill('Two people above $100')
    await policy.getByRole('button', { name: 'Save policy', exact: true }).click(); await settled()
    await expect(policy).toContainText('Purchase orders (spend)')
    const po = await send('po.draft', { supplierId: supplier.id, expectedDate: '2030-01-10', reason: 'Approval proof', lines: [{ itemId: item.id, quantity: '20', unitPrice: '10' }] })
    const signed = await send('po.approve', { poId: po.id, version: po.version })
    expect(signed.remainingAtSigning).toBe(1)
    await page.reload(); await settled()
    const signatures = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Signatures', exact: true }) })
    await expect(signatures).toContainText('Valid')
    await shots('valid')
    await send('po.amend', { poId: po.id, version: po.version, lines: [{ lineId: po.lines[0].id, quantity: '25' }], reason: 'Bigger order' })
    await page.reload(); await settled()
    await expect(signatures).toContainText('Invalidated')
    await shots('invalidated')
  } finally {
    // Later journeys share this installation: purchase orders go back to one approver.
    await send('approval.policy', { category: 'spend', thresholdUsd: '100', signatures: 2, enabled: false, reason: 'Approval journey finished' })
  }
})

test('GOV-008 a quality-hold release under a two-signature quality threshold is signed once and then invalidated by a changed held quantity at 1440/390', async ({ page }) => {
  const { send, settled, shots } = await start(page, 'GOV-008')
  const today = new Date().toISOString().slice(0, 10)
  const supplier = await send('party.save', { name: 'Quality Plates', kind: 'supplier' })
  const location = await send('location.save', { name: 'Quality shelf' })
  const item = await send('item.save', { sku: 'QLT-1', name: 'Quality plate', kind: 'buy', baseUnit: 'each' })
  const po = await send('po.draft', { supplierId: supplier.id, expectedDate: today, reason: 'Held plates', lines: [{ itemId: item.id, quantity: '10', unitPrice: '10' }] })
  await send('po.approve', { poId: po.id, version: po.version })
  await send('receipt.create', { poId: po.id, supplierReference: 'synthetic-larder-32', lines: [{ lineId: po.lines[0].id, locationId: location.id, quantity: '10', lot: 'QLT-LOT' }] })
  const lot = (await (await page.request.get(origin + '/api/larder/state')).json()).lots.find((l: any) => l.code === 'QLT-LOT')
  const plan = await send('quality.plan.save', { itemId: item.id, stage: 'receipt', name: 'Plate finish', sampleSize: 1, measurements: [{ name: 'Roughness', unit: 'um', target: '1', lower: '0', upper: '2' }] })
  const live = await send('quality.plan.approve', { planId: plan.id, version: plan.version })
  const inspect = (value: string) => send('quality.inspect', { planId: live.id, planVersion: live.version, lotId: lot.id, samples: { Roughness: [value] } })
  await inspect('3'); await inspect('1')
  const hold = (await (await page.request.get(origin + '/api/larder/state')).json()).qualityHolds.find((h: any) => h.subjectId === lot.id)
  try {
    await page.goto(origin + '/app#more/approvals'); await settled()
    const policy = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Approval policies', exact: true }) })
    await policy.getByLabel('Approval', { exact: true }).selectOption('quality')
    await policy.getByLabel('Threshold', { exact: true }).fill('15')
    await policy.getByLabel('Signatures needed', { exact: true }).selectOption('2')
    await policy.getByLabel('Reason', { exact: true }).fill('Two people release held stock above $15')
    await policy.getByRole('button', { name: 'Save policy', exact: true }).click(); await settled()
    await expect(policy).toContainText('Quality releases (value released)')
    const signed = await send('quality.release', { holdId: hold.id, version: hold.version, reason: 'Retest passed', evidence: [{ name: 'retest.txt', contentType: 'text/plain', base64: Buffer.from('Retest record').toString('base64') }] })
    expect(signed.remainingAtSigning).toBe(1)
    await page.reload(); await settled()
    const signatures = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Signatures', exact: true }) })
    await expect(signatures).toContainText('Quality hold release')
    await expect(signatures).toContainText('Valid')
    await shots('valid')
    await send('quarantine.decide', { itemId: item.id, locationId: location.id, lotId: lot.id, quantity: '4', decision: 'reject', reason: 'Out of tolerance' })
    await page.reload(); await settled()
    await expect(signatures).toContainText('Invalidated')
    await shots('invalidated')
  } finally {
    // Later journeys share this installation: quality releases go back to one approver.
    await send('approval.policy', { category: 'quality', thresholdUsd: '15', signatures: 2, enabled: false, reason: 'Approval journey finished' })
  }
})
