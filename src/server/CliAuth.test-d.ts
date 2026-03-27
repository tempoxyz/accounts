import type { Hex } from 'viem'
import { describe, expectTypeOf, test } from 'vp/test'
import * as z from 'zod/mini'

import * as CliAuth from './CliAuth.js'

describe('createRequest', () => {
  test('includes the v1 device-code request fields', () => {
    expectTypeOf<z.output<typeof CliAuth.createRequest>>().toMatchTypeOf<{
      account?: Hex | undefined
      code_challenge: string
      expiry?: number | undefined
      key_type?: 'secp256k1' | 'p256' | 'webAuthn' | undefined
      limits?: readonly { token: Hex; limit: bigint }[] | undefined
      pub_key: Hex
    }>()
  })

  test('does not include scopes in v1', () => {
    type Request = z.output<typeof CliAuth.createRequest>
    expectTypeOf<Request>().not.toHaveProperty('scopes')
  })
})

describe('pollResponse', () => {
  test('authorized responses carry the normal keyAuthorization shape', () => {
    type Response = Extract<z.output<typeof CliAuth.pollResponse>, { status: 'authorized' }>
    expectTypeOf<Response>().toMatchTypeOf<{
      account_address: Hex
      key_authorization: z.output<typeof CliAuth.keyAuthorization>
      status: 'authorized'
    }>()
  })
})

describe('Store', () => {
  test('memory helper satisfies the shared store contract', () => {
    expectTypeOf(CliAuth.Store.memory).returns.toMatchTypeOf<CliAuth.Store>()
  })
})
