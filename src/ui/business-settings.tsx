import type { Larder } from './app'
import { rows } from './api'
import { usTimeZones } from '../larder/business'
import { Card, Choose, Field, Form, text } from './controls'

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export function BusinessSettings({ larder }: { larder: Larder }) {
  const s = larder.state!, profile = rows(s, 'businessProfiles')[0]
  if (s.actor.role !== 'owner') return <p>Only the owner configures business settings.</p>
  return <Card title="US business settings">
    <p>Functional currency: USD. These settings do not convert historical amounts or change existing production calendars.</p>
    {profile && <p role="status">Saved for {profile.legalName}. Last updated {new Intl.DateTimeFormat('en-US', { timeZone: profile.timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(profile.updatedAt))} ({profile.timeZone}).</p>}
    <Form key={profile?.version ?? 0} submit="Save business settings" busy={larder.busy} onSubmit={d => larder.run('business.save', {
      version: profile?.version ?? 0, legalName: text(d, 'legalName'), einReference: text(d, 'einReference'), functionalCurrency: 'USD', timeZone: text(d, 'timeZone'), fiscalYearStart: text(d, 'fiscalYearStart'), workingWeek: d.getAll('workingWeek').map(Number),
      ...Object.fromEntries(['billingAddress', 'shippingAddress'].map(kind => [kind, { ...Object.fromEntries(['street', 'city', 'state', 'postalCode'].map(field => [field, text(d, `${kind}.${field}`)])), country: 'US' }])),
    })}>
      <Field label="Legal business name" name="legalName" defaultValue={profile?.legalName ?? ''} />
      <Field label="EIN reference" name="einReference" required={false} defaultValue={profile?.einReference ?? ''} />
      {(['billingAddress', 'shippingAddress'] as const).map(kind => <fieldset key={kind} className="wide"><legend>{kind === 'billingAddress' ? 'US billing address' : 'US shipping address'}</legend><div className="form-grid">
        <Field label={`${kind === 'billingAddress' ? 'Billing' : 'Shipping'} street`} name={`${kind}.street`} defaultValue={profile?.[kind]?.street ?? ''} autoComplete="street-address" />
        <Field label={`${kind === 'billingAddress' ? 'Billing' : 'Shipping'} city`} name={`${kind}.city`} defaultValue={profile?.[kind]?.city ?? ''} />
        <Field label={`${kind === 'billingAddress' ? 'Billing' : 'Shipping'} state`} name={`${kind}.state`} maxLength={2} placeholder="OH" defaultValue={profile?.[kind]?.state ?? ''} />
        <Field label={`${kind === 'billingAddress' ? 'Billing' : 'Shipping'} ZIP code`} name={`${kind}.postalCode`} defaultValue={profile?.[kind]?.postalCode ?? ''} />
      </div></fieldset>)}
      <Choose label="US time zone" name="timeZone" defaultValue={profile?.timeZone ?? 'America/New_York'} options={usTimeZones.map(value => ({ value, label: value }))} />
      <Field label="Fiscal year starts (MM-DD)" name="fiscalYearStart" defaultValue={profile?.fiscalYearStart ?? '01-01'} placeholder="01-01" />
      <fieldset className="wide"><legend>Working week</legend>{weekdays.map((day, index) => <label className="check" key={day}><input type="checkbox" name="workingWeek" value={index} defaultChecked={(profile?.workingWeek ?? [1, 2, 3, 4, 5]).includes(index)} />{day}</label>)}</fieldset>
    </Form>
  </Card>
}
