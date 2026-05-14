import { describe, expectTypeOf, test } from 'vp/test'

import * as Adapter from '../Adapter.js'
import { privy } from './privy.js'

describe('privy', () => {
  test('accepts a structural Privy client with silent-restore surface', () => {
    expectTypeOf<privy.Client>().toEqualTypeOf<{
      getAccessToken: () => Promise<string | null>
      getCurrentUserId: () => Promise<string | null>
      loadEthereumWallets: () => Promise<readonly privy.EmbeddedWallet[]>
      logout: (parameters?: { userId: string } | undefined) => Promise<void> | void
      initialize?: (() => Promise<void> | void) | undefined
    }>()
  })

  test('accepts a wider client with extra fields', () => {
    expectTypeOf<{
      getAccessToken: () => Promise<string | null>
      getCurrentUserId: () => Promise<string | null>
      loadEthereumWallets: () => Promise<readonly privy.EmbeddedWallet[]>
      logout: (parameters?: { userId: string } | undefined) => Promise<void>
      initialize: () => Promise<void>
      // Extra app-specific fields are fine.
      privyVersion: string
      raw: { auth: { login: () => Promise<void> } }
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

  test('options require client, createAccount, loadAccounts', () => {
    expectTypeOf<privy.Options>().toMatchTypeOf<{
      client: privy.Client
      createAccount: (parameters: {
        client: privy.Client
        parameters: Adapter.createAccount.Parameters
      }) => Promise<privy.EmbeddedWallet>
      loadAccounts: (parameters: {
        client: privy.Client
        parameters?: Adapter.loadAccounts.Parameters | undefined
      }) => Promise<readonly privy.EmbeddedWallet[]>
    }>()
  })

  test('privy() returns an Adapter', () => {
    expectTypeOf(privy).returns.toEqualTypeOf<Adapter.Adapter>()
  })

  test('callbacks receive a Privy client and adapter parameters', () => {
    privy({
      client: {
        getAccessToken: async () => null,
        getCurrentUserId: async () => null,
        loadEthereumWallets: async () => [],
        logout: async () => {},
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
    })
  })

  test('callbacks preserve the concrete client type', () => {
    const client = {
      getAccessToken: async () => null,
      getCurrentUserId: async () => null,
      loadEthereumWallets: async () => [],
      logout: async () => {},
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
    })
  })
})
