import { type ChildProcess, spawn } from 'node:child_process'
import { join } from 'node:path'

const port = new URL(process.env.CONNECT_BASE_URL || 'http://localhost:5175').port

export default async function () {
  const connectDir = join(import.meta.dirname, '../../connect')

  const server = await new Promise<ChildProcess>((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'vite', 'dev', '--port', String(port)], {
      cwd: connectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'development' },
    })

    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('Dev server did not start within 30s'))
    }, 30_000)

    function onData(data: Buffer) {
      if (data.toString().includes('localhost')) {
        clearTimeout(timeout)
        resolve(child)
      }
    }

    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)

    child.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })

  return async () => {
    server.kill('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 500))
    if (!server.killed) server.kill('SIGKILL')
  }
}
