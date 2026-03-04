import type { RpcSchema } from 'ox'
import { describe, expectTypeOf, test } from 'vitest'

import type * as Schema from './Schema.js'
import type * as Rpc from './zod/rpc.js'

describe('DefineItem', () => {
  test('eth_accounts', () => {
    expectTypeOf<Rpc.eth_accounts>().toEqualTypeOf<{
      method: 'eth_accounts'
      params: undefined
      returns: readonly `0x${string}`[]
    }>()
  })

  test('eth_chainId', () => {
    expectTypeOf<Rpc.eth_chainId>().toEqualTypeOf<{
      method: 'eth_chainId'
      params: undefined
      returns: `0x${string}`
    }>()
  })

  test('eth_requestAccounts', () => {
    expectTypeOf<Rpc.eth_requestAccounts>().toEqualTypeOf<{
      method: 'eth_requestAccounts'
      params: undefined
      returns: readonly `0x${string}`[]
    }>()
  })

  test('wallet_connect', () => {
    expectTypeOf<Rpc.wallet_connect>().toEqualTypeOf<{
      method: 'wallet_connect'
      params:
        | readonly [
            {
              capabilities?: { method?: 'register' | 'login' | undefined } | undefined
            },
          ]
        | undefined
      returns: readonly `0x${string}`[]
    }>()
  })

  test('wallet_disconnect', () => {
    expectTypeOf<Rpc.wallet_disconnect>().toEqualTypeOf<{
      method: 'wallet_disconnect'
      params: undefined
      returns: undefined
    }>()
  })

  test('wallet_switchEthereumChain', () => {
    expectTypeOf<Rpc.wallet_switchEthereumChain>().toEqualTypeOf<{
      method: 'wallet_switchEthereumChain'
      params: readonly [{ chainId: number }]
      returns: undefined
    }>()
  })
})

describe('ToOx', () => {
  test('produces RpcSchema.Generic members', () => {
    type OxSchema = Schema.ToOx<typeof Schema.schema>
    expectTypeOf<OxSchema>().toMatchTypeOf<RpcSchema.Generic>()
  })
})

describe('ToViem', () => {
  test('produces tuple with Method/Parameters/ReturnType', () => {
    type ViemSchema = Schema.ToViem<typeof Schema.schema>
    expectTypeOf<ViemSchema[0]['Method']>().toEqualTypeOf<'eth_accounts'>()
    expectTypeOf<ViemSchema[0]['Parameters']>().toEqualTypeOf<undefined>()
    expectTypeOf<ViemSchema[0]['ReturnType']>().toEqualTypeOf<readonly `0x${string}`[]>()
  })
})

describe('Ox', () => {
  test('includes RpcSchema.Eth', () => {
    expectTypeOf<RpcSchema.Eth>().toMatchTypeOf<Schema.Ox>()
  })

  test('includes provider methods', () => {
    expectTypeOf<Schema.ToOx<typeof Schema.schema>>().toMatchTypeOf<Schema.Ox>()
  })
})

describe('Viem', () => {
  test('is a tuple of all provider methods', () => {
    expectTypeOf<Schema.Viem[0]['Method']>().toEqualTypeOf<'eth_accounts'>()
    expectTypeOf<Schema.Viem[5]['Method']>().toEqualTypeOf<'wallet_switchEthereumChain'>()
  })
})

describe('Request', () => {
  test('is a discriminated union of all methods', () => {
    type Methods = Schema.Request['method']
    expectTypeOf<Methods>().toEqualTypeOf<
      | 'eth_accounts'
      | 'eth_chainId'
      | 'eth_requestAccounts'
      | 'wallet_connect'
      | 'wallet_disconnect'
      | 'wallet_switchEthereumChain'
    >()
  })

  test('wallet_switchEthereumChain has decoded params', () => {
    type SwitchChain = Extract<Schema.Request, { method: 'wallet_switchEthereumChain' }>
    expectTypeOf<SwitchChain['params']>().toEqualTypeOf<readonly [{ chainId: number }]>()
  })

  test('eth_accounts has no params', () => {
    type EthAccounts = Extract<Schema.Request, { method: 'eth_accounts' }>
    expectTypeOf<EthAccounts>().not.toHaveProperty('params')
  })

  test('wallet_connect params are optional', () => {
    type WalletConnect = Extract<Schema.Request, { method: 'wallet_connect' }>
    expectTypeOf<WalletConnect>().toMatchTypeOf<{ method: 'wallet_connect' }>()
  })
})
