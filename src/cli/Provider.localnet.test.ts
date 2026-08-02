import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Address, Hex } from 'ox'
import { Hex as ox_Hex } from 'ox'
import { type Address as ViemAddress, parseUnits } from 'viem'
import { Actions, Addresses } from 'viem/tempo'
import { describe, expect, test, vi } from 'vp/test'
import type * as z from 'zod/mini'

import { accounts, chain, getClient } from '../../test/config.js'
import { createDeviceCodeHost, submitVerify } from '../../test/deviceCode.js'
import { createJsonStorage, createServer } from '../../test/utils.js'
import type * as Rpc from '../core/zod/rpc.js'
import * as Provider from './Provider.js'
import * as Storage from './storage.js'

const root = accounts[0]!
const accessKey = accounts[1]!
const accessKey_2 = accounts[2]!
const expiry = Math.floor(Date.now() / 1000) + 3_600
const expiry_2 = expiry + 60

function connectRequest(
  options: {
    accessKey?: typeof accessKey | undefined
    expiry?: number | undefined
    method?: 'login' | 'register' | undefined
    showDeposit?: z.output<typeof Rpc.wallet_connect.showDeposit> | undefined
  } = {},
) {
  const { accessKey: key = accessKey, expiry: expiry_ = expiry, method, showDeposit } = options

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
          ...(method ? { method } : {}),
          ...(showDeposit !== undefined ? { showDeposit } : {}),
        },
      },
    ],
  } as const
}

async function createStoragePath() {
  return join(await mkdtemp(join(tmpdir(), 'accounts-cli-')), 'store.json')
}

async function readAccessKeys(storage: ReturnType<typeof Storage.filesystem>) {
  const value = await storage.getItem<{
    state: {
      accessKeys: {
        access: Address.Address
        address: Address.Address
        chainId: number
        expiry?: number | undefined
        handle?: { kind: string; privateKey: Hex.Hex } | undefined
        keyType: string
      }[]
    }
  }>('store')
  return value!.state.accessKeys
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

function connectCapabilities(host: ReturnType<typeof createDeviceCodeHost>, index: number) {
  const params = host.requests()[index]!.params as readonly {
    capabilities?: Record<string, unknown> | undefined
  }[]
  return params[0]?.capabilities
}

describe('Provider.create', () => {
  test('default: bootstraps wallet_connect through the device-code flow', async () => {
    const host = createDeviceCodeHost()
    const server = await createServer(host.listener)
    const opened: string[] = []

    try {
      const provider = Provider.create({
        chains: [chain],
        open: async (url, prompt) => {
          opened.push(url)
          await submitVerify(prompt)
        },
        host: `${server.url}/auth/device`,
        storage: createJsonStorage(),
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

      expect(opened).toHaveLength(1)
      expect(opened[0]).toMatch(
        new RegExp(`^${server.url}/auth/device/verify\\?user_code=[A-Z]{4}-[A-Z]{4}$`),
      )
      expect({
        account: {
          address: account.address,
          capabilities: keyAuthorization ? { keyAuthorization } : {},
        },
      }).toMatchInlineSnapshot(`
        {
          "account": {
            "address": "${root.address}",
            "capabilities": {
              "keyAuthorization": {
                "address": "${accessKey.address.toLowerCase()}",
                "chainId": "${ox_Hex.fromNumber(chain.id)}",
                "expiry": "${ox_Hex.fromNumber(expiry)}",
                "keyId": "${accessKey.address.toLowerCase()}",
                "keyType": "secp256k1",
                "signature": {
                  "type": "secp256k1",
                },
              },
            },
          },
        }
      `)
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: forwards showDeposit through registration device-code requests', async () => {
    const host = createDeviceCodeHost()
    const server = await createServer(host.listener)

    try {
      const provider = Provider.create({
        chains: [chain],
        open: async (_url, prompt) => {
          await submitVerify(prompt)
        },
        host: `${server.url}/auth/device`,
        storage: createJsonStorage(),
      })

      await provider.request(
        connectRequest({
          method: 'register',
          showDeposit: {
            amount: '50',
            displayName: 'DoorDash',
            on: 'register',
            token: 'USDC',
          },
        }),
      )

      expect(connectCapabilities(host, 0)?.showDeposit).toMatchInlineSnapshot(`
        {
          "amount": "50",
          "displayName": "DoorDash",
          "on": "register",
          "token": "USDC",
        }
      `)
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: forwards showDeposit through login device-code requests', async () => {
    const host = createDeviceCodeHost()
    const server = await createServer(host.listener)

    try {
      const provider = Provider.create({
        chains: [chain],
        open: async (_url, prompt) => {
          await submitVerify(prompt)
        },
        host: `${server.url}/auth/device`,
        storage: createJsonStorage(),
      })

      await provider.request(connectRequest({ method: 'login', showDeposit: true }))

      expect(connectCapabilities(host, 0)?.showDeposit).toBe(true)
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: forwards showDeposit through wallet_authorizeAccessKey device-code requests', async () => {
    const host = createDeviceCodeHost()
    const server = await createServer(host.listener)

    try {
      const provider = Provider.create({
        chains: [chain],
        open: async (_url, prompt) => {
          await submitVerify(prompt)
        },
        host: `${server.url}/auth/device`,
        storage: createJsonStorage(),
      })

      await provider.request(connectRequest())
      await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [
          {
            expiry,
            keyType: accessKey.keyType,
            publicKey: accessKey.publicKey,
            showDeposit: true,
          },
        ],
      })

      const params = host.requests()[1]!.params as readonly { showDeposit?: unknown }[]
      expect(host.requests()[1]!.method).toBe('wallet_authorizeAccessKey')
      expect(params[0]?.showDeposit).toBe(true)
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: browser-open failures surface the URL and code', async () => {
    const host = createDeviceCodeHost()
    const server = await createServer(host.listener)

    try {
      const provider = Provider.create({
        chains: [chain],
        open() {
          throw new Error('browser unavailable')
        },
        host: `${server.url}/auth/device`,
        storage: createJsonStorage(),
      })

      const error = await provider.request(connectRequest()).then(
        () => undefined,
        (error: Error) => error,
      )
      expect(error?.message).toMatch(
        /^Failed to surface device code [A-Z]{4}-[A-Z]{4}\. Open .*\/auth\/device\/verify\?user_code=[A-Z]{4}-[A-Z]{4} manually\.$/,
      )
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: prints the user code when the complete verification URI is absent', async () => {
    const host = createDeviceCodeHost({ omitVerificationUriFull: true })
    const server = await createServer(host.listener)
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    try {
      const provider = Provider.create({
        chains: [chain],
        open: async (url, prompt) => {
          expect(url).toBe(prompt.verificationUri)
          await submitVerify(prompt)
        },
        host: `${server.url}/auth/device`,
        storage: createJsonStorage(),
      })

      await provider.request(connectRequest())

      expect(write).toHaveBeenCalledWith(expect.stringMatching(/^Enter code .+ at http/))
    } finally {
      write.mockRestore()
      await server.closeAsync()
    }
  })

  test('behavior: times out while waiting for authorization', async () => {
    const host = createDeviceCodeHost({ pollingInterval: 10 })
    const server = await createServer(host.listener)

    try {
      const provider = Provider.create({
        chains: [chain],
        open() {},
        host: `${server.url}/auth/device`,
        storage: createJsonStorage(),
        timeout: 100,
      })

      const error = await provider.request(connectRequest()).then(
        () => undefined,
        (error: Error) => error,
      )
      expect(error?.message).toMatch(
        /^Timed out waiting for device code [A-Z]{4}-[A-Z]{4}\. Continue at /,
      )
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: wallet_authorizeAccessKey requires a connected account', async () => {
    const host = createDeviceCodeHost()
    const server = await createServer(host.listener)

    try {
      const provider = Provider.create({
        chains: [chain],
        open() {
          throw new Error('Unexpected browser open.')
        },
        host: `${server.url}/auth/device`,
        storage: createJsonStorage(),
      })

      await expect(
        provider.request({
          method: 'wallet_authorizeAccessKey',
          params: [
            { expiry: expiry_2, keyType: accessKey_2.keyType, publicKey: accessKey_2.publicKey },
          ],
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Provider.DisconnectedError: No active account.]`,
      )
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: authorizes an access key for the active account', async () => {
    const host = createDeviceCodeHost()
    const server = await createServer(host.listener)
    const opened: string[] = []

    try {
      const provider = Provider.create({
        chains: [chain],
        open: async (url, prompt) => {
          opened.push(url)
          await submitVerify(prompt)
        },
        host: `${server.url}/auth/device`,
        storage: createJsonStorage(),
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

      expect(opened).toHaveLength(2)
      expect({
        keyAuthorization,
        rootAddress: result.rootAddress,
      }).toMatchInlineSnapshot(`
        {
          "keyAuthorization": {
            "address": "${accessKey_2.address.toLowerCase()}",
            "chainId": "${ox_Hex.fromNumber(chain.id)}",
            "expiry": "${ox_Hex.fromNumber(expiry_2)}",
            "keyId": "${accessKey_2.address.toLowerCase()}",
            "keyType": "secp256k1",
            "signature": {
              "type": "secp256k1",
            },
          },
          "rootAddress": "${root.address}",
        }
      `)
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: rejects unsupported revokeAccessKey after bootstrap', async () => {
    const host = createDeviceCodeHost()
    const server = await createServer(host.listener)

    try {
      const provider = Provider.create({
        chains: [chain],
        open: async (_url, prompt) => {
          await submitVerify(prompt)
        },
        host: `${server.url}/auth/device`,
        storage: createJsonStorage(),
      })

      await provider.request(connectRequest())

      await expect(
        provider.request({
          method: 'wallet_revokeAccessKey',
          params: [{ accessKeyAddress: accessKey.address, address: root.address }],
        }),
      ).rejects.toThrow('`wallet_revokeAccessKey` not supported by device-code adapter.')
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: generates, persists, and reuses a managed key during wallet_connect', async () => {
    const host = createDeviceCodeHost()
    const server = await createServer(host.listener)
    const storagePath = await createStoragePath()
    const storage = Storage.filesystem({ path: storagePath })

    try {
      const provider = Provider.create({
        chains: [chain],
        open: async (_url, prompt) => {
          await submitVerify(prompt)
        },
        host: `${server.url}/auth/device`,
        storage,
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
      const storage_2 = Storage.filesystem({ path: storagePath })
      const provider_2 = Provider.create({
        chains: [chain],
        open() {
          throw new Error('Unexpected browser open.')
        },
        host: `${server.url}/auth/device`,
        storage: storage_2,
      })
      const receipt_2 = await provider_2.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })
      const [entry] = await readAccessKeys(storage)

      expect({
        initial: receipt.status,
        restored: receipt_2.status,
      }).toMatchInlineSnapshot(`
        {
          "initial": "0x1",
          "restored": "0x1",
        }
      `)
      expect(entry!.access).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')
      expect(entry!.chainId).toBe(1337)
      expect(entry!.keyType).toBe('p256')
      expect(entry!.address).toMatch(/^0x[0-9a-f]{40}$/i)
      // The CLI default is an extractable WebCrypto P-256 key (JWK handle),
      // which survives the filesystem storage round-trip above.
      expect(entry!.handle).toMatchObject({ kind: 'webcrypto-p256' })
      expect((entry!.handle as { jwk?: { d?: string } }).jwk?.d).toBeTruthy()
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: signs messages locally with the managed access key', async () => {
    const host = createDeviceCodeHost()
    const server = await createServer(host.listener)

    try {
      const provider = Provider.create({
        chains: [chain],
        open: async (_url, prompt) => {
          await submitVerify(prompt)
        },
        host: `${server.url}/auth/device`,
        storage: createJsonStorage(),
      })
      const connected = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { authorizeAccessKey: { expiry: expiry_2 } } }],
      })
      const address = connected.accounts[0]!.address

      const personal = await provider.request({
        method: 'personal_sign',
        params: ['0x68656c6c6f', address],
      })
      const typedData = await provider.request({
        method: 'eth_signTypedData_v4',
        params: [
          address,
          JSON.stringify({
            domain: {},
            message: { contents: 'hello' },
            primaryType: 'Message',
            types: {
              EIP712Domain: [],
              Message: [{ name: 'contents', type: 'string' }],
            },
          }),
        ],
      })

      expect(personal).toMatch(/^0x/)
      expect(typedData).toMatch(/^0x/)
      expect(host.requests()).toHaveLength(1)
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: generates a managed key for wallet_authorizeAccessKey without publicKey', async () => {
    const host = createDeviceCodeHost()
    const server = await createServer(host.listener)
    const storagePath = await createStoragePath()
    const storage = Storage.filesystem({ path: storagePath })

    try {
      const provider = Provider.create({
        chains: [chain],
        open: async (_url, prompt) => {
          await submitVerify(prompt)
        },
        host: `${server.url}/auth/device`,
        storage,
      })

      const connected = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: {} }],
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
      const [entry] = await readAccessKeys(storage)

      expect(connected.accounts[0]!.address).toBe(root.address)
      expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
      expect({
        access: entry!.access,
        chainId: entry!.chainId,
      }).toMatchInlineSnapshot(`
        {
          "access": "${root.address}",
          "chainId": ${chain.id},
        }
      `)
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: wallet_updateAccessKey replaces an unpublished key authorization', async () => {
    const host = createDeviceCodeHost()
    const server = await createServer(host.listener)
    const storagePath = await createStoragePath()
    const storage = Storage.filesystem({ path: storagePath })

    try {
      const provider = Provider.create({
        chains: [chain],
        open: async (_url, prompt) => {
          await submitVerify(prompt)
        },
        host: `${server.url}/auth/device`,
        storage,
      })

      const result = await provider.request({
        method: 'wallet_connect',
        params: [
          {
            capabilities: {
              authorizeAccessKey: {
                expiry: expiry_2,
                limits: [{ limit: ox_Hex.fromNumber(1n), token: Addresses.pathUsd }],
              },
            },
          },
        ],
      })
      const account = result.accounts[0]!
      const accessKeyAddress = account.capabilities.keyAuthorization!.keyId

      const updated = parseUnits('9', 6)
      await provider.request({
        method: 'wallet_updateAccessKey',
        params: [
          {
            address: account.address,
            accessKeyAddress,
            limits: [{ limit: ox_Hex.fromNumber(updated), token: Addresses.pathUsd }],
          },
        ],
      })

      const [stored] = provider.store.accessKeys.list({
        accessKey: accessKeyAddress,
        account: account.address,
        chainId: chain.id,
      })
      expect(stored?.keyAuthorization?.limits).toEqual([
        { limit: updated, token: Addresses.pathUsd },
      ])
      expect(
        await provider.store.accessKeys.getStatus({
          accessKey: accessKeyAddress,
          account: account.address,
          chainId: chain.id,
          client: getClient(),
        }),
      ).toBe('pending')
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: wallet_updateAccessKey updates published spending limits through approval', async () => {
    const host = createDeviceCodeHost()
    const server = await createServer(host.listener)
    const storagePath = await createStoragePath()
    const storage = Storage.filesystem({ path: storagePath })

    try {
      const provider = Provider.create({
        chains: [chain],
        open: async (_url, prompt) => {
          await submitVerify(prompt)
        },
        host: `${server.url}/auth/device`,
        storage,
      })

      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { authorizeAccessKey: { expiry: expiry_2 } } }],
      })
      const account = result.accounts[0]!
      const accessKeyAddress = account.capabilities.keyAuthorization!.keyId
      await fund(account.address)
      await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })

      const updated = parseUnits('9', 6)
      await provider.request({
        method: 'wallet_updateAccessKey',
        params: [
          {
            address: account.address,
            accessKeyAddress,
            limits: [{ limit: ox_Hex.fromNumber(updated), token: Addresses.pathUsd }],
          },
        ],
      })

      const { remaining } = await Actions.accessKey.getRemainingLimit(getClient(), {
        account: account.address,
        accessKey: accessKeyAddress,
        token: Addresses.pathUsd,
      })
      expect(remaining).toBe(updated)
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: regenerates a managed key when the requested key type changes', async () => {
    const host = createDeviceCodeHost()
    const server = await createServer(host.listener)
    const storagePath = await createStoragePath()
    const storage = Storage.filesystem({ path: storagePath })

    try {
      const provider = Provider.create({
        chains: [chain],
        open: async (_url, prompt) => {
          await submitVerify(prompt)
        },
        host: `${server.url}/auth/device`,
        storage,
      })

      await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: {} }],
      })
      // secp256k1 is requested explicitly; p256 is the default — a genuine
      // type change that regenerates the managed key.
      const first = await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry, keyType: 'secp256k1' }],
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
      const keys = await readAccessKeys(storage)

      expect(first.keyAuthorization.keyType).toBe('secp256k1')
      expect(second.keyAuthorization.keyType).toBe('p256')
      expect(first.keyAuthorization.keyId).not.toBe(second.keyAuthorization.keyId)
      expect(new Set(keys.map((key) => key.keyType))).toEqual(new Set(['secp256k1', 'p256']))
      expect(receipt.status).toBe('0x1')
    } finally {
      await server.closeAsync()
    }
  })
})
