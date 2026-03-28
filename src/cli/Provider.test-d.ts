import { describe, expectTypeOf, test } from 'vp/test'

import type * as CoreProvider from '../core/Provider.js'
import type { cli } from './adapter.js'
import type * as Provider from './Provider.js'

describe('create', () => {
  test('accepts CLI bootstrap options', () => {
    expectTypeOf<Parameters<typeof Provider.create>[0]>().toMatchTypeOf<{
      host: string
      open?: ((url: string) => Promise<void> | void) | undefined
      pollIntervalMs?: number | undefined
      timeoutMs?: number | undefined
    }>()
  })

  test('returns the normal provider shape', () => {
    expectTypeOf<ReturnType<typeof Provider.create>>().toMatchTypeOf<CoreProvider.Provider>()
  })
})

describe('cli', () => {
  test('requires a service URL', () => {
    expectTypeOf<Parameters<typeof cli>[0]>().toMatchTypeOf<{
      host: string
    }>()
  })
})
