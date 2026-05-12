import { describe, expectTypeOf, test } from 'vp/test'

import * as Adapter from '../Adapter.js'
import { bitgo } from './bitgo.js'

describe('bitgo', () => {
  test('options accept BitGo credentials directly', () => {
    expectTypeOf<bitgo.Options>().toMatchTypeOf<{
      accessToken: string
      coin: string
      walletId: string
      walletPassphrase: string
    }>()
  })

  test('env is optional and accepts test, prod, or custom URL', () => {
    expectTypeOf<bitgo.Options['env']>().toEqualTypeOf<
      'test' | 'prod' | string | undefined
    >()
  })

  test('expressUrl is optional', () => {
    expectTypeOf<bitgo.Options['expressUrl']>().toEqualTypeOf<string | undefined>()
  })

  test('bitgo() returns an Adapter', () => {
    expectTypeOf(bitgo).returns.toEqualTypeOf<Adapter.Adapter>()
  })

  test('minimal usage compiles', () => {
    bitgo({
      accessToken: 'v2x...',
      coin: 'hteth',
      walletId: '123',
      walletPassphrase: 'pass',
    })
  })

  test('full usage with all options compiles', () => {
    bitgo({
      accessToken: 'v2x...',
      coin: 'hteth',
      walletId: '123',
      walletPassphrase: 'pass',
      env: 'test',
      expressUrl: 'http://localhost:3080',
      name: 'My BitGo',
      rdns: 'com.example.bitgo',
    })
  })
})
