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
    const beforeGroup = await (await page.request.get(origin + '/api/larder/state')).json()
    const grouped = await send('proposal.prepare', { kind: 'replenishment', summary: 'Two reviewed deliveries', evidence: ['Supplier delivery review'], plan: { explanation: 'One grouped purchasing decision', purchases: [1, 2].map(n => ({ supplierId: supplier.id, expectedDate: `2030-01-1${n}`, lines: [{ itemId: item.id, quantity: '6', unitPrice: '10' }] })) } })
    const groupSignature = await send('proposal.approve', { proposalId: grouped.id, version: grouped.version })
    expect(groupSignature.remainingAtSigning).toBe(1)
    const afterGroup = await (await page.request.get(origin + '/api/larder/state')).json()
    expect(afterGroup.purchaseOrders).toEqual(beforeGroup.purchaseOrders)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.reload(); await settled()
    await expect(signatures).toContainText('Grouped replenishment')
    await shots('grouped-replenishment')
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
  await send('receipt.create', { poId: po.id, supplierReference: 'QLT-RECEIPT', lines: [{ lineId: po.lines[0].id, locationId: location.id, quantity: '10', lot: 'QLT-LOT' }] })
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

test('GOV-011 an expired-lot write-off under a two-signature inventory-adjustment threshold is signed once and then invalidated by a stock movement at 1440/390', async ({ page }) => {
  const { send, settled, shots } = await start(page, 'GOV-011')
  const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
  const supplier = await send('party.save', { name: 'Write-off Extracts', kind: 'supplier' })
  const location = await send('location.save', { name: 'Write-off shelf' })
  const item = await send('item.save', { sku: 'WOF-1', name: 'Write-off extract', kind: 'buy', baseUnit: 'each' })
  const po = await send('po.draft', { supplierId: supplier.id, expectedDate: day(0), reason: 'Expired extract', lines: [{ itemId: item.id, quantity: '10', unitPrice: '10' }] })
  await send('po.approve', { poId: po.id, version: po.version })
  await send('receipt.create', { poId: po.id, supplierReference: 'WOF-RECEIPT', lines: [{ lineId: po.lines[0].id, locationId: location.id, quantity: '10', lot: 'WOF-LOT', dates: { expiresOn: day(-1) } }] })
  const lot = (await (await page.request.get(origin + '/api/larder/state')).json()).lots.find((l: any) => l.code === 'WOF-LOT')
  try {
    await page.goto(origin + '/app#more/approvals'); await settled()
    const policy = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Approval policies', exact: true }) })
    await policy.getByLabel('Approval', { exact: true }).selectOption('inventoryAdjustment')
    await policy.getByLabel('Threshold', { exact: true }).fill('50')
    await policy.getByLabel('Signatures needed', { exact: true }).selectOption('2')
    await policy.getByLabel('Reason', { exact: true }).fill('Two people write off stock above $50')
    await policy.getByRole('button', { name: 'Save policy', exact: true }).click(); await settled()
    await expect(policy).toContainText('Stock write-offs')
    const signed = await send('lot.dispose', { lotId: lot.id, version: lot.version, decision: 'scrap', locationId: location.id, reason: 'Expired; destroyed', evidence: [{ name: 'disposal.txt', contentType: 'text/plain', base64: Buffer.from('Disposal record').toString('base64') }] })
    expect(signed.remainingAtSigning).toBe(1)
    await page.reload(); await settled()
    const signatures = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Signatures', exact: true }) })
    await expect(signatures).toContainText('Expired lot write-off')
    await expect(signatures).toContainText('Valid')
    await shots('valid')
    const count = await send('count.record', { itemId: item.id, locationId: location.id, lotId: lot.id, counted: '9' })
    await send('count.approve', { countId: count.id, version: count.version })
    await page.reload(); await settled()
    await expect(signatures).toContainText('Invalidated')
    await shots('invalidated')
  } finally {
    // Later journeys share this installation: write-offs go back to one approver.
    await send('approval.policy', { category: 'inventoryAdjustment', thresholdUsd: '50', signatures: 2, enabled: false, reason: 'Approval journey finished' })
  }
})

test('GOV-009 a reschedule under a two-signature schedule threshold is signed once and then invalidated by a changed work order at 1440/390', async ({ page }) => {
  const { send, settled, shots } = await start(page, 'GOV-009')
  const part = await send('item.save', { sku: 'SCH-1', name: 'Schedule assembly', kind: 'make', baseUnit: 'each' })
  const blank = await send('item.save', { sku: 'SCH-2', name: 'Schedule blank', kind: 'buy', baseUnit: 'each' })
  await send('bom.revise', { itemId: part.id, components: [{ itemId: blank.id, quantity: '1' }] })
  const job = await send('wo.draft', { itemId: part.id, quantity: '1', requiredBy: '2030-01-20', plannedStart: '2030-01-10', reason: 'Schedule approval proof' })
  const proposal = await send('proposal.prepare', { kind: 'reschedule', summary: 'Move the assembly later', evidence: ['bench review'], plan: { changes: [{ workOrderId: job.id, plannedStart: '2030-01-14', priority: 1 }], conflicts: [] } })
  try {
    await page.goto(origin + '/app#more/approvals'); await settled()
    const policy = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Approval policies', exact: true }) })
    await policy.getByLabel('Approval', { exact: true }).selectOption('schedule')
    await policy.getByLabel('Threshold', { exact: true }).fill('0')
    await policy.getByLabel('Signatures needed', { exact: true }).selectOption('2')
    await policy.getByLabel('Reason', { exact: true }).fill('Two people for every reschedule')
    await policy.getByRole('button', { name: 'Save policy', exact: true }).click(); await settled()
    await expect(policy).toContainText('Schedule adoptions and grants')
    await expect(policy).toContainText('min of per-job delay')
    const signed = await send('proposal.approve', { proposalId: proposal.id, version: proposal.version })
    expect(signed.remainingAtSigning).toBe(1)
    await page.reload(); await settled()
    const signatures = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Signatures', exact: true }) })
    await expect(signatures).toContainText('Reschedule')
    await expect(signatures).toContainText('min of delay')
    await expect(signatures).toContainText('Valid')
    await shots('valid')
    await send('order.rank', { kind: 'work', orderId: job.id, version: job.version, rank: 1 })
    await page.reload(); await settled()
    await expect(signatures).toContainText('Invalidated')
    await shots('invalidated')
  } finally {
    // Later journeys share this installation: reschedules go back to one approver.
    await send('approval.policy', { category: 'schedule', thresholdMinutes: 0, signatures: 2, enabled: false, reason: 'Approval journey finished' })
  }
})
