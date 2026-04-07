import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Address, Hex, PublicKey } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { type Address as ViemAddress, parseUnits } from 'viem'
import { Actions, Addresses } from 'viem/tempo'
import { describe, expect, test } from 'vp/test'
import * as z from 'zod/mini'

import { accounts, chain, getClient } from '../../test/config.js'
import { createServer } from '../../test/utils.js'
import * as CliAuth from '../server/CliAuth.js'
import * as Handler from '../server/Handler.js'
import * as Keyring from './keyring.js'
import * as Provider from './Provider.js'

const root = accounts[0]!
const accessKey = accounts[1]!
const accessKey_2 = accounts[2]!
const expiry = Math.floor(Date.now() / 1000) + 3_600
const expiry_2 = expiry + 60

async function authorize(
  code: string,
  options: {
    accessKey?: typeof accessKey | undefined
    expiry?: number | undefined
  } = {},
) {
  const { accessKey: key = accessKey, expiry: expiry_ = expiry } = options

  const signed = await root.signKeyAuthorization(
    {
      accessKeyAddress: key.address,
      keyType: key.keyType,
    },
    {
      chainId: BigInt(chain.id),
      expiry: expiry_,
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

function connectRequest(
  options: {
    accessKey?: typeof accessKey | undefined
    expiry?: number | undefined
  } = {},
) {
  const { accessKey: key = accessKey, expiry: expiry_ = expiry } = options

  return {
    method: 'wallet_connect',
    params: [
      {
        capabilities: {
          authorizeAccessKey: {
            expiry: expiry_,
            keyType: key.keyType,
            publicKey: key.publicKey,
          },
        },
      },
    ],
  } as const
}

function createHandler() {
  let random = 0

  return Handler.codeAuth({
    path: '/cli-auth',
    chains: [chain],
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

async function createKeysPath() {
  return join(await mkdtemp(join(tmpdir(), 'accounts-cli-')), 'keys.toml')
}

async function fund(address: ViemAddress) {
  await Actions.token.transferSync(getClient(), {
    account: root,
    feeToken: Addresses.pathUsd,
    to: address,
    token: Addresses.pathUsd,
    amount: parseUnits('10', 6),
  })
}

const transferCall = Actions.token.transfer.call({
  to: '0x0000000000000000000000000000000000000001',
  token: Addresses.pathUsd,
  amount: parseUnits('1', 6),
})

describe('Provider.create', () => {
  test('default: bootstraps wallet_connect through the device-code flow', async () => {
    const handler = createHandler()
    const server = await createServer(handler.listener)
    const opened: string[] = []

    try {
      const provider = Provider.create({
        chains: [chain],
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
        chains: [chain],
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
        chains: [chain],
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

  test('behavior: authorizes an access key while disconnected when publicKey is provided', async () => {
    const handler = createHandler()
    const server = await createServer(handler.listener)
    const opened: string[] = []

    try {
      const provider = Provider.create({
        chains: [chain],
        open: async (url) => {
          opened.push(url)
          const code = new URL(url).searchParams.get('code')!
          try {
            await fetch(`${server.url}/cli-auth`, {
              body: JSON.stringify(
                await authorize(code, { accessKey: accessKey_2, expiry: expiry_2 }),
              ),
              headers: { 'content-type': 'application/json' },
              method: 'POST',
            })
          } catch {}
        },
        host: `${server.url}/cli-auth`,
      })

      const result = await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [
          { expiry: expiry_2, keyType: accessKey_2.keyType, publicKey: accessKey_2.publicKey },
        ],
      })
      const keyAuthorization = {
        ...result.keyAuthorization,
        signature: {
          type: result.keyAuthorization.signature.type,
        },
      }

      expect({
        keyAuthorization,
        rootAddress: result.rootAddress,
        opened: opened.map((url) => url.replace(server.url, 'http://service')),
      }).toMatchInlineSnapshot(`
        {
          "keyAuthorization": {
            "address": "${accessKey_2.address}",
            "chainId": "${Hex.fromNumber(chain.id)}",
            "expiry": "${Hex.fromNumber(expiry_2)}",
            "keyId": "${accessKey_2.address}",
            "keyType": "secp256k1",
            "signature": {
              "type": "secp256k1",
            },
          },
          "opened": [
            "http://service/cli-auth?code=ABCDEFGH",
          ],
          "rootAddress": "${root.address}",
        }
      `)
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: authorizes an access key for the active account', async () => {
    const handler = createHandler()
    const server = await createServer(handler.listener)
    const opened: string[] = []

    try {
      const approvals = [
        (code: string) => authorize(code),
        (code: string) => authorize(code, { accessKey: accessKey_2, expiry: expiry_2 }),
      ]
      const provider = Provider.create({
        chains: [chain],
        open: async (url) => {
          opened.push(url)
          const approve = approvals.shift()
          if (!approve) throw new Error('Unexpected device-code approval request.')
          const code = new URL(url).searchParams.get('code')!
          await fetch(`${server.url}/cli-auth`, {
            body: JSON.stringify(await approve(code)),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
          })
        },
        host: `${server.url}/cli-auth`,
      })

      await provider.request(connectRequest())

      const result = await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [
          { expiry: expiry_2, keyType: accessKey_2.keyType, publicKey: accessKey_2.publicKey },
        ],
      })
      const keyAuthorization = {
        ...result.keyAuthorization,
        signature: {
          type: result.keyAuthorization.signature.type,
        },
      }

      expect({
        keyAuthorization,
        rootAddress: result.rootAddress,
        opened: opened.map((url) => url.replace(server.url, 'http://service')),
      }).toMatchInlineSnapshot(`
        {
          "keyAuthorization": {
            "address": "${accessKey_2.address}",
            "chainId": "${Hex.fromNumber(chain.id)}",
            "expiry": "${Hex.fromNumber(expiry_2)}",
            "keyId": "${accessKey_2.address}",
            "keyType": "secp256k1",
            "signature": {
              "type": "secp256k1",
            },
          },
          "opened": [
            "http://service/cli-auth?code=ABCDEFGH",
            "http://service/cli-auth?code=JKLMNPQR",
          ],
          "rootAddress": "${root.address}",
        }
      `)
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: rejects unsupported revokeAccessKey after bootstrap', async () => {
    const handler = createHandler()
    const server = await createServer(handler.listener)

    try {
      const provider = Provider.create({
        chains: [chain],
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
          method: 'wallet_revokeAccessKey',
          params: [{ accessKeyAddress: accessKey.address, address: root.address }],
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Provider.UnsupportedMethodError: \`wallet_revokeAccessKey\` not supported by CLI adapter.]`,
      )
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: generates, persists, and uses a managed key during wallet_connect', async () => {
    const handler = createHandler()
    const server = await createServer(handler.listener)
    const keysPath = await createKeysPath()

    try {
      const provider = Provider.create({
        chains: [chain],
        keysPath,
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

      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { authorizeAccessKey: { expiry: expiry_2 } } }],
      })
      const account = result.accounts[0]!
      await fund(account.address)

      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })
      const [entry] = await Keyring.load({ path: keysPath })
      const { key, keyAuthorization, ...persisted } = entry!

      expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
      expect({
        ...persisted,
        keyAddress: persisted.keyAddress.toLowerCase(),
      }).toMatchInlineSnapshot(`
        {
          "chainId": ${chain.id},
          "expiry": ${expiry_2},
          "keyAddress": "${account.capabilities.keyAuthorization!.keyId.toLowerCase()}",
          "keyType": "secp256k1",
          "walletAddress": "${root.address}",
          "walletType": "passkey",
        }
      `)
      expect(key).toMatch(/^0x[0-9a-f]{64}$/i)
      expect(keyAuthorization).toMatch(/^0x[0-9a-f]+$/i)
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: generates a managed key for wallet_authorizeAccessKey without publicKey', async () => {
    const handler = createHandler()
    const server = await createServer(handler.listener)
    const keysPath = await createKeysPath()

    try {
      const provider = Provider.create({
        chains: [chain],
        keysPath,
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

      const result = await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry: expiry_2 }],
      })
      await fund(result.rootAddress)

      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })
      const toml = await readFile(keysPath, 'utf8')

      expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
      expect(toml).toContain(`wallet_address = "${root.address}"`)
      expect(toml).toContain(`chain_id = ${chain.id}`)
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: regenerates a managed key when the requested key type changes', async () => {
    const handler = createHandler()
    const server = await createServer(handler.listener)
    const keysPath = await createKeysPath()

    try {
      const provider = Provider.create({
        chains: [chain],
        keysPath,
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

      const first = await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry }],
      })
      const second = await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry: expiry_2, keyType: 'p256' }],
      })
      await fund(second.rootAddress)

      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })
      const keys = await Keyring.load({ path: keysPath })

      expect({
        first: {
          keyId: first.keyAuthorization.keyId,
          keyType: first.keyAuthorization.keyType,
        },
        second: {
          keyId: second.keyAuthorization.keyId,
          keyType: second.keyAuthorization.keyType,
        },
        stored: keys.map((key) => ({
          keyAddress: key.keyAddress.toLowerCase(),
          keyType: key.keyType,
        })),
      }).toMatchInlineSnapshot(`
        {
          "first": {
            "keyId": "${first.keyAuthorization.keyId}",
            "keyType": "secp256k1",
          },
          "second": {
            "keyId": "${second.keyAuthorization.keyId}",
            "keyType": "p256",
          },
          "stored": [
            {
              "keyAddress": "${first.keyAuthorization.keyId}",
              "keyType": "secp256k1",
            },
            {
              "keyAddress": "${second.keyAuthorization.keyId}",
              "keyType": "p256",
            },
          ],
        }
      `)
      expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
    } finally {
      await server.closeAsync()
    }
  })
})
