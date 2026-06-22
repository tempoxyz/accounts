import { describe, expectTypeOf, test } from 'vp/test'
import type * as z from 'zod/mini'

import type * as Rpc from './rpc.js'

describe('wallet_connect.auth', () => {
  test('request exposes resources and statement', () => {
    type Auth = Exclude<z.output<typeof Rpc.wallet_connect.auth>, string | undefined>
    expectTypeOf<Auth>().toMatchTypeOf<{
      resources?: readonly string[] | undefined
      statement?: string | undefined
    }>()
  })

  test('result preserves token plus arbitrary JSON fields', () => {
    type Result = z.output<typeof Rpc.wallet_connect.capabilities.result>
    expectTypeOf<Result['auth']>().toMatchTypeOf<
      ({ token?: string | undefined } & Record<string, unknown>) | undefined
    >()
  })
})

describe('wallet_connect.identity', () => {
  type EmailRequest = boolean | { nonce?: string | undefined } | undefined

  test('infers email as boolean | { nonce } | undefined', () => {
    type Identity = z.output<typeof Rpc.wallet_connect.identity>
    expectTypeOf<Identity>().toEqualTypeOf<{ email?: EmailRequest } | undefined>()
  })

  test('register request capability exposes identity', () => {
    type Capabilities = NonNullable<z.output<typeof Rpc.wallet_connect.capabilities.request>>
    type Register = Extract<Capabilities, { method: 'register' }>
    expectTypeOf<Register['identity']>().toEqualTypeOf<{ email?: EmailRequest } | undefined>()
  })

  test('login request capability exposes identity', () => {
    type Capabilities = NonNullable<z.output<typeof Rpc.wallet_connect.capabilities.request>>
    type Login = Extract<Capabilities, { method?: 'login' | undefined }>
    expectTypeOf<Login['identity']>().toEqualTypeOf<{ email?: EmailRequest } | undefined>()
  })

  test('result capability exposes identity.email + identity.idToken claims', () => {
    type Result = z.output<typeof Rpc.wallet_connect.capabilities.result>
    expectTypeOf<Result['identity']>().toEqualTypeOf<
      { email?: string | null | undefined; idToken?: string | undefined } | undefined
    >()
  })
})
