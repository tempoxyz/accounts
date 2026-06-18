import { describe, expect, test } from 'vp/test'

import * as TrustedHosts from './TrustedHosts.js'

describe('TrustedHosts.match', () => {
  test('matches explicit trusted host patterns', () => {
    expect(
      TrustedHosts.match(['localhost', '*.localhost'], 'playground.localhost', 'wallet.localhost'),
    ).toMatchInlineSnapshot(`true`)
  })

  test('trusts same registrable production domains', () => {
    expect(
      TrustedHosts.match([], 'playground.tempo.xyz', 'wallet.tempo.xyz'),
    ).toMatchInlineSnapshot(`true`)
  })

  test('does not trust same registrable .local domains', () => {
    expect(
      TrustedHosts.match([], 'playground-13a5.tempo.local', 'wallet-13a5.tempo.local'),
    ).toMatchInlineSnapshot(`false`)
  })
})
