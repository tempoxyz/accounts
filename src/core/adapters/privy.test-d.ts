import { describe, expectTypeOf, test } from 'vp/test'

import * as Adapter from '../Adapter.js'
import { privy } from './privy.js'

describe('privy', () => {
  test('accepts a structural Privy client', () => {
    expectTypeOf<privy.Client>().toEqualTypeOf<{
      auth: {
        logout: () => Promise<void> | void
      }
      getAccessToken: () => Promise<string | null>
      initialize?: (() => Promise<void> | void) | undefined
    }>()
  })

  test('accepts a wider client with extra fields', () => {
    expectTypeOf<{
      auth: {
        logout: () => Promise<void>
        login: (email: string) => Promise<void>
      }
      embeddedWallet: { getProvider: () => Promise<unknown> }
      getAccessToken: () => Promise<string | null>
      initialize: () => Promise<void>
      user: { get: () => Promise<{ id: string }> }
    }>().toMatchTypeOf<privy.Client>()
  })

  test('embedded wallet shape requires address and signRawHash', () => {
    expectTypeOf<privy.EmbeddedWallet>().toEqualTypeOf<{
      address: string
      signRawHash: (hash: `0x${string}`) => Promise<`0x${string}`>
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
        getAccessToken: async () => null,
      },
      createAccount: async ({ client, parameters }) => {
        expectTypeOf(client).toEqualTypeOf<privy.Client>()
        expectTypeOf(parameters).toEqualTypeOf<Adapter.createAccount.Parameters>()
        return { address: '0x0', signRawHash: async () => '0x0' }
      },
      loadAccounts: async ({ client, parameters }) => {
        expectTypeOf(client).toEqualTypeOf<privy.Client>()
        expectTypeOf(parameters).toEqualTypeOf<Adapter.loadAccounts.Parameters | undefined>()
        return []
      },
    })
  })
})
