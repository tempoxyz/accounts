import { afterEach, describe, expect, test, vi } from 'vp/test'

import * as Adapter from './Adapter.js'
import * as Provider from './Provider.js'
import * as Storage from './Storage.js'

const address = '0x0000000000000000000000000000000000000001'

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
