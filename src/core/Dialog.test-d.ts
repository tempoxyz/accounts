import { describe, expectTypeOf, test } from 'vp/test'

import type * as Dialog from './Dialog.js'

describe('Dialog', () => {
  test('has name and setup returning a dialog session', () => {
    expectTypeOf<Dialog.SetupFn.Parameters>().toEqualTypeOf<{
      host: string
      getAccounts: () => readonly { address: string }[]
      getChainId: () => number
      onAccountsInvalid: () => void
      theme?: Dialog.Theme | undefined
    }>()
    expectTypeOf<Dialog.RequestContext>().toEqualTypeOf<{
      account: { address: string } | undefined
      chainId: number
      request: Dialog.PendingRequest
    }>()
    expectTypeOf<Dialog.Session>().toMatchTypeOf<{
      open: () => void
      close: () => void
      destroy: () => void
      request: (context: Dialog.RequestContext) => Promise<unknown>
    }>()
  })
})
