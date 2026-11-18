/**
 * Runs the `tokens` plugin without a server, on access tokens and ID tokens that the test signs.
 * The issuer's key set comes through the instance's `fetch`.
 * @module
 */
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { Address, Secp256k1 } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { custom, hashMessage } from 'viem'
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as Dpop from '../internal/Dpop.js'
import { tokens } from './tokens.js'
import { viem } from './viem.js'

/** The origin of the issuer, which no test reaches. */
const url = 'https://id.test'

/** The address of the user's Tempo Account in the tokens of the tests, checksummed. */
const account = '0x5e8BD1f1f8b6A3c1E9d4b2a7c3f0E1D2c3B4a5f6'

/** An address that the compliance claim of a test names in two letter cases. */
const other = '0x1111111111111111111111111111111111111abc'

describe('tokens', () => {
  test('verifyAccessToken returns the claims of a valid Bearer token, with its valid compliance entries by checksummed address', async () => {
    const keys = await issuer()
    const accounts = instance(keys)
    const token = await keys.sign({
      compliance: {
        [account.toLowerCase()]: 'exit_only',
        '0x01': 'clear',
        '0x000000000000000000000000000000000000dEaD': 'flagged',
        [`0x${other.slice(2).toLowerCase()}`]: 'blocked',
        [`0x${other.slice(2).toUpperCase()}`]: 'clear',
      },
    })

    const verified = await accounts.tokens.verifyAccessToken(
      request({ authorization: `Bearer ${token}` }),
    )

    expect(verified).toMatchInlineSnapshot(
      {
        expiresAt: expect.any(Number),
        issuedAt: expect.any(Number),
      },
      `
      {
        "accessKeys": [],
        "accounts": [
          "0x5e8BD1f1f8b6A3c1E9d4b2a7c3f0E1D2c3B4a5f6",
        ],
        "apiAccessKeys": [],
        "boundTo": undefined,
        "clientId": "https://app.example",
        "compliance": {
          "0x5e8BD1f1f8b6A3c1E9d4b2a7c3f0E1D2c3B4a5f6": "exit_only",
        },
        "expiresAt": Any<Number>,
        "issuedAt": Any<Number>,
        "proof": undefined,
        "scope": [],
        "userId": "user_1",
      }
    `,
    )
  })

  test('verifyAccessToken returns `undefined` for a request without a valid access token of the app in a Bearer or DPoP header', async () => {
    const keys = await issuer()
    const accounts = instance(keys)
    const token = await keys.sign()
    const other = await keys.sign({ clientId: 'https://other.example' })
    const headers = {
      'another app': { authorization: `Bearer ${other}` },
      'another scheme': { authorization: `Basic ${token}` },
      'Bearer token with the DPoP scheme': { authorization: `DPoP ${token}` },
      'no header': {},
    }

    const results = await Promise.all(
      Object.entries(headers).map(async ([name, entry]) => [
        name,
        await accounts.tokens.verifyAccessToken(request(entry)),
      ]),
    )

    expect(Object.fromEntries(results)).toMatchInlineSnapshot(`
      {
        "Bearer token with the DPoP scheme": undefined,
        "another app": undefined,
        "another scheme": undefined,
        "no header": undefined,
      }
    `)
  })

  test('verifyAccessToken checks a DPoP proof against `url`, behind a proxy that terminates TLS', async () => {
    const keys = await issuer()
    const dpop = await Dpop.create()
    const token = await keys.sign({ jkt: Dpop.thumbprint(dpop) })
    const proof = await Dpop.proof(dpop, {
      accessToken: token,
      method: 'GET',
      url: 'https://api.example/me',
    })
    const internal = (path: string) =>
      request(
        { authorization: `DPoP ${token}`, dpop: proof },
        { url: `http://10.0.0.1${path}` },
      )
    const without = instance(keys)
    const behind = instance(keys, { url: 'https://api.example' })

    const elsewhere = await Dpop.proof(dpop, {
      accessToken: token,
      method: 'GET',
      url: 'https://evil.example/me',
    })

    const refused = await without.tokens.verifyAccessToken(internal('/me'))
    const accepted = await behind.tokens.verifyAccessToken(internal('/me'))
    const otherRoute = await behind.tokens.verifyAccessToken(internal('/admin'))
    const otherOrigin = await behind.tokens.verifyAccessToken(
      request(
        { authorization: `DPoP ${token}`, dpop: elsewhere },
        { url: 'http://10.0.0.1//evil.example/me' },
      ),
    )

    expect(refused).toMatchInlineSnapshot(`undefined`)
    expect(accepted?.boundTo === Dpop.thumbprint(dpop)).toMatchInlineSnapshot(
      `true`,
    )
    expect(otherRoute).toMatchInlineSnapshot(`undefined`)
    expect(otherOrigin).toMatchInlineSnapshot(`undefined`)
  })

  test('verifyAccessToken throws `Accounts.RequestError` with status 0 when the key set cannot be fetched', async () => {
    const keys = await issuer()
    const accounts = instance({
      fetch: (() =>
        Promise.resolve(
          new Response(null, { status: 503 }),
        )) as unknown as typeof globalThis.fetch,
    })

    const error = await accounts.tokens
      .verifyAccessToken(
        request({ authorization: `Bearer ${await keys.sign()}` }),
      )
      .catch((error: Accounts.RequestError) => error)

    expect(
      error instanceof Accounts.RequestError && {
        code: error.code,
        status: error.status,
      },
    ).toMatchInlineSnapshot(`
      {
        "code": "temporarily_unavailable",
        "status": 0,
      }
    `)
  })

  test('userInfo throws `Accounts.RequestError` with the reason `invalid_token` for an access token that Tempo ID refuses', async () => {
    const requested: string[] = []
    const accounts = instance({
      fetch: ((input: URL) => {
        requested.push(String(input))
        return Promise.resolve(
          Response.json({ error: 'unauthorized' }, { status: 401 }),
        )
      }) as unknown as typeof globalThis.fetch,
    })

    const error = await accounts.tokens
      .userInfo({ accessToken: 'invalid' })
      .catch((error: Accounts.RequestError) => error)

    expect(requested).toMatchInlineSnapshot(`
      [
        "https://id.test/oauth2/userinfo",
      ]
    `)
    expect(
      error instanceof Accounts.RequestError && {
        reason: error.reason,
        status: error.status,
      },
    ).toMatchInlineSnapshot(`
      {
        "reason": "invalid_token",
        "status": 401,
      }
    `)
  })

  test('userInfo sends the access token of a token that verifyAccessToken returned, and refuses a copy of it', async () => {
    const keys = await issuer()
    const authorizations: (string | null)[] = []
    const accounts = instance({
      fetch: ((input: URL, init?: RequestInit) => {
        if (!String(input).endsWith('/oauth2/userinfo'))
          return keys.fetch(input)
        authorizations.push(new Headers(init?.headers).get('authorization'))
        return Promise.resolve(
          Response.json({ email: 'user@example.com', sub: 'user_1' }),
        )
      }) as unknown as typeof globalThis.fetch,
    })
    const accessToken = await keys.sign()
    const token = await accounts.tokens.verifyAccessToken(
      request({ authorization: `Bearer ${accessToken}` }),
    )

    const user = await accounts.tokens.userInfo({ accessToken: token! })
    const error = await accounts.tokens
      .userInfo({ accessToken: { ...token! } })
      .catch((error: Error) => error)

    expect(user).toMatchInlineSnapshot(`
      {
        "email": "user@example.com",
        "id": "user_1",
      }
    `)
    expect(authorizations).toEqual([`Bearer ${accessToken}`])
    expect((error as Error).message).toMatchInlineSnapshot(
      `"Invalid access token: \`tokens.verifyAccessToken\` of this instance did not return it. Pass its result, or the access token itself."`,
    )
  })

  test("verifyIdToken returns the claims of the app's ID token, and `undefined` for another app's, also with `clientIds: 'any'`", async () => {
    const keys = await issuer()
    const own = instance(keys)
    const any = instance(keys, {
      audience: 'https://api.example',
      clientIds: 'any',
    })
    const token = await keys.signIdToken()
    const other = await keys.signIdToken({ clientId: 'https://other.example' })

    const results = {
      'another app': await own.tokens.verifyIdToken({ idToken: other }),
      'another app, any': await any.tokens.verifyIdToken({ idToken: other }),
      'the app, any': (await any.tokens.verifyIdToken({ idToken: token }))
        ?.clientId,
      'the app': (await own.tokens.verifyIdToken({ idToken: token }))?.userId,
    }

    expect(results).toMatchInlineSnapshot(`
      {
        "another app": undefined,
        "another app, any": undefined,
        "the app": "user_1",
        "the app, any": "https://app.example",
      }
    `)
  })

  test("verifyChallenge throws `Challenge.InvalidError` for a malformed proof before any request of the instance's viem plugin", async () => {
    const keys = await issuer()
    const methods: string[] = []
    const accounts = Accounts.create({
      chain: 'testnet',
      clientId: 'https://app.example',
      fetch: keys.fetch,
      plugins: [
        tokens(),
        viem({
          transport: custom({
            request: (args: { method: string }) => {
              methods.push(args.method)
              return Promise.resolve(undefined)
            },
          }),
        }),
      ],
      url,
    })
    const token = await accounts.tokens.verifyAccessToken(
      request({ authorization: `Bearer ${await keys.sign()}` }),
    )

    const error = await accounts.tokens
      .verifyChallenge({
        accessToken: token!,
        challenge: 'app.example asks for proof of this sign-in.',
        keyAuthorization: {} as KeyAuthorization.Rpc,
      })
      .catch((error: Error) => error)

    expect((error as Error).name).toMatchInlineSnapshot(
      `"Challenge.InvalidError"`,
    )
    expect(methods).toMatchInlineSnapshot(`[]`)
  })

  test('verifyChallenge checks the chain that `switchChain` selects after an earlier call', async () => {
    const keys = await issuer()
    const accounts = Accounts.create({
      chain: 'testnet',
      clientId: 'https://app.example',
      fetch: keys.fetch,
      plugins: [tokens(), viem()],
      url,
    })
    const challenge = 'app.example asks for proof of this sign-in.'
    const privateKey = Secp256k1.randomPrivateKey()
    const authorization = KeyAuthorization.from({
      address: Address.fromPublicKey(Secp256k1.getPublicKey({ privateKey })),
      chainId: 4217n,
      type: 'secp256k1',
      witness: hashMessage(challenge),
    })
    const keyAuthorization = KeyAuthorization.toRpc(
      KeyAuthorization.from(authorization, {
        signature: Secp256k1.sign({
          payload: KeyAuthorization.getSignPayload(authorization),
          privateKey: Secp256k1.randomPrivateKey(),
        }),
      }),
    )
    const verify = () =>
      accounts.tokens
        .verifyChallenge({
          accessToken: { accessKeys: [] },
          challenge,
          keyAuthorization,
        })
        .catch((error: Error) => error.message)

    const before = await verify()
    await accounts.switchChain({ chainId: 4217 })
    const after = await verify()

    expect({ after, before }).toMatchInlineSnapshot(`
      {
        "after": "Invalid challenge proof: the app's access token does not name the access key. Sign in again with a new challenge.",
        "before": "Invalid challenge proof: the access key acts on chain 4217, not 42431. Sign in again with a new challenge.",
      }
    `)
  })

  test("verifyChallenge rejects with `clientIds: 'any'`, which accepts every app's token", async () => {
    const keys = await issuer()
    const accounts = instance(keys, {
      audience: 'https://api.example',
      clientIds: 'any',
    })

    const result = accounts.tokens.verifyChallenge({
      accessToken: { accessKeys: [] },
      challenge: 'app.example asks for proof of this sign-in.',
      keyAuthorization: {} as KeyAuthorization.Rpc,
    })

    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: Invalid \`clientIds\`: \`'any'\` accepts every app's token, which proves no challenge for this app. Name the server's own client IDs.]`,
    )
  })
})

/** Returns an instance of the app `https://app.example` with the plugin, on the key set of `keys`. */
function instance(
  keys: { fetch: typeof globalThis.fetch },
  options: tokens.Options = {},
) {
  return Accounts.create({
    chain: 'testnet',
    clientId: 'https://app.example',
    fetch: keys.fetch,
    plugins: [tokens(options)],
    url,
  })
}

/** Returns a signer of access tokens, and a `fetch` that serves its key set at Tempo ID's JWKS URL. */
async function issuer() {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'test' }
  return {
    fetch: (() =>
      Promise.resolve(
        Response.json({ keys: [jwk] }),
      )) as unknown as typeof globalThis.fetch,
    /** Signs an access token of the app, for the user's Tempo Account, which every check admits. */
    sign: (
      options: {
        clientId?: string | undefined
        compliance?: Record<string, string> | undefined
        jkt?: string | undefined
      } = {},
    ) =>
      new SignJWT({
        client_id: options.clientId ?? 'https://app.example',
        ...(options.compliance ? { compliance: options.compliance } : {}),
        ...(options.jkt ? { cnf: { jkt: options.jkt } } : {}),
        tempo_accounts: [account],
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'test', typ: 'at+jwt' })
        .setAudience(url)
        .setExpirationTime('5m')
        .setIssuedAt()
        .setIssuer(url)
        .setSubject('user_1')
        .sign(privateKey),
    /** Signs an ID token of the app, as Tempo ID signs one at a sign-in, without `typ`. */
    signIdToken: (options: { clientId?: string | undefined } = {}) =>
      new SignJWT({ email: 'user@example.com', email_verified: true })
        .setProtectedHeader({ alg: 'RS256', kid: 'test' })
        .setAudience(options.clientId ?? 'https://app.example')
        .setExpirationTime('5m')
        .setIssuedAt()
        .setIssuer(url)
        .setSubject('user_1')
        .sign(privateKey),
  }
}

/** Returns a `GET` request of the API with `headers`, at `https://api.example/me` by default. */
function request(
  headers: Record<string, string>,
  options: { url?: string | undefined } = {},
) {
  return new Request(options.url ?? 'https://api.example/me', { headers })
}
