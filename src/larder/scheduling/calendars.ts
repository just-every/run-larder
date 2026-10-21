import { bump, date, fresh, get, list, row, text, type Context, type Row } from '../model'
import { decimal, format } from '../decimal'
import { fail } from '../problem'
import { allow } from '../roles'

export const rateReaders = ['owner', 'manager', 'accounts']
export function integer(v: unknown, name: string, min: number, max: number): number {
  if (!Number.isInteger(v) || Number(v) < min || Number(v) > max) fail('INPUT', `${name} must be an integer from ${min} to ${max}.`)
  return Number(v)
}
export function instant(v: unknown, name: string): string {
  if (typeof v !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(v) || !Number.isFinite(Date.parse(v))) fail('INPUT', `${name} needs a timestamp with UTC offset.`)
  return new Date(v as string).toISOString()
}
function strings(v: unknown, label: string): string[] {
  if (!Array.isArray(v) || v.length > 100) fail('INPUT', `${label} must be an array of at most 100 names.`)
  return [...new Set((v as any[]).map(x => text(x, label, 120)))]
}
function definition(p: any) {
  const timeZone = text(p.timeZone, 'IANA time zone', 80)
  try { new Intl.DateTimeFormat('en-US', { timeZone }).format() } catch { fail('INPUT', 'Choose an IANA time zone.') }
  const calendarDate = (v: unknown) => { const d = date(v); if (new Date(d + 'T00:00Z').toISOString().slice(0, 10) !== d) fail('INPUT', 'Use a real calendar date.'); return d }
  const effectiveFrom = calendarDate(p.effectiveFrom), effectiveTo = calendarDate(p.effectiveTo)
  if (effectiveTo < effectiveFrom) fail('INPUT', 'Effective end precedes start.')
  const shifts = list<any>(p.shifts, 'shifts', 14).map(s => {
    const weekdays = list<number>(s.weekdays, 'weekdays', 7).map(d => integer(d, 'weekday', 0, 6))
    const start = integer(s.start, 'shift start minute', 0, 1439), end = integer(s.end, 'shift end minute', start + 1, start + 1440)
    const breaks = (s.breaks === undefined || (Array.isArray(s.breaks) && !s.breaks.length) ? [] : list<any>(s.breaks, 'breaks', 20)).map((b: any) => {
      const from = integer(b.start, 'break start', start, end - 1), to = integer(b.end, 'break end', from + 1, end)
      return { start: from, end: to }
    })
    return { weekdays: [...new Set(weekdays)], start, end, breaks }
  })
  const closedDates = p.closedDates === undefined ? [] : strings(p.closedDates, 'closed dates').map(d => calendarDate(d))
  if (p.usHolidays !== undefined && typeof p.usHolidays !== 'boolean') fail('INPUT', 'US holidays must be true or false.')
  const exceptions = (p.exceptions === undefined || (Array.isArray(p.exceptions) && !p.exceptions.length) ? [] : list<any>(p.exceptions, 'exceptions', 100)).map(x => {
    const startsAt = instant(x.startsAt, 'exception start'), endsAt = instant(x.endsAt, 'exception end')
    if (endsAt <= startsAt) fail('INPUT', 'Exception end must follow start.')
    return { startsAt, endsAt, reason: text(x.reason, 'exception reason') }
  })
  return { timeZone, effectiveFrom, effectiveTo, shifts, closedDates, usHolidays: p.usHolidays === true, exceptions }
}

export function calendars(c: Context, type: string, p: any): Row | undefined {
  if (type === 'capacity.rate') {
    allow(c, ['manager', 'accounts'])
    const labor = get(c.s, 'laborCalendars', p.laborId, 'labor calendar')
    const rate = format(decimal(p.hourlyRate, 'hourly wage')), burden = format(decimal(p.burdenRate, 'hourly burden'))
    const old = c.s.laborRates.find(r => r.laborId === labor.id)
    const data = { laborId: labor.id, hourlyRate: rate, burdenRate: burden, currency: 'USD', reason: text(p.reason, 'rate reason'), updatedBy: c.actor.id, updatedAt: c.now }
    if (old) { fresh(old, p.version); return bump(old, { ...data, history: [...(old.history ?? []), { ...old, history: undefined }] }) }
    return row(c, 'laborRates', data)
  }
  if (!['capacity.machine', 'capacity.labor'].includes(type)) return
  allow(c, type === 'capacity.machine' ? ['manager', 'planner'] : ['manager'])
  const collection = type === 'capacity.machine' ? 'machineCalendars' : 'laborCalendars'
  const old = p.id ? get(c.s, collection, p.id) : undefined
  if (old) fresh(old, p.version)
  const name = text(p.name, 'calendar name', 120), reason = text(p.reason, 'calendar change reason')
  if (c.s[collection].some(r => r.name === name && r.id !== old?.id)) fail('DUPLICATE', 'That calendar name is already in use.')
  const common = { ...definition(p), name, reason, updatedAt: c.now, updatedBy: c.actor.id }
  let data: Record<string, any>
  if (collection === 'machineCalendars') data = { ...common, capacity: integer(p.capacity, 'parallel capacity', 1, 20), efficiency: integer(p.efficiency, 'efficiency percent', 1, 100) }
  else {
    const operatorIds = strings(p.operatorIds, 'team members')
    if (!operatorIds.length) fail('INPUT', 'Choose at least one active person for this person/team calendar.')
    if (c.s.laborCalendars.some(r => r.id !== old?.id && r.operatorIds.some((id: string) => operatorIds.includes(id)))) fail('DUPLICATE', 'A person belongs to one labor calendar; edit their current calendar instead.')
    data = { ...common, operatorIds, skills: strings(p.skills ?? [], 'skills'), capacity: integer(p.capacity, 'simultaneous-task limit per person', 1, 10) }
  }
  // Immutable prior definitions are retained as evidence, never used as hidden defaults.
  if (old) return bump(old, { ...data, history: [...(old.history ?? []), { ...old, history: undefined }] })
  return row(c, collection, data)
}

const DAY = 86400000
export function previousDate(day: string) { return new Date(Date.parse(day + 'T00:00Z') - DAY).toISOString().slice(0, 10) }
function holidayDates(year: number): string[] {
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const observed = (m: number, d: number) => { const t = new Date(Date.UTC(year, m - 1, d)); const w = t.getUTCDay(); t.setUTCDate(t.getUTCDate() + (w === 6 ? -1 : w === 0 ? 1 : 0)); return iso(t) }
  const nth = (m: number, weekday: number, n: number) => { const d = new Date(Date.UTC(year, m - 1, 1)); d.setUTCDate(1 + (weekday - d.getUTCDay() + 7) % 7 + 7 * (n - 1)); return iso(d) }
  const last = (m: number) => { const d = new Date(Date.UTC(year, m, 0)); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() - 1 + 7) % 7); return iso(d) }
  return [...[[1, 1], [6, 19], [7, 4], [11, 11], [12, 25]].map(([m, d]) => iso(new Date(Date.UTC(year, m! - 1, d)))), observed(1, 1), nth(1, 1, 3), nth(2, 1, 3), last(5), observed(6, 19), observed(7, 4), nth(9, 1, 1), nth(10, 1, 2), observed(11, 11), nth(11, 4, 4), observed(12, 25)]
}
export type LocalMinute = { day: string; previous: string; weekday: number; minute: number }
export function localGrid(timeZone: string, from: number, length: number): LocalMinute[] {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  let lastDay = '', previous = '', weekday = 0
  return Array.from({ length }, (_, i) => {
    const parts = Object.fromEntries(formatter.formatToParts(from + i * 60000).map(p => [p.type, p.value]))
    const day = `${parts.year}-${parts.month}-${parts.day}`
    if (day !== lastDay) { lastDay = day; previous = previousDate(day); weekday = new Date(day + 'T00:00Z').getUTCDay() }
    return { day, previous, weekday, minute: Number(parts.hour) * 60 + Number(parts.minute) }
  })
}
export function calendarMask(r: Row, grid: LocalMinute[], from: number): Uint8Array {
  const closed = new Set<string>(r.closedDates)
  if (r.usHolidays) for (const y of new Set(grid.flatMap(g => [Number(g.day.slice(0, 4)) - 1, Number(g.day.slice(0, 4)), Number(g.day.slice(0, 4)) + 1]))) for (const d of holidayDates(y)) closed.add(d)
  return Uint8Array.from(grid, (g, i) => {
    const at = from + i * 60000
    if (r.exceptions.some((e: any) => Date.parse(e.startsAt) < at + 60000 && Date.parse(e.endsAt) > at)) return 0
    return r.shifts.some((shift: any) => [0, 1].some(back => {
      const day = back ? g.previous : g.day, minute = g.minute + back * 1440
      return day >= r.effectiveFrom && day <= r.effectiveTo && !closed.has(day) && !closed.has(g.day) && shift.weekdays.includes((g.weekday - back + 7) % 7) && minute >= shift.start && minute < shift.end && !shift.breaks.some((b: any) => minute >= b.start && minute < b.end)
    })) ? 1 : 0
  })
}
