import { describe, expectTypeOf, test } from 'vitest'

import type * as Dialog from './Dialog.js'
import type * as Messenger from './Messenger.js'

describe('Dialog', () => {
  test('has name and setup returning open, close, destroy', () => {
    expectTypeOf<Dialog.setup.Parameters>().toEqualTypeOf<{
      host: string
      messenger: Messenger.Bridge
    }>()
    expectTypeOf<Dialog.setup.ReturnType>().toEqualTypeOf<{
      open: () => void
      close: () => void
      destroy: () => void
    }>()
  })
})
