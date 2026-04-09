import type { Hex } from 'viem'
import { describe, expectTypeOf, test } from 'vp/test'

import { dangerous_secp256k1 } from './dangerous_secp256k1.js'

describe('dangerous_secp256k1', () => {
  test('privateKey option is hex', () => {
    expectTypeOf<NonNullable<dangerous_secp256k1.Options['privateKey']>>().toEqualTypeOf<Hex>()
  })

  test('options accept privateKey', () => {
    expectTypeOf<dangerous_secp256k1.Options>().toMatchTypeOf<{
      privateKey?: Hex | undefined
    }>()
  })
})
