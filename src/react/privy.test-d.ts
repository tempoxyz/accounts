import { describe, expectTypeOf, test } from 'vp/test'

import type * as Adapter from '../core/Adapter.js'
import { PrivyAccountsBridge, privy } from './privy.js'

describe('privy', () => {
  test('returns an Adapter', () => {
    expectTypeOf(privy).returns.toEqualTypeOf<Adapter.Adapter>()
  })

  test('accepts adapter metadata options', () => {
    expectTypeOf<privy.Options>().toEqualTypeOf<{
      icon?: `data:image/${string}` | undefined
      name?: string | undefined
      rdns?: string | undefined
    }>()
  })

  test('bridge is a null-rendering component', () => {
    expectTypeOf(PrivyAccountsBridge).returns.toEqualTypeOf<null>()
  })
})
