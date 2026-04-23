import { describe, expect, test } from 'vp/test'

import * as Oidc from './oidc.js'

describe('Oidc.get', () => {
  test('preserves path prefixes such as the mock issuer route', () => {
    expect([
      Oidc.get('https://wallet.tempo.local'),
      Oidc.get('https://wallet.tempo.local/mock-oidc'),
      Oidc.get('https://wallet.tempo.local/mock-oidc/'),
    ]).toMatchInlineSnapshot(`
      [
        "https://wallet.tempo.local/.well-known/openid-configuration",
        "https://wallet.tempo.local/mock-oidc/.well-known/openid-configuration",
        "https://wallet.tempo.local/mock-oidc/.well-known/openid-configuration",
      ]
    `)
  })
})
