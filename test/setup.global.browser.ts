import * as Http from 'node:http'

import * as Handler from '../src/server/Handler.js'
import * as Kv from '../src/server/Kv.js'
import { nodeEnv } from './config.js'
import { setupServer } from './prool.js'
import { hooksPort, port } from './webauthn.constants.js'

export default async function () {
  const teardowns: (() => Promise<void>)[] = []

  if (nodeEnv === 'localnet') {
    const teardown = await setupServer({ port: 8546 })
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

  return async () => {
    await Promise.all(teardowns.map((fn) => fn()))
  }
}
