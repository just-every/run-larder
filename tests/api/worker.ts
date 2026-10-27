import { larderResponse, runDueReports } from '../../src/larder/api'
import { authResponse } from '../../src/auth.server'
export default {
  async scheduled(_controller: ScheduledController, env: any) {
    await runDueReports(env)
  },
  async fetch(request: Request, env: any) {
    return (await larderResponse(request, env)) ?? (await authResponse(request, env)) ?? new Response('Not found', { status: 404 })
  },
}
