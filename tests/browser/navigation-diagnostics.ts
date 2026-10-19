// Temporary, redacted lifecycle capture for the single R11 CI diagnosis.
import { test as base, expect, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export { expect }
const timelines = new WeakMap<Page, unknown[]>()
export function navigationMark(page: Page, stage: string) {
  timelines.get(page)?.push({ type: 'checkpoint', stage, at: Date.now(), url: safeUrl(page.url()) })
}
const safeUrl = (value: string) => {
  try { const url = new URL(value); return url.pathname + (/^#(?:today|orders|schedule|stock|make|handoff|more)(?:\/|$)/.test(url.hash) ? url.hash : url.hash ? '#[private]' : '') } catch { return '[unavailable]' }
}
export const test = base.extend<{ navigationDiagnostics: void }>({
  navigationDiagnostics: [async ({ page }, use, info) => {
    const events: unknown[] = [], requests = new Map<object, number>()
    timelines.set(page, events)
    await page.exposeFunction('__larderNavigationEvent', (event: any) => {
      // The checkpoint helper supplies only the current hash, never entry data.
      if (event.hash) event.hash = safeUrl('http://local/app' + event.hash).slice(4)
      events.push({ receivedAt: Date.now(), ...event })
    })
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) events.push({ type: 'frame', url: safeUrl(frame.url()), at: Date.now() }) })
    const watched = (url: string) => /\/api\/larder\/state$|\/auth\/dev\//.test(new URL(url).pathname)
    page.on('request', request => { if (watched(request.url())) { const id = requests.size + 1; requests.set(request, id); events.push({ type: 'request-start', id, path: new URL(request.url()).pathname, method: request.method(), at: Date.now() }) } })
    page.on('response', response => { const id = requests.get(response.request()); if (id) events.push({ type: 'response', id, status: response.status(), at: Date.now() }) })
    page.on('requestfinished', request => { const id = requests.get(request); if (id) events.push({ type: 'request-finished', id, at: Date.now() }) })
    page.on('requestfailed', request => { const id = requests.get(request); if (id) events.push({ type: 'request-failed', id, error: request.failure()?.errorText, at: Date.now() }) })
    await page.addInitScript(() => {
      const safe = (hash: string | undefined) => !hash ? '' : /^#?(?:today|orders|schedule|stock|make|handoff|more)(?:\/|$)/.test(hash) ? hash : '[private]'
      const snapshot = () => {
        const router = (window as any).__TSR_ROUTER__
        return { path: location.pathname, hash: safe(location.hash), historyHash: safe(router?.history.location.hash), routerHash: safe(router?.stores.location.get().hash),
          headings: [...document.querySelectorAll('main h1, main h2')].map(h => h.textContent), busy: document.querySelector('main')?.getAttribute('aria-busy') }
      }
      const emit = (type: string, more = {}) => (window as any).__larderNavigationEvent({ type, at: performance.now(), ...snapshot(), ...more })
      emit('document-init')
      for (const method of ['pushState', 'replaceState'] as const) {
        const original = history[method]
        history[method] = function (...args: Parameters<typeof original>) {
          const target = args[2] ? new URL(String(args[2]), location.href) : new URL(location.href)
          emit('history-before-' + method, { target: target.pathname + safe(target.hash), stack: new Error().stack?.split('\n').slice(1, 7).map(line => line.replace(/https?:\/\/[^\s)]+/g, '[script]')) })
          const result = original.apply(this, args)
          emit('history-after-' + method)
          return result
        }
      }
      for (const type of ['hashchange', 'popstate', 'pageshow', 'pagehide', 'beforeunload']) addEventListener(type, () => emit(type))
      let previous = ''
      setInterval(() => { const next = JSON.stringify(snapshot()); if (next !== previous) { previous = next; emit('view-change') } }, 50)
    })
    await use()
    timelines.delete(page)
    const directory = join(process.env.LARDER_BROWSER_OUTPUT || '/tmp/larder-browser-evidence', 'navigation-diagnostics')
    await mkdir(directory, { recursive: true })
    const snapshot = await page.locator('main').ariaSnapshot().catch(() => '[No main snapshot available]')
    const last = await page.evaluate(() => ({ path: location.pathname, hash: location.hash })).catch(() => null)
    if (last) events.push({ type: 'final-location', url: safeUrl('http://local' + last.path + last.hash) })
    const result = { status: info.status, events, snapshot: snapshot.replace(/https?:\/\/[^\s"<>]+/g, '[URL]') }
    await writeFile(join(directory, 'forecast-navigation.json'), JSON.stringify(result, null, 2))
    console.log('FORECAST_NAVIGATION', JSON.stringify({ status: info.status, events }))
  }, { auto: true }],
})
