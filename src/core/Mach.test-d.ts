import type { Hex } from 'ox'
import { expectTypeOf, test } from 'vp/test'

import * as Mach from './Mach.js'
import type * as Provider from './Provider.js'
import type * as Rpc from './zod/rpc.js'

test('fund supports the SDK provider with a precise wallet response', () => {
  expectTypeOf<Provider.Provider>().toExtend<Parameters<typeof Mach.fund>[0]>()
  expectTypeOf<ReturnType<typeof Mach.fund>>().toEqualTypeOf<
    Promise<Rpc.wallet_deposit.Encoded['returns']>
  >()
  expectTypeOf<Mach.fund.Options>().toMatchTypeOf<{
    address?: Hex.Hex | undefined
    amount?: string | undefined
    chainId?: number | undefined
  }>()
})

test('handoff links require an explicit recipient', () => {
  expectTypeOf<Mach.getFundingUrl.Options>().toExtend<{ address: Hex.Hex }>()
  expectTypeOf<ReturnType<typeof Mach.getFundingUrl>>().toEqualTypeOf<string>()
})

test('MACH prompts work during connect and access-key authorization', () => {
  type Connect = NonNullable<Rpc.wallet_connect.Encoded['params']>[0]
  type Authorize = NonNullable<Rpc.wallet_authorizeAccessKey.Encoded['params']>[0]
  const showDeposit = { intent: 'mach', amount: '5', token: 'MACH' } as const
  expectTypeOf<{ capabilities: { showDeposit: typeof showDeposit } }>().toExtend<Connect>()
  expectTypeOf<typeof showDeposit>().toExtend<NonNullable<Authorize['showDeposit']>>()
})
