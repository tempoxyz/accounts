import * as Http from 'node:http'

import * as Handler from '../src/server/Handler.js'
import * as Kv from '../src/server/Kv.js'

export const port = 44320
export const hooksPort = 44321

export default async function () {
  const kv = Kv.memory()

  const server = Http.createServer((req, res) => {
    // Origin varies per Playwright run; extract from request header.
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

  return async () => {
    await Promise.all([
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
      new Promise<void>((resolve, reject) =>
        hooksServer.close((err) => (err ? reject(err) : resolve())),
      ),
    ])
  }
}
