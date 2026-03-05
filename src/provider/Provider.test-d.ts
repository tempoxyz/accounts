import type { RpcSchema } from 'ox'
import { describe, expectTypeOf, test } from 'vitest'

import type * as Schema from './Schema.js'

type Result<method extends RpcSchema.MethodNameGeneric<Schema.Ox>> = RpcSchema.ExtractReturnType<
  Schema.Ox,
  method
>

describe('request', () => {
  test('eth_accounts', () => {
    expectTypeOf<Result<'eth_accounts'>>().toEqualTypeOf<readonly `0x${string}`[]>()
  })

  test('eth_chainId', () => {
    expectTypeOf<Result<'eth_chainId'>>().toEqualTypeOf<`0x${string}`>()
  })

  test('eth_requestAccounts', () => {
    expectTypeOf<Result<'eth_requestAccounts'>>().toEqualTypeOf<readonly `0x${string}`[]>()
  })

  test('eth_sendTransaction', () => {
    expectTypeOf<Result<'eth_sendTransaction'>>().toEqualTypeOf<`0x${string}`>()
  })

  test('wallet_connect', () => {
    expectTypeOf<Result<'wallet_connect'>>().toEqualTypeOf<readonly `0x${string}`[]>()
  })

  test('wallet_disconnect', () => {
    expectTypeOf<Result<'wallet_disconnect'>>().toEqualTypeOf<undefined>()
  })

  test('wallet_switchEthereumChain', () => {
    expectTypeOf<Result<'wallet_switchEthereumChain'>>().toEqualTypeOf<undefined>()
  })
})
