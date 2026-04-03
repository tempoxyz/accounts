import { Address, Hex, PublicKey } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { parseUnits } from 'viem'
import { Actions, Addresses } from 'viem/tempo'
import { describe, expect, test } from 'vp/test'
import * as z from 'zod/mini'

import * as CliAuth from '../../src/server/CliAuth.js'
import * as Handler from '../../src/server/Handler.js'
import { Provider } from '../../src/cli/index.js'
import { accounts, chain, getClient } from '../../test/config.js'
import { createServer } from '../../test/utils.js'

const root = accounts[0]!
const expiry = Math.floor(Date.now() / 1000) + 3_600

function createHandler() {
  let random = 0

  return Handler.codeAuth({
    path: '/cli-auth',
    chainId: chain.id,
    client: getClient({ chain }),
    policy: {
      validate({ expiry: requestedExpiry, limits }) {
        return {
          expiry: requestedExpiry ?? expiry,
          ...(limits ? { limits } : {}),
        }
      },
    },
    random: () => {
      const out = new Uint8Array(Array.from({ length: 8 }, (_, i) => random + i))
      random += 8
      return out
    },
  })
}

async function authorizePending(serverUrl: string, code: string) {
  const response = await fetch(`${serverUrl}/cli-auth/pending/${code}`)
  const pending = z.decode(CliAuth.pendingResponse, (await response.json()) as never)
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

  return z.encode(CliAuth.authorizeRequest, {
    accountAddress: root.address,
    code,
    keyAuthorization: z.decode(CliAuth.keyAuthorization, {
      ...keyAuthorization,
      address: keyAuthorization.keyId,
    }),
  })
}

async function fund(address: `0x${string}`) {
  await Actions.token.transferSync(getClient(), {
    account: root,
    feeToken: Addresses.pathUsd,
    to: address,
    token: Addresses.pathUsd,
    amount: parseUnits('10', 6),
  })
}

describe('examples/cli', () => {
  test('e2e: connects with authorizeAccessKey and performs a TIP-20 transfer', async () => {
    const handler = createHandler()
    const server = await createServer(handler.listener)

    try {
      const provider = Provider.create({
        chains: [chain],
        open: async (url) => {
          const code = new URL(url).searchParams.get('code')!
          await fetch(`${server.url}/cli-auth`, {
            body: JSON.stringify(await authorizePending(server.url, code)),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
          })
        },
        host: `${server.url}/cli-auth`,
      })

      // 1. wallet_connect with authorizeAccessKey (limits + expiry).
      const connectResult = await provider.request({
        method: 'wallet_connect',
        params: [
          {
            capabilities: {
              authorizeAccessKey: {
                expiry,
                limits: [
                  {
                    limit: Hex.fromNumber(1000),
                    token: Addresses.pathUsd,
                  },
                ],
              },
            },
          },
        ],
      })

      const address = connectResult.accounts[0]!.address
      expect(address).toBe(root.address)
      expect(connectResult.accounts[0]!.capabilities.keyAuthorization).toBeDefined()

      // Fund the account so the transfer can succeed.
      await fund(address)

      // 2. TIP-20 transfer via Actions.token.transferSync.
      const client = provider.getClient()
      const account = provider.getAccount()
      const { receipt } = await Actions.token.transferSync(client, {
        account,
        amount: parseUnits('1', 6),
        to: '0x0000000000000000000000000000000000000001',
        token: Addresses.pathUsd,
      })

      expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
      expect(receipt.transactionHash).toMatch(/^0x[0-9a-f]{64}$/i)
    } finally {
      await server.closeAsync()
    }
  })
})
