import { expect, type Page, type Browser } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { resourceFixture } from '../api/resource-fixture.mjs'

const origin = process.env.LARDER_BASE_URL || 'http://127.0.0.1:8787'
const state = (page: Page) => page.evaluate(async () => (await fetch('/api/larder/state', { cache: 'no-store' })).json())
async function shot(page: Page, name: string) {
  const shots = process.env.LARDER_SCREENSHOTS
  if (!shots) return
  await mkdir(shots, { recursive: true })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: join(shots, `${page.viewportSize()!.width}-${name}.png`), fullPage: true })
}

// Part of the existing order journey; this helper registers no extra test.
export async function resourceScreens(page: Page, browser: Browser) {
  // Compare the new read projections with the existing native screens, using
  // real test identities and their current authority at each HTTP read.
  const command = async (type: string, payload: object) => {
    const r = await page.request.post(origin + '/api/larder/commands', { headers: { Origin: origin }, data: { commandId: crypto.randomUUID(), type, payload } })
    const body = await r.json(); expect(body.ok, JSON.stringify(body.error)).toBe(true); return body.result
  }
  const suffix = '-' + crypto.randomUUID().slice(0, 6)
  const f = await resourceFixture({ command, state: () => state(page) }, undefined, suffix)
  for (const role of ['accounts', 'operator']) {
    const email = [`synthetic-larder-resource-${role}${suffix}`, 'example.test'].join('@')
    expect((await page.request.post(origin + '/auth/invite', { headers: { Origin: origin }, data: { email, displayName: 'Resource ' + role, role: 'member' } })).status()).toBe(202)
    const context = await browser.newContext({ storageState: await page.context().storageState() })
    try {
      const member = await context.newPage()
      await member.goto(origin + '/auth/dev/enter?as=' + encodeURIComponent(email)); await member.waitForURL(u => u.pathname === '/app')
      const person = (await (await member.request.get(origin + '/auth/session')).json()).operator.id
      await command('role.set', { operatorId: person, role })
      if (role === 'operator') await command('member.scope', { operatorId: person, locations: [f.loc.id], costsRestricted: true })
      await member.reload()
      await expect(member.locator('main')).toHaveAttribute('aria-busy', 'false')
      await member.setViewportSize({ width: 1440, height: 1000 })
      const native = await state(member)
      expect(native.actor.role).toBe(role)
      if (role === 'operator') expect(native.actor.scope.costs).toBe(true)
      const read = async (kind: string, id: string) => {
        const r = await member.request.get(origin + `/api/larder/v1/resources/${kind}/${id}`)
        expect(r.status()).toBe(200); return r.json()
      }
      const receipt = await read('receipts', f.receipt.id), output = await read('outputs', f.batch.id), shipment = await read('shipments', f.shipment.id)
      expect(receipt.data).toEqual(native.receipts.find((r: any) => r.id === f.receipt.id))
      expect(output.data).toEqual({ ...native.workOrders.find((r: any) => r.id === f.work.id).outputs.find((o: any) => o.id === f.batch.id), workOrderId: f.work.id, version: f.work.version })
      expect(shipment.data).toEqual(native.shipments.find((r: any) => r.id === f.shipment.id))
      for (const projection of [receipt, output, shipment]) for (const link of [...projection.links, ...projection.planning.links]) {
        const linked = await member.request.get(origin + link.href)
        expect(linked.status()).toBe(200); expect((await linked.json()).resource).toEqual(link)
      }
      for (const projection of [receipt, output, shipment]) {
        const { href, links, ...pegs } = projection.planning
        const current = await member.request.get(origin + href)
        expect(current.status()).toBe(200); expect(await current.json()).toEqual(pegs)
        expect(projection.files.some((file: any) => file.id === f.receipt.documents[0].id)).toBe(true)
        for (const file of projection.files) {
          const download = await member.request.get(origin + file.href)
          expect(download.status()).toBe(200)
          expect(createHash('sha256').update(await download.body()).digest('hex')).toBe(file.sha256)
        }
      }
      expect((await member.request.get(origin + `/api/larder/attachments/${f.billFile.id}`)).status()).toBe(role === 'accounts' ? 200 : 403)
      expect(receipt.data.lines[0].quantity).toBe('6'); expect(output.data.good).toBe('3'); expect(shipment.data.lines[0].quantity).toBe('2')
      for (const projection of [output, shipment]) {
        const [allocation] = projection.physical.allocations
        expect([allocation.output.id, allocation.lot.id, allocation.quantity]).toEqual([f.batch.id, f.receipt.lines[0].lotId, '3'])
        const movement = await member.request.get(origin + allocation.movement.href)
        expect((await movement.json()).data.quantity).toBe('-4')
      }
      const screens = [
        ['receipt', `make/po/${f.purchase.id}`, f.receipt.supplierReference],
        ['output', `make/wo/${f.work.id}`, 'Materials used'],
        ['shipment', `orders/${f.order.id}`, 'Part shipped'],
        ['lots', 'stock', 'synthetic-larder-resource-output-lot'],
      ]
      for (const [name, hash, text] of screens) {
        await member.goto(origin + '/app#' + hash); await member.reload()
        await expect(member.locator('main')).toHaveAttribute('aria-busy', 'false')
        await expect(member.locator('main')).toContainText(text)
        if (name === 'output') await expect(member.locator('main')).toContainText(role === 'operator' ? 'restricted' : '$29.00')
        if (role === 'operator') await expect(member.locator('main')).not.toContainText('$7.25')
        await shot(member, 'SURFACE-007-' + role + '-' + name)
        await member.setViewportSize({ width: 390, height: 1000 })
        await shot(member, 'SURFACE-007-' + role + '-' + name)
        await member.setViewportSize({ width: 1440, height: 1000 })
      }
    } finally { await context.close() }
  }

}
