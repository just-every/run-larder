// Shared native recovery setup; every business record is created through HTTP.
const week = '2026-11-25T00:00:00Z'
const calendar = (name, changes = {}) => ({ name, timeZone: 'UTC', effectiveFrom: '2026-01-01', effectiveTo: '2027-12-31', shifts: [{ weekdays: [0, 1, 2, 3, 4, 5, 6], start: 0, end: 1440, breaks: [] }], closedDates: [], usHolidays: false, exceptions: [], capacity: 1, efficiency: 100, reason: 'synthetic-larder-821 recorded calendar', ...changes })

export async function recoveryFixture(h, w, planner = { run: h.command }) {
  const owner = (await h.state()).actor
  const raw = await h.command('item.save', { sku: 'RECOVERY-INPUT', name: 'Recovery input', kind: 'buy', baseUnit: 'each' })
  const product = await h.command('item.save', { sku: 'RECOVERY-PART', name: 'Recovery part', kind: 'make', baseUnit: 'each' })
  const names = ['Recovery primary', 'Recovery alternate A', 'Recovery alternate B']
  for (const [index, name] of names.entries()) {
    const machine = await h.command('capacity.machine', calendar(name, { timeZone: 'UTC', ...(index === 0 ? { closedDates: ['2026-11-26', '2026-11-27', '2026-11-28'] } : {}) }))
    await h.command('capacity.sequence', { id: machine.id, version: machine.version, tools: ['Recovery fixture'], initialFamily: 'part', changeovers: [], planningHourlyCost: String(60 + index * 30), reason: 'Recorded qualified machine and public estimate' })
  }
  const labor = (await h.state()).laborCalendars.find(l => l.operatorIds.includes(owner.id))
  await h.command('capacity.labor', calendar(labor?.name ?? 'Recovery operator', { ...(labor ? { id: labor.id, version: labor.version } : {}), timeZone: 'UTC', operatorIds: [owner.id], skills: [...new Set([...(labor?.skills ?? []), 'recovery cutting'])] }))
  await h.command('bom.revise', { itemId: product.id, components: [{ itemId: raw.id, quantity: '1' }], routing: [{ name: 'Recovery cut', workCentre: names[0], eligibleCentres: names, setupFamily: 'part', requiredTools: ['Recovery fixture'], requiredSkills: ['recovery cutting'], minutes: 60 }] })
  let order = await h.command('so.quote', { customerId: w.customer.id, promiseDate: '2026-11-27', lines: [{ itemId: product.id, quantity: '2', unitPrice: '90' }] })
  order = await h.command('so.confirm', { orderId: order.id, version: order.version, reserve: false })
  let job = await h.command('plan.draft', { itemId: product.id, reason: 'Approved customer demand' })
  job = await h.command('wo.release', { workOrderId: job.id, version: job.version })
  const pinned = await planner.run('proposal.prepare', { kind: 'reschedule', summary: 'Original primary machine', evidence: ['Pinned routing'], plan: { changes: [{ workOrderId: job.id, plannedStart: '2026-11-25', scheduleChoices: { 1: names[0] } }], capacity: { asOf: week, days: 7 } } })
  await h.command('proposal.approve', { proposalId: pinned.id, version: pinned.version })
  let po = await h.command('po.draft', { supplierId: w.supplier.id, expectedDate: '2026-11-25', reason: 'Named input source', lines: [{ itemId: raw.id, quantity: '2', unitPrice: '8' }] })
  po = await h.command('po.approve', { poId: po.id, version: po.version })
  await planner.run('schedule.protect', { asOf: week, days: 7, freezeUntil: week, manualLocks: [], reason: 'Continuous recovery window; no frozen operations' })
  return { raw, product, names, order, job, po }
}

// Exclude only the archive creation time; all persisted records and commands remain.
export async function recoveryBusiness(h) {
  const { exportedAt, ...snapshot } = await (await h.request('/api/larder/archive')).json()
  return snapshot
}
