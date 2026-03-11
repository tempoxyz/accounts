import { describe, expectTypeOf, test } from 'vitest'

import type * as Messenger from './Messenger.js'
import type * as Store from './Store.js'

describe('Payload', () => {
  test('ready resolves to undefined', () => {
    expectTypeOf<Messenger.Payload<'ready'>>().toEqualTypeOf<undefined>()
  })

  test('rpc-requests resolves to { chainId, requests }', () => {
    expectTypeOf<Messenger.Payload<'rpc-requests'>>().toEqualTypeOf<{
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

  test('__internal is a discriminated union on type', () => {
    type Internal = Messenger.Payload<'__internal'>
    expectTypeOf<Extract<Internal, { type: 'init' }>>().toMatchTypeOf<{
      type: 'init'
      mode: 'iframe' | 'popup'
    }>()
    expectTypeOf<Extract<Internal, { type: 'resize' }>>().toMatchTypeOf<{
      type: 'resize'
      height?: number | undefined
      width?: number | undefined
    }>()
  })
})
