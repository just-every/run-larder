import { spawn } from 'node:child_process'
import { cp, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { createServer } from 'node:net'

export const redact = value => String(value)
  .replace(/^.*(?:RER_OPEN|RER_SIGN_IN|SESSION_SECRET|SETUP_TOKEN|RER_DEV_KEY).*$/gm, '[private runtime entry]')
  .replace(/https?:\/\/[^\s"<>]+/g, '[URL]')
  .replace(/(?:token|rer-dev|password|secret|key)\s*[=:]\s*[^\s"&<>]+/gi, '[private value]')

export async function freshCopy(workspace, root) {
  await mkdir(root, { recursive: true })
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: workspace, maxBuffer: 32 * 1024 * 1024 }).toString().split('\0').filter(Boolean)
  for (const file of files) {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await cp(join(workspace, file), join(root, file), { dereference: false })
  }
  // The native setup may repair pnpm links. Install in this owned tree instead
  // of sharing node_modules with the source checkout.
  await command('corepack', ['pnpm', 'install', '--frozen-lockfile'], root)
}

export async function freePort() {
  const listener = createServer()
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve) })
  const port = listener.address().port
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()))
  return port
}

export function child(command, args, cwd, env = {}) {
  const environment = { ...globalThis.process.env, CI: 'true', RER_SERVER_JOURNEY: '1', WRANGLER_SEND_METRICS: 'false', ...env }
  // Operation ownership is checkout-specific; never carry the source checkout's
  // live lease into this independently owned fresh installation.
  delete environment.RER_LOCAL_OPERATION
  delete environment.RER_ONBOARDING_PROCESS_OWNER
  const process = spawn(command, args, { cwd, env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  for (const pipe of [process.stdout, process.stderr]) pipe.on('data', chunk => { output += chunk; if (output.length > 4 * 1024 * 1024) output = output.slice(-4 * 1024 * 1024) })
  const done = new Promise((resolve, reject) => { process.once('error', () => reject(new Error('Could not start the owned test command.'))); process.once('close', code => resolve(code)) })
  return { process, done, output: () => output }
}

export async function command(executable, args, cwd, env) {
  const task = child(executable, args, cwd, env)
  const code = await task.done
  if (code !== 0) throw new Error(redact(task.output()).slice(-6000) || `Owned command exited ${code}.`)
  return task.output()
}

export async function startDev(root, port) {
  const executable = join(root, 'node_modules/.bin/rer')
  const runtime = child(executable, ['dev', '--port', String(port)], root)
  const deadline = Date.now() + 10 * 60 * 1000
  try {
    while (Date.now() < deadline) {
      const ready = runtime.output().match(/^RER_READY\s+(\S+)/m)?.[1]
      const entry = runtime.output().match(/^RER_OPEN\s+(\S+)/m)?.[1]
      if (ready && entry) return { ...runtime, origin: new URL(ready).origin, entry }
      if (runtime.process.exitCode !== null) throw new Error(redact(runtime.output()).slice(-6000) || 'Owned dev runtime exited before readiness.')
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    throw new Error('Owned dev runtime did not report readiness within ten minutes.')
  } catch (error) {
    await stopDev(root, runtime)
    throw error
  }
}

export async function stopDev(root, runtime) {
  let problem
  try { await command(join(root, 'node_modules/.bin/rer'), ['dev', '--stop'], root) } catch (error) { problem = error }
  if (runtime?.process.exitCode === null) runtime.process.kill('SIGTERM')
  if (runtime) {
    const settled = await Promise.race([runtime.done.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 5000))])
    if (!settled && runtime.process.exitCode === null) { runtime.process.kill('SIGKILL'); await runtime.done }
  }
  if (problem) throw new Error(`Owned runtime stop failed: ${redact(problem.message)}`)
}
