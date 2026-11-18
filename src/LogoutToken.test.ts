/**
 * Tests the verifier of `LogoutToken.create` with logout tokens that the test signs, and a `fetch`
 * that serves the key set of their key.
 * @module
 */
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from './Accounts.js'
import * as LogoutToken from './LogoutToken.js'

/** The origin of the issuer, which no test reaches. */
const url = 'https://id.test'

describe('create', () => {
  test('verify refuses a token whose `aud` names an app outside `clientIds`, also beside an allowed one', async () => {
    const keys = await issuer()
    const verifier = LogoutToken.create(
      Accounts.from({ clientId: 'client_allowed', fetch: keys.fetch, url }),
      { clientIds: ['client_allowed', 'client_second'] },
    )
    const audiences = [
      'client_allowed',
      ['client_second'],
      ['client_second', 'client_allowed'],
      'client_other',
      ['client_other', 'client_allowed'],
      ['client_allowed', 'client_other'],
    ]

    const results = await Promise.all(
      audiences.map(async (aud) =>
        verifier.verify({ logoutToken: await keys.sign(aud) }).then(
          (token) => token.clientId,
          (error: Error) => error.name,
        ),
      ),
    )

    expect(results).toMatchInlineSnapshot(`
      [
        "client_allowed",
        "client_second",
        "client_second",
        "LogoutToken.InvalidError",
        "LogoutToken.InvalidError",
        "LogoutToken.InvalidError",
      ]
    `)
  })
})

/** Returns a signer of logout tokens, and a `fetch` that serves its key set at Tempo ID's JWKS URL. */
async function issuer() {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'test' }
  return {
    fetch: (() =>
      Promise.resolve(
        Response.json({ keys: [jwk] }),
      )) as unknown as typeof globalThis.fetch,
    /** Signs a logout token for `aud`, which every other check of the verifier admits. */
    sign: (aud: string | string[]) =>
      new SignJWT({ events: { [LogoutToken.event]: {} }, sid: 'session_1' })
        .setProtectedHeader({ alg: 'RS256', kid: 'test', typ: 'logout+jwt' })
        .setAudience(aud)
        .setExpirationTime('2m')
        .setIssuedAt()
        .setIssuer(url)
        .setJti(crypto.randomUUID())
        .setSubject('user_1')
        .sign(privateKey),
  }
}
