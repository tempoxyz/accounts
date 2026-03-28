import { Hex } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { describe, expect, test } from 'vp/test'
import * as z from 'zod/mini'

import { accounts, chain, getClient } from '../../test/config.js'
import { createServer } from '../../test/utils.js'
import * as CliAuth from '../server/CliAuth.js'
import * as Handler from '../server/Handler.js'
import * as Provider from './Provider.js'

const root = accounts[0]!
const accessKey = accounts[1]!
const expiry = Math.floor(Date.now() / 1000) + 3_600

async function authorize(code: string) {
  const signed = await root.signKeyAuthorization(
    {
      accessKeyAddress: accessKey.address,
      keyType: accessKey.keyType,
    },
    {
      chainId: BigInt(chain.id),
      expiry,
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

function connectRequest() {
  return {
    method: 'wallet_connect',
    params: [
      {
        capabilities: {
          authorizeAccessKey: {
            expiry,
            publicKey: accessKey.publicKey,
          },
        },
      },
    ],
  } as const
}

function createHandler() {
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
    random: () => new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]),
  })
}

describe('Provider.create', () => {
  test('default: bootstraps wallet_connect through the device-code flow', async () => {
    const handler = createHandler()
    const server = await createServer(handler.listener)
    const opened: string[] = []

    try {
      const provider = Provider.create({
        open: async (url) => {
          opened.push(url)
          const code = new URL(url).searchParams.get('code')!
          await fetch(`${server.url}/cli-auth`, {
            body: JSON.stringify(await authorize(code)),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
          })
        },
        host: `${server.url}/cli-auth`,
      })

      const result = await provider.request(connectRequest())
      const account = result.accounts[0]!
      const keyAuthorization = account.capabilities.keyAuthorization
        ? {
            ...account.capabilities.keyAuthorization,
            signature: {
              type: account.capabilities.keyAuthorization.signature.type,
            },
          }
        : undefined

      expect({
        account: {
          address: account.address,
          capabilities: keyAuthorization ? { keyAuthorization } : {},
        },
        opened: opened.map((url) => url.replace(server.url, 'http://service')),
      }).toMatchInlineSnapshot(`
        {
          "account": {
            "address": "${root.address}",
            "capabilities": {
              "keyAuthorization": {
                "address": "${accessKey.address}",
                "chainId": "${Hex.fromNumber(chain.id)}",
                "expiry": "${Hex.fromNumber(expiry)}",
                "keyId": "${accessKey.address}",
                "keyType": "secp256k1",
                "signature": {
                  "type": "secp256k1",
                },
              },
            },
          },
          "opened": [
            "http://service/cli-auth?code=ABCDEFGH",
          ],
        }
      `)
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: browser-open failures surface the URL and code', async () => {
    const handler = createHandler()
    const server = await createServer(handler.listener)

    try {
      const provider = Provider.create({
        open() {
          throw new Error('browser unavailable')
        },
        host: `${server.url}/cli-auth`,
      })

      await expect(
        provider
          .request(connectRequest())
          .catch((error: { code: number; message: string; name: string }) => {
            return {
              code: error.code,
              message: error.message.replace(server.url, 'http://service'),
              name: error.name,
            }
          }),
      ).resolves.toMatchInlineSnapshot(`
        {
          "code": -32603,
          "message": "Failed to open browser for device code ABCD-EFGH. Open http://service/cli-auth?code=ABCDEFGH manually.",
          "name": "RpcResponse.InternalError",
        }
      `)
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: times out while waiting for authorization', async () => {
    const handler = createHandler()
    const server = await createServer(handler.listener)

    try {
      const provider = Provider.create({
        open() {},
        pollIntervalMs: 1,
        host: `${server.url}/cli-auth`,
        timeoutMs: 10,
      })

      await expect(
        provider
          .request(connectRequest())
          .catch((error: { code: number; message: string; name: string }) => {
            return {
              code: error.code,
              message: error.message.replace(server.url, 'http://service'),
              name: error.name,
            }
          }),
      ).resolves.toMatchInlineSnapshot(`
        {
          "code": -32603,
          "message": "Timed out waiting for device code ABCD-EFGH. Continue at http://service/cli-auth?code=ABCDEFGH.",
          "name": "RpcResponse.InternalError",
        }
      `)
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: rejects non-bootstrap RPCs', async () => {
    const handler = createHandler()
    const server = await createServer(handler.listener)

    try {
      const provider = Provider.create({
        open: async (url) => {
          const code = new URL(url).searchParams.get('code')!
          await fetch(`${server.url}/cli-auth`, {
            body: JSON.stringify(await authorize(code)),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
          })
        },
        host: `${server.url}/cli-auth`,
      })

      await provider.request(connectRequest())

      await expect(
        provider.request({
          method: 'wallet_authorizeAccessKey',
          params: [{ expiry, keyType: accessKey.keyType, publicKey: accessKey.publicKey }],
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Provider.UnsupportedMethodError: \`authorizeAccessKey\` not supported by adapter.]`,
      )
    } finally {
      await server.closeAsync()
    }
  })
})
