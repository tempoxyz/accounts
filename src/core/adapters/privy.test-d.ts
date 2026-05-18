import { describe, expectTypeOf, test } from 'vp/test'

import * as Adapter from '../Adapter.js'
import { privy } from './privy.js'

describe('privy', () => {
  test('accepts a structural Privy client matching `@privy-io/js-sdk-core`', () => {
    expectTypeOf<privy.Client>().toEqualTypeOf<{
      auth: {
        logout: (parameters?: { userId: string } | undefined) => Promise<void> | void
      }
      embeddedWallet: {
        getEthereumProvider: (parameters: {
          wallet: privy.LinkedAccount
          entropyId: string
          entropyIdVerifier: string
        }) => Promise<privy.EthereumProvider> | privy.EthereumProvider
      }
      getAccessToken: () => Promise<string | null>
      initialize?: (() => Promise<void> | void) | undefined
      user: {
        get: () => Promise<{ user: privy.User }>
      }
    }>()
  })

  test('accepts a wider client with extra fields', () => {
    expectTypeOf<{
      auth: {
        logout: () => Promise<void>
        login: () => Promise<void>
      }
      embeddedWallet: {
        getEthereumProvider: (parameters: {
          wallet: privy.LinkedAccount
          entropyId: string
          entropyIdVerifier: string
        }) => Promise<privy.EthereumProvider>
      }
      getAccessToken: () => Promise<string | null>
      initialize: () => Promise<void>
      user: {
        get: () => Promise<{ user: privy.User }>
      }
      // Extra app-specific fields are fine.
      privyVersion: string
    }>().toMatchTypeOf<privy.Client>()
  })

  test('ethereum provider shape exposes EIP-1193 request', () => {
    expectTypeOf<privy.EthereumProvider>().toMatchTypeOf<{
      request(parameters: {
        method: string
        params?: readonly unknown[] | undefined
      }): Promise<unknown>
    }>()
  })

  test('embedded wallet shape requires address and EIP-1193 provider', () => {
    expectTypeOf<privy.EmbeddedWallet>().toEqualTypeOf<{
      address: string
      provider: privy.EthereumProvider
    }>()
  })

  test('options require client and loadAccounts; createAccount is optional', () => {
    expectTypeOf<privy.Options>().toMatchTypeOf<{
      client: privy.Client
      createAccount?:
        | ((parameters: {
            client: privy.Client
            parameters: Adapter.createAccount.Parameters
          }) => Promise<privy.AccountSelection>)
        | undefined
      loadAccounts: (parameters: {
        client: privy.Client
        parameters?: Adapter.loadAccounts.Parameters | undefined
      }) => Promise<privy.AccountSelection>
    }>()
  })

  test('privy() returns an Adapter', () => {
    expectTypeOf(privy).returns.toEqualTypeOf<Adapter.Adapter>()
  })

  test('callbacks receive a Privy client and adapter parameters', () => {
    privy({
      client: {
        auth: { logout: async () => {} },
        embeddedWallet: {
          getEthereumProvider: async () => ({ request: async () => '0x0' }),
        },
        getAccessToken: async () => null,
        user: { get: async () => ({ user: { id: 'u' } }) },
      },
      createAccount: async ({ client, parameters }) => {
        expectTypeOf(client).toMatchTypeOf<privy.Client>()
        expectTypeOf(parameters).toEqualTypeOf<Adapter.createAccount.Parameters>()
      },
      loadAccounts: async ({ client, parameters }) => {
        expectTypeOf(client).toMatchTypeOf<privy.Client>()
        expectTypeOf(parameters).toEqualTypeOf<Adapter.loadAccounts.Parameters | undefined>()
      },
    })
  })

  test('callbacks preserve the concrete client type', () => {
    const client = {
      auth: { logout: async () => {} },
      embeddedWallet: {
        getEthereumProvider: async () => ({ request: async () => '0x0' }),
      },
      getAccessToken: async () => null,
      user: { get: async () => ({ user: { id: 'u' } }) },
      // App-specific extras must remain visible to callbacks.
      raw: { delegateWallets: async () => 'delegated' as const },
    }
    privy({
      client,
      createAccount: async ({ client }) => {
        expectTypeOf(client.raw.delegateWallets).toEqualTypeOf<() => Promise<'delegated'>>()
      },
      loadAccounts: async ({ client }) => {
        expectTypeOf(client.raw.delegateWallets).toEqualTypeOf<() => Promise<'delegated'>>()
      },
    })
  })
})
