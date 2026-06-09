import { expectTypeOf, test } from 'vp/test'

import { type Handler } from '../../Handler.js'
import { oidcProvider } from './oidcProvider.js'

test('returns a Handler', () => {
  const handler = oidcProvider({
    issuer: 'https://wallet.example.com',
    publicKey: '{}',
    signingKey: '{}',
    getClaims: () => ({ email: 'a@b.com' }),
  })
  expectTypeOf(handler).toMatchTypeOf<Handler>()
})

test('getClaims is required; authenticate + key params are typed', () => {
  expectTypeOf(oidcProvider).parameter(0).toMatchTypeOf<{
    getClaims: (params: {
      audience: string
      nonce: string | undefined
      request: Request
      subject: string
    }) => Record<string, unknown> | Promise<Record<string, unknown>>
    issuer: string
    publicKey: string
    signingKey: string
    authenticate?: ((request: Request) => string | Promise<string>) | undefined
    claimsSupported?: readonly string[] | undefined
    jwksUri?: string | undefined
    kid?: string | undefined
    path?: string | undefined
    ttl?: number | undefined
  }>()
})
