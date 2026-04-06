import { type ChildProcess, spawn } from 'node:child_process'
import { join } from 'node:path'

import * as Handler from '../src/server/Handler.js'
import * as Kv from '../src/server/Kv.js'
import { nodeEnv } from './config.js'
import { setupServer } from './prool.js'
import { createServer } from './utils.js'
import { hooksPort, port } from './webauthn.constants.js'

export default async function () {
  const teardowns: (() => Promise<void>)[] = []

  if (nodeEnv === 'localnet') {
    const teardown = await setupServer({ port: Number(process.env.VITE_RPC_PORT ?? '8546') })
    teardowns.push(teardown)
  }

  const server = await createServer(
    Handler.webAuthn({ kv: Kv.memory(), origin: 'http://localhost', rpId: 'localhost' }).listener,
    { port },
  )
  const hooksServer = await createServer(
    Handler.webAuthn({
      cors: { exposeHeaders: 'x-custom' },
      kv: Kv.memory(),
      origin: 'http://localhost',
      rpId: 'localhost',
      onRegister({ credentialId }) {
        return Response.json(
          { sessionToken: `reg_${credentialId}` },
          { headers: { 'x-custom': 'register-hook' } },
        )
      },
      onAuthenticate({ credentialId }) {
        return Response.json(
          { sessionToken: `auth_${credentialId}` },
          { headers: { 'x-custom': 'authenticate-hook' } },
        )
      },
    }).listener,
    { port: hooksPort },
  )

  teardowns.push(async () => {
    await Promise.all([server.closeAsync(), hooksServer.closeAsync()])
  })

  // Start auth app dev server.
  const authServer = await new Promise<ChildProcess>((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'vite', 'dev', '--port', '5175'], {
      cwd: join(import.meta.dirname, '../auth'),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        VITE_RPC_URL: `http://localhost:${process.env.VITE_RPC_PORT ?? '8546'}/99999`,
      },
    })

    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('Auth dev server did not start within 60s'))
    }, 60_000)

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
    authServer.kill('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 500))
    if (!authServer.killed) authServer.kill('SIGKILL')
    await Promise.all(teardowns.map((fn) => fn()))
  }
}
