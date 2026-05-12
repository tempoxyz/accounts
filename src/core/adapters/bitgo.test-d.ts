import { describe, expectTypeOf, test } from 'vp/test'

import * as Adapter from '../Adapter.js'
import { bitgo, createBitGoClient } from './bitgo.js'

describe('bitgo', () => {
  test('accepts a structural BitGo client', () => {
    expectTypeOf<bitgo.Client>().toEqualTypeOf<{
      isAuthenticated: () => Promise<boolean>
      initialize?: (() => Promise<void> | void) | undefined
      logout?: (() => Promise<void> | void) | undefined
    }>()
  })

  test('accepts a wider client with extra fields', () => {
    expectTypeOf<{
      isAuthenticated: () => Promise<boolean>
      initialize: () => Promise<void>
      logout: () => Promise<void>
      accessToken: string
      coin: string
      walletId: string
    }>().toMatchTypeOf<bitgo.Client>()
  })

  test('wallet account shape requires address and signRawHash', () => {
    expectTypeOf<bitgo.WalletAccount>().toEqualTypeOf<{
      address: string
      signRawHash: (hash: `0x${string}`) => Promise<`0x${string}`>
    }>()
  })

  test('options require client, createAccount, loadAccounts', () => {
    expectTypeOf<bitgo.Options>().toMatchTypeOf<{
      client: bitgo.Client
      createAccount: (parameters: {
        client: bitgo.Client
        parameters: Adapter.createAccount.Parameters
      }) => Promise<bitgo.WalletAccount>
      loadAccounts: (parameters: {
        client: bitgo.Client
        parameters?: Adapter.loadAccounts.Parameters | undefined
      }) => Promise<readonly bitgo.WalletAccount[]>
    }>()
  })

  test('bitgo() returns an Adapter', () => {
    expectTypeOf(bitgo).returns.toEqualTypeOf<Adapter.Adapter>()
  })

  test('callbacks receive a BitGo client and adapter parameters', () => {
    bitgo({
      client: {
        isAuthenticated: async () => true,
      },
      createAccount: async ({ client, parameters }) => {
        expectTypeOf(client).toEqualTypeOf<bitgo.Client>()
        expectTypeOf(parameters).toEqualTypeOf<Adapter.createAccount.Parameters>()
        return { address: '0x0', signRawHash: async () => '0x0' }
      },
      loadAccounts: async ({ client, parameters }) => {
        expectTypeOf(client).toEqualTypeOf<bitgo.Client>()
        expectTypeOf(parameters).toEqualTypeOf<Adapter.loadAccounts.Parameters | undefined>()
        return []
      },
    })
  })

  test('createBitGoClient returns a client with getAddresses', () => {
    const client = createBitGoClient({
      accessToken: 'v2x...',
      coin: 'hteth',
      walletId: '123',
      walletPassphrase: 'pass',
      env: 'test',
    })
    expectTypeOf(client.isAuthenticated).toEqualTypeOf<() => Promise<boolean>>()
    expectTypeOf(client.getAddresses).toEqualTypeOf<
      () => Promise<readonly bitgo.WalletAccount[]>
    >()
    expectTypeOf(client).toMatchTypeOf<bitgo.Client>()
  })
})
