import type { Hex } from 'viem'
import { describe, expectTypeOf, test } from 'vp/test'
import * as z from 'zod/mini'

import * as CliAuth from './CliAuth.js'

describe('createRequest', () => {
  test('includes the v1 device-code request fields', () => {
    type Request = Exclude<z.output<typeof CliAuth.createRequest>, { action: 'updateAccessKey' }>
    expectTypeOf<Request>().toMatchTypeOf<{
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
            on?: 'login' | 'register' | undefined
            token?: string | undefined
          }
        | undefined
    }>()
  })

  test('includes access-key update requests', () => {
    type Request = Extract<z.output<typeof CliAuth.createRequest>, { action: 'updateAccessKey' }>
    expectTypeOf<Request>().toMatchTypeOf<{
      action: 'updateAccessKey'
      accessKeyAddress: Hex
      account: Hex
      chainId?: bigint | undefined
      codeChallenge: string
      keyAuthorization?: z.output<typeof CliAuth.keyAuthorization> | undefined
      limits: readonly { token: Hex; limit: bigint }[]
    }>()
  })

  test('does not include scopes in v1', () => {
    type Request = Exclude<z.output<typeof CliAuth.createRequest>, { action: 'updateAccessKey' }>
    expectTypeOf<Request>().not.toHaveProperty('scopes')
  })

  test('showDeposit does not include address or chainId', () => {
    type Request = Exclude<z.output<typeof CliAuth.createRequest>, { action: 'updateAccessKey' }>
    type ShowDeposit = Exclude<Exclude<Request['showDeposit'], boolean | undefined>, undefined>
    expectTypeOf<ShowDeposit>().not.toHaveProperty('address')
    expectTypeOf<ShowDeposit>().not.toHaveProperty('chainId')
  })
})

describe('pollResponse', () => {
  test('authorized responses carry the normal keyAuthorization shape', () => {
    type Response = Exclude<
      Extract<z.output<typeof CliAuth.pollResponse>, { status: 'authorized' }>,
      { action: 'updateAccessKey' }
    >
    expectTypeOf<Response>().toMatchTypeOf<{
      accountAddress: Hex
      keyAuthorization: z.output<typeof CliAuth.keyAuthorization>
      status: 'authorized'
    }>()
  })

  test('access-key updates can return a replacement authorization', () => {
    type Response = Extract<z.output<typeof CliAuth.pollResponse>, { action: 'updateAccessKey' }>
    expectTypeOf<Response>().toMatchTypeOf<{
      action: 'updateAccessKey'
      keyAuthorization?: z.output<typeof CliAuth.keyAuthorization> | undefined
      status: 'authorized'
    }>()
  })
})

describe('pendingResponse', () => {
  test('pending responses expose the browser approval payload', () => {
    type Response = Exclude<z.output<typeof CliAuth.pendingResponse>, { action: 'updateAccessKey' }>
    expectTypeOf<Response>().toMatchTypeOf<{
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
            on?: 'login' | 'register' | undefined
            token?: string | undefined
          }
        | undefined
      status: 'pending'
    }>()
  })

  test('pending access-key updates expose an optional current authorization', () => {
    type Response = Extract<z.output<typeof CliAuth.pendingResponse>, { action: 'updateAccessKey' }>
    expectTypeOf<Response>().toMatchTypeOf<{
      action: 'updateAccessKey'
      keyAuthorization?: z.output<typeof CliAuth.keyAuthorization> | undefined
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
