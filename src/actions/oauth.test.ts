/**
 * Runs `Actions.oauth.introspect`, `jwks`, and `userInfo` against `apps/id`, with tokens from a
 * redirect sign-in.
 * @module
 */
import { Actions, Id } from 'accounts'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'vite-plus/test'
import * as Admin from '../../test/Admin.js'
import { Env, Harness } from '../../test/TempoId.js'

const admin = Admin.create()
const server = Harness.create()

/** The redirect URI of the app that each test registers. */
const redirectUri = 'https://app.example.com/callback'

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
  await Promise.all([admin.close(), server.close()])
})

describe('introspect', () => {
  test('returns the claims of an active access token, and inactive for a token that was never issued', async () => {
    const email = `tempo-id-test+${crypto.randomUUID()}@example.org`
    const auth = await instance({ secret: true })
    const { accessToken, user } = await authorize(auth, { email })

    const active = await Actions.oauth.introspect(auth, { token: accessToken })
    const unissued = await Actions.oauth.introspect(auth, {
      token: 'unissued',
    })

    expect(active).toMatchObject({
      active: true,
      clientId: auth.clientId,
      userId: user.id,
    })
    expect(active.active && active.expiresAt! > Date.now()).toBe(true)
    expect(unissued).toMatchInlineSnapshot(`
      {
        "active": false,
      }
    `)
  })

  test('returns the claims of an active refresh token, which tokenTypeHint names', async () => {
    const email = `tempo-id-test+${crypto.randomUUID()}@example.org`
    const auth = await instance({ secret: true })
    const { refreshToken, user } = await authorize(auth, { email })

    const active = await Actions.oauth.introspect(auth, {
      token: refreshToken!,
      tokenTypeHint: 'refresh_token',
    })

    expect(active).toMatchObject({
      active: true,
      clientId: auth.clientId,
      userId: user.id,
    })
    expect(Object.keys(active).sort()).toMatchInlineSnapshot(`
      [
        "active",
        "clientId",
        "expiresAt",
        "issuedAt",
        "scope",
        "userId",
      ]
    `)
  })

  test('refuses an app without a client secret', async () => {
    const email = `tempo-id-test+${crypto.randomUUID()}@example.org`
    const auth = await instance({ secret: false })
    const { accessToken } = await authorize(auth, { email })

    const error = await Actions.oauth
      .introspect(auth, { token: accessToken })
      .catch((error: unknown) => error)

    expect(error).toBeInstanceOf(Id.RequestError)
    expect((error as Id.RequestError).status).toMatchInlineSnapshot(`401`)
    expect((error as Id.RequestError).code).toMatchInlineSnapshot(
      `"invalid_client"`,
    )
  })
})

describe('jwks', () => {
  test('returns the RS256 signing keys', async () => {
    const auth = await instance({ secret: false })

    const keys = await Actions.oauth.jwks(auth)

    expect(keys.keys.map((key) => key.alg)).toContain('RS256')
  })
})

describe('userInfo', () => {
  test('returns the user that an access token names', async () => {
    const email = `tempo-id-test+${crypto.randomUUID()}@example.org`
    const auth = await instance({ secret: false })
    const { accessToken, user } = await authorize(auth, { email })

    const info = await Actions.oauth.userInfo(auth, { accessToken })

    expect(info).toEqual(user)
  })

  test('refuses a token that was never issued', async () => {
    const auth = await instance({ secret: false })

    const error = await Actions.oauth
      .userInfo(auth, { accessToken: 'unissued' })
      .catch((error: unknown) => error)

    expect(error).toBeInstanceOf(Id.RequestError)
    expect((error as Id.RequestError).status).toMatchInlineSnapshot(`401`)
    expect((error as Id.RequestError).code).toMatchInlineSnapshot(
      `"invalid_token"`,
    )
  })
})

/** Signs `email` in, and returns the tokens and user of a redirect sign-in without an access key. */
async function authorize(auth: Id.Config, options: { email: string }) {
  const cookie = await signIn({ email: options.email })
  const { pending, url } = await Actions.redirect.createUrl(auth)

  let next = new URL(url)
  for (let hop = 0; hop < 5 && next.origin === Env.origin; hop++) {
    const response = await server.fetch(`${next.pathname}${next.search}`, {
      headers: { cookie },
      redirect: 'manual',
    })
    // The harness's fetch sends `sec-fetch-mode: cors`, so Better Auth returns its redirect as JSON.
    const location =
      response.headers.get('location') ??
      ((await response.json()) as { url?: string }).url
    if (!location)
      throw new Error(`The sign-in URL returned ${response.status}.`)
    next = new URL(location, Env.origin)
  }

  return Actions.redirect.handleCallback(auth, { pending, url: next.href })
}

/** Registers a first-party app that skips consent, and returns an instance for it. */
async function instance(options: { secret: boolean }) {
  const { app, clientSecret } = await Admin.createApp(admin, {
    name: 'Example',
    redirectUris: [redirectUri],
    secret: options.secret,
  })
  return Id.from({
    clientId: app.clientId,
    ...(clientSecret ? { clientSecret } : {}),
    // The harness's fetch returns Miniflare's `Response`, which the global `fetch` type does not name,
    // though both have the same shape at runtime.
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input)
      return server.fetch(
        `${url.pathname}${url.search}`,
        init as Parameters<typeof server.fetch>[1],
      )
    }) as unknown as typeof globalThis.fetch,
    redirectUri,
    url: Env.origin,
  })
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
