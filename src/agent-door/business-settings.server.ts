import type { Bindings } from '../auth.server'
import { createBusinessSettings } from '../modules/business-settings/index.ts'
import { larderTeam } from './team'

export function larderBusinessSettings(env: Bindings) {
  return createBusinessSettings({ db: env.DB, trust: env.RER_BUSINESS_TRUST, business: { settings: 1, values: ['display_name'], team: { roles: { admin: 'admin', member: 'member' } } }, team: larderTeam(env) })
}

// Presentation reads retained values; it does not open a signed write door.
export function larderBusinessPresentation(env: Bindings) {
  return createBusinessSettings({ db: env.DB, business: {settings:1,values:['display_name']} })
}
