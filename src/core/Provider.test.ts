import { Challenge } from 'mppx'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { Account as TempoAccount, Actions } from 'viem/tempo'
import { tempo } from 'viem/tempo/chains'
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
  const currency = '0x20c0000000000000000000000000000000000001'
  // viem anvil test key #1; its access key address is deterministic.
  const accessKeyPrivateKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'

  function serializedChallenge(
    options: {
      amount?: string
      chainId?: number
      intent?: string
      method?: string
      recipient?: string
    } = {},
  ) {
    const { amount = '1', chainId, intent = 'charge', method = 'tempo', recipient } = options
    return Challenge.serialize(
      Challenge.from({
        id: 'test-challenge',
        intent,
        method,
        realm: 'api.example.com',
        request: {
          amount,
          currency,
          ...(recipient !== undefined && { recipient }),
          ...(chainId !== undefined && { methodDetails: { chainId } }),
        },
      }),
    )
  }

  /** Provisions a locally-signable secp256k1 access key for the active account. */
  function provisionAccessKey(
    provider: ReturnType<typeof Provider.create>,
    options: {
      account?: `0x${string}` | undefined
      chainId?: number | undefined
      expiry?: number | undefined
      scopes?: KeyAuthorization.Scope[] | undefined
    } = {},
  ) {
    const account = options.account ?? address
    const chainId = options.chainId ?? tempo.id
    const accessKey = TempoAccount.fromSecp256k1(accessKeyPrivateKey)
    const authorization = KeyAuthorization.from(
      {
        address: accessKey.address,
        chainId: BigInt(chainId),
        expiry: options.expiry ?? Math.floor(Date.now() / 1000) + 3600,
        scopes: options.scopes,
        type: 'secp256k1',
      },
      { signature: SignatureEnvelope.from(`0x${'00'.repeat(65)}`) },
    )
    provider.store.accessKeys.add({
      account,
      authorization,
      privateKey: accessKeyPrivateKey,
    })
    return accessKey.address
  }

  /**
   * Captures the arguments passed to a method's `createCredential` and answers
   * with a sentinel, so tests can assert which signer the handler injects
   * without driving the full credential pipeline.
   */
  function spyCreateCredential(provider: ReturnType<typeof Provider.create>, intent: string) {
    const method = provider.mpp!.methods.find((m) => m.intent === intent)!
    return vi
      .spyOn(method as { createCredential: (args: unknown) => unknown }, 'createCredential')
      .mockResolvedValue('credential-stub' as never)
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

  test('behavior: charge signs with a scoped access key when one is selectable', async () => {
    const provider = Provider.create({
      adapter: testAdapter(),
      mpp: { polyfill: false },
      storage: Storage.memory(),
    })
    provider.store.setState({ accounts: [{ address }], activeAccount: 0 })
    const recipient = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
    // Charge credentials use `transferWithMemo` (0x95777d59).
    const accessKeyAddress = provisionAccessKey(provider, {
      scopes: [{ address: currency, selector: '0x95777d59', recipients: [recipient] }],
    })
    const createCredential = spyCreateCredential(provider, 'charge')

    await provider.request({
      method: 'wallet_authorizeChallenge',
      params: [{ challenges: [serializedChallenge({ recipient })] }],
    })

    // The handler passes the scoped key through `context.account`.
    const args = createCredential.mock.calls[0]![0] as {
      context?: { account?: TempoAccount.AccessKeyAccount }
    }
    expect(args.context?.account?.type).toBe('local')
    expect(args.context?.account?.address.toLowerCase()).toBe(address.toLowerCase())
    expect(args.context?.account?.accessKeyAddress?.toLowerCase()).toBe(
      accessKeyAddress.toLowerCase(),
    )
  })

  test('behavior: charge derives a transferWithMemo call matching the viem/tempo encoder', () => {
    const recipient = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
    // Assert against the encoder output, not only the literal selector.
    const expected = Actions.token.transfer.call({
      amount: 1n,
      memo: '0x',
      to: recipient,
      token: currency,
    })
    expect(expected.data.slice(0, 10)).toBe('0x95777d59')

    const provider = Provider.create({
      adapter: testAdapter(),
      mpp: { polyfill: false },
      storage: Storage.memory(),
    })
    provider.store.setState({ accounts: [{ address }], activeAccount: 0 })
    // The derived call must use the same selector the encoder produces.
    const accessKeyAddress = provisionAccessKey(provider, {
      scopes: [
        { address: currency, selector: expected.data.slice(0, 10), recipients: [recipient] },
      ],
    })
    const createCredential = spyCreateCredential(provider, 'charge')

    return provider
      .request({
        method: 'wallet_authorizeChallenge',
        params: [{ challenges: [serializedChallenge({ recipient })] }],
      })
      .then(() => {
        const args = createCredential.mock.calls[0]![0] as {
          context?: { account?: TempoAccount.AccessKeyAccount }
        }
        expect(args.context?.account?.accessKeyAddress?.toLowerCase()).toBe(
          accessKeyAddress.toLowerCase(),
        )
      })
  })

  test('behavior: charge does not select a key scoped to plain transfer (0xa9059cbb)', async () => {
    const provider = Provider.create({
      adapter: testAdapter(),
      mpp: { polyfill: false },
      storage: Storage.memory(),
    })
    provider.store.setState({ accounts: [{ address }], activeAccount: 0 })
    const recipient = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
    // Plain `transfer` scopes must not match charge credentials.
    provisionAccessKey(provider, {
      scopes: [{ address: currency, selector: '0xa9059cbb', recipients: [recipient] }],
    })
    const createCredential = spyCreateCredential(provider, 'charge')

    await provider.request({
      method: 'wallet_authorizeChallenge',
      params: [{ challenges: [serializedChallenge({ recipient })] }],
    })

    expect((createCredential.mock.calls[0]![0] as { context?: unknown }).context).toBeUndefined()
  })

  test('behavior: charge falls back to root when no access key is selectable', async () => {
    const provider = Provider.create({
      adapter: testAdapter(),
      mpp: { polyfill: false },
      storage: Storage.memory(),
    })
    provider.store.setState({ accounts: [{ address }], activeAccount: 0 })
    const createCredential = spyCreateCredential(provider, 'charge')

    await provider.request({
      method: 'wallet_authorizeChallenge',
      params: [{ challenges: [serializedChallenge()] }],
    })

    // No selected access key means no `context`.
    expect(createCredential.mock.calls[0]![0]).toMatchInlineSnapshot(`
      {
        "challenge": {
          "id": "test-challenge",
          "intent": "charge",
          "method": "tempo",
          "realm": "api.example.com",
          "request": {
            "amount": "1",
            "currency": "0x20c0000000000000000000000000000000000001",
          },
        },
      }
    `)
  })

  test('behavior: charge does not select a scoped key whose recipients do not match', async () => {
    const provider = Provider.create({
      adapter: testAdapter(),
      mpp: { polyfill: false },
      storage: Storage.memory(),
    })
    provider.store.setState({ accounts: [{ address }], activeAccount: 0 })
    provisionAccessKey(provider, {
      scopes: [
        {
          address: currency,
          selector: '0x95777d59',
          recipients: ['0x000000000000000000000000000000000000dEaD'],
        },
      ],
    })
    const createCredential = spyCreateCredential(provider, 'charge')

    await provider.request({
      method: 'wallet_authorizeChallenge',
      params: [
        {
          challenges: [
            serializedChallenge({ recipient: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' }),
          ],
        },
      ],
    })

    // Scope mismatch means no `context`.
    expect((createCredential.mock.calls[0]![0] as { context?: unknown }).context).toBeUndefined()
  })

  test('behavior: charge signs with an unscoped access key (limits only)', async () => {
    const provider = Provider.create({
      adapter: testAdapter(),
      mpp: { polyfill: false },
      storage: Storage.memory(),
    })
    provider.store.setState({ accounts: [{ address }], activeAccount: 0 })
    const recipient = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
    // No call scopes: an unscoped key matches any charge, so it is selected.
    const accessKeyAddress = provisionAccessKey(provider)
    const createCredential = spyCreateCredential(provider, 'charge')

    await provider.request({
      method: 'wallet_authorizeChallenge',
      params: [{ challenges: [serializedChallenge({ recipient })] }],
    })

    const args = createCredential.mock.calls[0]![0] as {
      context?: { account?: TempoAccount.AccessKeyAccount }
    }
    expect(args.context?.account?.accessKeyAddress?.toLowerCase()).toBe(
      accessKeyAddress.toLowerCase(),
    )
  })

  test('behavior: charge falls back to root when the scoped key is expired', async () => {
    const provider = Provider.create({
      adapter: testAdapter(),
      mpp: { polyfill: false },
      storage: Storage.memory(),
    })
    provider.store.setState({ accounts: [{ address }], activeAccount: 0 })
    const recipient = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
    // Correctly scoped but past expiry: selection skips it -> root signs.
    provisionAccessKey(provider, {
      scopes: [{ address: currency, selector: '0x95777d59', recipients: [recipient] }],
      expiry: Math.floor(Date.now() / 1000) - 60,
    })
    const createCredential = spyCreateCredential(provider, 'charge')

    await provider.request({
      method: 'wallet_authorizeChallenge',
      params: [{ challenges: [serializedChallenge({ recipient })] }],
    })

    expect((createCredential.mock.calls[0]![0] as { context?: unknown }).context).toBeUndefined()
  })

  test('behavior: no access key path is identical with mpp enabled and no keys', async () => {
    const provider = Provider.create({
      adapter: testAdapter(),
      mpp: { polyfill: false },
      storage: Storage.memory(),
    })
    provider.store.setState({ accounts: [{ address }], activeAccount: 0 })
    const createCredential = spyCreateCredential(provider, 'charge')

    await provider.request({
      method: 'wallet_authorizeChallenge',
      params: [{ challenges: [serializedChallenge({ intent: 'charge' })] }],
    })

    expect((createCredential.mock.calls[0]![0] as { context?: unknown }).context).toBeUndefined()
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
