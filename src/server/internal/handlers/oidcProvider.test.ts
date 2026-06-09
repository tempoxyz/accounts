import { decode, verify } from 'hono/jwt'
import { describe, expect, test } from 'vp/test'

import { oidcProvider } from './oidcProvider.js'

const signingKey = JSON.stringify({
  alg: 'Ed25519',
  crv: 'Ed25519',
  d: 'tx-s_Aj4ltT_rpY_AIEKexmitq2eyWMkuuIy5JMzmn4',
  x: 'eZEsf-38KiwfrWnn88cokaJmAoOVgTocC1TndJsz_uQ',
  kty: 'OKP',
})
const publicKey = JSON.stringify({
  alg: 'Ed25519',
  crv: 'Ed25519',
  x: 'eZEsf-38KiwfrWnn88cokaJmAoOVgTocC1TndJsz_uQ',
  kty: 'OKP',
})

const issuer = 'https://wallet.example.com'
const address = '0x0000000000000000000000000000000000001234'

function setup(options: Partial<Parameters<typeof oidcProvider>[0]> = {}) {
  return oidcProvider({
    issuer,
    publicKey,
    signingKey,
    authenticate: () => address,
    getClaims: () => ({ email: 'alice@example.com', email_verified: true }),
    ...options,
  })
}

describe('token', () => {
  test('mints a signed id_token with standard + custom claims', async () => {
    const app = setup()
    const res = await app.request('/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ audience: 'https://app.example.com', nonce: 'n-123' }),
    })

    expect(res.status).toBe(200)
    const { idToken } = (await res.json()) as { idToken: string }

    const verified = (await verify(idToken, JSON.parse(publicKey), 'EdDSA')) as Record<
      string,
      unknown
    >
    const { iat, exp, ...claims } = verified
    expect(typeof iat).toBe('number')
    expect(exp).toBe((iat as number) + 300)
    expect(claims).toMatchInlineSnapshot(`
      {
        "aud": "https://app.example.com",
        "email": "alice@example.com",
        "email_verified": true,
        "iss": "https://wallet.example.com",
        "nonce": "n-123",
        "sub": "0x0000000000000000000000000000000000001234",
      }
    `)
  })

  test('omits nonce when not supplied', async () => {
    const app = setup()
    const res = await app.request('/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ audience: 'https://app.example.com' }),
    })
    const { idToken } = (await res.json()) as { idToken: string }
    const { payload } = decode(idToken)
    expect('nonce' in payload).toBe(false)
  })

  test('authenticate throwing rejects with 401', async () => {
    const app = setup({
      authenticate: () => {
        throw new Error('no session')
      },
    })
    const res = await app.request('/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ audience: 'https://app.example.com' }),
    })
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchInlineSnapshot(`
      {
        "error": "no session",
      }
    `)
  })

  test('getClaims throwing rejects with 400', async () => {
    const app = setup({
      getClaims: () => {
        throw new Error('no verified email')
      },
    })
    const res = await app.request('/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ audience: 'https://app.example.com' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchInlineSnapshot(`
      {
        "error": "no verified email",
      }
    `)
  })

  test('falls back to body subject when no authenticate callback', async () => {
    const app = setup({ authenticate: undefined })
    const res = await app.request('/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ audience: 'https://app.example.com', subject: address }),
    })
    expect(res.status).toBe(200)
    const { idToken } = (await res.json()) as { idToken: string }
    const { payload } = decode(idToken)
    expect(payload.sub).toBe(address)
  })

  test('missing subject (no authenticate, no body subject) rejects with 400', async () => {
    const app = setup({ authenticate: undefined })
    const res = await app.request('/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ audience: 'https://app.example.com' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchInlineSnapshot(`
      {
        "error": "missing subject",
      }
    `)
  })
})

describe('discovery', () => {
  test('serves an openid-configuration document', async () => {
    const app = setup()
    const res = await app.request('/.well-known/openid-configuration')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchInlineSnapshot(`
      {
        "claims_supported": [
          "iss",
          "aud",
          "sub",
          "iat",
          "exp",
          "nonce",
        ],
        "id_token_signing_alg_values_supported": [
          "EdDSA",
        ],
        "issuer": "https://wallet.example.com",
        "jwks_uri": "https://wallet.example.com/.well-known/jwks.json",
        "response_types_supported": [
          "id_token",
        ],
        "subject_types_supported": [
          "public",
        ],
      }
    `)
  })

  test('appends deployment claims via claimsSupported', async () => {
    const app = setup({
      claimsSupported: ['iss', 'aud', 'sub', 'iat', 'exp', 'nonce', 'email', 'email_verified'],
    })
    const res = await app.request('/.well-known/openid-configuration')
    const doc = (await res.json()) as { claims_supported: string[] }
    expect(doc.claims_supported).toContain('email')
    expect(doc.claims_supported).toContain('email_verified')
  })

  test('honors a custom jwksUri', async () => {
    const app = setup({ jwksUri: 'https://keys.example.com/jwks.json' })
    const res = await app.request('/.well-known/openid-configuration')
    const doc = (await res.json()) as { jwks_uri: string }
    expect(doc.jwks_uri).toBe('https://keys.example.com/jwks.json')
  })
})

describe('jwks', () => {
  test('serves the public signing key', async () => {
    const app = setup()
    const res = await app.request('/.well-known/jwks.json')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchInlineSnapshot(`
      {
        "keys": [
          {
            "alg": "EdDSA",
            "crv": "Ed25519",
            "kid": "oidc-1",
            "kty": "OKP",
            "use": "sig",
            "x": "eZEsf-38KiwfrWnn88cokaJmAoOVgTocC1TndJsz_uQ",
          },
        ],
      }
    `)
  })
})
