import { describe, expectTypeOf, test } from 'vp/test'
import type * as z from 'zod/mini'

import type * as Rpc from './rpc.js'

describe('wallet_connect.auth', () => {
  test('request exposes resources', () => {
    type Auth = Exclude<z.output<typeof Rpc.wallet_connect.auth>, string | undefined>
    expectTypeOf<Auth>().toMatchTypeOf<{
      resources?: readonly string[] | undefined
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
  type EmailRequest =
    | boolean
    | string
    | {
        address?: string | undefined
        domains?: string[] | undefined
        nonce?: string | undefined
      }
    | undefined

  test('infers email as boolean | string | { address, domains, nonce } | undefined', () => {
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

describe('transactionRequest.requireFunds', () => {
  test('decodes quantities and source addresses for Viem', () => {
    type Request = z.output<typeof Rpc.transactionRequest>
    expectTypeOf<Request['requireFunds']>().toEqualTypeOf<
      | readonly {
          amount: bigint
          policyRules?: `0x${string}` | undefined
          slippageBps?: number | undefined
          sources?: readonly { target: `0x${string}`; data: `0x${string}` }[] | undefined
          token: `0x${string}`
        }[]
      | undefined
    >()
  })
})

describe('funding policy authorization', () => {
  test('requests allow omitted admins, signed data requires explicit admins', () => {
    type Request = z.output<typeof Rpc.wallet_authorizeAccessKey.parameters>['fundingPolicy']
    type Connect = NonNullable<
      z.output<typeof Rpc.wallet_connect.authorizeAccessKey>
    >['fundingPolicy']
    type Signed = z.output<typeof Rpc.keyAuthorization>['fundingPolicy']
    expectTypeOf<Request>().toEqualTypeOf<Connect>()
    expectTypeOf<Extract<Request, object>['admins']>().toEqualTypeOf<
      readonly `0x${string}`[] | undefined
    >()
    expectTypeOf<Extract<Signed, object>['admins']>().toEqualTypeOf<readonly `0x${string}`[]>()
    expectTypeOf<
      Extract<z.input<typeof Rpc.wallet_authorizeAccessKey.parameters>['fundingPolicy'], string>
    >().toEqualTypeOf<`0x${string}`>()
    expectTypeOf<Extract<Request, bigint>>().toEqualTypeOf<bigint>()
  })
})
