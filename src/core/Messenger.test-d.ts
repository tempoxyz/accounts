import { describe, expectTypeOf, test } from 'vitest'

import type * as Messenger from './Messenger.js'

describe('Payload', () => {
  test('ready resolves to undefined', () => {
    expectTypeOf<Messenger.Payload<'ready'>>().toEqualTypeOf<undefined>()
  })

  test('rpc-request resolves to RpcRequest shape', () => {
    expectTypeOf<Messenger.Payload<'rpc-request'>>().toEqualTypeOf<{
      id: number
      jsonrpc: '2.0'
      method: string
      params?: unknown
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
      referrer: { title: string; icon?: string | undefined }
    }>()
    expectTypeOf<Extract<Internal, { type: 'resize' }>>().toMatchTypeOf<{
      type: 'resize'
      height?: number | undefined
      width?: number | undefined
    }>()
  })
})
