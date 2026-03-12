import { describe, expectTypeOf, test } from 'vitest'

import type * as Messenger from './Messenger.js'
import type * as Store from './Store.js'

describe('Payload', () => {
  test('ready resolves to undefined', () => {
    expectTypeOf<Messenger.Payload<'ready'>>().toEqualTypeOf<undefined>()
  })

  test('rpc-requests resolves to { account, chainId, requests }', () => {
    expectTypeOf<Messenger.Payload<'rpc-requests'>>().toEqualTypeOf<{
      account: { address: string } | undefined
      chainId: number
      requests: readonly Store.QueuedRequest[]
    }>()
  })

  test('rpc-response includes _request', () => {
    expectTypeOf<Messenger.Payload<'rpc-response'>>().toMatchTypeOf<{
      _request: { id: number; method: string }
    }>()
  })

  test('close resolves to undefined', () => {
    expectTypeOf<Messenger.Payload<'close'>>().toEqualTypeOf<undefined>()
  })
})
