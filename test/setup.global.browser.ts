import { type ChildProcess, spawn } from 'node:child_process'
import * as Http from 'node:http'
import { join } from 'node:path'

import * as Handler from '../src/server/Handler.js'
import * as Kv from '../src/server/Kv.js'
import { nodeEnv } from './config.js'
import { setupServer } from './prool.js'
import { hooksPort, port } from './webauthn.constants.js'

export default async function () {
  const teardowns: (() => Promise<void>)[] = []

  if (nodeEnv === 'localnet') {
    const teardown = await setupServer({ port: Number(process.env.VITE_RPC_PORT ?? '8546') })
    teardowns.push(teardown)
  }

  const kv = Kv.memory()
  const server = Http.createServer((req, res) => {
    const origin = req.headers.origin ?? 'http://localhost'
    Handler.webauthn({ kv, origin, rpId: 'localhost' }).listener(req, res)
  })

  const hooksKv = Kv.memory()
  const hooksServer = Http.createServer((req, res) => {
    const origin = req.headers.origin ?? 'http://localhost'
    Handler.webauthn({
      cors: { exposeHeaders: 'x-custom' },
      kv: hooksKv,
      origin,
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
    }).listener(req, res)
  })

  await new Promise<void>((resolve) => server.listen(port, resolve))
  await new Promise<void>((resolve) => hooksServer.listen(hooksPort, resolve))

  teardowns.push(async () => {
    await Promise.all([
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
      new Promise<void>((resolve, reject) =>
        hooksServer.close((err) => (err ? reject(err) : resolve())),
      ),
    ])
  })

  // Start connect app dev server.
  const connectDir = join(import.meta.dirname, '../connect')
  const connectServer = await new Promise<ChildProcess>((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'vite', 'dev', '--port', '5175'], {
      cwd: connectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        VITE_RPC_URL: `http://localhost:${process.env.VITE_RPC_PORT ?? '8546'}/99999`,
      },
    })

    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('Connect dev server did not start within 30s'))
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
    connectServer.kill('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 500))
    if (!connectServer.killed) connectServer.kill('SIGKILL')
    await Promise.all(teardowns.map((fn) => fn()))
  }
}
