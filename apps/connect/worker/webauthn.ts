import { Handler, Kv } from 'accounts/server'
import { Hono } from 'hono'
import { Address, PublicKey } from 'ox'
import type { Hex } from 'ox'

import * as Account from './lib/db/account.js'
import * as Db from './lib/db/index.js'
import * as Wallet from './lib/db/wallet.js'
import * as Session from './lib/session.js'

export const webauthn = new Hono<{ Bindings: Env }>().all('/*', (c) => {
  const url = new URL(c.req.url)
  const proto = c.req.header('x-forwarded-proto') ?? url.protocol.replace(':', '')
  const origin = `${proto}://${url.hostname}`
  const hostname = url.hostname

  const baseKv = Kv.cloudflare(c.env.KV)
  const kv: Kv.Kv = {
    ...baseKv,
    async get(key) {
      const local = await baseKv.get(key)
      if (local || !key.startsWith('credential:')) return local
      const credentialId = key.slice('credential:'.length)
      const res = await fetch(`https://keys.tempo.xyz/${encodeURIComponent(credentialId)}`)
      if (!res.ok) return null as never
      const data = (await res.json()) as { publicKey: string }
      await baseKv.set(key, data)
      return data as never
    },
  }

  const handler = Handler.webAuthn({
    cors: false,
    kv,
    origin,
    path: '/api/webauthn',
    rpId: hostname.split('.').slice(-2).join('.'),

    async onRegister({ credentialId, publicKey }) {
      const address = Address.fromPublicKey(PublicKey.fromHex(publicKey as Hex.Hex))
      const db = Db.get(c.env.HYPERDRIVE)

      await Account.insert(db, { address })
      const wallet = await Wallet.insert(db, {
        address,
        id: crypto.randomUUID(),
        credentialId,
        label: 'Passkey',
        publicKey,
        username: address,
      })

      return res(hostname, address, {
        credential: {
          id: wallet.credentialId,
          publicKey: wallet.publicKey,
        },
        body: { wallet: { id: wallet.id, address: wallet.address } },
      })
    },

    // Lazily migrate Tempo accounts registered prior to connect.
    async onAuthenticate({ credentialId, publicKey }) {
      const db = Db.get(c.env.HYPERDRIVE)
      let wallet = await Wallet.getByCredentialId(db, credentialId)

      if (!wallet) {
        const address = Address.fromPublicKey(PublicKey.fromHex(publicKey as Hex.Hex))
        await Account.insert(db, { address })
        wallet = await Wallet.insert(db, {
          address,
          id: crypto.randomUUID(),
          credentialId,
          label: 'Passkey',
          publicKey,
          username: address,
        })
      } else {
        const existing = await Account.getByAddress(db, wallet.address)
        if (!existing) await Account.insert(db, { address: wallet.address })
      }

      return res(hostname, wallet.address, {
        credential: {
          id: wallet.credentialId,
          publicKey: wallet.publicKey,
        },
        body: { wallet: { id: wallet.id, address: wallet.address } },
      })
    },
  })

  return handler.fetch(c.req.raw)
})

async function res(
  hostname: string,
  address: string,
  options: { credential: Session.Credential; body: unknown },
) {
  const headers = new Headers({ 'content-type': 'application/json' })
  for (const cookie of await Session.cookies(process.env.SESSION_PRIVATE_KEY!, address, hostname, {
    embed: true,
    credential: options.credential,
  }))
    headers.append('set-cookie', cookie)
  return new Response(JSON.stringify(options.body), { headers })
}
