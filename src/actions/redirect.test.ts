/**
 * Runs the redirect sign-in against `apps/id`. A realm's secp256k1 owners, which the harness holds,
 * sign access keys on approval.
 * @module
 */
import { Actions, Id } from 'accounts'
import { Funding } from 'accounts/internal'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'vite-plus/test'
import { Address, Base64, Bytes, Hash, Hex } from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { Account, Expiry, Scopes } from 'viem/tempo'
import { tempo } from 'viem/tempo/chains'
import { ousd } from 'viem/tokens'
import * as Admin from '../../test/Admin.js'
import {
  Database,
  Env,
  Harness,
  Realm,
  Schema,
  Sql,
} from '../../test/TempoId.js'

const admin = Admin.create()
const database = Database.connect()
const server = Harness.create()

/** The redirect URI of the app that each test registers. */
const redirectUri = 'https://app.example.com/callback'

/** OUSD, which has its mainnet address on every Tempo chain. */
const ousdAddress = ousd(tempo.id).address

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

describe('createUrl', () => {
  test('sends a sign-in that requests a key to the approval page, even for an app that skips consent', async () => {
    const cookie = await signIn({
      email: `tempo-id-test+${crypto.randomUUID()}@example.org`,
    })
    const auth = await instance()

    const { url } = await Actions.redirect.createUrl(auth, {
      accessKey: permissions(),
    })
    const response = await server.fetch(
      `/oauth2/authorize${new URL(url).search}`,
      { headers: { cookie }, redirect: 'manual' },
    )
    const location = new URL(
      response.headers.get('location') ??
        ((await response.json()) as { url: string }).url,
      Env.origin,
    )

    expect(location.pathname).toMatchInlineSnapshot(`"/authorize"`)
    expect(location.searchParams.get('prompt')).toMatchInlineSnapshot(
      `"consent"`,
    )
  })

  test('sends a signed-out browser to the sign-in page in one redirect', async () => {
    const auth = await instance()

    const { url } = await Actions.redirect.createUrl(auth)
    const response = await server.fetch(
      `${new URL(url).pathname}${new URL(url).search}`,
      { redirect: 'manual' },
    )
    // A request that is not a navigation receives the redirect as JSON.
    const location = new URL(
      ((await response.json()) as { url: string }).url,
      Env.origin,
    )

    expect(location.pathname).toMatchInlineSnapshot(`"/login"`)
    expect(location.searchParams.has('sig')).toMatchInlineSnapshot(`true`)
  })

  test('sends funding as the funding parameters, which the sign-in page carries', async () => {
    const auth = await instance()

    const { url } = await Actions.redirect.createUrl(auth, {
      funding: Funding.from({
        amount: '10',
        currency: 'USD',
        token: 'pathUSD',
      }),
    })
    const response = await server.fetch(
      `${new URL(url).pathname}${new URL(url).search}`,
      { redirect: 'manual' },
    )
    const location = new URL(
      ((await response.json()) as { url: string }).url,
      Env.origin,
    )
    const funding = (search: URLSearchParams) =>
      Object.fromEntries(
        [...search].filter((entry) => entry[0].startsWith('funding_')),
      )

    expect(funding(new URL(url).searchParams)).toMatchInlineSnapshot(`
      {
        "funding_currency": "USD",
        "funding_hint": "10",
        "funding_token": "pathUSD",
      }
    `)
    expect(location.pathname).toMatchInlineSnapshot(`"/login"`)
    expect(funding(location.searchParams)).toEqual(
      funding(new URL(url).searchParams),
    )
  })

  test('builds the sign-in URL with the PKCE challenge, the state, the redirect URI, the client ID, and a key authorization request for the pending key', async () => {
    const auth = await instance()
    const expected = permissions()

    const { pending, url } = await Actions.redirect.createUrl(auth, {
      accessKey: expected,
    })
    const params = new URL(url).searchParams
    const requested = JSON.parse(
      Bytes.toString(Base64.toBytes(params.get('key_authorization')!)),
    ) as {
      address: Address.Address
      chainId: Hex.Hex
      expiry: number
      keyType: string
      limits: unknown
      scopes: unknown
    }

    expect(new URL(url).origin).toBe(Env.origin)
    expect(new URL(url).pathname).toMatchInlineSnapshot(`"/oauth2/authorize"`)
    expect([...params.keys()].sort()).toMatchInlineSnapshot(`
      [
        "client_id",
        "code_challenge",
        "code_challenge_method",
        "key_authorization",
        "redirect_uri",
        "response_type",
        "scope",
        "state",
      ]
    `)
    expect(params.get('client_id')).toBe(auth.clientId)
    // RFC 7636 defines the S256 challenge as the unpadded URL-safe Base64 of the verifier's SHA-256.
    expect(params.get('code_challenge')).toBe(
      Base64.fromBytes(Hash.sha256(Bytes.fromString(pending.verifier)), {
        pad: false,
        url: true,
      }),
    )
    expect(params.get('redirect_uri')).toBe(pending.redirectUri)
    expect(params.get('state')).toBe(pending.state)
    expect(
      Address.isEqual(
        requested.address,
        Account.fromSecp256k1(pending.privateKey!).address,
      ),
    ).toBe(true)
    expect([requested.chainId, requested.keyType]).toEqual([
      Hex.fromNumber(tempo.id),
      'secp256k1',
    ])
    // The request carries the access key as given, which Tempo ID fills none of.
    expect(requested.expiry).toBe(expected.expiry)
    expect([requested.limits, requested.scopes]).toMatchInlineSnapshot(`
      [
        [
          {
            "limit": "0x3b9aca00",
            "token": "0x20c0000000000000000000006a37DA5C996874BE",
          },
        ],
        [
          {
            "address": "0x20c0000000000000000000006a37DA5C996874BE",
            "selector": "0xa9059cbb",
          },
          {
            "address": "0x20c0000000000000000000006a37DA5C996874BE",
            "selector": "0x95777d59",
          },
        ],
      ]
    `)
  })

  test('carries the challenge that the key authorization binds', async () => {
    const auth = await instance()

    const { url } = await Actions.redirect.createUrl(auth, {
      challenge: 'Sign in to Example',
      accessKey: permissions(),
    })

    expect(new URL(url).searchParams.get('challenge')).toMatchInlineSnapshot(
      `"Sign in to Example"`,
    )
  })
})

describe('handleCallback', () => {
  test('returns the tokens and the user without a key for a sign-in that requested none', async () => {
    const email = `tempo-id-test+${crypto.randomUUID()}@example.org`
    const cookie = await signIn({ email })
    const auth = await instance()

    const { pending, url } = await Actions.redirect.createUrl(auth)
    const callback = await follow({ cookie, url })
    const result = await Actions.redirect.handleCallback(auth, {
      pending,
      url: callback,
    })

    expect(new URL(url).searchParams.has('key_authorization')).toBe(false)
    expect(pending.key).toBe(false)
    expect('key' in result).toBe(false)
    expect('accessKey' in result).toBe(false)
    expect(result.user.email).toBe(email)
    expect(result.accessToken).toMatch(/^ey/)
  })

  test('refuses a token response without a key authorization for a sign-in that requested a key', async () => {
    const email = `tempo-id-test+${crypto.randomUUID()}@example.org`
    const cookie = await signIn({ email })
    const auth = await instance()

    const { pending, url } = await Actions.redirect.createUrl(auth, {
      accessKey: permissions(),
    })
    // A request without its access key skips the approval page, so its code redeems for tokens alone.
    const stripped = new URL(url)
    stripped.searchParams.delete('key_authorization')
    const callback = await follow({ cookie, url: stripped.href })
    const error = await Actions.redirect
      .handleCallback(auth, { pending, url: callback })
      .catch((error: unknown) => error)

    expect(new URL(url).searchParams.has('key_authorization')).toBe(true)
    expect(error).toBeInstanceOf(Id.RequestError)
    expect((error as Id.RequestError).code).toMatchInlineSnapshot(
      `"invalid_grant"`,
    )
    expect((error as Id.RequestError).signedIn).toBe(true)
  })

  test('rejects a callback with a forged state or without a code with 400 and the field at fault', async () => {
    const auth = await instance()
    const { pending } = await Actions.redirect.createUrl(auth)

    const errors = await Promise.all([
      Actions.redirect
        .handleCallback(auth, {
          pending,
          url: `${redirectUri}?code=abc&state=forged`,
        })
        .catch((error: unknown) => error),
      Actions.redirect
        .handleCallback(auth, {
          pending,
          url: `${redirectUri}?state=${pending.state}`,
        })
        .catch((error: unknown) => error),
    ])

    expect(
      errors.map((error) => [
        (error as Id.RequestError).status,
        (error as Id.RequestError).code,
        (error as Id.RequestError).field,
      ]),
    ).toMatchInlineSnapshot(`
      [
        [
          400,
          "invalid_request",
          "state",
        ],
        [
          400,
          "invalid_request",
          "code",
        ],
      ]
    `)
  })

  test('marks a refused code exchange after the pending state as signed in, and a forged state as not', async () => {
    const auth = await instance()
    const { pending } = await Actions.redirect.createUrl(auth)

    const errors = await Promise.all([
      Actions.redirect
        .handleCallback(auth, {
          pending,
          url: `${redirectUri}?code=unknown&state=${pending.state}`,
        })
        .catch((error: unknown) => error),
      Actions.redirect
        .handleCallback(auth, {
          pending,
          url: `${redirectUri}?code=unknown&state=forged`,
        })
        .catch((error: unknown) => error),
    ])

    expect(
      errors.map((error) => [
        (error as Id.RequestError).code,
        (error as Id.RequestError).signedIn,
      ]),
    ).toMatchInlineSnapshot(`
      [
        [
          "invalid_grant",
          true,
        ],
        [
          "invalid_request",
          false,
        ],
      ]
    `)
  })

  test("rejects an issuer error with a forged state as a state mismatch, and returns the issuer's refusal only with the pending state", async () => {
    const auth = await instance()
    const { pending } = await Actions.redirect.createUrl(auth)
    const query = 'error=access_denied&error_description=Forged'

    const [forged, denied] = await Promise.all([
      Actions.redirect
        .handleCallback(auth, {
          pending,
          url: `${redirectUri}?${query}&state=forged`,
        })
        .catch((error: unknown) => error),
      Actions.redirect
        .handleCallback(auth, {
          pending,
          url: `${redirectUri}?${query}&state=${pending.state}`,
        })
        .catch((error: unknown) => error),
    ])

    expect([
      (forged as Id.RequestError).code,
      (forged as Id.RequestError).field,
      (forged as Id.RequestError).message,
    ]).toMatchInlineSnapshot(`
      [
        "invalid_request",
        "state",
        "Invalid \`state\` in the callback URL. Start sign-in again from this app.",
      ]
    `)
    expect([
      (denied as Id.RequestError).code,
      (denied as Id.RequestError).field,
      (denied as Id.RequestError).message,
    ]).toMatchInlineSnapshot(`
      [
        "access_denied",
        "code",
        "Forged",
      ]
    `)
  })

  test('returns the key and a refresh token to a confidential app, which redeems the code with its client secret', async () => {
    const realmId = await realm()
    const created = await Admin.createApp(admin, {
      name: 'Backend',
      redirectUris: [redirectUri],
      secret: true,
    })
    await Admin.setAppRealms(admin, {
      clientId: created.app.clientId,
      realms: [realmId],
    })
    const { account, cookie, session } = await signable({
      clientId: created.app.clientId,
    })
    const auth = await instance({
      clientId: created.app.clientId,
      clientSecret: created.clientSecret!,
    })

    const { pending, url } = await Actions.redirect.createUrl(auth, {
      accessKey: permissions(),
    })
    const location = await approval({ cookie, url })
    const approved = await server.fetch('/v1/authorize/consent', {
      body: JSON.stringify({
        accept: true,
        account,
        oauth_query: location.search.slice(1),
        session_id: session,
      }),
      headers: { 'content-type': 'application/json', cookie },
      method: 'POST',
    })
    const { redirect } = (await approved.json()) as { redirect: string }
    const result = await Actions.redirect.handleCallback(auth, {
      pending,
      url: redirect,
    })
    const signed = KeyAuthorization.fromRpc(result.key.keyAuthorization)
    const owner = SignatureEnvelope.extractAddress({
      payload: KeyAuthorization.getSignPayload(signed),
      signature: signed.signature,
    })

    expect(approved.status).toMatchInlineSnapshot(`200`)
    expect(Address.isEqual(result.key.account, account)).toBe(true)
    expect(Address.isEqual(owner, account)).toBe(true)
    expect(result.key.privateKey).toBe(pending.privateKey)
    expect(result.refreshToken).toBeTypeOf('string')
  })
})

describe('handleCallback with a registered query', () => {
  test('returns the authorization for a registered redirect URI that holds its own error parameter', async () => {
    const email = `tempo-id-test+${crypto.randomUUID()}@example.org`
    const cookie = await signIn({ email })
    const auth = await instance({
      redirectUri: 'https://app.example.com/callback?error=none',
    })

    const { pending, url } = await Actions.redirect.createUrl(auth)
    const callback = await follow({ cookie, url })
    const result = await Actions.redirect.handleCallback(auth, {
      pending,
      url: callback,
    })

    expect(new URL(callback).searchParams.getAll('error'))
      .toMatchInlineSnapshot(`
      [
        "none",
      ]
    `)
    expect(result.user.email).toBe(email)
  })

  test('redeems the code of the response for a registered redirect URI that holds its own state and code', async () => {
    const email = `tempo-id-test+${crypto.randomUUID()}@example.org`
    const cookie = await signIn({ email })
    const auth = await instance({
      redirectUri:
        'https://app.example.com/callback?code=registered&state=registered',
    })

    const { pending, url } = await Actions.redirect.createUrl(auth)
    const callback = await follow({ cookie, url })
    const result = await Actions.redirect.handleCallback(auth, {
      pending,
      url: callback,
    })

    // The issuer replaces the registered `code` and `state` with its own.
    expect(new URL(callback).searchParams.getAll('state')).toEqual([
      pending.state,
    ])
    expect(result.user.email).toBe(email)
  })

  test("throws the issuer's refusal for a registered redirect URI that holds its own state", async () => {
    const cookie = await signIn({
      email: `tempo-id-test+${crypto.randomUUID()}@example.org`,
    })
    const auth = await instance({
      redirectUri: 'https://app.example.com/callback?state=registered',
    })

    const { pending, url } = await Actions.redirect.createUrl(auth, {
      // The app lacks the `tempo-id:sign` scope, so `/oauth2/authorize` refuses the challenge.
      challenge: 'Sign in to Example',
      accessKey: permissions(),
    })
    const callback = await follow({ cookie, url })
    const error = await Actions.redirect
      .handleCallback(auth, { pending, url: callback })
      .catch((error: unknown) => error)

    // A refusal appends the response's `state` after the registered one.
    expect(new URL(callback).searchParams.getAll('state')).toEqual([
      'registered',
      pending.state,
    ])
    expect((error as Id.RequestError).code).toMatchInlineSnapshot(
      `"unauthorized_client"`,
    )
  })

  test('throws the refusal of a key that returns to a registered redirect URI with its own error', async () => {
    const cookie = await signIn({
      email: `tempo-id-test+${crypto.randomUUID()}@example.org`,
    })
    const auth = await instance({
      redirectUri: 'https://app.example.com/callback?error=none',
    })

    const { pending, url } = await Actions.redirect.createUrl(auth, {
      // The app lacks the `tempo-id:sign` scope, so `/oauth2/authorize` refuses the challenge.
      challenge: 'Sign in to Example',
      accessKey: permissions(),
    })
    const callback = await follow({ cookie, url })
    const error = await Actions.redirect
      .handleCallback(auth, { pending, url: callback })
      .catch((error: unknown) => error)

    expect(new URL(callback).searchParams.getAll('error'))
      .toMatchInlineSnapshot(`
        [
          "none",
          "unauthorized_client",
        ]
      `)
    expect((error as Id.RequestError).code).toMatchInlineSnapshot(
      `"unauthorized_client"`,
    )
  })
})

describe('createUrl', () => {
  test('refuses a challenge for a sign-in without a key', async () => {
    const auth = await instance()

    const error = await Actions.redirect
      .createUrl(auth, {
        // A challenge rides in the access key, so the type admits none without `accessKey`.
        challenge: 'Sign in to Example' as never,
      })
      .catch((error: unknown) => error)

    expect(error).toBeInstanceOf(Id.ChallengeWithoutKeyError)
  })
})

/** Follows a sign-in URL that requests an access key to the approval page, and returns its signed URL. */
async function approval(options: { cookie: string; url: string }) {
  let url = new URL(options.url)
  for (let hop = 0; hop < 5; hop++) {
    const response = await server.fetch(`${url.pathname}${url.search}`, {
      headers: { cookie: options.cookie },
      redirect: 'manual',
    })
    // The harness's fetch sends `sec-fetch-mode: cors`, so Better Auth returns its redirect as JSON.
    const location =
      response.headers.get('location') ??
      ((await response.json()) as { url?: string }).url
    if (!location)
      throw new Error(`The sign-in URL returned ${response.status}.`)
    const next = new URL(location, Env.origin)
    if (next.pathname === '/authorize' && next.searchParams.has('sig'))
      return next
    url = next
  }
  throw new Error('The sign-in URL redirected too many times.')
}

/**
 * Registers a public app that skips consent, and returns an instance for it that calls the harness.
 * With `clientId`, it registers nothing.
 */
async function instance(
  options: {
    clientId?: string | undefined
    clientSecret?: string | undefined
    redirectUri?: string | undefined
  } = {},
) {
  const registered = options.redirectUri ?? redirectUri
  const clientId = options.clientId ?? crypto.randomUUID()
  if (!options.clientId)
    await Admin.createApp(admin, {
      clientId,
      name: 'Example',
      redirectUris: [registered],
    })
  return Id.from({
    clientId,
    clientSecret: options.clientSecret,
    // The harness's fetch returns Miniflare's `Response`, which the global `fetch` type does not name,
    // though both have the same shape at runtime.
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input)
      return server.fetch(
        `${url.pathname}${url.search}`,
        init as Parameters<typeof server.fetch>[1],
      )
    }) as unknown as typeof globalThis.fetch,
    redirectUri: registered,
    url: Env.origin,
  })
}

/** Follows the sign-in URL for `cookie` to the app's callback, and returns the callback URL. */
async function follow(options: { cookie: string; url: string }) {
  let url = new URL(options.url)
  for (let hop = 0; hop < 5; hop++) {
    if (url.origin !== Env.origin) return url.href
    const response = await server.fetch(`${url.pathname}${url.search}`, {
      headers: { cookie: options.cookie },
      redirect: 'manual',
    })
    // The harness's fetch sends `sec-fetch-mode: cors`, so Better Auth returns its redirect as JSON.
    const location =
      response.headers.get('location') ??
      ((await response.json()) as { url?: string }).url
    if (!location)
      throw new Error(`The sign-in URL returned ${response.status}.`)
    url = new URL(location, Env.origin)
  }
  throw new Error('The sign-in URL redirected too many times.')
}

/**
 * Returns the permissions of an access key that each test names: OUSD's transfers, up to $1,000, for 364
 * days.
 */
function permissions() {
  return {
    expiry: Expiry.days(364),
    limits: [{ limit: 1_000_000_000n, token: ousdAddress }],
    scopes: [
      Scopes.tip20(ousdAddress).transfer(),
      Scopes.tip20(ousdAddress).transferWithMemo(),
    ],
  }
}

/** Adds a realm whose secp256k1 owners the harness holds, and returns its ID. */
async function realm() {
  const id = `cash-${crypto.randomUUID().replaceAll('-', '')}`
  await Admin.addRealm(admin, { id, name: 'Tempo Cash' })
  // The Admin API sets no secp256k1 owners.
  await Realm.setSecp256k1(database.db, { enabled: true, realmId: id })
  return id
}

/**
 * Signs a new address in, creates its first Tempo Account in the app's first realm, and returns
 * the account, the session cookie, and the session's ID.
 */
async function signable(options: { clientId: string }) {
  const cookie = await signIn({
    email: `tempo-id-test+${crypto.randomUUID()}@example.org`,
  })

  const read = await server.fetch('/v1/auth/session', { headers: { cookie } })
  const { user } = (await read.json()) as { user: { id: string } }
  const [session] = await database.db
    .select({ id: Schema.session.id })
    .from(Schema.session)
    .where(Sql.eq(Schema.session.userId, user.id))
    .orderBy(Sql.desc(Schema.session.createdAt))
    .limit(1)
  if (!session) throw new Error('The sign-in stored no session.')

  const created = await server.fetch('/v1/account', {
    body: JSON.stringify({ client_id: options.clientId }),
    headers: {
      'content-type': 'application/json',
      cookie,
      origin: new URL(redirectUri).origin,
    },
    method: 'POST',
  })
  const body = (await created.json()) as {
    tempo: readonly { address: `0x${string}` }[]
  }
  const account = body.tempo[0]?.address
  if (!account) throw new Error(`The account failed with ${created.status}.`)
  return { account, cookie, session: session.id }
}

/** Signs `email` in with a code from the stand-in inbox, and returns the session cookie. */
async function signIn(options: { email: string }) {
  const { email } = options
  const code = await Harness.sendCode(server, { email })

  const verify = await server.fetch('/v1/auth/code/verify', {
    body: JSON.stringify({ code, email }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  await verify.body?.cancel()
  const cookie = verify.headers
    .getSetCookie()
    .find((entry) => entry.includes('tempo-id-session'))
    ?.split(';')[0]
  if (!cookie) throw new Error(`The sign-in failed with ${verify.status}.`)
  return cookie
}
