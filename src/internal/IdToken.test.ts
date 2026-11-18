/**
 * Tests the verifier of `IdToken.create` with ID tokens that the test signs, and a `fetch` that
 * serves the key set of their key.
 * @module
 */
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as IdToken from './IdToken.js'

/** The origin of the issuer, which no test reaches. */
const url = 'https://id.test'

describe('create', () => {
  test('verify returns the claims of a valid ID token, and `undefined` for each token that fails a check', async () => {
    const keys = await issuer()
    const verifier = IdToken.create(
      Accounts.from({ clientId: 'client_allowed', fetch: keys.fetch, url }),
      { clientIds: ['client_allowed', 'client_second'] },
    )
    const cases = {
      'access token': { typ: 'at+jwt' },
      'another app': { aud: 'client_other' },
      'another app beside an allowed one': {
        aud: ['client_allowed', 'client_other'],
      },
      'both allowed apps': { aud: ['client_second', 'client_allowed'] },
      expired: { exp: Math.floor(Date.now() / 1000) - 60 },
      'logout token': { typ: 'logout+jwt' },
      'no email': { email: undefined },
      'numeric type': { typ: 7 },
      valid: {},
      'with JWT type and session': { sid: 'session_1', typ: 'JWT' },
    } satisfies Record<string, Parameters<typeof keys.sign>[0]>

    const results = Object.fromEntries(
      await Promise.all(
        Object.entries(cases).map(async ([name, overrides]) => [
          name,
          await verifier.verify({ idToken: await keys.sign(overrides) }),
        ]),
      ),
    )

    expect(results).toMatchInlineSnapshot(`
      {
        "access token": undefined,
        "another app": undefined,
        "another app beside an allowed one": undefined,
        "both allowed apps": {
          "authTime": 1767225000000,
          "clientId": "client_second",
          "email": "user@example.com",
          "emailVerified": true,
          "expiresAt": 4102444800000,
          "issuedAt": 1767225600000,
          "sessionId": undefined,
          "userId": "user_1",
        },
        "expired": undefined,
        "logout token": undefined,
        "no email": undefined,
        "numeric type": undefined,
        "valid": {
          "authTime": 1767225000000,
          "clientId": "client_allowed",
          "email": "user@example.com",
          "emailVerified": true,
          "expiresAt": 4102444800000,
          "issuedAt": 1767225600000,
          "sessionId": undefined,
          "userId": "user_1",
        },
        "with JWT type and session": {
          "authTime": 1767225000000,
          "clientId": "client_allowed",
          "email": "user@example.com",
          "emailVerified": true,
          "expiresAt": 4102444800000,
          "issuedAt": 1767225600000,
          "sessionId": "session_1",
          "userId": "user_1",
        },
      }
    `)
  })

  test('verify throws `Accounts.RequestError` with status 0 when the key set cannot be fetched', async () => {
    const keys = await issuer()
    const verifier = IdToken.create(
      Accounts.from({
        clientId: 'client_allowed',
        fetch: (() =>
          Promise.resolve(
            new Response(null, { status: 503 }),
          )) as unknown as typeof globalThis.fetch,
        url,
      }),
    )

    const error = await verifier
      .verify({ idToken: await keys.sign({}) })
      .catch((error: Accounts.RequestError) => error)

    expect(error).toBeInstanceOf(Accounts.RequestError)
    expect({
      code: (error as Accounts.RequestError).code,
      status: (error as Accounts.RequestError).status,
    }).toMatchInlineSnapshot(`
      {
        "code": "temporarily_unavailable",
        "status": 0,
      }
    `)
  })
})

/** Returns a signer of ID tokens, and a `fetch` that serves its key set at Tempo ID's JWKS URL. */
async function issuer() {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'test' }
  return {
    fetch: (() =>
      Promise.resolve(
        Response.json({ keys: [jwk] }),
      )) as unknown as typeof globalThis.fetch,
    /**
     * Signs an ID token for `client_allowed`, issued at a fixed time, which every check of the
     * verifier admits unless `overrides` changes it. An `undefined` override removes the claim.
     */
    sign: (overrides: {
      aud?: string | string[]
      email?: undefined
      exp?: number
      sid?: string
      typ?: number | string
    }) => {
      const { typ, ...claims } = overrides
      const payload = Object.fromEntries(
        Object.entries({
          aud: 'client_allowed',
          auth_time: 1_767_225_000,
          email: 'user@example.com',
          email_verified: true,
          exp: 4_102_444_800,
          iat: 1_767_225_600,
          iss: url,
          sub: 'user_1',
          ...claims,
        }).filter(([, value]) => value !== undefined),
      )
      return new SignJWT(payload)
        .setProtectedHeader({
          alg: 'RS256',
          kid: 'test',
          // A numeric `typ` is no valid header, which only a faulty signer issues.
          ...(typ ? { typ: typ as string } : {}),
        })
        .sign(privateKey)
    },
  }
}
