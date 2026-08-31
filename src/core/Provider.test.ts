import { Hex } from 'ox'
import { custom } from 'viem'
import { createSiweMessage } from 'viem/siwe'
import { tempo, tempoModerato } from 'viem/tempo/chains'
import { afterEach, describe, expect, test, vi } from 'vp/test'

import { accounts, privateKeys } from '../../test/config.js'
import * as Adapter from './Adapter.js'
import * as Provider from './Provider.js'
import * as Storage from './Storage.js'

const address = '0x0000000000000000000000000000000000000001'

describe('eth_fillTransaction', () => {
  test('behavior: forwards Tempo-formatted request capabilities', async () => {
    const capabilities: unknown[] = []
    const request = tempo.formatters.transactionRequest.format(
      {
        capabilities: { balanceDiffs: false, errors: true },
        from: address,
        to: address,
        type: 'tempo',
      },
      'fillTransaction',
    )
    const provider = Provider.create({
      chains: [tempo],
      storage: Storage.memory(),
      transports: {
        [tempo.id]: custom(
          {
            async request(request) {
              if (request.method === 'eth_fillTransaction')
                capabilities.push(
                  (request.params?.[0] as { capabilities?: unknown } | undefined)?.capabilities,
                )
              throw new Error('capture complete')
            },
          },
          { retryCount: 0 },
        ),
      },
    })

    await expect(
      provider.request({
        method: 'eth_fillTransaction',
        params: [request as never],
      }),
    ).rejects.toThrow('capture complete')
    expect(capabilities).toMatchInlineSnapshot(`
      [
        {
          "balanceDiffs": false,
          "errors": true,
        },
      ]
    `)
  })
})

describe('getMppxParameters', () => {
  test('error: rejects unsupported chain IDs', () => {
    const provider = Provider.create({ storage: Storage.memory() })
    provider.store.setState({ accounts: [{ address }], activeAccount: 0 })

    expect(() =>
      provider.getMppxParameters().getClient({ chainId: 1 }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Provider.UnsupportedChainIdError: Chain 1 not configured.]`,
    )
  })

  test('behavior: returns account-scoped client without mutating cached client', () => {
    const provider = Provider.create({ storage: Storage.memory() })
    provider.store.setState({ accounts: [{ address }], activeAccount: 0 })

    const client = provider.getClient()
    const mppxClient = provider.getMppxParameters().getClient({})

    expect(mppxClient).not.toBe(client)
    expect((mppxClient as { account?: unknown }).account).toEqual({
      address,
      type: 'json-rpc',
    })
    expect((client as { account?: unknown }).account).toBeUndefined()
  })

  test('behavior: routes chain RPCs to the requested chain', async () => {
    const provider = Provider.create({
      chains: [tempo, tempoModerato],
      storage: Storage.memory(),
      transports: {
        [tempoModerato.id]: custom({ request: async () => '0xa5bf' }),
      },
    })
    provider.store.setState({ accounts: [{ address }], activeAccount: 0 })

    const client = await provider.getMppxParameters().getClient({ chainId: tempoModerato.id })
    expect(await client.request({ method: 'eth_chainId' })).toBe('0xa5bf')
  })

  test('behavior: resolves existing access key for connected account', async () => {
    const payer = accounts[0]!
    const provider = Provider.create({ storage: Storage.memory() })
    const chainId = provider.store.getState().chainId

    await provider.store.accessKeys.authorize({
      account: payer,
      chainId,
      parameters: { expiry: 9999999999, privateKey: privateKeys[2] },
    })
    const key = provider.store.getState().accessKeys[0]!
    provider.store.setState({ accounts: [{ address: payer.address }], activeAccount: 0 })

    const resolved = await provider.getMppxParameters().resolveAccount({
      account: { address: payer.address, type: 'json-rpc' },
      chainId,
      operation: { kind: 'authorizePaymentChannel' },
    })
    const resolvedKey = resolved as
      | { accessKeyAddress: string; address: string; source: string }
      | undefined

    expect(resolvedKey?.accessKeyAddress.toLowerCase()).toBe(key.address.toLowerCase())
    expect(resolvedKey?.address).toBe(payer.address)
    expect(resolvedKey?.source).toBe('accessKey')
  })

  test('behavior: resolves requested access key for connected account', async () => {
    const payer = accounts[0]!
    const provider = Provider.create({ storage: Storage.memory() })
    const chainId = provider.store.getState().chainId
    const token = '0x0000000000000000000000000000000000000abc' as const

    await provider.store.accessKeys.authorize({
      account: payer,
      chainId,
      parameters: {
        expiry: 9999999999,
        privateKey: privateKeys[1],
        scopes: [{ address: token, selector: 'transfer(address,uint256)' }],
      },
    })
    await provider.store.accessKeys.authorize({
      account: payer,
      chainId,
      parameters: { expiry: 9999999999, privateKey: privateKeys[2] },
    })
    const requested = provider.store.getState().accessKeys[1]!
    provider.store.setState({ accounts: [{ address: payer.address }], activeAccount: 0 })

    const resolved = await provider
      .getMppxParameters({ accessKey: requested.address })
      .resolveAccount({
        account: { address: payer.address, type: 'json-rpc' },
        chainId,
        operation: { kind: 'authorizePaymentChannel' },
      })
    const resolvedKey = resolved as
      | { accessKeyAddress: string; address: string; source: string }
      | undefined

    expect(resolvedKey?.accessKeyAddress.toLowerCase()).toBe(requested.address.toLowerCase())
    expect(resolvedKey?.address).toBe(payer.address)
    expect(resolvedKey?.source).toBe('accessKey')
  })

  test('behavior: resolves scoped access key for channel authority', async () => {
    const payer = accounts[0]!
    const provider = Provider.create({ storage: Storage.memory() })
    const chainId = provider.store.getState().chainId
    const token = '0x0000000000000000000000000000000000000abc' as const

    await provider.store.accessKeys.authorize({
      account: payer,
      chainId,
      parameters: {
        expiry: 9999999999,
        privateKey: privateKeys[1],
        scopes: [{ address: token, selector: 'transfer(address,uint256)' }],
      },
    })
    const key = provider.store.getState().accessKeys[0]!
    provider.store.setState({ accounts: [{ address: payer.address }], activeAccount: 0 })

    const resolved = await provider.getMppxParameters().resolveAccount({
      account: { address: payer.address, type: 'json-rpc' },
      chainId,
      operation: { kind: 'authorizePaymentChannel', authority: key.address },
    })
    const resolvedKey = resolved as
      | { accessKeyAddress: string; address: string; source: string }
      | undefined

    expect(resolvedKey?.accessKeyAddress.toLowerCase()).toBe(key.address.toLowerCase())
    expect(resolvedKey?.address).toBe(payer.address)
    expect(resolvedKey?.source).toBe('accessKey')
  })

  test('error: rejects requested access key that cannot sign for account', async () => {
    const payer = accounts[0]!
    const provider = Provider.create({ storage: Storage.memory() })
    const chainId = provider.store.getState().chainId
    provider.store.setState({ accounts: [{ address: payer.address }], activeAccount: 0 })

    await expect(
      provider.getMppxParameters({ accessKey: accounts[1]!.address }).resolveAccount({
        account: { address: payer.address, type: 'json-rpc' },
        chainId,
        operation: { kind: 'authorizePaymentChannel' },
      }),
    ).rejects.toThrowError(`Access key "${accounts[1]!.address}" cannot sign`)
  })

  test('error: rejects requested access key that cannot satisfy channel authority', async () => {
    const payer = accounts[0]!
    const provider = Provider.create({ storage: Storage.memory() })
    const chainId = provider.store.getState().chainId

    await provider.store.accessKeys.authorize({
      account: payer,
      chainId,
      parameters: { expiry: 9999999999, privateKey: privateKeys[1] },
    })
    const key = provider.store.getState().accessKeys[0]!
    provider.store.setState({ accounts: [{ address: payer.address }], activeAccount: 0 })

    for (const authority of [
      accounts[2]!.address,
      payer.address,
      '0x0000000000000000000000000000000000000000',
    ] as const)
      await expect(
        provider.getMppxParameters({ accessKey: key.address }).resolveAccount({
          account: { address: payer.address, type: 'json-rpc' },
          chainId,
          operation: { kind: 'authorizePaymentChannel', authority },
        }),
      ).rejects.toThrowError(
        `Access key "${key.address}" cannot satisfy channel authority "${authority}".`,
      )
  })

  test('error: rejects requested access key when transaction calls do not match scopes', async () => {
    const payer = accounts[0]!
    const provider = Provider.create({ storage: Storage.memory() })
    const chainId = provider.store.getState().chainId
    const token = '0x0000000000000000000000000000000000000abc' as const

    await provider.store.accessKeys.authorize({
      account: payer,
      chainId,
      parameters: {
        expiry: 9999999999,
        privateKey: privateKeys[2],
        scopes: [{ address: token, selector: 'transfer(address,uint256)' }],
      },
    })
    const key = provider.store.getState().accessKeys[0]!
    provider.store.setState({ accounts: [{ address: payer.address }], activeAccount: 0 })

    await expect(
      provider.getMppxParameters({ accessKey: key.address }).resolveAccount({
        account: { address: payer.address, type: 'json-rpc' },
        chainId,
        operation: { kind: 'executeCalls' },
      }),
    ).rejects.toThrowError(
      `Access key "${key.address}" cannot be selected for executeCalls without transaction call details.`,
    )

    await expect(
      provider.getMppxParameters({ accessKey: key.address }).resolveAccount({
        account: { address: payer.address, type: 'json-rpc' },
        chainId,
        operation: {
          kind: 'executeCalls',
          calls: [{ to: '0x0000000000000000000000000000000000000def', data: '0xdeadbeef' }],
        },
      }),
    ).rejects.toThrowError(`Access key "${key.address}" cannot sign`)
  })

  test('error: does not resolve access keys for disconnected accounts', async () => {
    const payer = accounts[0]!
    const active = accounts[1]!
    const provider = Provider.create({ storage: Storage.memory() })

    await provider.store.accessKeys.authorize({
      account: payer,
      chainId: provider.store.getState().chainId,
      parameters: { expiry: 123, privateKey: privateKeys[2] },
    })
    provider.store.setState({ accounts: [{ address: active.address }], activeAccount: 0 })

    await expect(
      provider.getMppxParameters().resolveAccount({
        account: { address: payer.address, type: 'json-rpc' },
        chainId: provider.store.getState().chainId,
        operation: { kind: 'authorizePaymentChannel' },
      }),
    ).rejects.toThrowError(`Account "${payer.address}" not found.`)
  })
})

describe('wallet_connect', () => {
  test('behavior: forwards allowed credential IDs to the adapter', async () => {
    const loadAccounts = vi.fn(async (_parameters?: Adapter.loadAccounts.Parameters) => ({
      accounts: [{ address }] as const,
    }))
    const adapter = Adapter.define({ name: 'Test Wallet', rdns: 'com.example.test' }, () => ({
      actions: {
        async createAccount() {
          return { accounts: [{ address }] }
        },
        loadAccounts,
      },
    }))
    const provider = Provider.create({ adapter, storage: Storage.memory() })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { credentialId: ['cred-1', 'cred-2'] } }],
    })

    expect(loadAccounts.mock.calls[0]?.[0]).toMatchInlineSnapshot(`
      {
        "authorizeAccessKey": undefined,
        "credentialId": [
          "cred-1",
          "cred-2",
        ],
        "digest": undefined,
        "selectAccount": undefined,
      }
    `)
  })

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

    test('includes credentials when minting identity tokens', async () => {
      let request: RequestInit | undefined
      vi.stubGlobal('fetch', async (_input: string | URL, init?: RequestInit) => {
        request = init
        return Response.json({
          idToken: 'eyJhbGciOiJub25lIn0.eyJlbWFpbCI6ImFsaWNlQGV4YW1wbGUuY29tIn0.sig',
        })
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
        adapter,
        identity: {
          audience: 'https://console.example.com',
          issuer: 'https://wallet.example.com/oidc',
        },
        storage: Storage.memory(),
      })

      await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { identity: { email: true } } }],
      })

      expect(request?.credentials).toMatchInlineSnapshot(`"include"`)
    })

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
