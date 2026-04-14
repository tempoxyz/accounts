import { Handler, Kv } from 'accounts/server'
import { Hono } from 'hono'
import { Address, PublicKey } from 'ox'
import type { Hex } from 'ox'

import * as Db from './lib/db/index.js'
import * as Wallet from './lib/db/wallet.js'
import * as Session from './lib/session.js'

export const webauthn = new Hono<{ Bindings: Env }>().all('/*', (c) => {
  const url = new URL(c.req.url)
  const proto = c.req.header('x-forwarded-proto') ?? url.protocol.replace(':', '')
  const origin = `${proto}://${url.hostname}`
  const hostname = url.hostname

  const handler = Handler.webAuthn({
    kv: Kv.cloudflare(c.env.KV),
    origin,
    path: '/api/webauthn',
    rpId: hostname.split('.').slice(-2).join('.'),

    async onRegister({ credentialId, publicKey, request }) {
      const session = await Session.fromRawRequest(request, process.env.SESSION_PUBLIC_KEY!)
      if (!session) return undefined as never

      const address = Address.fromPublicKey(PublicKey.fromHex(publicKey as Hex.Hex))
      const db = Db.get(c.env.HYPERDRIVE)
      const wallet = await Wallet.insert(db, {
        address,
        id: crypto.randomUUID(),
        credentialId,
        label: 'Passkey',
        publicKey,
        publicKeyHex: publicKey,
        userId: session.sub,
      })

      return res(hostname, session.sub, {
        email: session.email ?? undefined,
        wallet: {
          credentialId: wallet.credentialId,
          publicKey: wallet.publicKeyHex,
          label: wallet.label,
        },
        body: { wallet: { id: wallet.id, address: wallet.address } },
      })
    },

    async onAuthenticate({ credentialId, request }) {
      const db = Db.get(c.env.HYPERDRIVE)
      const wallet = await Wallet.getByCredentialId(db, credentialId)
      if (!wallet) return undefined as never

      const session = await Session.fromRawRequest(request, process.env.SESSION_PUBLIC_KEY!)
      const userId = session?.sub ?? wallet.userId

      return res(hostname, userId, {
        email: session?.email ?? undefined,
        wallet: {
          credentialId: wallet.credentialId,
          publicKey: wallet.publicKeyHex,
          label: wallet.label,
        },
        body: { wallet: { id: wallet.id, address: wallet.address } },
      })
    },
  })

  return handler.fetch(c.req.raw)
})

async function res(
  hostname: string,
  userId: string,
  options: { email?: string | undefined; wallet: Session.Wallet; body: unknown },
) {
  const headers = new Headers({ 'content-type': 'application/json' })
  for (const cookie of await Session.cookies(process.env.SESSION_PRIVATE_KEY!, userId, hostname, {
    email: options.email,
    embed: true,
    wallet: options.wallet,
  }))
    headers.append('set-cookie', cookie)
  return new Response(JSON.stringify(options.body), { headers })
}
