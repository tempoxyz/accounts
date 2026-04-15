import { Hono } from 'hono'

/** JWKS endpoint exposing the session-signing public key. */
export const jwks = new Hono<{ Bindings: Env }>().get('/jwks.json', (c) => {
  const jwk = JSON.parse(process.env.SESSION_PUBLIC_KEY!) as JsonWebKey
  return c.json(
    { keys: [{ ...jwk, kid: 'connect-1', use: 'sig', alg: 'EdDSA' }] },
    { headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } },
  )
})
