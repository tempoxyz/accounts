import { Hex } from 'ox'
import { custom } from 'viem'
import { createSiweMessage } from 'viem/siwe'
import { vi } from 'vitest'
import { afterEach, describe, expect, test } from 'vp/test'

import * as Adapter from './Adapter.js'
import * as Provider from './Provider.js'
import * as Storage from './Storage.js'

const address = '0x0000000000000000000000000000000000000001'
const hash = `0x${'11'.repeat(32)}` as const
const receivePolicy = vi.hoisted(() => ({
  burn: vi.fn(),
  claim: vi.fn(),
  get: vi.fn(),
  getBlockedBalance: vi.fn(),
  set: vi.fn(),
  validate: vi.fn(),
}))

vi.mock('viem/tempo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem/tempo')>()
  return {
    ...actual,
    Actions: {
      ...actual.Actions,
      receivePolicy: {
        ...actual.Actions.receivePolicy,
        burn: receivePolicy.burn,
        claim: receivePolicy.claim,
        get: receivePolicy.get,
        getBlockedBalance: receivePolicy.getBlockedBalance,
        set: receivePolicy.set,
        validate: receivePolicy.validate,
      },
    },
  }
})

function receivePolicyAdapter() {
  const account = { address, type: 'local' as const }
  return Adapter.define({ name: 'Test Wallet', rdns: 'com.example.test' }, () => ({
    actions: {
      async createAccount() {
        return { accounts: [{ address }] }
      },
      async loadAccounts() {
        return { accounts: [{ address }] }
      },
    },
    getAccount() {
      return { account: account as never }
    },
  }))
}

const keyAuthorization = {
  account: address,
  chainId: '0x1',
  expiry: null,
  isAdmin: true,
  keyId: '0x0000000000000000000000000000000000000002',
  keyType: 'p256',
  limits: undefined,
  signature: {
    r: `0x${'22'.repeat(32)}`,
    s: `0x${'33'.repeat(32)}`,
    type: 'p256',
    yParity: '0x0',
  },
} as const

describe('wallet_connect', () => {
  test('behavior: validates auth before preparing access key material', async () => {
    const createKey = vi.fn(() => {
      throw new Error('createKey called')
    })
    const adapter = Adapter.define({ name: 'Test Wallet', rdns: 'com.example.test' }, () => ({
      actions: {
        async createAccount() {
          return { accounts: [{ address }] }
        },
        async loadAccounts() {
          return { accounts: [{ address }] }
        },
      },
    }))
    const provider = Provider.create({
      accessKey: {
        keystores: {
          p256: {
            createKey,
            toAccount() {
              throw new Error('unused')
            },
          },
        },
      },
      adapter,
      storage: Storage.memory(),
    })

    await expect(
      provider.request({
        method: 'wallet_connect',
        params: [
          {
            capabilities: {
              auth: { returnToken: true },
              authorizeAccessKey: { expiry: 123 },
            },
          },
        ],
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: \`auth\` capability must include either \`url\` or an explicit \`challenge\` endpoint.]`,
    )
    expect(createKey.mock.calls).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: forwards identity.email + identity.idToken onto the authenticated account', async () => {
    const adapter = Adapter.define({ name: 'Test Wallet', rdns: 'com.example.test' }, () => ({
      actions: {
        async createAccount() {
          return { accounts: [{ address }] }
        },
        async loadAccounts() {
          return {
            accounts: [{ address }],
            identity: { email: 'alice@example.com', idToken: 'eyJhbG.payload.sig' },
          }
        },
      },
    }))
    const provider = Provider.create({ adapter, storage: Storage.memory() })

    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { identity: { email: true } } }],
    })

    expect(result.accounts[0]?.capabilities?.identity).toMatchInlineSnapshot(`
      {
        "email": "alice@example.com",
        "idToken": "eyJhbG.payload.sig",
      }
    `)
  })

  describe('identity + auth', () => {
    afterEach(() => vi.unstubAllGlobals())

    test('behavior: forwards identity.idToken into the auth verify request body', async () => {
      // Capture the body POSTed to the verify endpoint. The challenge endpoint
      // echoes the SDK-sent chainId into a valid SIWE message so the SDK's
      // challenge validation (domain/uri/chainId/nonce) passes.
      let verifyBody: Record<string, unknown> | undefined
      vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/auth/challenge')) {
          const { chainId } = JSON.parse(String(init?.body)) as { chainId: number }
          const message = [
            'app.example.com wants you to sign in with your Ethereum account:',
            address,
            '',
            '',
            'URI: https://app.example.com',
            'Version: 1',
            `Chain ID: ${chainId}`,
            'Nonce: deadbeef00',
            'Issued At: 2025-01-01T00:00:00Z',
          ].join('\n')
          return new Response(JSON.stringify({ message }), { status: 200 })
        }
        if (url === 'https://app.example.com/auth') {
          verifyBody = JSON.parse(String(init?.body))
          return new Response(JSON.stringify({ token: 'session' }), { status: 200 })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })

      const adapter = Adapter.define({ name: 'Test Wallet', rdns: 'com.example.test' }, () => ({
        actions: {
          async createAccount() {
            return { accounts: [{ address }] }
          },
          async loadAccounts() {
            // Wallet host minted the token during the ceremony, reusing the
            // SIWE nonce; it surfaces on the connect result's identity.
            return {
              accounts: [{ address }],
              identity: { email: 'alice@example.com', idToken: 'eyJhbG.payload.sig' },
              signature: '0xabc',
            }
          },
        },
      }))
      const provider = Provider.create({ adapter, storage: Storage.memory() })

      await provider.request({
        method: 'wallet_connect',
        params: [
          {
            capabilities: {
              auth: { url: 'https://app.example.com/auth' },
              identity: { email: true },
            },
          },
        ],
      })

      expect(verifyBody?.idToken).toBe('eyJhbG.payload.sig')
    })
  })

  describe('auth resources', () => {
    afterEach(() => vi.unstubAllGlobals())

    function authAdapter() {
      return Adapter.define({ name: 'Test Wallet', rdns: 'com.example.test' }, () => ({
        actions: {
          async createAccount() {
            return { accounts: [{ address }], signature: '0xabc' }
          },
          async loadAccounts() {
            return { accounts: [{ address }], signature: '0xabc' }
          },
        },
      }))
    }

    function message(options: {
      chainId: number
      resources?: readonly string[] | undefined
      statement?: string | undefined
    }) {
      const { chainId, resources, statement } = options
      return createSiweMessage({
        address,
        chainId,
        domain: 'app.example.com',
        uri: 'https://app.example.com',
        version: '1',
        nonce: 'deadbeef00',
        issuedAt: new Date('2025-01-01T00:00:00Z'),
        ...(resources ? { resources: [...resources] } : {}),
        ...(statement ? { statement } : {}),
      })
    }

    function stubAuthFetch(options: {
      resources?: readonly string[] | undefined
      statement?: string | undefined
      onChallenge?: ((body: Record<string, unknown>) => void) | undefined
      verify?: Record<string, unknown> | undefined
    }) {
      vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/auth/challenge')) {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>
          options.onChallenge?.(body)
          const { chainId } = body as { chainId: number }
          return new Response(
            JSON.stringify({
              message: message({
                chainId,
                resources: options.resources,
                statement: options.statement,
              }),
            }),
            { status: 200 },
          )
        }
        if (url === 'https://app.example.com/auth')
          return new Response(JSON.stringify(options.verify ?? { token: 'session' }), {
            status: 200,
          })
        throw new Error(`unexpected fetch: ${url}`)
      })
    }

    function connect(
      provider: ReturnType<typeof Provider.create>,
      options: {
        chainId?: `0x${string}` | undefined
        resources: readonly string[]
      },
    ) {
      const { chainId, resources } = options
      return provider.request({
        method: 'wallet_connect',
        params: [
          {
            ...(chainId ? { chainId } : {}),
            capabilities: {
              auth: {
                url: 'https://app.example.com/auth',
                resources,
              },
            },
          },
        ],
      })
    }

    test('behavior: sends resources and accepts a server-provided statement', async () => {
      const resources = ['urn:tempo:api-signing-key:test', 'https://api.example.com/signing-keys/1']
      let challengeBody: Record<string, unknown> | undefined
      stubAuthFetch({
        resources,
        statement: 'Authorize a scoped API signing key.',
        onChallenge(body) {
          challengeBody = body
        },
      })

      const provider = Provider.create({ adapter: authAdapter(), storage: Storage.memory() })

      await connect(provider, {
        chainId: Hex.fromNumber(1),
        resources,
      })

      expect(challengeBody).toMatchInlineSnapshot(`
        {
          "chainId": 1,
          "resources": [
            "urn:tempo:api-signing-key:test",
            "https://api.example.com/signing-keys/1",
          ],
        }
      `)
    })

    test('error: rejects when the challenge omits requested resources', async () => {
      const resources = ['https://api.example.com/signing-keys/1']
      stubAuthFetch({})
      const provider = Provider.create({ adapter: authAdapter(), storage: Storage.memory() })

      await expect(
        connect(provider, {
          resources,
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[RpcResponse.InvalidParamsError: Server Authentication challenge endpoint \`https://app.example.com/auth/challenge\` did not echo the requested SIWE resources.]`,
      )
    })

    test('error: rejects when the challenge changes requested resources', async () => {
      const resources = ['https://api.example.com/signing-keys/1']
      stubAuthFetch({
        resources: ['https://api.example.com/signing-keys/2'],
      })
      const provider = Provider.create({ adapter: authAdapter(), storage: Storage.memory() })

      await expect(
        connect(provider, {
          resources,
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[RpcResponse.InvalidParamsError: Server Authentication challenge endpoint \`https://app.example.com/auth/challenge\` did not echo the requested SIWE resources.]`,
      )
    })

    test('error: rejects when forwarded auth message omits requested resources', async () => {
      const resources = ['https://api.example.com/signing-keys/1']
      const signed = message({ chainId: 1 })
      let verifyCalled = false
      vi.stubGlobal('fetch', async (input: string | URL) => {
        const url = String(input)
        if (url === 'https://app.example.com/auth') {
          verifyCalled = true
          return new Response(JSON.stringify({ token: 'session' }), { status: 200 })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
      const adapter = Adapter.define({ name: 'Test Wallet', rdns: 'com.example.test' }, () => ({
        actions: {
          async createAccount() {
            return {
              accounts: [{ address }],
              personalSign: { message: signed },
              signature: '0xabc',
            }
          },
          async loadAccounts() {
            return {
              accounts: [{ address }],
              personalSign: { message: signed },
              signature: '0xabc',
            }
          },
        },
        forwardsAuth: true,
      }))
      const provider = Provider.create({ adapter, storage: Storage.memory() })

      await expect(
        connect(provider, {
          chainId: Hex.fromNumber(1),
          resources,
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[RpcResponse.InvalidParamsError: Server Authentication challenge endpoint \`https://app.example.com/auth/challenge\` did not echo the requested SIWE resources.]`,
      )
      expect(verifyCalled).toMatchInlineSnapshot(`false`)
    })

    test('behavior: preserves extra verify JSON under capabilities.auth', async () => {
      const resources = ['https://api.example.com/signing-keys/1']
      stubAuthFetch({
        resources,
        verify: {
          apiSigningKey: { id: 'key_1', scope: 'read' },
          token: 'session',
        },
      })
      const provider = Provider.create({ adapter: authAdapter(), storage: Storage.memory() })

      const result = await connect(provider, {
        resources,
      })

      expect(result.accounts[0]?.capabilities.auth).toMatchInlineSnapshot(`
        {
          "apiSigningKey": {
            "id": "key_1",
            "scope": "read",
          },
          "token": "session",
        }
      `)
    })
  })
})

describe('wallet_authorizeAdminKey', () => {
  test('behavior: forwards to json-rpc adapter and returns key authorization', async () => {
    const requests: unknown[] = []
    const adapter = Adapter.define({ name: 'Test Wallet', rdns: 'com.example.test' }, () => ({
      actions: {
        async createAccount() {
          return { accounts: [{ address }] }
        },
        async loadAccounts() {
          return { accounts: [{ address }] }
        },
      },
      getAccount() {
        return {
          account: { address, type: 'json-rpc' as const },
          transport: custom({
            async request(request) {
              requests.push(request)
              return { keyAuthorization, rootAddress: address }
            },
          }),
        }
      },
    }))
    const provider = Provider.create({ adapter, storage: Storage.memory() })

    const result = await provider.request({
      method: 'wallet_authorizeAdminKey',
      params: [{ chainId: '0x1', publicKey: '0x1234' }],
    })

    expect(requests).toMatchInlineSnapshot(`
      [
        {
          "method": "wallet_authorizeAdminKey",
          "params": [
            {
              "chainId": "0x1",
              "publicKey": "0x1234",
            },
          ],
        },
      ]
    `)
    expect(result).toMatchInlineSnapshot(`
      {
        "keyAuthorization": {
          "account": "0x0000000000000000000000000000000000000001",
          "address": "0x0000000000000000000000000000000000000002",
          "chainId": "0x1",
          "expiry": null,
          "isAdmin": true,
          "keyId": "0x0000000000000000000000000000000000000002",
          "keyType": "p256",
          "limits": undefined,
          "signature": {
            "r": "0x2222222222222222222222222222222222222222222222222222222222222222",
            "s": "0x3333333333333333333333333333333333333333333333333333333333333333",
            "type": "p256",
            "yParity": "0x0",
          },
        },
        "rootAddress": "0x0000000000000000000000000000000000000001",
      }
    `)
  })
})

describe('wallet_receivePolicy', () => {
  afterEach(() => {
    receivePolicy.burn.mockReset()
    receivePolicy.claim.mockReset()
    receivePolicy.get.mockReset()
    receivePolicy.getBlockedBalance.mockReset()
    receivePolicy.set.mockReset()
    receivePolicy.validate.mockReset()
  })

  test('behavior: read methods decode params and encode return values', async () => {
    receivePolicy.get.mockResolvedValue({
      claimer: 'self',
      hasReceivePolicy: true,
      recoveryAuthority: address,
      senderPolicyId: 2n,
      senderPolicyType: 'whitelist',
      tokenPolicyId: 'allow-all',
      tokenPolicyType: 'blacklist',
    })
    receivePolicy.validate.mockResolvedValue({
      authorized: false,
      blockedReason: 'receivePolicy',
    })
    receivePolicy.getBlockedBalance.mockResolvedValue(123n)
    const provider = Provider.create({
      adapter: receivePolicyAdapter(),
      storage: Storage.memory(),
    })

    const policy = await provider.request({
      method: 'wallet_receivePolicy_get',
      params: [{ account: address, chainId: '0x1' }],
    })
    const validation = await provider.request({
      method: 'wallet_receivePolicy_validate',
      params: [{ chainId: '0x1', receiver: address, sender: address, token: address }],
    })
    const blockedBalance = await provider.request({
      method: 'wallet_receivePolicy_getBlockedBalance',
      params: [{ chainId: '0x1', receipt: '0x1234' }],
    })

    expect(receivePolicy.get.mock.calls[0]?.[1]).toMatchInlineSnapshot(`
      {
        "account": "0x0000000000000000000000000000000000000001",
      }
    `)
    expect(policy).toMatchInlineSnapshot(`
      {
        "claimer": "self",
        "hasReceivePolicy": true,
        "recoveryAuthority": "0x0000000000000000000000000000000000000001",
        "senderPolicyId": "0x2",
        "senderPolicyType": "whitelist",
        "tokenPolicyId": "allow-all",
        "tokenPolicyType": "blacklist",
      }
    `)
    expect(receivePolicy.validate.mock.calls[0]?.[1]).toMatchInlineSnapshot(`
      {
        "receiver": "0x0000000000000000000000000000000000000001",
        "sender": "0x0000000000000000000000000000000000000001",
        "token": "0x0000000000000000000000000000000000000001",
      }
    `)
    expect(validation).toMatchInlineSnapshot(`
      {
        "authorized": false,
        "blockedReason": "receivePolicy",
      }
    `)
    expect(receivePolicy.getBlockedBalance.mock.calls[0]?.[1]).toMatchInlineSnapshot(`
      {
        "receipt": "0x1234",
      }
    `)
    expect(blockedBalance).toMatchInlineSnapshot(`"0x7b"`)
  })

  test('behavior: set resolves feePayer true from provider default', async () => {
    receivePolicy.set.mockResolvedValue(hash)
    const provider = Provider.create({
      adapter: receivePolicyAdapter(),
      feePayer: 'https://relay.example.com',
      storage: Storage.memory(),
    })
    await provider.request({ method: 'wallet_connect' })

    const result = await provider.request({
      method: 'wallet_receivePolicy_set',
      params: [{ feePayer: true, senderPolicyId: 'allow-all', tokenPolicyId: 'reject-all' }],
    })

    expect(result).toMatchInlineSnapshot(
      `"0x1111111111111111111111111111111111111111111111111111111111111111"`,
    )
    expect(receivePolicy.set.mock.calls[0]?.[1]).toMatchInlineSnapshot(`
      {
        "account": {
          "address": "0x0000000000000000000000000000000000000001",
          "type": "local",
        },
        "feePayer": true,
        "senderPolicyId": "allow-all",
        "tokenPolicyId": "reject-all",
      }
    `)
  })

  test('behavior: set does not forward unresolved feePayer true', async () => {
    receivePolicy.set.mockResolvedValue(hash)
    const provider = Provider.create({
      adapter: receivePolicyAdapter(),
      storage: Storage.memory(),
    })
    await provider.request({ method: 'wallet_connect' })

    await provider.request({
      method: 'wallet_receivePolicy_set',
      params: [{ feePayer: true, senderPolicyId: 'allow-all' }],
    })

    expect(receivePolicy.set.mock.calls[0]?.[1]).toMatchInlineSnapshot(`
      {
        "account": {
          "address": "0x0000000000000000000000000000000000000001",
          "type": "local",
        },
        "senderPolicyId": "allow-all",
      }
    `)
  })

  test('behavior: claim and burn forward explicit feePayer URLs', async () => {
    receivePolicy.claim.mockResolvedValue(hash)
    receivePolicy.burn.mockResolvedValue(hash)
    const provider = Provider.create({
      adapter: receivePolicyAdapter(),
      storage: Storage.memory(),
    })
    await provider.request({ method: 'wallet_connect' })

    await provider.request({
      method: 'wallet_receivePolicy_claim',
      params: [{ feePayer: 'https://relay.example.com', receipt: '0x1234', to: address }],
    })
    await provider.request({
      method: 'wallet_receivePolicy_burn',
      params: [{ feePayer: 'https://relay.example.com', receipt: '0x1234' }],
    })

    expect(receivePolicy.claim.mock.calls[0]?.[1]).toMatchInlineSnapshot(`
      {
        "account": {
          "address": "0x0000000000000000000000000000000000000001",
          "type": "local",
        },
        "feePayer": true,
        "receipt": "0x1234",
        "to": "0x0000000000000000000000000000000000000001",
      }
    `)
    expect(receivePolicy.burn.mock.calls[0]?.[1]).toMatchInlineSnapshot(`
      {
        "account": {
          "address": "0x0000000000000000000000000000000000000001",
          "type": "local",
        },
        "feePayer": true,
        "receipt": "0x1234",
      }
    `)
  })
})

describe('adapter actions', () => {
  test('behavior: explicit adapter action overrides provider default', async () => {
    const getAccount = vi.fn(() => {
      throw new Error('getAccount called')
    })
    const signPersonalMessage = vi.fn(
      async (_parameters: Adapter.signPersonalMessage.Parameters) => {
        return '0x1234' as const
      },
    )
    const adapter = Adapter.define({ name: 'Test Wallet', rdns: 'com.example.test' }, () => ({
      actions: {
        async createAccount() {
          return { accounts: [{ address }] }
        },
        async loadAccounts() {
          return { accounts: [{ address }] }
        },
        signPersonalMessage,
      },
      getAccount: getAccount as never,
    }))
    const provider = Provider.create({ adapter, storage: Storage.memory() })
    provider.store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      provider.request({
        method: 'personal_sign',
        params: ['0x68656c6c6f', address],
      }),
    ).resolves.toMatchInlineSnapshot(`"0x1234"`)
    expect(getAccount.mock.calls).toMatchInlineSnapshot(`[]`)
    expect(signPersonalMessage.mock.calls.map(([parameters]) => parameters)).toMatchInlineSnapshot(`
      [
        {
          "address": "0x0000000000000000000000000000000000000001",
          "data": "0x68656c6c6f",
        },
      ]
    `)
  })
})
