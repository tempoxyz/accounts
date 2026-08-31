import { Hex } from 'ox'
import { describe, expect, test } from 'vp/test'
import type { DeviceCode } from 'wata'

import { accounts, chain } from '../../../../test/config.js'
import { createDeviceCodeHost, submitVerify } from '../../../../test/deviceCode.js'
import { createServer } from '../../../../test/utils.js'
import * as Provider from '../../Provider.js'
import { deviceCode } from './deviceCode.js'

const root = accounts[0]!
const accessKey = accounts[1]!
const expiry = Math.floor(Date.now() / 1000) + 3_600

function connectRequest() {
  return {
    method: 'wallet_connect',
    params: [
      {
        capabilities: {
          authorizeAccessKey: {
            expiry,
            keyType: accessKey.keyType,
            publicKey: accessKey.publicKey,
          },
        },
      },
    ],
  } as const
}

function createProvider(options: Partial<deviceCode.Options> & { url: string }) {
  return Provider.create({
    adapter: deviceCode({
      name: 'Accounts Test CLI',
      onPrompt: (prompt) => void submitVerify(prompt),
      rdns: 'xyz.tempo.accounts.test',
      ...options,
    }),
    chains: [chain],
  })
}

describe('deviceCode', () => {
  test('default: bootstraps wallet_connect through the device-code flow', async () => {
    const host = createDeviceCodeHost()
    const server = await createServer(host.listener)
    const prompts: DeviceCode.Prompt[] = []

    try {
      const provider = createProvider({
        onPrompt: (prompt) => {
          prompts.push(prompt)
          void submitVerify(prompt)
        },
        url: `${server.url}/auth/device`,
      })

      const result = await provider.request(connectRequest())
      const account = result.accounts[0]!
      const keyAuthorization = account.capabilities.keyAuthorization
        ? {
            ...account.capabilities.keyAuthorization,
            signature: { type: account.capabilities.keyAuthorization.signature.type },
          }
        : undefined

      expect(prompts).toHaveLength(1)
      expect(prompts[0]!.userCode).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/)
      expect(prompts[0]!.verificationUri).toBe(`${server.url}/auth/device/verify`)
      expect(prompts[0]!.verificationUriFull).toBe(
        `${server.url}/auth/device/verify?user_code=${prompts[0]!.userCode}`,
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
                "chainId": "${Hex.fromNumber(chain.id)}",
                "expiry": "${Hex.fromNumber(expiry)}",
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

  test('behavior: forwards request context to the host', async () => {
    const host = createDeviceCodeHost()
    const server = await createServer(host.listener)

    try {
      const provider = createProvider({ url: `${server.url}/auth/device` })
      await provider.request(connectRequest())

      expect(host.requests()).toHaveLength(1)
      expect(host.requests()[0]!.method).toBe('wallet_connect')
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: preserves a null username capability', async () => {
    const host = createDeviceCodeHost({ username: null })
    const server = await createServer(host.listener)

    try {
      const provider = createProvider({ url: `${server.url}/auth/device` })
      const result = await provider.request(connectRequest())

      expect(result.accounts[0]!.capabilities.username).toBeNull()
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: denial rejects with a user-rejected error', async () => {
    const host = createDeviceCodeHost()
    const server = await createServer(host.listener)

    try {
      const provider = createProvider({
        onPrompt: (prompt) => void submitVerify(prompt, { action: 'deny' }),
        url: `${server.url}/auth/device`,
      })

      await expect(
        provider.request(connectRequest()).catch((error: { code: number; message: string }) => ({
          code: error.code,
          message: error.message,
        })),
      ).resolves.toMatchInlineSnapshot(`
        {
          "code": 4001,
          "message": "User denied the device-code request.",
        }
      `)
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: keeps retrying while an approved response is being persisted', async () => {
    const host = createDeviceCodeHost()
    const server = await createServer(host.listener)
    let pendingApprovalResponses = 0

    try {
      const provider = createProvider({
        fetch: async (input, init) => {
          const url = input instanceof Request ? input.url : String(input)
          if (pendingApprovalResponses < 3 && url.endsWith('/token')) {
            pendingApprovalResponses++
            return Response.json(
              {
                error: 'server_error',
                error_description: 'approved but no response queued',
              },
              { status: 500 },
            )
          }
          return await fetch(input, init)
        },
        url: `${server.url}/auth/device`,
      })

      const result = await provider.request(connectRequest())

      expect({ address: result.accounts[0]?.address, pendingApprovalResponses })
        .toMatchInlineSnapshot(`
        {
          "address": "${root.address}",
          "pendingApprovalResponses": 3,
        }
      `)
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: times out while waiting for authorization', async () => {
    const host = createDeviceCodeHost({ pollingInterval: 10 })
    const server = await createServer(host.listener)

    try {
      const provider = createProvider({
        onPrompt: () => {},
        timeout: 100,
        url: `${server.url}/auth/device`,
      })

      const error = await provider.request(connectRequest()).then(
        () => undefined,
        (error: Error) => error,
      )
      expect(error?.message).toMatch(/^Timed out waiting for device code [A-Z-]+\. Continue at /)
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: onPrompt failures surface the URL and code', async () => {
    const host = createDeviceCodeHost()
    const server = await createServer(host.listener)

    try {
      const provider = createProvider({
        onPrompt: () => {
          throw new Error('browser unavailable')
        },
        url: `${server.url}/auth/device`,
      })

      const error = await provider.request(connectRequest()).then(
        () => undefined,
        (error: Error) => error,
      )
      expect(error?.message).toMatch(
        /^Failed to surface device code [A-Z-]+\. Open .*\/auth\/device\/verify\?user_code=[A-Z-]+ manually\.$/,
      )
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: rejects methods outside the allowlist without a ceremony', async () => {
    const host = createDeviceCodeHost()
    const server = await createServer(host.listener)
    const prompts: DeviceCode.Prompt[] = []

    try {
      const provider = createProvider({
        methods: ['wallet_authorizeAccessKey'],
        onPrompt: (prompt) => {
          prompts.push(prompt)
          void submitVerify(prompt)
        },
        url: `${server.url}/auth/device`,
      })

      await expect(provider.request(connectRequest())).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Provider.UnsupportedMethodError: \`wallet_connect\` not supported by device-code adapter.]`,
      )
      expect(prompts).toHaveLength(0)
    } finally {
      await server.closeAsync()
    }
  })
})
