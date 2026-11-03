/**
 * Verifies the access tokens that `apps/id` issues, as an API does with `AccessToken.create`.
 * @module
 */
import { AccessToken, Actions, Id } from 'accounts'
import * as Http from 'node:http'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'vite-plus/test'
import { Base64, Bytes } from 'ox'
import * as Admin from '../test/Admin.js'
import * as Client from '../test/Client.js'
import { Database, Env, Harness, Realm } from '../test/TempoId.js'

const admin = Admin.create()
const database = Database.connect()
const server = Harness.create()

/** The origin of each test's app. */
const appOrigin = 'https://app.example.com'

/** An origin where nothing listens, which refuses every connection. */
const unreachable = 'http://127.0.0.1:1'

beforeAll(async () => {
  await Promise.all([admin.listen(), server.listen()])
})

afterEach(async (context) => {
  if (context.task.result?.state === 'fail') {
    admin.debug()
    server.debug()
  }
  await Promise.all([admin.reset(), server.reset()])
})

afterAll(async () => {
  await Promise.all([admin.close(), database.end(), server.close()])
})

describe('create', () => {
  test("verifies an allowed app's access token, and returns its user and the user's Tempo Accounts", async () => {
    const client = await instance()
    const { account, authorization } = await signIn(client)
    const verifier = AccessToken.create(client.auth, {
      clientIds: [client.auth.clientId],
    })

    const token = await verifier.verify({
      accessToken: authorization.accessToken,
    })

    expect(token.accounts).toEqual([account.address])
    expect(token.clientId).toBe(client.auth.clientId)
    expect(token.userId).toBe(authorization.user.id)
    // The authorization counts `expires_in` from its own clock, and `exp` holds whole seconds.
    expect(Math.abs(token.expiresAt - authorization.expiresAt)).toBeLessThan(
      2_000,
    )
    expect(token.scope).toMatchInlineSnapshot(`
      [
        "openid",
        "email",
        "offline_access",
      ]
    `)
    expect(
      AccessToken.includes(token, {
        address: account.address.toLowerCase() as `0x${string}`,
      }),
    ).toBe(true)
    expect(
      AccessToken.includes(token, {
        address: '0x0000000000000000000000000000000000000001',
      }),
    ).toBe(false)
    expect(AccessToken.includes(token, { address: '0xnot-an-address' })).toBe(
      false,
    )
  })

  test("throws InvalidError for another app's token, whose audience is the same", async () => {
    const client = await instance()
    const { authorization } = await signIn(client)
    const verifier = AccessToken.create(client.auth, {
      clientIds: ['another-app'],
    })

    const error = await verifier
      .verify({ accessToken: authorization.accessToken })
      .catch((error: unknown) => error)

    expect(error).toBeInstanceOf(AccessToken.InvalidError)
    expect((error as Error).message).toMatchInlineSnapshot(
      `"Invalid access token: the token does not verify, has expired, or names an app that the API does not allow. Request a new access token."`,
    )
  })

  test("accepts only the instance's own app by default, without `clientIds`", async () => {
    const client = await instance()
    const other = await instance()
    const own = await signIn(client)
    const another = await signIn(other)
    const verifier = AccessToken.create(client.auth)

    const token = await verifier.verify({
      accessToken: own.authorization.accessToken,
    })
    const error = await verifier
      .verify({ accessToken: another.authorization.accessToken })
      .catch((error: unknown) => error)

    expect(token.clientId).toBe(client.auth.clientId)
    expect(error).toBeInstanceOf(AccessToken.InvalidError)
  })

  test('throws InvalidError for an ID token, whose `typ` is not at+jwt, and for a token whose signature does not verify', async () => {
    const client = await instance()
    const { authorization } = await signIn(client)
    const verifier = AccessToken.create(client.auth, {
      clientIds: [client.auth.clientId],
    })
    const [header, payload, signature = ''] =
      authorization.accessToken.split('.')
    // Another signature of the same length, so only the RS256 check refuses it.
    const forged = `${header}.${payload}.${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`

    const errors = await Promise.all(
      [authorization.idToken!, forged].map((accessToken) =>
        verifier.verify({ accessToken }).catch((error: unknown) => error),
      ),
    )

    expect(
      errors.map((error) => [
        error instanceof AccessToken.InvalidError,
        ((error as Error).cause as Error).name,
      ]),
    ).toMatchInlineSnapshot(`
      [
        [
          true,
          "JWTClaimValidationFailed",
        ],
        [
          true,
          "JWSSignatureVerificationFailed",
        ],
      ]
    `)
  })

  test('fetches the key set once for concurrent verifications, and keeps it for later ones', async () => {
    const client = await instance()
    const { authorization } = await signIn(client)
    const verifier = AccessToken.create(client.auth, {
      clientIds: [client.auth.clientId],
    })

    await Promise.all(
      [0, 1].map(() =>
        verifier.verify({ accessToken: authorization.accessToken }),
      ),
    )
    await verifier.verify({ accessToken: authorization.accessToken })

    expect(
      client.paths.filter((path) => path === 'GET /oauth2/jwks'),
    ).toHaveLength(1)
  })

  test("throws the key set's failed fetch as a RequestError, not InvalidError, and shares one fetch across concurrent verifications", async () => {
    const client = await instance()
    const { authorization } = await signIn(client)
    const issuer = outage(client)
    issuer.up = false
    const verifier = AccessToken.create(issuer.auth, {
      clientIds: [client.auth.clientId],
    })

    const errors = await Promise.all(
      [0, 1, 2].map(() =>
        verifier
          .verify({ accessToken: authorization.accessToken })
          .catch((error: unknown) => error),
      ),
    )
    const later = await verifier
      .verify({ accessToken: authorization.accessToken })
      .catch((error: unknown) => error)

    expect(
      [...errors, later].map((error) => [
        error instanceof Id.RequestError,
        error instanceof AccessToken.InvalidError,
        (error as Id.RequestError).status,
        (error as Id.RequestError).code,
      ]),
    ).toMatchInlineSnapshot(`
      [
        [
          true,
          false,
          0,
          "temporarily_unavailable",
        ],
        [
          true,
          false,
          0,
          "temporarily_unavailable",
        ],
        [
          true,
          false,
          0,
          "temporarily_unavailable",
        ],
        [
          true,
          false,
          0,
          "temporarily_unavailable",
        ],
      ]
    `)
    // The three concurrent verifications share one fetch. jose holds no cooldown after a failed
    // fetch, so the later one fetches again.
    expect(issuer.requests).toBe(2)
  })

  test('fetches the key set again once it is older than `maxAge`, and fails closed when that fetch fails', async () => {
    const client = await instance()
    const { authorization } = await signIn(client)
    const issuer = outage(client)
    const verifier = AccessToken.create(issuer.auth, {
      clientIds: [client.auth.clientId],
      maxAge: 0,
    })

    const first = await verifier.verify({
      accessToken: authorization.accessToken,
    })
    issuer.up = false
    const error = await verifier
      .verify({ accessToken: authorization.accessToken })
      .catch((error: unknown) => error)

    expect(first.clientId).toBe(client.auth.clientId)
    expect(error).toBeInstanceOf(Id.RequestError)
    expect(issuer.requests).toBe(2)
  })

  test(
    'joins a fetch in flight for a token that names an unknown key after the cooldown, and throws its failure as a RequestError',
    { timeout: 60_000 },
    async () => {
      const client = await instance()
      const { authorization } = await signIn(client)
      const issuer = outage(client)
      const verifier = AccessToken.create(issuer.auth, {
        clientIds: [client.auth.clientId],
      })
      // The token's header names a key that the issuer's set lacks, as after a rotation.
      const [header = '', ...rest] = authorization.accessToken.split('.')
      const rotated = [
        Base64.fromString(
          JSON.stringify({
            ...JSON.parse(Bytes.toString(Base64.toBytes(header))),
            kid: 'rotated',
          }),
          { pad: false, url: true },
        ),
        ...rest,
      ].join('.')
      const verify = () =>
        verifier
          .verify({ accessToken: rotated })
          .catch((error: unknown) => error)

      await verifier.verify({ accessToken: authorization.accessToken })
      const unknown = await verify()
      // An unknown key fetches the set again only after the cooldown, which no fake clock shortens.
      await new Promise((resolve) => setTimeout(resolve, 30_000))
      issuer.up = false
      const concurrent = await Promise.all([verify(), verify()])
      const later = await verify()

      expect(unknown).toBeInstanceOf(AccessToken.InvalidError)
      expect(
        [...concurrent, later].map((error) => [
          error instanceof Id.RequestError,
          (error as Id.RequestError).status,
        ]),
      ).toMatchInlineSnapshot(`
      [
        [
          true,
          0,
        ],
        [
          true,
          0,
        ],
        [
          true,
          0,
        ],
      ]
    `)
      // The first fetch, then one that the two concurrent verifications share, then the later one's.
      expect(issuer.requests).toBe(3)
    },
  )

  test('throws a RequestError with status 0 once a stalled fetch of the key set exceeds `timeout`', async () => {
    const client = await instance()
    const { authorization } = await signIn(client)
    // A server that accepts each request and never responds, as a stalled issuer does.
    const stalled = Http.createServer(() => {})
    await new Promise<void>((resolve) =>
      stalled.listen(0, '127.0.0.1', resolve),
    )
    const { port } = stalled.address() as { port: number }

    const error = await AccessToken.create(
      { ...client.auth, fetch, url: `http://127.0.0.1:${port}` },
      { clientIds: [client.auth.clientId], issuer: Env.origin, timeout: 200 },
    )
      .verify({ accessToken: authorization.accessToken })
      .catch((error: unknown) => error)
    stalled.closeAllConnections()
    await new Promise((resolve) => stalled.close(resolve))

    expect([
      error instanceof Id.RequestError,
      (error as Id.RequestError).status,
      ((error as Id.RequestError).cause as Error).name,
    ]).toMatchInlineSnapshot(`
      [
        true,
        0,
        "JWKSTimeout",
      ]
    `)
  })

  test("throws a RequestError with status 0 for a key set whose key for the token's `kid` does not import", async () => {
    const client = await instance()
    const { authorization } = await signIn(client)
    const { kid } = JSON.parse(
      Bytes.toString(Base64.toBytes(authorization.accessToken.split('.')[0]!)),
    ) as { kid: string }
    // An issuer that serves a well-formed set whose RSA key has no valid modulus.
    const broken = Http.createServer((_, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          keys: [{ alg: 'RS256', e: 'AQAB', kid, kty: 'RSA', n: 'AA' }],
        }),
      )
    })
    await new Promise<void>((resolve) => broken.listen(0, '127.0.0.1', resolve))
    const { port } = broken.address() as { port: number }

    const error = await AccessToken.create(
      { ...client.auth, fetch, url: `http://127.0.0.1:${port}` },
      { clientIds: [client.auth.clientId], issuer: Env.origin },
    )
      .verify({ accessToken: authorization.accessToken })
      .catch((error: unknown) => error)
    broken.closeAllConnections()
    await new Promise((resolve) => broken.close(resolve))

    expect([
      error instanceof Id.RequestError,
      error instanceof AccessToken.InvalidError,
      (error as Id.RequestError).status,
      (error as Id.RequestError).code,
    ]).toMatchInlineSnapshot(`
      [
        true,
        false,
        0,
        "temporarily_unavailable",
      ]
    `)
  })

  test('verifies a token through an instance at another address with `issuer`, and refuses it without', async () => {
    const client = await instance()
    const { authorization } = await signIn(client)
    // The client's fetch reaches the harness at any host, as an internal address reaches Tempo ID.
    const internal = { ...client.auth, url: 'http://id.internal' }

    const token = await AccessToken.create(internal, {
      clientIds: [client.auth.clientId],
      issuer: `${Env.origin}/`,
    }).verify({ accessToken: authorization.accessToken })
    const error = await AccessToken.create(internal, {
      clientIds: [client.auth.clientId],
    })
      .verify({ accessToken: authorization.accessToken })
      .catch((error: unknown) => error)

    expect(token.clientId).toBe(client.auth.clientId)
    expect(error).toBeInstanceOf(AccessToken.InvalidError)
  })
})

/**
 * Returns the instance of `client` whose key set requests reach the harness while `up` is `true`,
 * and a port where nothing listens while it is `false`, and the number of key set requests.
 */
function outage(client: ReturnType<typeof Client.create>) {
  const state = {
    auth: {
      ...client.auth,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input)
        if (url.pathname !== '/oauth2/jwks') return client.fetch(input, init)
        state.requests++
        if (state.up) return client.fetch(input, init)
        return fetch(new URL(url.pathname, unreachable), init)
      }) as typeof globalThis.fetch,
    },
    requests: 0,
    up: true,
  }
  return state
}

/**
 * Registers a public app whose realm's secp256k1 owners the harness holds, and returns an instance.
 */
async function instance() {
  const realmId = `cash-${crypto.randomUUID().replaceAll('-', '')}`
  await Admin.addRealm(admin, { id: realmId, name: 'Tempo Cash' })
  // The Admin API configures no secp256k1 owners.
  await Realm.setSecp256k1(database.db, { enabled: true, realmId })
  const { app } = await Admin.createApp(admin, {
    name: 'Example',
    redirectUris: [`${appOrigin}/callback`],
  })
  await Admin.setAppRealms(admin, { clientId: app.clientId, realms: [realmId] })
  return Client.create(server, { clientId: app.clientId, origin: appOrigin })
}

/**
 * Signs a new address in without an access key, creates its first Tempo Account, and returns the account and
 * an authorization whose access token lists it.
 */
async function signIn(client: ReturnType<typeof Client.create>) {
  const email = `tempo-id-test+${crypto.randomUUID()}@example.org`
  await Actions.email.sendCode(client.auth, { email })
  await Actions.email.signIn(client.auth, {
    code: await Harness.code(server, { email }),
    email,
  })
  const account = await Actions.account.get(client.auth)
  if (!account) throw new Error('The sign-in created no Tempo Account.')
  // The sign-in's token predates the account, so a new one lists it.
  const authorization = await Actions.authorize(client.auth)
  if (!authorization) throw new Error('The session ended after the sign-in.')
  return { account, authorization }
}
