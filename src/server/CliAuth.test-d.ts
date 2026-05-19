import type { Hex } from 'viem'
import { describe, expectTypeOf, test } from 'vp/test'
import * as z from 'zod/mini'

import * as CliAuth from './CliAuth.js'

describe('createRequest', () => {
  test('includes the v1 device-code request fields', () => {
    expectTypeOf<z.output<typeof CliAuth.createRequest>>().toMatchTypeOf<{
      account?: Hex | undefined
      codeChallenge: string
      expiry?: number | undefined
      keyType?: 'secp256k1' | 'p256' | 'webAuthn' | undefined
      limits?: readonly { token: Hex; limit: bigint }[] | undefined
      pubKey: Hex
      showDeposit?:
        | boolean
        | {
            amount?: string | undefined
            displayName?: string | undefined
            token?: string | undefined
          }
        | undefined
    }>()
  })

  test('does not include scopes in v1', () => {
    type Request = z.output<typeof CliAuth.createRequest>
    expectTypeOf<Request>().not.toHaveProperty('scopes')
  })

  test('showDeposit does not include address or chainId', () => {
    type Request = z.output<typeof CliAuth.createRequest>
    type ShowDeposit = Exclude<Exclude<Request['showDeposit'], boolean | undefined>, undefined>
    expectTypeOf<ShowDeposit>().not.toHaveProperty('address')
    expectTypeOf<ShowDeposit>().not.toHaveProperty('chainId')
  })
})

describe('pollResponse', () => {
  test('authorized responses carry the normal keyAuthorization shape', () => {
    type Response = Extract<z.output<typeof CliAuth.pollResponse>, { status: 'authorized' }>
    expectTypeOf<Response>().toMatchTypeOf<{
      accountAddress: Hex
      keyAuthorization: z.output<typeof CliAuth.keyAuthorization>
      status: 'authorized'
    }>()
  })
})

describe('pendingResponse', () => {
  test('pending responses expose the browser approval payload', () => {
    expectTypeOf<z.output<typeof CliAuth.pendingResponse>>().toMatchTypeOf<{
      accessKeyAddress: Hex
      account?: Hex | undefined
      chainId: bigint
      code: string
      expiry: number
      keyType: 'secp256k1' | 'p256' | 'webAuthn'
      limits?: readonly { token: Hex; limit: bigint }[] | undefined
      pubKey: Hex
      showDeposit?:
        | boolean
        | {
            amount?: string | undefined
            displayName?: string | undefined
            token?: string | undefined
          }
        | undefined
      status: 'pending'
    }>()
  })
})

describe('Store', () => {
  test('memory helper satisfies the shared store contract', () => {
    expectTypeOf(CliAuth.Store.memory).returns.toMatchTypeOf<CliAuth.Store>()
  })
})

describe('from', () => {
  test('returns the shared CLI auth helper contract', () => {
    expectTypeOf(CliAuth.from).returns.toMatchTypeOf<CliAuth.CliAuth>()
  })
})
