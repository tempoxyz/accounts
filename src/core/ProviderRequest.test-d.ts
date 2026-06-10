import { describe, expectTypeOf, test } from 'vp/test'

import * as ProviderRequest from './ProviderRequest.js'

describe('parse', () => {
  test('narrows params by expected method', () => {
    const request = ProviderRequest.parse(
      {
        method: 'personal_sign',
        params: ['0x68656c6c6f', '0x0000000000000000000000000000000000000001'],
      },
      { method: 'personal_sign' },
    )

    expectTypeOf(request.method).toEqualTypeOf<'personal_sign'>()
    expectTypeOf(request.params).toEqualTypeOf<readonly [`0x${string}`, `0x${string}`]>()
  })

  test('narrows params by discriminating method', () => {
    const request = ProviderRequest.parse({ method: 'eth_accounts' })

    if (request.method === 'wallet_switchEthereumChain')
      expectTypeOf(request.params).toEqualTypeOf<readonly [{ chainId: number }]>()
    else expectTypeOf(request).toMatchTypeOf<ProviderRequest.ProviderRequest>()
  })

  test('exposes optional transport metadata', () => {
    const request = ProviderRequest.parse({ id: 1, method: 'eth_accounts' })

    expectTypeOf(request.id).toEqualTypeOf<ProviderRequest.Id | undefined>()
    expectTypeOf(request.origin).toEqualTypeOf<string | undefined>()
  })
})
