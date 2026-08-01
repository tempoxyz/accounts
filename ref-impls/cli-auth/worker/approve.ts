import { CliAuth } from 'accounts/server'
import { Address, type Hex, PublicKey } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { Account, Actions } from 'viem/tempo'
import * as z from 'zod/mini'

import { client, store } from './deps.js'

function parseCode(value: string) {
  const code = value.replaceAll('-', '').toUpperCase()
  if (/^[A-Z0-9]{8}$/.test(code)) return code

  throw new Error('Expected an 8-character device code.')
}

function getRoot(env: { PRIVATE_KEY: Hex.Hex }) {
  if (!env.PRIVATE_KEY)
    throw new Error('Missing PRIVATE_KEY. Copy .env.example to .env and set a root wallet key.')

  return Account.fromSecp256k1(env.PRIVATE_KEY)
}

/**
 * Completes a pending key authorization or limit update with the root wallet.
 */
export async function approve(request: Request, env: { PRIVATE_KEY: Hex.Hex }) {
  const body = z.decode(z.object({ code: z.string() }), await request.json())
  const code = parseCode(body.code)
  const pending = await CliAuth.pending({
    code,
    store,
  })
  const root = getRoot(env)
  if (pending.action === 'updateAccessKey') {
    for (const limit of pending.limits)
      await Actions.accessKey.updateLimitSync(client, {
        account: root,
        accessKey: pending.accessKeyAddress,
        limit: limit.limit,
        token: limit.token,
      })
    const result = await CliAuth.authorize({
      chainId: pending.chainId,
      client,
      request: {
        action: 'updateAccessKey',
        accountAddress: root.address,
        chainId: pending.chainId,
        code,
      },
      store,
    })
    return Response.json({ accountAddress: root.address, status: result.status })
  }

  const signed = await root.signKeyAuthorization(
    {
      accessKeyAddress: Address.fromPublicKey(PublicKey.from(pending.pubKey)),
      keyType: pending.keyType,
    },
    {
      chainId: pending.chainId,
      expiry: pending.expiry,
      ...(pending.limits ? { limits: pending.limits } : {}),
    },
  )
  const keyAuthorization = KeyAuthorization.toRpc(signed)
  const result = await CliAuth.authorize({
    chainId: pending.chainId,
    client,
    request: {
      accountAddress: root.address,
      code,
      keyAuthorization: z.decode(CliAuth.keyAuthorization, {
        ...keyAuthorization,
        address: keyAuthorization.keyId,
      }),
    },
    store,
  })

  return Response.json({
    accountAddress: root.address,
    status: result.status,
  })
}
