import { describe, expectTypeOf, test } from 'vp/test'

import * as Adapter from '../Adapter.js'
import { privy } from './privy.js'

describe('privy', () => {
  test('accepts a structural Privy client with silent-restore surface', () => {
    expectTypeOf<privy.Client>().toEqualTypeOf<{
      auth: {
        logout: (parameters?: { userId: string } | undefined) => Promise<void> | void
      }
      embeddedWallet: {
        getEthereumProvider: (parameters: {
          wallet: privy.LinkedAccount
          entropyId: string
          entropyIdVerifier: string
        }) => Promise<privy.EthereumProvider>
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
        login: (email: string) => Promise<void>
      }
      embeddedWallet: {
        getEthereumProvider: (parameters: {
          wallet: privy.LinkedAccount
          entropyId: string
          entropyIdVerifier: string
        }) => Promise<privy.EthereumProvider>
        delegateWallets: () => Promise<void>
      }
      getAccessToken: () => Promise<string | null>
      initialize: () => Promise<void>
      user: {
        get: () => Promise<{ user: privy.User }>
        update: () => Promise<void>
      }
    }>().toMatchTypeOf<privy.Client>()
  })

  test('user shape exposes id and optional linked accounts', () => {
    expectTypeOf<privy.User>().toEqualTypeOf<{
      id: string
      linked_accounts?: readonly privy.LinkedAccount[] | undefined
    }>()
  })

  test('linked account shape mirrors the Privy SDK fields used during restore', () => {
    expectTypeOf<privy.LinkedAccount>().toMatchTypeOf<{
      address?: string | undefined
      chain_type?: string | undefined
      connector_type?: string | undefined
      type?: string | undefined
      wallet_client_type?: string | undefined
      wallet_index?: number | null | undefined
    }>()
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
        auth: { logout: async () => {} },
        embeddedWallet: {
          getEthereumProvider: async () => ({ request: async () => '0x0' }),
        },
        getAccessToken: async () => null,
        user: { get: async () => ({ user: { id: 'user_1' } }) },
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
      auth: { logout: async () => {} },
      embeddedWallet: {
        getEthereumProvider: async () => ({ request: async () => '0x0' }),
        delegateWallets: async () => 'delegated' as const,
      },
      getAccessToken: async () => null,
      user: {
        get: async () => ({ user: { id: 'user_1' } }),
        update: async () => 'updated' as const,
      },
    }
    privy({
      client,
      createAccount: async ({ client }) => {
        expectTypeOf(client.embeddedWallet.delegateWallets).toEqualTypeOf<
          () => Promise<'delegated'>
        >()
        expectTypeOf(client.user.update).toEqualTypeOf<() => Promise<'updated'>>()
        return { address: '0x0', provider: { request: async () => '0x0' } }
      },
      loadAccounts: async ({ client }) => {
        expectTypeOf(client.embeddedWallet.delegateWallets).toEqualTypeOf<
          () => Promise<'delegated'>
        >()
        expectTypeOf(client.user.update).toEqualTypeOf<() => Promise<'updated'>>()
        return []
      },
    })
  })
})
