import { describe, expectTypeOf, test } from 'vp/test'

import type * as Dialog from './Dialog.js'
import type * as Store from './Store.js'

describe('Dialog', () => {
  test('has name and setup returning open, close, destroy, syncRequests', () => {
    expectTypeOf<Dialog.SetupFn.Parameters>().toEqualTypeOf<{
      host: string
      store: Store.Store
      theme?: Dialog.Theme | undefined
    }>()
    expectTypeOf<Dialog.Instance>().toMatchTypeOf<{
      open: () => void
      close: () => void
      destroy: () => void
      syncRequests: (requests: readonly Store.QueuedRequest[]) => Promise<void>
    }>()
  })
})
