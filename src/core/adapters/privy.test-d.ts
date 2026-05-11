import { describe, expectTypeOf, test } from 'vp/test'

import { privy } from './privy.js'

describe('privy', () => {
  test('accepts a structural Core client', () => {
    expectTypeOf<privy.Client>().toMatchTypeOf<{
      auth?:
        | {
            logout: (
              parameters?: { userId?: string | undefined } | undefined,
            ) => Promise<void> | void
          }
        | undefined
      getAccessToken?: (() => Promise<string | null | undefined>) | undefined
      getAuthenticatedUser?: (() => Promise<{ id: string } | null | undefined>) | undefined
      initialize?: (() => Promise<void> | void) | undefined
      logout?: (() => Promise<void> | void) | undefined
      user?: { get: () => Promise<{ user?: { id: string } | null | undefined }> } | undefined
    }>()
  })

  test('accepts a structural EIP-1193 provider', () => {
    expectTypeOf<privy.EthereumProvider>().toMatchTypeOf<{
      request: (parameters: { method: string; params?: unknown[] | undefined }) => Promise<unknown>
    }>()
    expectTypeOf<{
      request: (parameters: { method: string; params?: unknown[] | undefined }) => Promise<unknown>
      on: (event: string, listener: (...args: unknown[]) => void) => unknown
      removeListener: (event: string | symbol, listener: (...args: unknown[]) => void) => unknown
    }>().toMatchTypeOf<privy.EthereumProvider>()
  })

  test('accepts structural Privy embedded wallet restore APIs', () => {
    expectTypeOf<{
      embeddedWallet?: {
        getProvider?: (wallet: privy.EmbeddedWallet) => Promise<privy.EthereumProvider>
      }
      getAuthenticatedUser?:
        | (() => Promise<{
            id: string
            linkedAccounts?: readonly privy.LinkedAccount[] | undefined
          } | null>)
        | undefined
      user?: {
        get: () => Promise<{
          user?: { id: string; linked_accounts?: readonly privy.LinkedAccount[] | undefined }
        }>
      }
    }>().toMatchTypeOf<privy.Client>()
  })

  test('restoreAccounts preserves the concrete client type', () => {
    const client = {
      custom: {
        getWallets: async () => [] as privy.WalletAccount[],
      },
      initialize() {},
      user: {
        async get() {
          return { user: { id: 'user_1' } }
        },
      },
    }
    privy({
      client,
      createAccount: async () => {
        return { address: '0x0', provider: { request: async () => '0x0' } }
      },
      loadAccounts: async () => [],
      restoreAccounts: async ({ client, user }) => {
        expectTypeOf(client.custom.getWallets).toEqualTypeOf<() => Promise<privy.WalletAccount[]>>()
        expectTypeOf(user.id).toEqualTypeOf<string>()
        return []
      },
    })
  })

  test('callback accounts only require address and provider', () => {
    expectTypeOf<privy.WalletAccount>().toMatchTypeOf<{
      address: string
      provider: privy.EthereumProvider
    }>()
  })

  test('callbacks preserve the concrete client type', () => {
    const client = {
      custom: {
        getWallets: async () => [] as privy.WalletAccount[],
      },
      initialize() {},
    }
    privy({
      client,
      createAccount: async ({ client }) => {
        expectTypeOf(client.custom.getWallets).toEqualTypeOf<() => Promise<privy.WalletAccount[]>>()
        return { address: '0x0', provider: { request: async () => '0x0' } }
      },
      loadAccounts: async ({ client }) => {
        expectTypeOf(client.custom.getWallets).toEqualTypeOf<() => Promise<privy.WalletAccount[]>>()
        return []
      },
    })
  })
})
