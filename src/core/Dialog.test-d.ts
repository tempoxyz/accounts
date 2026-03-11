import { describe, expectTypeOf, test } from 'vitest'

import type * as Dialog from './Dialog.js'
import type * as Messenger from './Messenger.js'
import type * as Store from './Store.js'

describe('Dialog', () => {
  test('has name and setup returning open, close, destroy, messenger, syncRequests', () => {
    expectTypeOf<Dialog.setup.Parameters>().toEqualTypeOf<{
      host: string
      store: Store.Store
    }>()
    expectTypeOf<Dialog.setup.ReturnType>().toMatchTypeOf<{
      open: () => void
      close: () => void
      destroy: () => void
      messenger: Messenger.Bridge
      syncRequests: (requests: readonly Store.QueuedRequest[]) => void
    }>()
  })
})
