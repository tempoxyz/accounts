import { describe, expectTypeOf, test } from 'vp/test'

import type * as Dialog from './Dialog.js'
import type * as Remote from './Remote.js'
import type * as Store from './Store.js'

describe('Dialog', () => {
  test('has name and setup returning open, close, destroy, syncRequests', () => {
    expectTypeOf<Dialog.SetupFn.Parameters>().toEqualTypeOf<{
      host: string
      onError?: ((error: Dialog.TransportError, ids: readonly number[]) => void) | undefined
      store: Store.Store
      onReject: (ids: readonly number[]) => void
      onResponse: (response: {
        id: number
        result?: unknown
        error?: { code: number; message: string } | undefined
      }) => void
      theme?: Dialog.Theme | undefined
    }>()
    expectTypeOf<Remote.Sync>().toEqualTypeOf<{
      account: { address: string } | undefined
      chainId: number
      requests: readonly Remote.Request[]
    }>()
    expectTypeOf<Dialog.Instance>().toMatchTypeOf<{
      open: () => void
      close: () => void
      destroy: () => void
      syncRequests: (sync: Remote.Sync) => Promise<void>
    }>()
  })
})

test('transport diagnostics expose only safe origin and stable stage fields', () => {
  expectTypeOf<Dialog.TransportError['data']>().toEqualTypeOf<{
    origin: string
    stage: 'dialog_ready' | 'dispatch' | 'closed'
  }>()
  expectTypeOf<Dialog.TransportError['code']>().toEqualTypeOf<number>()
})
