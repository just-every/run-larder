import { larderResponse, runDueReports } from '../../src/larder/api'
import { authResponse } from '../../src/auth.server'
import { meterDb } from './d1-meter'
export default {
  async scheduled(_controller: ScheduledController, env: any) {
    await runDueReports(env)
  },
  async fetch(request: Request, env: any) {
    // Test-only door: one scheduled run with every D1 read counted (cron-d1-budget.test.mjs).
    if (new URL(request.url).pathname === '/__d1/cron') {
      const trace: { sql: string; read: number }[] = []
      await runDueReports({ ...env, DB: meterDb(env.DB, trace) })
      return Response.json({ rows: trace.reduce((n, t) => n + t.read, 0), statements: trace.length })
    }
    return (await larderResponse(request, env)) ?? (await authResponse(request, env)) ?? new Response('Not found', { status: 404 })
  },
}
