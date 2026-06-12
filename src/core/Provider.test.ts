import { Challenge } from 'mppx'
import { afterEach, describe, expect, test, vi } from 'vp/test'

import * as Adapter from './Adapter.js'
import * as Provider from './Provider.js'
import * as Storage from './Storage.js'

const address = '0x0000000000000000000000000000000000000001'

const testAdapter = () =>
  Adapter.define({ name: 'Test Wallet', rdns: 'com.example.test' }, () => ({
    actions: {
      async createAccount() {
        return { accounts: [{ address }] }
      },
      async loadAccounts() {
        return { accounts: [{ address }] }
      },
    },
  }))

describe('wallet_connect', () => {
  test('behavior: validates auth before preparing access key material', async () => {
    const generateAccessKey = vi.fn(() => {
      throw new Error('generateAccessKey called')
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
      generateAccessKey,
    }))
    const provider = Provider.create({ adapter, storage: Storage.memory() })

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
    expect(generateAccessKey.mock.calls).toMatchInlineSnapshot(`[]`)
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
})

describe('mpp', () => {
  test('default: exposes payment-aware fetch and method clients', () => {
    const provider = Provider.create({
      adapter: testAdapter(),
      mpp: { polyfill: false },
      storage: Storage.memory(),
    })

    expect(typeof provider.mpp?.fetch).toMatch(/function/)
    expect(provider.mpp?.methods.map((m) => `${m.name}/${m.intent}`)).toMatchInlineSnapshot(`
      [
        "tempo/charge",
        "tempo/session",
        "tempo/subscription",
      ]
    `)
  })

  test('behavior: undefined when disabled', () => {
    const provider = Provider.create({
      adapter: testAdapter(),
      mpp: false,
      storage: Storage.memory(),
    })

    expect(provider.mpp).toBeUndefined()
  })
})

describe('wallet_authorizeChallenge', () => {
  function serializedChallenge(
    options: { amount?: string; chainId?: number; intent?: string; method?: string } = {},
  ) {
    const { amount = '1', chainId, intent = 'charge', method = 'tempo' } = options
    return Challenge.serialize(
      Challenge.from({
        id: 'test-challenge',
        intent,
        method,
        realm: 'api.example.com',
        request: {
          amount,
          currency: '0x20c0000000000000000000000000000000000001',
          ...(chainId !== undefined && { methodDetails: { chainId } }),
        },
      }),
    )
  }

  test('behavior: wallet-internal method clients do not re-enter wallet_authorizeChallenge', async () => {
    const provider = Provider.create({
      adapter: testAdapter(),
      mpp: { polyfill: false },
      storage: Storage.memory(),
    })
    provider.store.setState({ accounts: [{ address }], activeAccount: 0 })

    // The tempo method clients probe their wallet (`wallet_authorizeChallenge`)
    // before signing locally, routed back through this provider — a second
    // `wallet_authorizeChallenge` entering `request` means the handler
    // re-entered itself.
    let entries = 0
    const request = provider.request.bind(provider)
    provider.request = (async (args: { method: string }) => {
      if (args.method === 'wallet_authorizeChallenge' && ++entries > 1)
        throw new Error('nested wallet_authorizeChallenge detected')
      return request(args as never)
    }) as typeof provider.request

    // Zero-amount keeps the local fallback on the signing path, which the
    // bare test adapter rejects — only the absence of re-entrancy matters.
    const result = await provider
      .request({
        method: 'wallet_authorizeChallenge',
        params: [{ challenges: [serializedChallenge({ amount: '0' })] }],
      })
      .catch((error) => error)

    expect(entries).toBe(1)
    expect(String(result)).not.toContain('nested wallet_authorizeChallenge detected')
  })

  test('error: throws UnsupportedMethodError when mpp is disabled', async () => {
    const provider = Provider.create({
      adapter: testAdapter(),
      mpp: false,
      storage: Storage.memory(),
    })
    provider.store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      provider.request({
        method: 'wallet_authorizeChallenge',
        params: [{ challenges: [serializedChallenge()] }],
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Provider.UnsupportedMethodError: \`wallet_authorizeChallenge\` not supported. MPP is disabled.]`,
    )
  })

  test('error: throws DisconnectedError when no account is connected', async () => {
    const provider = Provider.create({
      adapter: testAdapter(),
      mpp: { polyfill: false },
      storage: Storage.memory(),
    })

    await expect(
      provider.request({
        method: 'wallet_authorizeChallenge',
        params: [{ challenges: [serializedChallenge()] }],
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Provider.DisconnectedError: No accounts connected.]`,
    )
  })

  test('error: throws InvalidParamsError when challenges is empty', async () => {
    const provider = Provider.create({
      adapter: testAdapter(),
      mpp: { polyfill: false },
      storage: Storage.memory(),
    })
    provider.store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      provider.request({ method: 'wallet_authorizeChallenge', params: [{ challenges: [] }] }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: Invalid params: params.0.challenges: Invalid input]`,
    )
  })

  test('error: throws InvalidParamsError when a challenge is malformed', async () => {
    const provider = Provider.create({
      adapter: testAdapter(),
      mpp: { polyfill: false },
      storage: Storage.memory(),
    })
    provider.store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      provider.request({
        method: 'wallet_authorizeChallenge',
        params: [{ challenges: ['not-a-challenge'] }],
      }),
    ).rejects.toThrow(/`challenges\[0\]` is not a valid MPP challenge/)
  })

  test('error: throws InvalidParamsError when a challenge targets an unsupported chain', async () => {
    const provider = Provider.create({
      adapter: testAdapter(),
      mpp: { polyfill: false },
      storage: Storage.memory(),
    })
    provider.store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      provider.request({
        method: 'wallet_authorizeChallenge',
        params: [{ challenges: [serializedChallenge({ chainId: 999 })] }],
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: \`challenges[0]\` targets unsupported chain 999.]`,
    )
  })

  test('error: throws InvalidParamsError when any challenge is unsupported', async () => {
    const provider = Provider.create({
      adapter: testAdapter(),
      mpp: { polyfill: false },
      storage: Storage.memory(),
    })
    provider.store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      provider.request({
        method: 'wallet_authorizeChallenge',
        params: [
          { challenges: [serializedChallenge(), serializedChallenge({ method: 'stripe' })] },
        ],
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: \`challenges[1]\` has unsupported method "stripe/charge". Supported: tempo/charge, tempo/session, tempo/subscription.]`,
    )
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
