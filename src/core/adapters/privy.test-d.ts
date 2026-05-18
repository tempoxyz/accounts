import { describe, expectTypeOf, test } from 'vp/test'

import * as Adapter from '../Adapter.js'
import { privy } from './privy.js'

describe('privy', () => {
  test('accepts a structural Privy client matching `@privy-io/js-sdk-core`', () => {
    expectTypeOf<privy.Client>().toEqualTypeOf<{
      auth: {
        logout: (parameters?: { userId: string } | undefined) => Promise<void> | void
      }
      getAccessToken: () => Promise<string | null>
      initialize?: (() => Promise<void> | void) | undefined
      user: {
        get: () => Promise<{ user: { id: string } }>
      }
    }>()
  })

  test('accepts a wider client with extra fields', () => {
    expectTypeOf<{
      auth: {
        logout: () => Promise<void>
        login: () => Promise<void>
      }
      getAccessToken: () => Promise<string | null>
      initialize: () => Promise<void>
      user: {
        get: () => Promise<{ user: { id: string } }>
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

  test('options require client and loadAccounts; createAccount/restoreAccounts are optional', () => {
    expectTypeOf<privy.Options>().toMatchTypeOf<{
      client: privy.Client
      createAccount?:
        | ((parameters: {
            client: privy.Client
            parameters: Adapter.createAccount.Parameters
          }) => Promise<privy.EmbeddedWallet>)
        | undefined
      loadAccounts: (parameters: {
        client: privy.Client
        parameters?: Adapter.loadAccounts.Parameters | undefined
      }) => Promise<readonly privy.EmbeddedWallet[]>
      restoreAccounts?:
        | ((parameters: { client: privy.Client }) => Promise<readonly privy.EmbeddedWallet[]>)
        | undefined
    }>()
  })

  test('privy() returns an Adapter', () => {
    expectTypeOf(privy).returns.toEqualTypeOf<Adapter.Adapter>()
  })

  test('callbacks receive a Privy client and adapter parameters', () => {
    privy({
      client: {
        auth: { logout: async () => {} },
        getAccessToken: async () => null,
        user: { get: async () => ({ user: { id: 'u' } }) },
      },
      createAccount: async ({ client, parameters }) => {
        expectTypeOf(client).toMatchTypeOf<privy.Client>()
        expectTypeOf(parameters).toEqualTypeOf<Adapter.createAccount.Parameters>()
        return { address: '0x0', provider: { request: async () => '0x0' } }
      },
      loadAccounts: async ({ client, parameters }) => {
        expectTypeOf(client).toMatchTypeOf<privy.Client>()
        expectTypeOf(parameters).toEqualTypeOf<Adapter.loadAccounts.Parameters | undefined>()
        return []
      },
      restoreAccounts: async ({ client }) => {
        expectTypeOf(client).toMatchTypeOf<privy.Client>()
        return []
      },
    })
  })

  test('callbacks preserve the concrete client type', () => {
    const client = {
      auth: { logout: async () => {} },
      getAccessToken: async () => null,
      user: { get: async () => ({ user: { id: 'u' } }) },
      // App-specific extras must remain visible to callbacks.
      raw: { delegateWallets: async () => 'delegated' as const },
    }
    privy({
      client,
      createAccount: async ({ client }) => {
        expectTypeOf(client.raw.delegateWallets).toEqualTypeOf<() => Promise<'delegated'>>()
        return { address: '0x0', provider: { request: async () => '0x0' } }
      },
      loadAccounts: async ({ client }) => {
        expectTypeOf(client.raw.delegateWallets).toEqualTypeOf<() => Promise<'delegated'>>()
        return []
      },
      restoreAccounts: async ({ client }) => {
        expectTypeOf(client.raw.delegateWallets).toEqualTypeOf<() => Promise<'delegated'>>()
        return []
      },
    })
  })
})
