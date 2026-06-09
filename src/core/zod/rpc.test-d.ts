import { describe, expectTypeOf, test } from 'vp/test'
import type * as z from 'zod/mini'

import type * as Rpc from './rpc.js'

describe('wallet_connect.identity', () => {
  test('infers email as boolean | undefined', () => {
    type Identity = z.output<typeof Rpc.wallet_connect.identity>
    expectTypeOf<Identity>().toEqualTypeOf<{ email?: boolean | undefined } | undefined>()
  })

  test('register request capability exposes identity', () => {
    type Capabilities = NonNullable<z.output<typeof Rpc.wallet_connect.capabilities.request>>
    type Register = Extract<Capabilities, { method: 'register' }>
    expectTypeOf<Register['identity']>().toEqualTypeOf<{ email?: boolean | undefined } | undefined>()
  })

  test('login request capability exposes identity', () => {
    type Capabilities = NonNullable<z.output<typeof Rpc.wallet_connect.capabilities.request>>
    type Login = Extract<Capabilities, { method?: 'login' | undefined }>
    expectTypeOf<Login['identity']>().toEqualTypeOf<{ email?: boolean | undefined } | undefined>()
  })

  test('result capability exposes identity.email claim', () => {
    type Result = z.output<typeof Rpc.wallet_connect.capabilities.result>
    expectTypeOf<Result['identity']>().toEqualTypeOf<
      { email?: string | null | undefined } | undefined
    >()
  })
})
