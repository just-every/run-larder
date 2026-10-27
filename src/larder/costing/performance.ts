import { ledgerFacts } from '../operation-ledger'
// Ratios keep their numerator, denominator, missing observations and source
// identities. An absent clock or denominator can never become perfect OEE.
import { decimal, divide, format, times, SCALE, min } from '../decimal'
import { date, type State, type Context, type Row, row, get, fresh, bump, text } from '../model'
import { fail } from '../problem'
import { allow } from '../roles'
import { calendarMask, localGrid } from '../scheduling/calendars'
import { adjustedForecast, weeklyOrders } from '../forecast-plan'
const add = (a: bigint[]) => a.reduce((n, x) => n + x, 0n)
const rate = (numerator: bigint, denominator: bigint, missing: string[], sources: any[], unit = 'records') => ({
  unit,
  numerator: format(numerator),
  denominator: format(denominator),
  percent: denominator > 0n && !missing.length ? format(divide(times(numerator, decimal('100')), denominator)) : null,
  missing: [...new Set([...missing, ...(denominator === 0n ? ['No denominator observations'] : [])])],
  sources,
})
const allowed = ['from', 'to', 'site', 'center', 'itemId', 'ownerId']
export function performanceFilters(q: URLSearchParams, now = new Date().toISOString().slice(0, 10)) {
  for (const k of q.keys()) if (!allowed.includes(k)) fail('INPUT', 'Unknown performance filter.')
  const from = date(q.get('from') ?? now, 'report start'),
    to = date(q.get('to') ?? now, 'report end')
  if (
    new Date(from + 'T00:00Z').toISOString().slice(0, 10) !== from ||
    new Date(to + 'T00:00Z').toISOString().slice(0, 10) !== to
  )
    fail('INPUT', 'Use real calendar dates for this report.')
  if (to < from || Date.parse(to) - Date.parse(from) > 60 * 86400000)
    fail('INPUT', 'Choose a period of at most 61 days.')
  return {
    from,
    to,
    site: q.get('site') ?? '',
    center: q.get('center') ?? '',
    itemId: q.get('itemId') ?? '',
    ownerId: q.get('ownerId') ?? '',
  }
}
export function performanceReport(s: State, q = new URLSearchParams()) {
  const f = performanceFilters(q),
    from = Date.parse(f.from + 'T00:00Z'),
    until = Date.parse(f.to + 'T00:00Z') + 86400000,
    within = (at: string) => Date.parse(at) >= from && Date.parse(at) < until
  const jobs = s.workOrders.filter(
    (w) =>
      (!f.itemId || w.itemId === f.itemId) &&
      (!f.site || s.movements.some((m) => m.documentId === w.id && m.locationId === f.site)) &&
      (!f.center || w.routing.some((r: any) => r.workCentre === f.center)) &&
      (!f.ownerId || w.createdBy === f.ownerId || w.operationStates?.some((t: any) => t.startedBy === f.ownerId)),
  )
  const operations = jobs.flatMap((w) =>
    (w.operationStates ?? [])
      .filter(
        (t: any) =>
          (!f.center || t.workCentre === f.center) &&
          (!f.ownerId || t.startedBy === f.ownerId) &&
          t.startedAt &&
          Date.parse(t.startedAt) < until &&
          (!t.completedAt || Date.parse(t.completedAt) >= from),
      )
      .map((t: any) => {
        const step = w.routing.find((r: any) => r.sequence === t.sequence),
          start = Math.max(from, Date.parse(t.startedAt)),
          stop = Math.min(until, Date.parse(t.completedAt))
        const known = Number.isFinite(start) && Number.isFinite(stop) && stop >= start
        const spans = (t.downtime ?? [])
          .map((d: any) => [
            Math.max(start, Date.parse(d.startedAt)),
            Math.min(stop, Date.parse(d.stoppedAt ?? t.completedAt)),
          ])
          .filter(([a, b]: number[]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
          .sort((a: number[], b: number[]) => a[0] - b[0])
        let last = start,
          downtime = 0
        for (const [a, b] of spans) {
          downtime += Math.max(0, b - Math.max(a, last))
          last = Math.max(last, b)
        }
        const ledger = ledgerFacts(w, step)
        const good = ledger.received - ledger.scrapped - ledger.inProcess - ledger.backordered
        return {
          workOrderId: w.id,
          reference: w.reference,
          sequence: t.sequence,
          itemId: w.itemId,
          ownerId: t.startedBy,
          center: t.workCentre,
          startedAt: t.startedAt ?? null,
          completedAt: t.completedAt ?? null,
          elapsedMs: known ? stop - start : null,
          downtimeMs: known ? downtime : null,
          activeMs: known ? stop - start - downtime : null,
          idealMinutes: step?.runMinutes ?? step?.minutes ?? null,
          good: format(good > 0n ? good : 0n),
          scrap: format(ledger.scrapped),
          held: format(ledger.held),
          quantityInPeriod:
            Boolean(t.completedAt) && Date.parse(t.startedAt) >= from && Date.parse(t.completedAt) < until,
          reports: t.reports ?? [],
          downtime: t.downtime ?? [],
        }
      }),
  )
  const timeMissing = operations
    .filter((o) => o.activeMs === null)
    .map((o) => `${o.reference} step ${o.sequence}: incomplete operation clock`)
  if (!operations.length) timeMissing.push('No recorded operation clocks for these filters')
  // Parallel crews/operations use summed machine-slot minutes, matching the
  // parallel-slot calendar denominator. No inferred clock fills a gap.
  const elapsed = BigInt(operations.reduce((n, o) => n + (o.elapsedMs ?? 0), 0)),
    active = BigInt(operations.reduce((n, o) => n + (o.activeMs ?? 0), 0)),
    downtime = BigInt(operations.reduce((n, o) => n + (o.downtimeMs ?? 0), 0))
  const calendars = s.machineCalendars.filter(
    (m) => (!f.center || m.name === f.center) && (!f.site || m.locationId === f.site),
  )
  const capacity = calendars.reduce(
    (n, m) =>
      n +
      BigInt(
        calendarMask(m, localGrid(m.timeZone, from, (until - from) / 60000), from).reduce((n, x) => n + x, 0) *
          m.capacity *
          60000,
      ),
    0n,
  )
  const capacityMissing = [
    ...timeMissing,
    ...(!calendars.length ? ['No configured machine-slot calendar for these filters'] : []),
    ...(f.ownerId ? ['Person-filtered machine capacity is not allocated to an individual'] : []),
  ]
  const finished = jobs.filter((w) => w.closedAt && within(w.closedAt)),
    output = add(finished.map((w) => decimal(w.output))),
    scrap = add(finished.map((w) => decimal(w.scrap)))
  const adherence = operations
    .filter((o) => o.completedAt)
    .map((o) => {
      const booking = s.scheduleBookings
        .filter(
          (b) =>
            b.approvedAt <= o.startedAt &&
            b.operations?.some((x: any) => x.workOrderId === o.workOrderId && x.sequence === o.sequence),
        )
        .at(-1)
      const slot = booking?.operations.find((x: any) => x.workOrderId === o.workOrderId && x.sequence === o.sequence)
      return { ...o, scheduledEnd: slot?.endsAt ?? null, onTime: slot ? o.completedAt <= slot.endsAt : null }
    })
  const ideal = add(
    operations
      .filter((o) => o.idealMinutes !== null)
      .map((o) => times(decimal(String(o.idealMinutes)), decimal(o.good) + decimal(o.scrap))),
  )
  const suppliers = s.purchaseOrders
    .flatMap((po) =>
      po.lines
        .filter((l: any) => (!f.itemId || l.itemId === f.itemId) && (!f.ownerId || po.createdBy === f.ownerId))
        .map((l: any) => {
          const sources = s.receipts
            .filter((r) => r.poId === po.id)
            .flatMap((r) =>
              r.lines
                .filter((x: any) => x.lineId === l.id && (!f.site || x.locationId === f.site))
                .map((x: any) => {
                  const m = s.movements.find((m) => m.id === x.movementId),
                    net = m
                      ? m.quantity +
                        s.movements.filter((v) => v.reversesId === m.id).reduce((n, v) => n + v.quantity, 0n)
                      : 0n
                  const expectedDate = x.expectedDate ?? l.confirmedDate ?? l.expectedDate ?? po.expectedDate
                  const releases = s.approvals.filter(
                    (a) =>
                      a.subjectKind === 'lots' &&
                      a.subjectId === x.lotId &&
                      a.decision === 'released' &&
                      a.createdAt.slice(0, 10) <= expectedDate,
                  )
                  const accepted =
                    x.inspection === 'quarantine' ? min(net, add(releases.map((a) => decimal(a.quantity)))) : net
                  return {
                    expectedDate,
                    acceptedOnTime: r.createdAt.slice(0, 10) <= expectedDate ? format(accepted) : '0',
                    qualityDecisionIds: releases.map((a) => a.id),
                    receiptId: r.id,
                    movementId: x.movementId,
                    arrivedOn: r.createdAt.slice(0, 10),
                    quantity: format(net),
                    inspection: x.inspection,
                    rejected: s.movements.some((m) => m.kind === 'reject' && m.lotId === x.lotId),
                  }
                }),
            )
          const promised = sources[0]?.expectedDate ?? l.confirmedDate ?? l.expectedDate ?? po.expectedDate,
            onTime = add(sources.filter((x) => x.arrivedOn <= promised).map((x) => decimal(x.acceptedOnTime)))
          return {
            poId: po.id,
            lineId: l.id,
            supplierId: po.supplierId,
            promised,
            ordered: l.quantity,
            onTimeAccepted: format(onTime),
            otif: onTime >= decimal(l.quantity),
            sources,
          }
        }),
    )
    .filter((x) => (!f.site || x.sources.length > 0) && within(x.promised + 'T00:00Z'))
  const forecasts = s.forecasts
    .filter(
      (forecast) => (!f.itemId || forecast.itemId === f.itemId) && forecast.week >= f.from && forecast.week <= f.to,
    )
    .map((forecast) => {
      const bucket = weeklyOrders(s).get(`${forecast.itemId}|${forecast.week}`),
        actual = bucket?.actual ?? 0n,
        expected = adjustedForecast(forecast)
      return {
        forecastId: forecast.id,
        itemId: forecast.itemId,
        week: forecast.week,
        forecast: format(expected),
        actual: format(actual),
        absoluteError: format(actual > expected ? actual - expected : expected - actual),
        sources: bucket?.sources ?? [],
      }
    })
  const forecastMissing =
    f.site || f.center || f.ownerId ? ['Forecast demand has no site, center or person attribution'] : []
  const availability = rate(active * SCALE, elapsed * SCALE, timeMissing, operations, 'milliseconds'),
    performance = rate(
      times(ideal, decimal('60000')),
      active * SCALE,
      [
        ...timeMissing,
        ...operations
          .filter((o) => !o.quantityInPeriod)
          .map((o) => `${o.reference}: interval output quantities not recorded`),
        ...(operations.some((o) => o.idealMinutes === null) ? ['Missing pinned ideal run time'] : []),
      ],
      operations,
      'milliseconds',
    ),
    finalYield = rate(
      output,
      output + scrap,
      finished.length ? [] : ['No completed output quantities'],
      finished.map((w) => ({ workOrderId: w.id, output: w.output, scrap: w.scrap, outputs: w.outputs ?? [] })),
      'base units',
    )
  const operationGood = add(operations.map((o) => decimal(o.good))),
    operationScrap = add(operations.map((o) => decimal(o.scrap)))
  const quality = rate(
    operationGood,
    operationGood + operationScrap,
    operations.length
      ? operations
          .filter((o) => !o.quantityInPeriod || decimal(o.held) > 0n)
          .map((o) => `${o.reference}: incomplete interval quantities or unresolved held units`)
      : ['No operation quantity observations'],
    operations,
    'operation units',
  )
  const oee = rate(
    times(times(ideal, decimal('60000')), operationGood),
    times(elapsed * SCALE, operationGood + operationScrap),
    [...new Set([...availability.missing, ...performance.missing, ...quality.missing])],
    operations,
    'milliseconds × units',
  )
  return {
    filters: f,
    basis:
      'UTC event period; site is an existing stock location. OTD is closed jobs by required date. Utilization uses configured machine-slot milliseconds; incomplete time is unknown. OEE uses operation quantities, availability × performance × quality, uncapped; yield uses final job output. Cross-period output quantities stay unknown. Supplier OTIF requires accepted ordered units by the first receipt’s pinned expected date (the current promise for an undelivered line). Forecast error is absolute units / actual demand. No external sends.',
    metrics: {
      onTimeDelivery: rate(
        BigInt(finished.filter((w) => w.closedAt.slice(0, 10) <= w.requiredBy).length) * SCALE,
        BigInt(finished.length) * SCALE,
        [],
        finished.map((w) => ({ workOrderId: w.id, requiredBy: w.requiredBy, closedAt: w.closedAt })),
      ),
      scheduleAdherence: rate(
        BigInt(adherence.filter((o) => o.onTime === true).length) * SCALE,
        BigInt(adherence.length) * SCALE,
        adherence.filter((o) => o.onTime === null).map((o) => `${o.reference}: no retained booked end`),
        adherence,
      ),
      utilization: rate(active * SCALE, capacity * SCALE, capacityMissing, operations, 'milliseconds'),
      availability,
      performance,
      quality,
      oee,
      downtime: {
        ...rate(downtime * SCALE, elapsed * SCALE, timeMissing, operations, 'milliseconds'),
        milliseconds: String(downtime),
      },
      yield: finalYield,
      supplierOtif: rate(
        BigInt(suppliers.filter((x) => x.otif).length) * SCALE,
        BigInt(suppliers.length) * SCALE,
        f.center ? ['Purchase receipts have no work-center attribution'] : [],
        suppliers,
      ),
      forecastError: rate(
        add(forecasts.map((x) => decimal(x.absoluteError))),
        add(forecasts.map((x) => decimal(x.actual))),
        forecastMissing,
        forecasts,
        'base units',
      ),
    },
  }
}

export function reportScheduling(c: Context, type: string, p: any): Row | undefined {
  if (!type.startsWith('reports.')) return
  allow(c, []) // New report schedules require the owner's explicit consent.
  if (type === 'reports.schedule') {
    const filters = performanceFilters(new URLSearchParams(p.filters ?? {}))
    if (p.consent !== true) fail('CONSENT', 'Explicit consent is required to save a report schedule.')
    return row(c, 'reportSchedules', {
      filters,
      status: 'active',
      ownerId: c.actor.id,
      cadence: 'daily',
      delivery: 'daily in-app snapshots while the consenting native owner session is live; no external send',
      nextDate: c.now.slice(0, 10),
      reason: text(p.reason, 'schedule reason', 400),
      consent: { by: c.actor.id, at: c.now },
      snapshots: [],
    })
  }
  const r = get(c.s, 'reportSchedules', p.scheduleId)
  fresh(r, p.version)
  if (r.ownerId !== c.actor.id && c.actor.role !== 'owner')
    fail('FORBIDDEN', 'Only the schedule owner manages this report.')
  if (type === 'reports.cancel') return bump(r, { status: 'cancelled', reason: text(p.reason, 'cancel reason', 400) })
  if (type === 'reports.run') {
    if (r.status !== 'active' || r.nextDate > c.now.slice(0, 10)) fail('STATE', 'This in-app report is not due.')
    const snapshot = performanceReport(c.s, new URLSearchParams(r.filters)),
      tomorrow = new Date(Date.parse(c.now.slice(0, 10) + 'T00:00Z') + 86400000).toISOString().slice(0, 10)
    return bump(r, { snapshots: [...r.snapshots, { at: c.now, by: r.ownerId, ownerName: c.reportAuthority?.name ?? c.actor.name, generation: c.automaticReport ? 'scheduled' : 'manual', report: snapshot }], nextDate: tomorrow })
  }
}
