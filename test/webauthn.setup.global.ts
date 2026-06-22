import * as Http from 'node:http'

import * as Handler from '../src/server/Handler.js'
import * as Kv from '../src/server/Kv.js'
import { hooksPort, port } from './webauthn.constants.js'

function extensions_response(extensions: unknown) {
  if (!extensions || typeof extensions !== 'object') return undefined
  const { hostContext } = extensions as { hostContext?: unknown }
  return hostContext === undefined ? undefined : { hostContext }
}

export default async function () {
  const kv = Kv.memory()
  const server = Http.createServer((req, res) => {
    // Origin varies per Playwright run; extract from request header.
    const origin = req.headers.origin ?? 'http://localhost'
    Handler.webAuthn({ kv, origin, rpId: 'localhost' }).listener(req, res)
  })

  const hooksKv = Kv.memory()
  const hooksServer = Http.createServer((req, res) => {
    const origin = req.headers.origin ?? 'http://localhost'
    Handler.webAuthn({
      cors: { exposeHeaders: 'x-custom' },
      kv: hooksKv,
      origin,
      rpId: 'localhost',
      onRegister({ credentialId, extensions }) {
        return Response.json(
          { extensions: extensions_response(extensions), sessionToken: `reg_${credentialId}` },
          { headers: { 'x-custom': 'register-hook' } },
        )
      },
      onAuthenticate({ credentialId, extensions }) {
        return Response.json(
          { extensions: extensions_response(extensions), sessionToken: `auth_${credentialId}` },
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
