import { describe, expect, test } from 'vp/test'

import * as TrustedHosts from './TrustedHosts.js'

describe('match', () => {
  test('behavior: matches explicit trusted host', () => {
    expect(TrustedHosts.match(['app.example.com'], 'app.example.com')).toMatchInlineSnapshot(`true`)
  })

  test('behavior: matches explicit wildcard subdomain', () => {
    expect(TrustedHosts.match(['*.example.com'], 'app.example.com')).toMatchInlineSnapshot(`true`)
  })

  test('behavior: does not implicitly trust shared hosting siblings', () => {
    expect(
      TrustedHosts.match([], 'wallet.vercel.app', 'attacker.vercel.app'),
    ).toMatchInlineSnapshot(`false`)
  })
})
