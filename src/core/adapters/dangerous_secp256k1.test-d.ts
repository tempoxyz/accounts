import type { Account as TempoAccount } from 'viem/tempo'
import { describe, expectTypeOf, test } from 'vp/test'

import { dangerous_secp256k1 } from './dangerous_secp256k1.js'

describe('dangerous_secp256k1', () => {
  test('account option includes keyType', () => {
    expectTypeOf<NonNullable<dangerous_secp256k1.Options['account']>>().toMatchTypeOf<{
      address: `0x${string}`
      keyType: string
    }>()
  })

  test('account option accepts a viem root account', () => {
    expectTypeOf<TempoAccount.RootAccount>().toMatchTypeOf<
      NonNullable<dangerous_secp256k1.Options['account']>
    >()
  })
})
