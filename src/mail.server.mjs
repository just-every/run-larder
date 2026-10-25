import { createMailSender } from './modules/mail/index.mjs'

export function operatorMail(env) {
 // Demos and local development send nothing: Base's development provider
 // validates each message and suppresses it, and auth accepts that there.
 if (env.RER_DEMO === '1' || (env.MAIL_PROVIDER === 'development' && env.AUTH_LOCAL === 'true')) return createMailSender({ provider: 'development', mode: 'development' })
 // Base refuses relayUrl for every provider but rer, even an empty one, and the
 // deployed vars always declare MAIL_RELAY_URL: pass it only as rer's relay.
 return env.MAIL_PROVIDER && env.MAIL_PROVIDER !== 'development' ? createMailSender({ provider: env.MAIL_PROVIDER, mode: 'production', apiKey: env.MAIL_API_KEY, ...(env.MAIL_PROVIDER === 'rer' && env.MAIL_RELAY_URL?.trim() ? { relayUrl: env.MAIL_RELAY_URL } : {}), ...(env.MAIL_PROVIDER === 'cloudflare' ? { accountId: env.MAIL_ACCOUNT_ID } : {}) }) : undefined
}
