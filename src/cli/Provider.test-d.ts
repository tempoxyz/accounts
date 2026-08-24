import { describe, expectTypeOf, test } from 'vp/test'
import type { DeviceCode } from 'wata'

import type * as CoreProvider from '../core/Provider.js'
import type { cli } from './adapter.js'
import type * as Provider from './Provider.js'

describe('create', () => {
  test('accepts CLI bootstrap options', () => {
    expectTypeOf<Parameters<typeof Provider.create>[0]>().toMatchTypeOf<{
      host?: string | undefined
      open?: ((url: string, prompt: DeviceCode.Prompt) => Promise<void> | void) | undefined
      pollingInterval?: number | undefined
      timeout?: number | undefined
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
