import { mkdtemp, mkdir, rm, readdir, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { freshCopy, freePort, command, startDev, stopDev, redact } from './runtime.mjs'

const workspace = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const evidence = resolve(process.env.LARDER_BROWSER_OUTPUT || join(tmpdir(), 'larder-browser-evidence'))
const screenshots = resolve(process.env.LARDER_SCREENSHOTS || join(evidence, 'screenshots'))
if ([evidence, screenshots].some(path => path === workspace || path.startsWith(workspace + '/'))) throw new Error('Browser evidence must be outside the product checkout.')
await mkdir(evidence, { recursive: true })
await mkdir(screenshots, { recursive: true })
const parent = await mkdtemp(join(process.env.LARDER_WORK_DIR || tmpdir(), 'larder-browser-'))
const root = join(parent, 'installation')
let runtime, failure, prepared = false, stopped = true
try {
  await freshCopy(workspace, root)
  prepared = true
  const port = await freePort()
  await command(join(root, 'node_modules/.bin/rer'), ['setup', '--owner-email', 'owner@example.test', '--non-interactive', '--port', String(port)], root)
  runtime = await startDev(root, port)
  const output = await command(join(workspace, 'node_modules/.bin/playwright'), ['test', '--config', join(workspace, 'tests/browser/playwright.config.ts'), '--workers=1'], workspace, { LARDER_BASE_URL: runtime.origin, LARDER_SITE_URL: runtime.site, LARDER_OPEN: runtime.entry, LARDER_SCREENSHOTS: screenshots, LARDER_BROWSER_OUTPUT: evidence })
  console.log(redact(output))
  console.log(`Real setup/dev and desktop/mobile UI journeys passed. Screenshots: ${screenshots}`)
} catch (error) {
  failure = error
  // CI cannot retain this temporary installation. Include only Playwright's
  // accessibility snapshot, never its source excerpt or authenticated trace.
  for (const entry of await readdir(evidence, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const context = await readFile(join(evidence, entry.name, 'error-context.md'), 'utf8').catch(() => '')
    const snapshot = context.split('```yaml\n')[1]?.split('\n```')[0]
    if (snapshot) console.error(`Failed page (${entry.name}):\n${redact(snapshot).slice(0, 16000)}`)
  }
} finally {
  try { if (prepared) await stopDev(root, runtime) } catch (error) { stopped = false; failure ||= error }
  if (stopped) await rm(parent, { recursive: true, force: true, maxRetries: 5 })
  else console.error(`Owned installation retained for stop recovery: ${root}`)
}
if (failure) { console.error(redact(failure.message)); process.exitCode = 1 }
