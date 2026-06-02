import { describe, expectTypeOf, test } from 'vp/test'

import type * as Dialog from './Dialog.js'
import type * as Store from './Store.js'

describe('Dialog', () => {
  test('has name and setup returning open, close, destroy, syncRequests', () => {
    expectTypeOf<Dialog.SetupFn.Parameters>().toEqualTypeOf<{
      host: string
      store: Store.Store
      onReject: (ids: readonly number[]) => void
      onResponse: (response: {
        id: number
        result?: unknown
        error?: { code: number; message: string } | undefined
      }) => void
      theme?: Dialog.Theme | undefined
    }>()
    expectTypeOf<Dialog.Sync>().toEqualTypeOf<{
      account: { address: string } | undefined
      chainId: number
      requests: readonly Dialog.Request[]
    }>()
    expectTypeOf<Dialog.Instance>().toMatchTypeOf<{
      open: () => void
      close: () => void
      destroy: () => void
      syncRequests: (sync: Dialog.Sync) => Promise<void>
    }>()
  })
})
