// US business identity is configured explicitly; it never changes historical money.
import { bump, fresh, optionalText, row, text, type Context, type Row } from './model'
import { fail, forbidden } from './problem'

export const usTimeZones = ['America/New_York', 'America/Detroit', 'America/Indiana/Indianapolis', 'America/Indiana/Marengo', 'America/Indiana/Petersburg', 'America/Indiana/Vevay', 'America/Indiana/Vincennes', 'America/Indiana/Winamac', 'America/Kentucky/Louisville', 'America/Kentucky/Monticello', 'America/Chicago', 'America/Indiana/Knox', 'America/Indiana/Tell_City', 'America/Menominee', 'America/North_Dakota/Beulah', 'America/North_Dakota/Center', 'America/North_Dakota/New_Salem', 'America/Denver', 'America/Boise', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'America/Juneau', 'America/Metlakatla', 'America/Nome', 'America/Sitka', 'America/Yakutat', 'America/Adak', 'Pacific/Honolulu'] as const
const states = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '))
function address(value: any, label: string) {
  const street = text(value?.street, `${label} street`, 200), city = text(value?.city, `${label} city`, 100)
  if (!states.has(value?.state) || !/^\d{5}(-\d{4})?$/.test(value?.postalCode ?? '') || value?.country !== 'US') fail('INPUT', `${label} needs a US state, ZIP code and US country.`)
  return { street, city, state: value.state as string, postalCode: value.postalCode as string, country: 'US' }
}
export function business(c: Context, type: string, p: any): Row | undefined {
  if (type !== 'business.save') return
  if (c.actor.role !== 'owner') forbidden('Only the owner configures the business identity.')
  const current = c.s.businessProfiles[0]
  if (current) fresh(current, p.version)
  else if (p.version !== 0) fail('STALE', 'Review the current business settings.')
  if ((p.functionalCurrency ?? 'USD') !== 'USD') fail('CURRENCY_MIGRATION', 'Business settings cannot convert or relabel historical currency. USD is the functional currency.')
  if (!(usTimeZones as readonly string[]).includes(p.timeZone)) fail('INPUT', 'Choose a US IANA time zone.')
  if (!Array.isArray(p.workingWeek) || !p.workingWeek.length || p.workingWeek.length > 7 || new Set(p.workingWeek).size !== p.workingWeek.length || p.workingWeek.some((d: any) => !Number.isInteger(d) || d < 0 || d > 6)) fail('INPUT', 'Working week needs distinct weekdays from 0 (Sunday) to 6 (Saturday).')
  if (typeof p.fiscalYearStart !== 'string' || !/^\d{2}-\d{2}$/.test(p.fiscalYearStart) || Number.isNaN(Date.parse(`2025-${p.fiscalYearStart}T00:00:00Z`)) || new Date(`2025-${p.fiscalYearStart}T00:00:00Z`).toISOString().slice(5, 10) !== p.fiscalYearStart) fail('INPUT', 'Fiscal year start needs a recurring valid month and day (MM-DD).')
  const einReference = optionalText(p.einReference, 'EIN reference', 100)
  const data = { legalName: text(p.legalName, 'legal name', 200), billingAddress: address(p.billingAddress, 'Billing address'), shippingAddress: address(p.shippingAddress, 'Shipping address'), einReference, functionalCurrency: 'USD', timeZone: p.timeZone, workingWeek: [...p.workingWeek].sort(), fiscalYearStart: p.fiscalYearStart, updatedAt: c.now, updatedBy: c.actor.id }
  return current ? bump(current, data) : row(c, 'businessProfiles', { id: 'business', ...data })
}
