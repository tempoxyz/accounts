/**
 * Runs the `backend` and `siwe` plugins' sign-in routes through `accounts.handler`, with a memory
 * store, at a Tempo ID URL where nothing listens, so a route that sends a request to Tempo ID fails.
 * @module
 */
import { Base64 } from 'ox'
import { custom } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../../Accounts.js'
import { backend } from '../../plugins/backend.js'
import { siwe } from '../../plugins/siwe.js'
import { viem } from '../../plugins/viem.js'
import * as Session from '../../Session.js'
import * as Store from '../../Store.js'
import * as Api from '../Api.js'
import * as BackendCookie from '../BackendCookie.js'
import * as Backend from './Backend.js'

const origin = 'https://app.example.com'

describe('fetch', () => {
  test('GET /login redirects to Tempo ID with the callback under basePath, and sets the pending cookies', async () => {
    const accounts = instance()

    const response = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/login?returnTo=/notes?tab=1`),
    )
    const location = new URL(response.headers.get('location')!)

    expect(response.status).toMatchInlineSnapshot(`302`)
    expect(location.origin + location.pathname).toMatchInlineSnapshot(
      `"http://127.0.0.1:9/oauth2/authorize"`,
    )
    expect(location.searchParams.get('redirect_uri')).toMatchInlineSnapshot(
      `"https://app.example.com/accounts/auth/callback"`,
    )
    expect(response.headers.getSetCookie().map(masked)).toMatchInlineSnapshot(`
      [
        "__Host-tempo-id.pending.<id>=<start>:%2Fnotes%3Ftab%3D1; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600",
        "__Host-tempo-id.pending=<id>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600",
        "__Host-tempo-id.return=%2Fnotes%3Ftab%3D1; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600",
        "__Host-tempo-id.dialog=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      ]
    `)
  })

  test('GET /login keeps no returnTo of another origin', async () => {
    const accounts = instance()

    const responses = await Promise.all(
      [
        '//evil.example/x',
        'https://evil.example',
        '/\\evil.example',
        'notes',
      ].map((value) =>
        accounts.handler.fetch(
          new Request(
            `${origin}/accounts/auth/login?returnTo=${encodeURIComponent(value)}`,
          ),
        ),
      ),
    )

    expect(
      responses.map(
        (response) =>
          response.headers
            .getSetCookie()
            .find((cookie) => cookie.startsWith(BackendCookie.pendingPrefix))!
            .split(';')[0]!
            .split(':')[1],
      ),
    ).toMatchInlineSnapshot(`
      [
        "%2F",
        "%2F",
        "%2F",
        "%2F",
      ]
    `)
  })

  test('GET /login passes the loginHint and prompt query parameters to Tempo ID, and drops a prompt other than login', async () => {
    const accounts = instance()

    const responses = await Promise.all(
      [
        'loginHint=user%40example.com&prompt=login',
        'loginHint=&prompt=none',
      ].map((query) =>
        accounts.handler.fetch(
          new Request(`${origin}/accounts/auth/login?${query}`),
        ),
      ),
    )

    expect(
      responses.map((response) => {
        const { searchParams } = new URL(response.headers.get('location')!)
        return {
          login_hint: searchParams.get('login_hint'),
          prompt: searchParams.get('prompt'),
        }
      }),
    ).toMatchInlineSnapshot(`
      [
        {
          "login_hint": "user@example.com",
          "prompt": "login",
        },
        {
          "login_hint": null,
          "prompt": null,
        },
      ]
    `)
  })

  test('GET /login answers 503 temporarily_unavailable, sets no cookie, and redirects nowhere, when the pushed request receives no response', async () => {
    const accounts = instance({ clientSecret: 'secret' })

    // Nothing listens at the URL, so the push to `/oauth2/par` receives no response.
    const response = await accounts.handler
      .fetch(new Request(`${origin}/accounts/auth/login?returnTo=/notes`))
      .catch((error: Error) => `${error.name}: ${error.message}`)

    expect(
      response instanceof Response
        ? {
            body: await response.json(),
            cookies: response.headers.getSetCookie(),
            location: response.headers.get('location'),
            status: response.status,
          }
        : response,
    ).toMatchInlineSnapshot(`
      {
        "body": {
          "error": "temporarily_unavailable",
        },
        "cookies": [],
        "location": null,
        "status": 503,
      }
    `)
  })

  test("GET /login rejects with the fault of the instance's own access key, which sends no request", async () => {
    const accounts = instance({
      accessKey: { expiry: 1, limits: [{ limit: '1', token: 'ousd' }] },
      clientSecret: 'secret',
    })

    const response = await accounts.handler
      .fetch(new Request(`${origin}/accounts/auth/login`))
      .catch((error: Accounts.RequestError) => [error.name, error.reason])

    expect(response).toMatchInlineSnapshot(`
      [
        "Accounts.RequestError",
        "expiry_passed",
      ]
    `)
  })

  test('GET /callback returns to returnTo with the denial, and sets no session cookie', async () => {
    const accounts = instance()
    const login = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/login?returnTo=/notes`),
    )
    const state = new URL(login.headers.get('location')!).searchParams.get(
      'state',
    )

    const response = await accounts.handler.fetch(
      new Request(
        `${origin}/accounts/auth/callback?error=access_denied&state=${state}`,
        { headers: { cookie: cookies(login) } },
      ),
    )

    expect(response.status).toMatchInlineSnapshot(`302`)
    expect(response.headers.get('location')).toMatchInlineSnapshot(
      `"/notes?error=access_denied"`,
    )
    expect(response.headers.getSetCookie().map(masked)).toMatchInlineSnapshot(`
      [
        "__Host-tempo-id.pending.<id>=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
        "__Host-tempo-id.dialog=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
        "__Host-tempo-id.pending=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
        "__Host-tempo-id.return=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      ]
    `)
  })

  test("GET /callback of another sign-in's state returns the page that posts it to the dialog, and keeps the redirect sign-in", async () => {
    const accounts = instance()
    const login = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/login?returnTo=/notes`),
    )
    const state = new URL(login.headers.get('location')!).searchParams.get(
      'state',
    )

    const foreign = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/callback?code=code&state=other`, {
        headers: { cookie: cookies(login) },
      }),
    )
    const denial = await accounts.handler.fetch(
      new Request(
        `${origin}/accounts/auth/callback?error=access_denied&state=${state}`,
        { headers: { cookie: cookies(login) } },
      ),
    )

    expect({
      cookies: foreign.headers.getSetCookie(),
      location: foreign.headers.get('location'),
      status: foreign.status,
    }).toMatchInlineSnapshot(`
      {
        "cookies": [],
        "location": null,
        "status": 200,
      }
    `)
    expect(denial.headers.get('location')).toMatchInlineSnapshot(
      `"/notes?error=access_denied"`,
    )
  })

  test('GET /callback completes each of two sign-ins that two tabs started, whichever callback arrives first, and returns each to its own returnTo', async () => {
    const accounts = instance()

    // The tabs share one cookie jar, so a later sign-in's cookies replace an earlier one's.
    async function tabs(order: 'first' | 'second') {
      const jar = new Map<string, string>()
      async function send(path: string) {
        const cookie = [...jar].map(([name, value]) => `${name}=${value}`)
        const response = await accounts.handler.fetch(
          new Request(`${origin}${path}`, {
            headers: { cookie: cookie.join('; ') },
          }),
        )
        for (const entry of response.headers.getSetCookie()) {
          const [pair = ''] = entry.split(';')
          const index = pair.indexOf('=')
          const value = pair.slice(index + 1)
          if (value) jar.set(pair.slice(0, index), value)
          else jar.delete(pair.slice(0, index))
        }
        return response
      }
      const states = []
      for (const path of ['/a', '/b']) {
        const login = await send(`/accounts/auth/login?returnTo=${path}`)
        states.push(
          new URL(login.headers.get('location')!).searchParams.get('state'),
        )
      }
      if (order === 'second') states.reverse()
      const locations = []
      for (const state of states) {
        const response = await send(
          `/accounts/auth/callback?error=access_denied&state=${state}`,
        )
        locations.push(`${response.status} ${response.headers.get('location')}`)
      }
      return { cookies: [...jar.keys()], locations }
    }

    const results = [await tabs('first'), await tabs('second')]

    expect(results).toMatchInlineSnapshot(`
      [
        {
          "cookies": [],
          "locations": [
            "302 /a?error=access_denied",
            "302 /b?error=access_denied",
          ],
        },
        {
          "cookies": [],
          "locations": [
            "302 /b?error=access_denied",
            "302 /a?error=access_denied",
          ],
        },
      ]
    `)
  })

  test('GET /callback completes each of two sign-ins whose GET /login requests two tabs sent at once', async () => {
    const accounts = instance()

    // Both tabs send their request before either response arrives, so each reads the same cookies.
    const logins = await Promise.all(
      ['/a', '/b'].map((path) =>
        accounts.handler.fetch(
          new Request(`${origin}/accounts/auth/login?returnTo=${path}`),
        ),
      ),
    )
    const responses = [...logins]
    for (const login of logins) {
      const state = new URL(login.headers.get('location')!).searchParams.get(
        'state',
      )
      responses.push(
        await accounts.handler.fetch(
          new Request(
            `${origin}/accounts/auth/callback?error=access_denied&state=${state}`,
            { headers: { cookie: cookies(...responses) } },
          ),
        ),
      )
    }

    expect({
      cookie: cookies(...responses),
      locations: responses
        .slice(logins.length)
        .map(
          (response) =>
            `${response.status} ${response.headers.get('location')}`,
        ),
    }).toMatchInlineSnapshot(`
      {
        "cookie": "",
        "locations": [
          "302 /a?error=access_denied",
          "302 /b?error=access_denied",
        ],
      }
    `)
  })

  test('GET /login drops the oldest of 4 sign-ins that start in the same second, so the 3 newest complete', async () => {
    const accounts = instance()
    const logins: Response[] = []
    for (const path of ['/a', '/b', '/c', '/d'])
      logins.push(
        await accounts.handler.fetch(
          new Request(`${origin}/accounts/auth/login?returnTo=${path}`, {
            headers: { cookie: cookies(...logins) },
          }),
        ),
      )

    const locations = await Promise.all(
      logins.map(async (login) => {
        const state = new URL(login.headers.get('location')!).searchParams.get(
          'state',
        )
        const response = await accounts.handler.fetch(
          new Request(
            `${origin}/accounts/auth/callback?error=access_denied&state=${state}`,
            { headers: { cookie: cookies(...logins) } },
          ),
        )
        return `${response.status} ${response.headers.get('location')}`
      }),
    )

    expect(locations).toMatchInlineSnapshot(`
      [
        "200 null",
        "302 /b?error=access_denied",
        "302 /c?error=access_denied",
        "302 /d?error=access_denied",
      ]
    `)
  })

  test("GET /callback relays the callback of a dialog sign-in that another tab's redirect sign-in followed, and POST /callback redeems it", async () => {
    const accounts = instance()
    const dialog = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/login`, {
        headers: { origin },
        method: 'POST',
      }),
    )
    const { url } = (await dialog.json()) as { url: string }
    const state = new URL(url).searchParams.get('state')
    const redirect = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/login`, {
        headers: { cookie: cookies(dialog) },
      }),
    )
    const cookie = cookies(dialog, redirect)
    const callback = `${origin}/accounts/auth/callback?error=access_denied&state=${state}`

    const popup = await accounts.handler.fetch(
      new Request(callback, { headers: { cookie } }),
    )
    const posted = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/callback`, {
        body: JSON.stringify({ url: callback }),
        headers: { cookie, origin },
        method: 'POST',
      }),
    )

    expect([
      popup.status,
      popup.headers.get('location'),
      posted.status,
      await posted.json(),
    ]).toMatchInlineSnapshot(`
      [
        200,
        null,
        400,
        {
          "error": "access_denied",
          "error_description": "The user denied the request. Start the request again to ask once more.",
        },
      ]
    `)
  })

  test('GET /callback reads at most 3 sign-ins of crafted pending cookies', async () => {
    const memory = Store.memory()
    const reads: string[] = []
    const accounts = instance({
      store: Store.from({
        ...memory,
        getItem: (key) => {
          if (key.startsWith('tempo-id:pending:')) reads.push(key)
          return memory.getItem(key)
        },
      }),
    })
    const started = Math.floor(Date.now() / 1000).toString(36)
    const value = Array.from(
      { length: 50 },
      (_, index) => `id${index}.${started}:%2F`,
    ).join('|')
    const own = Array.from(
      { length: 50 },
      (_, index) => `${BackendCookie.pendingPrefix}own${index}=${started}:%2F`,
    ).join('; ')

    await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/callback?code=code&state=state`, {
        headers: { cookie: `__Host-tempo-id.pendings=${value}; ${own}` },
      }),
    )

    expect(reads.length).toMatchInlineSnapshot(`3`)
  })

  test('GET /login keeps each pending cookie under 4096 bytes, so the newest sign-in completes beside a long returnTo', async () => {
    const accounts = instance()
    const long = `/notes?data=${'a'.repeat(2000)}`
    const first = await accounts.handler.fetch(
      new Request(
        `${origin}/accounts/auth/login?returnTo=${encodeURIComponent(long)}`,
      ),
    )
    const second = await accounts.handler.fetch(
      new Request(
        `${origin}/accounts/auth/login?returnTo=${encodeURIComponent(`${long}b`)}`,
        {
          headers: { cookie: cookies(first) },
        },
      ),
    )
    const state = new URL(second.headers.get('location')!).searchParams.get(
      'state',
    )

    const denial = await accounts.handler.fetch(
      new Request(
        `${origin}/accounts/auth/callback?error=access_denied&state=${state}`,
        {
          headers: { cookie: cookies(first, second) },
        },
      ),
    )

    expect([
      [...first.headers.getSetCookie(), ...second.headers.getSetCookie()].every(
        (cookie) => cookie.length <= 4096,
      ),
      denial.status,
      denial.headers.get('location')!.endsWith('ab&error=access_denied'),
    ]).toMatchInlineSnapshot(`
      [
        true,
        302,
        true,
      ]
    `)
  })

  test("GET /callback completes its sign-in when another sign-in's lookup throws, such as for a corrupted pending entry", async () => {
    const store = Store.memory()
    const accounts = instance({ store })
    const first = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/login?returnTo=/a`),
    )
    const second = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/login?returnTo=/b`, {
        headers: { cookie: cookies(first) },
      }),
    )
    // The entry holds no pending state, so its lookup throws a TypeError, not a refusal.
    await store.setItem(
      `tempo-id:pending:${cookies(second).match(/pending=([\w-]+)/)![1]}`,
      'corrupted',
    )
    const state = new URL(first.headers.get('location')!).searchParams.get(
      'state',
    )

    const denial = await accounts.handler
      .fetch(
        new Request(
          `${origin}/accounts/auth/callback?error=access_denied&state=${state}`,
          {
            headers: { cookie: cookies(first, second) },
          },
        ),
      )
      .catch((error: Error) => error)

    expect(
      denial instanceof Response
        ? denial.headers.get('location')
        : denial.message,
    ).toMatchInlineSnapshot(`"/a?error=access_denied"`)
  })

  test('GET /callback returns the page that posts it to the dialog for a pending cookie whose sign-ins all expired, since an expired entry leaves the cookie', async () => {
    const accounts = instance()
    const started = (Math.floor(Date.now() / 1000) - 11 * 60).toString(36)
    const cookie = `__Host-tempo-id.pendings=id_1.${started}:%2Fa`

    const response = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/callback?code=code&state=other`, {
        headers: { cookie },
      }),
    )

    expect([response.status, response.headers.get('location')])
      .toMatchInlineSnapshot(`
      [
        200,
        null,
      ]
    `)
  })

  test("POST /callback with a forged state keeps another tab's redirect sign-in, whose callback then completes", async () => {
    const accounts = instance()
    const redirect = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/login?returnTo=/a`),
    )
    const state = new URL(redirect.headers.get('location')!).searchParams.get(
      'state',
    )
    const dialog = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/login`, {
        headers: { cookie: cookies(redirect), origin },
        method: 'POST',
      }),
    )
    const forged = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/callback`, {
        body: JSON.stringify({
          url: `${origin}/accounts/auth/callback?code=code&state=forged`,
        }),
        headers: { cookie: cookies(redirect, dialog), origin },
        method: 'POST',
      }),
    )
    const pending = cookies(redirect, dialog, forged)

    const denial = await accounts.handler.fetch(
      new Request(
        `${origin}/accounts/auth/callback?error=access_denied&state=${state}`,
        {
          headers: { cookie: pending },
        },
      ),
    )

    expect([forged.status, denial.status, denial.headers.get('location')])
      .toMatchInlineSnapshot(`
      [
        400,
        302,
        "/a?error=access_denied",
      ]
    `)
  })

  test("GET /callback completes a redirect sign-in while another tab's dialog sign-in is in progress", async () => {
    const accounts = instance()
    const redirect = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/login?returnTo=/a`),
    )
    const state = new URL(redirect.headers.get('location')!).searchParams.get(
      'state',
    )
    const dialog = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/login`, {
        headers: { cookie: cookies(redirect), origin },
        method: 'POST',
      }),
    )
    const cookie = cookies(redirect, dialog)

    const denial = await accounts.handler.fetch(
      new Request(
        `${origin}/accounts/auth/callback?error=access_denied&state=${state}`,
        {
          headers: { cookie },
        },
      ),
    )

    expect([
      denial.status,
      denial.headers.get('location'),
      denial.headers
        .getSetCookie()
        .some((entry) => entry.startsWith('__Host-tempo-id.dialog=;')),
    ]).toMatchInlineSnapshot(`
      [
        302,
        "/a?error=access_denied",
        false,
      ]
    `)
  })

  test("GET /callback returns the page that posts it to the dialog for a dialog popup's callback beside a redirect sign-in that the store no longer holds", async () => {
    const store = Store.memory()
    const accounts = instance({ store })
    const redirect = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/login?returnTo=/a`),
    )
    await store.removeItem(
      `tempo-id:pending:${cookies(redirect).match(/pending=([\w-]+)/)![1]}`,
    )

    const popup = await accounts.handler.fetch(
      new Request(
        `${origin}/accounts/auth/callback?code=code&state=signed-message`,
        {
          headers: { cookie: cookies(redirect) },
        },
      ),
    )

    expect([popup.status, popup.headers.get('location')])
      .toMatchInlineSnapshot(`
      [
        200,
        null,
      ]
    `)
  })

  test('GET /callback without a redirect sign-in in progress returns the page that posts it to the dialog, which returns a tab to / with invalid_request', async () => {
    const accounts = instance()

    const response = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/callback?code=code&state=state`),
    )

    expect(response.status).toMatchInlineSnapshot(`200`)
    expect(await response.text()).toContain(
      "location.replace('/?error=invalid_request')",
    )
  })

  test('POST /login starts a sign-in in the dialog, and returns its URL', async () => {
    const accounts = instance()

    const response = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/login`, {
        headers: { origin },
        method: 'POST',
      }),
    )
    const { url } = (await response.json()) as { url: string }
    const query = new URL(url).searchParams

    expect(response.status).toMatchInlineSnapshot(`200`)
    expect([
      query.get('display'),
      query.get('redirect_uri'),
      query.has('state'),
    ]).toMatchInlineSnapshot(`
      [
        "popup",
        "https://app.example.com/accounts/auth/callback",
        true,
      ]
    `)
    expect(response.headers.getSetCookie().map(masked)).toMatchInlineSnapshot(`
      [
        "__Host-tempo-id.pending.<id>=<start>!; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600",
        "__Host-tempo-id.pending=<id>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600",
        "__Host-tempo-id.return=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
        "__Host-tempo-id.dialog=1; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600",
      ]
    `)
  })

  test('POST /login does not push the request of an app that pushes, since the frame takes its parameters', async () => {
    const accounts = Accounts.create({
      clientId: origin,
      clientSecret: 'secret',
      handler: { basePath: '/accounts' },
      plugins: [backend({ store: Store.memory() })],
      url: 'http://127.0.0.1:9',
    })

    const response = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/login`, {
        headers: { origin },
        method: 'POST',
      }),
    )
    const { url } = (await response.json()) as { url: string }

    expect(new URL(url).searchParams.has('request_uri')).toMatchInlineSnapshot(
      `false`,
    )
  })

  test('POST /login and POST /callback refuse another origin', async () => {
    const accounts = instance()

    const responses = await Promise.all(
      ['/accounts/auth/login', '/accounts/auth/callback'].map((path) =>
        accounts.handler.fetch(
          new Request(`${origin}${path}`, {
            body: JSON.stringify({ url: `${origin}/accounts/auth/callback` }),
            headers: { origin: 'https://evil.example' },
            method: 'POST',
          }),
        ),
      ),
    )

    expect(responses.map((response) => response.status)).toMatchInlineSnapshot(`
      [
        403,
        403,
      ]
    `)
  })

  test("GET /callback of the dialog's sign-in returns the page that posts it to the dialog, and redeems nothing", async () => {
    const accounts = instance()
    const login = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/login`, {
        headers: { origin },
        method: 'POST',
      }),
    )
    const { url } = (await login.json()) as { url: string }
    const state = new URL(url).searchParams.get('state')

    const response = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/callback?code=code&state=${state}`, {
        headers: { cookie: cookies(login) },
      }),
    )

    expect(response.status).toMatchInlineSnapshot(`200`)
    expect([
      response.headers.get('content-type'),
      response.headers
        .get('content-security-policy')
        ?.replace(/nonce-[^']+/, 'nonce-<nonce>'),
      response.headers.get('referrer-policy'),
    ]).toMatchInlineSnapshot(`
      [
        "text/html; charset=utf-8",
        "default-src 'none'; script-src 'nonce-<nonce>'",
        "no-referrer",
      ]
    `)
    expect(response.headers.getSetCookie()).toMatchInlineSnapshot(`[]`)
    expect(await response.text()).toContain(
      "new BroadcastChannel('tempo-id:dialog:' + state)",
    )
  })

  test('POST /callback refuses a forged state, and deletes the cookies of the sign-in', async () => {
    const accounts = instance()
    const login = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/login`, {
        headers: { origin },
        method: 'POST',
      }),
    )

    const response = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/callback`, {
        body: JSON.stringify({
          url: `${origin}/accounts/auth/callback?code=code&state=forged`,
        }),
        headers: { cookie: cookies(login), origin },
        method: 'POST',
      }),
    )

    expect(response.status).toMatchInlineSnapshot(`400`)
    expect(await response.json()).toMatchInlineSnapshot(`
      {
        "error": "invalid_request",
        "error_description": "Invalid \`state\` in the callback URL. Start sign-in again from this app.",
        "field": "state",
      }
    `)
    expect(response.headers.getSetCookie().map(masked)).toMatchInlineSnapshot(`
      [
        "__Host-tempo-id.pending.<id>=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
        "__Host-tempo-id.dialog=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
        "__Host-tempo-id.pending=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
        "__Host-tempo-id.return=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      ]
    `)
  })

  test("POST /callback returns the denial of the dialog's sign-in", async () => {
    const accounts = instance()
    const login = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/login`, {
        headers: { origin },
        method: 'POST',
      }),
    )
    const { url } = (await login.json()) as { url: string }
    const state = new URL(url).searchParams.get('state')

    const response = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/callback`, {
        body: JSON.stringify({
          url: `${origin}/accounts/auth/callback?error=access_denied&state=${state}`,
        }),
        headers: { cookie: cookies(login), origin },
        method: 'POST',
      }),
    )

    expect([response.status, await response.json()]).toMatchInlineSnapshot(`
      [
        400,
        {
          "error": "access_denied",
          "error_description": "The user denied the request. Start the request again to ask once more.",
        },
      ]
    `)
  })

  test('POST /callback answers 400 for a denial with server_error that the callback URL carries', async () => {
    const accounts = instance()
    const login = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/login`, {
        headers: { origin },
        method: 'POST',
      }),
    )
    const { url } = (await login.json()) as { url: string }
    const state = new URL(url).searchParams.get('state')

    const response = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/callback`, {
        body: JSON.stringify({
          url: `${origin}/accounts/auth/callback?error=server_error&state=${state}`,
        }),
        headers: { cookie: cookies(login), origin },
        method: 'POST',
      }),
    )

    expect([response.status, await response.json()]).toMatchInlineSnapshot(`
      [
        400,
        {
          "error": "server_error",
          "error_description": "Refused callback: \`server_error\`, without a description. Start the request again.",
        },
      ]
    `)
  })

  test("POST /callback answers 503 with the refusal's description when the code exchange of the dialog's sign-in receives no response", async () => {
    const accounts = instance()
    const login = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/login`, {
        headers: { origin },
        method: 'POST',
      }),
    )
    const { url } = (await login.json()) as { url: string }
    const state = new URL(url).searchParams.get('state')

    // Nothing listens at the URL, so the code exchange receives no response.
    const response = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/callback`, {
        body: JSON.stringify({
          url: `${origin}/accounts/auth/callback?code=code&state=${state}`,
        }),
        headers: { cookie: cookies(login), origin },
        method: 'POST',
      }),
    )

    expect([response.status, await response.json()]).toMatchInlineSnapshot(`
      [
        503,
        {
          "error": "server_error",
          "error_description": "The code exchange received no response. Check the connection, and sign in again.",
          "signed_in": true,
        },
      ]
    `)
  })

  test("POST /callback marks a refusal after the code exchange as signed in, so the page's `Accounts.RequestError` has `signedIn`, and a denial has none", async () => {
    const accounts = instance()

    async function refusal(query: string) {
      const login = await accounts.handler.fetch(
        new Request(`${origin}/accounts/auth/login`, {
          headers: { origin },
          method: 'POST',
        }),
      )
      const { url } = (await login.json()) as { url: string }
      const state = new URL(url).searchParams.get('state')
      const response = await accounts.handler.fetch(
        new Request(`${origin}/accounts/auth/callback`, {
          body: JSON.stringify({
            url: `${origin}/accounts/auth/callback?${query}&state=${state}`,
          }),
          headers: { cookie: cookies(login), origin },
          method: 'POST',
        }),
      )
      // The dialog's page reads the response with the same parser.
      const error = await Api.json(response).catch((error: unknown) => error)
      if (!(error instanceof Accounts.RequestError)) throw error
      return {
        code: error.code,
        signedIn: error.signedIn,
        status: error.status,
      }
    }

    // Nothing listens at the URL, so the code exchange after the user's sign-in receives no response.
    expect(await refusal('code=code')).toMatchInlineSnapshot(`
      {
        "code": "server_error",
        "signedIn": true,
        "status": 503,
      }
    `)
    expect(await refusal('error=access_denied')).toMatchInlineSnapshot(`
      {
        "code": "access_denied",
        "signedIn": false,
        "status": 400,
      }
    `)
  })

  test('POST /callback refuses a body without a callback URL', async () => {
    const accounts = instance()

    const responses = await Promise.all(
      ['{}', '{"url":"not a url"}', 'not json'].map((body) =>
        accounts.handler.fetch(
          new Request(`${origin}/accounts/auth/callback`, {
            body,
            headers: { origin },
            method: 'POST',
          }),
        ),
      ),
    )

    expect(
      await Promise.all(
        responses.map(async (response) => [
          response.status,
          ((await response.json()) as { error: string }).error,
        ]),
      ),
    ).toMatchInlineSnapshot(`
      [
        [
          400,
          "invalid_request",
        ],
        [
          400,
          "invalid_request",
        ],
        [
          400,
          "invalid_request",
        ],
      ]
    `)
  })

  test('GET /login after a sign-in in the dialog deletes its mark, so the callback redirects', async () => {
    const accounts = instance()

    const response = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/login`, {
        headers: { cookie: '__Host-tempo-id.dialog=1' },
      }),
    )

    expect(
      response.headers
        .getSetCookie()
        .filter((cookie) => cookie.startsWith('__Host-tempo-id.dialog=')),
    ).toMatchInlineSnapshot(`
      [
        "__Host-tempo-id.dialog=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      ]
    `)
  })

  test('GET /login keeps a dialog sign-in of an earlier release as the dialog’s, so its callback relays', async () => {
    const accounts = instance()
    const cookie = '__Host-tempo-id.pending=legacy; __Host-tempo-id.dialog=1'

    const login = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/login`, { headers: { cookie } }),
    )
    const pending = login.headers
      .getSetCookie()
      .find((value) =>
        value.startsWith(`${BackendCookie.pendingPrefix}legacy=`),
      )!
      .split(';')[0]!
    const callback = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/callback?code=c&state=legacy`, {
        headers: { cookie: pending },
      }),
    )

    expect(pending.split('=')[1]).toMatch(/^[0-9a-z]+!$/)
    expect([callback.status, callback.headers.get('content-type')])
      .toMatchInlineSnapshot(`
        [
          200,
          "text/html; charset=utf-8",
        ]
      `)
  })

  test('GET /login drops the older sign-ins once one does not fit, so a newer one never leaves first', async () => {
    const accounts = instance()
    const started = Math.floor(Date.now() / 1000).toString(36)
    const cookie = `__Host-tempo-id.pendings=b.${started}:%2F${'b'.repeat(2780)}|c.${started}:%2F${'c'.repeat(180)}`

    const response = await accounts.handler.fetch(
      new Request(
        `${origin}/accounts/auth/login?returnTo=/${'a'.repeat(280)}`,
        { headers: { cookie } },
      ),
    )
    const pending = response.headers
      .getSetCookie()
      .filter((value) => value.startsWith(BackendCookie.pendingPrefix))
      .map((value) =>
        value.split('=')[0]!.slice(BackendCookie.pendingPrefix.length),
      )

    expect(pending.length).toMatchInlineSnapshot(`1`)
    expect(
      pending.some((id) => id === 'b' || id === 'c'),
    ).toMatchInlineSnapshot(`false`)
  })

  test('GET /callback that relays drops the sign-ins the store no longer holds from the pending cookie', async () => {
    const accounts = instance()
    const started = Math.floor(Date.now() / 1000).toString(36)

    const response = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/callback?code=c&state=other`, {
        headers: {
          cookie: `__Host-tempo-id.pendings=gone.${started}:%2Fnotes`,
        },
      }),
    )

    expect(response.status).toMatchInlineSnapshot(`200`)
    expect(
      response.headers
        .getSetCookie()
        .filter((cookie) => cookie.startsWith('__Host-tempo-id.pendings=')),
    ).toMatchInlineSnapshot(`
      [
        "__Host-tempo-id.pendings=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      ]
    `)
  })

  test('GET /login keeps the newest sign-in in the cookies the earlier release reads, so it completes while a deployment runs both', async () => {
    const accounts = instance()

    const first = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/login?returnTo=/a`),
    )
    const second = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/login?returnTo=/b`, {
        headers: { cookie: cookies(first) },
      }),
    )
    const value = (name: string) =>
      second.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith(`${name}=`))!
        .split(';')[0]!
        .slice(name.length + 1)

    const own = (response: Response) =>
      response.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith(BackendCookie.pendingPrefix))!
        .split('=')[0]!
        .slice(BackendCookie.pendingPrefix.length)

    // The earlier release reads the pending cookie as one session ID: the second tab's.
    expect(value('__Host-tempo-id.pending')).toBe(own(second))
    expect(value('__Host-tempo-id.pending')).not.toBe(
      cookies(first).match(/pending=([\w-]+)/)![1],
    )
    expect(value('__Host-tempo-id.return')).toMatchInlineSnapshot(`"%2Fb"`)
    expect(
      cookies(first, second)
        .split('; ')
        .filter((cookie) => cookie.startsWith(BackendCookie.pendingPrefix))
        .length,
    ).toMatchInlineSnapshot(`2`)
  })

  test('GET /callback that leaves a dialog sign-in newest marks it for the earlier release', async () => {
    const accounts = instance()
    const dialog = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/login`, {
        headers: { origin },
        method: 'POST',
      }),
    )
    const redirect = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/login?returnTo=/b`, {
        headers: { cookie: cookies(dialog) },
      }),
    )
    const state = new URL(redirect.headers.get('location')!).searchParams.get(
      'state',
    )

    const callback = await accounts.handler.fetch(
      new Request(
        `${origin}/accounts/auth/callback?error=access_denied&state=${state}`,
        { headers: { cookie: cookies(dialog, redirect) } },
      ),
    )

    expect(
      callback.headers
        .getSetCookie()
        .filter((cookie) => cookie.startsWith('__Host-tempo-id.dialog=')),
    ).toMatchInlineSnapshot(`
      [
        "__Host-tempo-id.dialog=1; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600",
      ]
    `)
  })

  test('GET /session returns the user and Tempo Account, without tokens', async () => {
    const accounts = instance()
    const { id } = await accounts.backend.save({ session: session() })

    const response = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/session`, {
        headers: { cookie: `__Host-tempo-id.sid=${id}` },
      }),
    )

    expect(response.headers.get('cache-control')).toMatchInlineSnapshot(
      `"no-store"`,
    )
    expect(await response.json()).toMatchInlineSnapshot(`
      {
        "session": {
          "account": null,
          "method": "tempo-id",
          "user": {
            "email": "user@example.com",
            "id": "user_1",
          },
        },
      }
    `)
  })

  test('GET /session returns null, and deletes a cookie whose session ended', async () => {
    const accounts = instance()

    const response = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/session`, {
        headers: { cookie: '__Host-tempo-id.sid=unknown' },
      }),
    )

    expect(await response.json()).toMatchInlineSnapshot(`
      {
        "session": null,
      }
    `)
    expect(response.headers.getSetCookie()).toMatchInlineSnapshot(`
      [
        "__Host-tempo-id.sid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      ]
    `)
  })

  test("GET /session and POST /logout keep the entries of an instance that shares the store, for a cookie that holds the instance's session name", async () => {
    const store = Store.memory()
    const options = {
      chain: 42431,
      clientId: origin,
      store,
      url: 'http://127.0.0.1:9',
    } as const
    // The instance's session name follows `tempo-id:session:`, as a backend's session ID does.
    const name = '["http://127.0.0.1:9","https://app.example.com",42431]'
    // The instance writes its chain selection under `<name>:chain`.
    await Accounts.create(options).switchChain({ chainId: 4217 })
    await store.setItem(`tempo-id:session:${name}`, {
      state: { session: session() },
      version: 0,
    })
    const accounts = instance({ store })

    const read = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/session`, {
        headers: { cookie: `__Host-tempo-id.sid=${name}` },
      }),
    )
    const logout = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/logout`, {
        headers: { cookie: `__Host-tempo-id.sid=${name}:chain`, origin },
        method: 'POST',
      }),
    )
    // A restart of the instance's process reads the store.
    const restored = await Accounts.create(options).session.get()

    expect([read.status, await read.json(), logout.status])
      .toMatchInlineSnapshot(`
        [
          200,
          {
            "session": null,
          },
          204,
        ]
      `)
    expect(restored?.user?.id).toMatchInlineSnapshot(`"user_1"`)
    expect(
      await store.getItem(`tempo-id:session:${name}:chain`),
    ).toMatchInlineSnapshot(`4217`)
  })

  test('GET /session answers 503 temporarily_unavailable, and keeps the cookie, when the refresh of its session fails', async () => {
    const accounts = instance()
    const { id } = await accounts.backend.save({
      session: Session.from({
        ...session(),
        expiresAt: 0,
        refreshToken: 'refresh-token',
      }),
    })

    // Nothing listens at the URL, so the refresh of the expired access token receives no response.
    const response = await accounts.handler
      .fetch(
        new Request(`${origin}/accounts/auth/session`, {
          headers: { cookie: `__Host-tempo-id.sid=${id}` },
        }),
      )
      .catch((error: Error) => error.name)

    expect(
      response instanceof Response
        ? {
            body: await response.json(),
            cacheControl: response.headers.get('cache-control'),
            cookies: response.headers.getSetCookie(),
            status: response.status,
          }
        : response,
    ).toMatchInlineSnapshot(`
      {
        "body": {
          "error": "temporarily_unavailable",
        },
        "cacheControl": "no-store",
        "cookies": [],
        "status": 503,
      }
    `)
  })

  test('GET /session ends the session, returns null, and deletes the cookie, for a session whose tokens a DPoP key binds that the instance lacks', async () => {
    const requests: string[] = []
    const accounts = Accounts.create({
      clientId: origin,
      fetch: (input, init) => {
        requests.push(
          `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
        )
        return fetch(input, init)
      },
      handler: { basePath: '/accounts' },
      plugins: [backend({ store: Store.memory() })],
      url: 'http://127.0.0.1:9',
    })
    const part = (value: unknown) =>
      Base64.fromString(JSON.stringify(value), { pad: false, url: true })
    const { id } = await accounts.backend.save({
      session: Session.from({
        ...session(),
        accessToken: [
          part({ alg: 'ES256', typ: 'at+jwt' }),
          part({ cnf: { jkt: 'thumbprint' } }),
          'signature',
        ].join('.'),
        expiresAt: 0,
        refreshToken: 'refresh-token',
      }),
    })

    // The refresh refuses `invalid_dpop_proof` before any request, so only the end's revocation sends
    // one, which fails, since nothing listens at the URL.
    const response = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/session`, {
        headers: { cookie: `__Host-tempo-id.sid=${id}` },
      }),
    )

    expect({
      body: await response.json(),
      cookies: response.headers.getSetCookie(),
      requests,
      status: response.status,
    }).toMatchInlineSnapshot(`
      {
        "body": {
          "session": null,
        },
        "cookies": [
          "__Host-tempo-id.sid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
        ],
        "requests": [
          "POST /oauth2/revoke",
        ],
        "status": 200,
      }
    `)
  })

  test('POST /logout refuses another origin, and keeps the session', async () => {
    const accounts = instance()
    const { id } = await accounts.backend.save({ session: session() })

    const response = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/logout`, {
        headers: {
          cookie: `__Host-tempo-id.sid=${id}`,
          origin: 'https://evil.example',
        },
        method: 'POST',
      }),
    )

    expect(response.status).toMatchInlineSnapshot(`403`)
    expect(Boolean(await accounts.backend.get({ id }))).toMatchInlineSnapshot(
      `true`,
    )
  })

  test('POST /logout ends the session, and deletes its cookie', async () => {
    const accounts = instance()
    const { id } = await accounts.backend.save({ session: session() })

    const response = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/logout`, {
        headers: { cookie: `__Host-tempo-id.sid=${id}`, origin },
        method: 'POST',
      }),
    )

    expect(response.status).toMatchInlineSnapshot(`204`)
    expect(response.headers.getSetCookie()).toMatchInlineSnapshot(`
      [
        "__Host-tempo-id.sid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      ]
    `)
    expect(await accounts.backend.get({ id })).toMatchInlineSnapshot(
      `undefined`,
    )
  })

  test('POST /backchannel-logout answers 400 for a body without a logout token, and for a token that does not verify, and keeps the session', async () => {
    const accounts = instance()
    const { id } = await accounts.backend.save({ session: session() })
    const post = (body: string) =>
      accounts.handler.fetch(
        new Request(`${origin}/accounts/auth/backchannel-logout`, {
          body,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          method: 'POST',
        }),
      )

    const [missing, invalid] = await Promise.all([
      post(''),
      post('logout_token=forged'),
    ])

    expect({
      invalid: [
        invalid.status,
        ((await invalid.json()) as { error: string }).error,
      ],
      missing: [
        missing.status,
        ((await missing.json()) as { error: string }).error,
      ],
    }).toMatchInlineSnapshot(`
      {
        "invalid": [
          400,
          "invalid_request",
        ],
        "missing": [
          400,
          "invalid_request",
        ],
      }
    `)
    expect((await accounts.backend.get({ id }))?.id).toBe(id)
  })

  test('POST /backchannel-logout answers 503 when the key set of Tempo ID cannot be fetched, so Tempo ID sends the token again', async () => {
    const accounts = instance()
    const part = (value: unknown) =>
      Base64.fromString(JSON.stringify(value), { pad: false, url: true })
    const logoutToken = [
      part({ alg: 'RS256', kid: 'key_1', typ: 'logout+jwt' }),
      part({ sid: 'sid_1' }),
      'signature',
    ].join('.')

    const response = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/backchannel-logout`, {
        body: new URLSearchParams({ logout_token: logoutToken }),
        method: 'POST',
      }),
    )

    expect(response.status).toMatchInlineSnapshot(`503`)
  })

  test('POST /backchannel-logout answers 413 for a body above 64 KiB, and stops reading at the chunk that crosses 64 KiB', async () => {
    const accounts = instance()
    const chunk = new TextEncoder().encode('a'.repeat(16 * 1_024))
    // Any server can post to the route, so the body streams 16 MiB, which the route must not buffer.
    let read = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (read === 0)
          controller.enqueue(new TextEncoder().encode('logout_token='))
        if (read >= 16 * 1_024 * 1_024) return controller.close()
        read += chunk.byteLength
        controller.enqueue(chunk)
      },
    })

    const response = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/backchannel-logout`, {
        body,
        duplex: 'half',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        method: 'POST',
      } as RequestInit),
    )

    expect({
      error: ((await response.json()) as { error: string }).error,
      read: read <= 80 * 1_024,
      status: response.status,
    }).toMatchInlineSnapshot(`
      {
        "error": "invalid_request",
        "read": true,
        "status": 413,
      }
    `)
  })

  test('POST /logout deletes the cookie with 503 if the store fails', async () => {
    const store = Store.memory()
    const accounts = Accounts.create({
      clientId: origin,
      plugins: [
        backend({
          store: Store.from({
            ...store,
            removeItem: () => Promise.reject(new Error('Store unavailable.')),
          }),
        }),
      ],
      url: 'http://127.0.0.1:9',
    })
    const { id } = await accounts.backend.save({ session: session() })

    const response = await accounts.handler.fetch(
      new Request(`${origin}/api/auth/logout`, {
        headers: { cookie: `__Host-tempo-id.sid=${id}`, origin },
        method: 'POST',
      }),
    )

    expect(response.status).toMatchInlineSnapshot(`503`)
    expect(response.headers.getSetCookie()).toMatchInlineSnapshot(`
      [
        "__Host-tempo-id.sid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      ]
    `)
  })

  test('refuses another method with 405, and another path with 404', async () => {
    const accounts = instance()

    const responses = await Promise.all([
      accounts.handler.fetch(new Request(`${origin}/accounts/auth/logout`)),
      accounts.handler.fetch(new Request(`${origin}/accounts/auth/other`)),
    ])

    expect(
      responses.map((response) => [
        response.status,
        response.headers.get('allow'),
      ]),
    ).toMatchInlineSnapshot(`
      [
        [
          405,
          "POST",
        ],
        [
          404,
          null,
        ],
      ]
    `)
  })

  test('serves the sign-in routes under /api/auth without basePath, and under /auth with an empty one', async () => {
    const create = (handler?: { basePath: string }) =>
      Accounts.create({
        clientId: origin,
        ...(handler ? { handler } : {}),
        plugins: [backend({ store: Store.memory() })],
        url: 'http://127.0.0.1:9',
      })

    const responses = await Promise.all([
      create().handler.fetch(new Request(`${origin}/api/auth/session`)),
      create().handler.fetch(new Request(`${origin}/api/session`)),
      create({ basePath: '' }).handler.fetch(
        new Request(`${origin}/auth/session`),
      ),
    ])

    expect(responses.map((response) => response.status)).toMatchInlineSnapshot(`
      [
        200,
        404,
        200,
      ]
    `)
  })

  test('serves no sign-in route without the backend plugin', async () => {
    const accounts = Accounts.create({
      clientId: origin,
      handler: { basePath: '/accounts' },
      url: 'http://127.0.0.1:9',
    })

    const response = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/login`),
    )

    expect(response.status).toMatchInlineSnapshot(`404`)
  })
})

describe('fetch with siwe', () => {
  test('POST /siwe/challenge and POST /siwe/verify sign in, and GET /session and POST /logout serve the SIWE session', async () => {
    const accounts = siweInstance()
    const account = privateKeyToAccount(generatePrivateKey())
    const { id: previous } = await accounts.backend.save({ session: session() })

    const challenge = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/siwe/challenge`, {
        headers: { origin },
        method: 'POST',
      }),
    )
    const { message } = (await challenge.json()) as { message: string }
    const verify = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/siwe/verify`, {
        body: JSON.stringify({
          address: account.address,
          message,
          signature: await account.signMessage({ message }),
        }),
        headers: {
          cookie: `${cookies(challenge)}; __Host-tempo-id.sid=${previous}`,
          origin,
        },
        method: 'POST',
      }),
    )
    const sid = cookies(verify).match(/__Host-tempo-id\.sid=([^;]+)/)![1]!
    const read = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/session`, {
        headers: { cookie: `__Host-tempo-id.sid=${sid}` },
      }),
    )
    const body = await verify.json()
    const logout = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/logout`, {
        headers: { cookie: `__Host-tempo-id.sid=${sid}`, origin },
        method: 'POST',
      }),
    )

    expect(
      challenge.headers
        .getSetCookie()
        .map((cookie) => cookie.replace(/siwe=[^;]+/, 'siwe=<id>')),
    ).toMatchInlineSnapshot(`
      [
        "__Host-tempo-id.siwe=<id>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600",
      ]
    `)
    expect(
      verify.headers
        .getSetCookie()
        .map((cookie) => cookie.replace(/sid=[^;]+/, 'sid=<id>')),
    ).toMatchInlineSnapshot(`
      [
        "__Host-tempo-id.siwe=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
        "__Host-tempo-id.sid=<id>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400",
      ]
    `)
    expect(body).toEqual({
      session: { account: account.address, method: 'siwe' },
    })
    expect(await read.json()).toEqual(body)
    expect({
      ended: await accounts.backend.get({ id: previous }),
      logout: logout.status,
      session: await accounts.backend.get({ id: sid }),
    }).toMatchInlineSnapshot(`
      {
        "ended": undefined,
        "logout": 204,
        "session": undefined,
      }
    `)
  })

  test('POST /siwe/verify sets the session cookie until the session expires, so the browser keeps it after a restart', async () => {
    const accounts = siweInstance()
    const account = privateKeyToAccount(generatePrivateKey())
    const challenge = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/siwe/challenge`, {
        headers: { origin },
        method: 'POST',
      }),
    )
    const { message } = (await challenge.json()) as { message: string }

    const verify = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/siwe/verify`, {
        body: JSON.stringify({
          address: account.address,
          message,
          signature: await account.signMessage({ message }),
        }),
        headers: { cookie: cookies(challenge), origin },
        method: 'POST',
      }),
    )

    expect(
      verify.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith('__Host-tempo-id.sid='))!
        .replace(/sid=[^;]+/, 'sid=<id>'),
    ).toMatchInlineSnapshot(
      `"__Host-tempo-id.sid=<id>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400"`,
    )
  })

  test('POST /siwe/verify over a Tempo ID session deletes it, and sends no revocation', async () => {
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 4217,
      clientId: origin,
      fetch: (input, init) => {
        requests.push(
          `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
        )
        return fetch(input, init)
      },
      handler: { basePath: '/accounts' },
      plugins: [
        backend({ store: Store.memory() }),
        siwe(),
        viem({ transport: transport() }),
      ],
      url: 'http://127.0.0.1:9',
    })
    const account = privateKeyToAccount(generatePrivateKey())
    const { id: previous } = await accounts.backend.save({
      session: Session.from({ ...session(), refreshToken: 'refresh-token' }),
    })
    const challenge = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/siwe/challenge`, {
        headers: { origin },
        method: 'POST',
      }),
    )
    const { message } = (await challenge.json()) as { message: string }

    const verify = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/siwe/verify`, {
        body: JSON.stringify({
          address: account.address,
          message,
          signature: await account.signMessage({ message }),
        }),
        headers: {
          cookie: `${cookies(challenge)}; __Host-tempo-id.sid=${previous}`,
          origin,
        },
        method: 'POST',
      }),
    )

    expect({
      ended: await accounts.backend.get({ id: previous }),
      requests,
      status: verify.status,
    }).toMatchInlineSnapshot(`
      {
        "ended": undefined,
        "requests": [],
        "status": 200,
      }
    `)
  })

  test("GET /callback after POST /siwe/challenge returns the page that posts it to the dialog, for a page that severs the popup's opener", async () => {
    const accounts = siweInstance()
    const challenge = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/siwe/challenge`, {
        headers: { origin },
        method: 'POST',
      }),
    )

    const callback = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/callback?code=code&state=state`, {
        headers: { cookie: cookies(challenge) },
      }),
    )

    expect({
      location: callback.headers.get('location'),
      status: callback.status,
      type: callback.headers.get('content-type'),
    }).toMatchInlineSnapshot(`
      {
        "location": null,
        "status": 200,
        "type": "text/html; charset=utf-8",
      }
    `)
  })

  test("POST /siwe/verify refuses a signature that is not the account's with 403, and a request without a challenge with 400", async () => {
    const accounts = siweInstance()
    const named = privateKeyToAccount(generatePrivateKey())
    const challenge = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/siwe/challenge`, {
        body: JSON.stringify({ address: named.address }),
        headers: { origin },
        method: 'POST',
      }),
    )
    const { message } = (await challenge.json()) as { message: string }
    const verify = (cookie?: string) =>
      accounts.handler.fetch(
        new Request(`${origin}/accounts/auth/siwe/verify`, {
          body: JSON.stringify({
            address: named.address,
            message,
            signature: '0x' + 'ab'.repeat(65),
          }),
          headers: { ...(cookie ? { cookie } : {}), origin },
          method: 'POST',
        }),
      )

    const refused = await verify(cookies(challenge))
    const missing = await verify()

    expect({
      cookies: refused.headers.getSetCookie(),
      missing: [missing.status, await missing.json()],
      refused: [refused.status, await refused.json()],
    }).toMatchInlineSnapshot(`
      {
        "cookies": [
          "__Host-tempo-id.siwe=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
        ],
        "missing": [
          400,
          {
            "error": "invalid_request",
            "error_description": "Missing challenge: no SIWE sign-in is in progress in this browser. Request a new challenge.",
          },
        ],
        "refused": [
          403,
          {
            "error": "access_denied",
            "error_description": "Invalid signature: the account does not sign the message. Sign the message with the account that it names.",
          },
        ],
      }
    `)
  })

  test('POST /siwe/challenge and POST /siwe/verify refuse another origin, and a malformed body', async () => {
    const accounts = siweInstance()

    const responses = await Promise.all([
      accounts.handler.fetch(
        new Request(`${origin}/accounts/auth/siwe/challenge`, {
          headers: { origin: 'https://evil.example' },
          method: 'POST',
        }),
      ),
      accounts.handler.fetch(
        new Request(`${origin}/accounts/auth/siwe/verify`, {
          body: '{}',
          headers: { origin: 'https://evil.example' },
          method: 'POST',
        }),
      ),
      accounts.handler.fetch(
        new Request(`${origin}/accounts/auth/siwe/challenge`, {
          body: JSON.stringify({ address: 'alice' }),
          headers: { origin },
          method: 'POST',
        }),
      ),
      accounts.handler.fetch(
        new Request(`${origin}/accounts/auth/siwe/verify`, {
          body: JSON.stringify({ message: 'hello' }),
          headers: { origin },
          method: 'POST',
        }),
      ),
    ])

    expect(responses.map((response) => response.status)).toMatchInlineSnapshot(`
      [
        403,
        403,
        400,
        400,
      ]
    `)
  })

  test('POST /siwe verifies as POST /siwe/verify does, so `siwe({ auth })` on the page names both routes with one path', async () => {
    const accounts = siweInstance()
    const account = privateKeyToAccount(generatePrivateKey())

    const challenge = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/siwe/challenge`, {
        headers: { origin },
        method: 'POST',
      }),
    )
    const { message } = (await challenge.json()) as { message: string }
    const verify = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/siwe`, {
        body: JSON.stringify({
          address: account.address,
          message,
          signature: await account.signMessage({ message }),
        }),
        headers: { cookie: cookies(challenge), origin },
        method: 'POST',
      }),
    )
    const sid = cookies(verify).match(/__Host-tempo-id\.sid=([^;]+)/)?.[1]

    expect(verify.status).toBe(200)
    expect(await verify.json()).toEqual({
      session: { account: account.address, method: 'siwe' },
    })
    expect(await accounts.backend.get({ id: sid! })).toMatchObject({
      address: account.address,
      method: 'siwe',
    })
    // Without the token mode, the session's ID reads only from its cookie.
    expect(
      await accounts.session.get(
        new Request(`${origin}/v1/notes`, {
          headers: { authorization: `Bearer ${sid}` },
        }),
      ),
    ).toBeUndefined()
    expect(
      await accounts.session.get(
        new Request(`${origin}/v1/notes`, {
          headers: { cookie: `__Host-tempo-id.sid=${sid}` },
        }),
      ),
    ).toMatchObject({ address: account.address, method: 'siwe' })
  })

  describe('in the token mode', () => {
    const api = 'https://api.example.com'

    test("signs in from the page on the plugin's origin without a cookie, and the bearer token reads and ends the session", async () => {
      const accounts = tokenInstance()
      const account = privateKeyToAccount(generatePrivateKey())

      const preflight = await accounts.handler.fetch(
        new Request(`${api}/accounts/auth/siwe/challenge`, {
          headers: {
            'access-control-request-headers': 'content-type',
            'access-control-request-method': 'POST',
            origin,
          },
          method: 'OPTIONS',
        }),
      )
      const challenge = await accounts.handler.fetch(
        new Request(`${api}/accounts/auth/siwe/challenge`, {
          body: '{}',
          headers: { 'content-type': 'application/json', origin },
          method: 'POST',
        }),
      )
      const issued = (await challenge.json()) as { id: string; message: string }
      const verify = await accounts.handler.fetch(
        new Request(`${api}/accounts/auth/siwe`, {
          body: JSON.stringify({
            address: account.address,
            id: issued.id,
            message: issued.message,
            signature: await account.signMessage({ message: issued.message }),
          }),
          headers: { 'content-type': 'application/json', origin },
          method: 'POST',
        }),
      )
      const verified = (await verify.json()) as { token: string }
      const authorization = `Bearer ${verified.token}`
      const read = await accounts.session.get(
        new Request(`${api}/v1/notes`, { headers: { authorization } }),
      )
      const page = await accounts.handler.fetch(
        new Request(`${api}/accounts/auth/session`, {
          headers: { authorization, origin },
        }),
      )
      const logout = await accounts.handler.fetch(
        new Request(`${api}/accounts/auth/logout`, {
          headers: { authorization, origin },
          method: 'POST',
        }),
      )
      const ended = await accounts.session.get(
        new Request(`${api}/v1/notes`, { headers: { authorization } }),
      )

      expect({
        headers: Object.fromEntries(preflight.headers),
        status: preflight.status,
      }).toEqual({
        headers: {
          'access-control-allow-headers': 'authorization, content-type, dpop',
          'access-control-allow-methods': 'POST',
          'access-control-allow-origin': origin,
          'access-control-max-age': '600',
          vary: 'origin',
        },
        status: 204,
      })
      expect(challenge.headers.getSetCookie()).toEqual([])
      expect(challenge.headers.get('access-control-allow-origin')).toBe(origin)
      expect(Object.keys(issued)).toEqual(['id', 'message'])
      // The message names the page's origin, which Tempo ID compares with the app's redirect URI.
      expect(issued.message).toMatch(/^app\.example\.com wants you to sign in/)
      expect(issued.message).toContain('URI: https://app.example.com')
      expect(verify.headers.getSetCookie()).toEqual([])
      expect(verify.headers.get('access-control-allow-origin')).toBe(origin)
      expect(verified).toEqual({
        session: { account: account.address, method: 'siwe' },
        token: issued.id,
      })
      expect(read).toMatchObject({ address: account.address, method: 'siwe' })
      expect(await page.json()).toEqual({
        session: { account: account.address, method: 'siwe' },
      })
      expect(page.headers.get('access-control-allow-origin')).toBe(origin)
      expect(logout.status).toBe(204)
      expect(ended).toBeUndefined()
    })

    test("refuses another origin, a body without the challenge's id, a spent id, and a bearer token of a Tempo ID session", async () => {
      const accounts = tokenInstance()
      const account = privateKeyToAccount(generatePrivateKey())
      const { id: tempoId } = await accounts.backend.save({
        session: session(),
      })
      const challenge = await accounts.handler.fetch(
        new Request(`${api}/accounts/auth/siwe/challenge`, {
          headers: { origin },
          method: 'POST',
        }),
      )
      const issued = (await challenge.json()) as { id: string; message: string }
      const signed = {
        address: account.address,
        message: issued.message,
        signature: await account.signMessage({ message: issued.message }),
      }
      const verify = (body: object) =>
        accounts.handler.fetch(
          new Request(`${api}/accounts/auth/siwe/verify`, {
            body: JSON.stringify(body),
            headers: { origin },
            method: 'POST',
          }),
        )

      const foreign = await accounts.handler.fetch(
        new Request(`${api}/accounts/auth/siwe/challenge`, {
          headers: { origin: 'https://evil.example' },
          method: 'POST',
        }),
      )
      const preflight = await accounts.handler.fetch(
        new Request(`${api}/accounts/auth/siwe/challenge`, {
          headers: { origin: 'https://evil.example' },
          method: 'OPTIONS',
        }),
      )
      const missing = await verify(signed)
      const first = await verify({ ...signed, id: issued.id })
      const spent = await verify({ ...signed, id: issued.id })
      const borrowed = await accounts.session.get(
        new Request(`${api}/v1/notes`, {
          headers: { authorization: `Bearer ${tempoId}` },
        }),
      )

      expect({
        allowed: foreign.headers.get('access-control-allow-origin'),
        status: foreign.status,
      }).toEqual({ allowed: null, status: 403 })
      expect(preflight.status).toBe(405)
      expect(missing.status).toBe(400)
      expect(first.status).toBe(200)
      expect({
        body: await spent.json(),
        status: spent.status,
      }).toMatchObject({ body: { error: 'invalid_request' }, status: 400 })
      expect(borrowed).toBeUndefined()
    })

    test("refuses a key authorization without the sign-in's access token, since any app may set its witness, and spends the challenge", async () => {
      const accounts = tokenInstance()
      const account = privateKeyToAccount(generatePrivateKey())
      const challenge = await accounts.handler.fetch(
        new Request(`${api}/accounts/auth/siwe/challenge`, {
          headers: { origin },
          method: 'POST',
        }),
      )
      const issued = (await challenge.json()) as { id: string; message: string }
      const verify = (body: object) =>
        accounts.handler.fetch(
          new Request(`${api}/accounts/auth/siwe`, {
            body: JSON.stringify(body),
            headers: { origin },
            method: 'POST',
          }),
        )

      const refused = await verify({
        address: account.address,
        id: issued.id,
        keyAuthorization: { witness: '0x00' },
        message: issued.message,
      })
      const spent = await verify({
        address: account.address,
        id: issued.id,
        message: issued.message,
        signature: await account.signMessage({ message: issued.message }),
      })

      expect({
        body: await refused.json(),
        status: refused.status,
      }).toMatchObject({ body: { error: 'access_denied' }, status: 403 })
      expect(spent.status).toBe(400)
    })

    test("issues the message on the body's chain among the plugin's chains, and of each of the plugin's origins, and refuses another chain, also one that the viem plugin resolves", async () => {
      const other = 'https://www.example.com'
      const accounts = tokenInstance({
        chains: [4217, 42431],
        origins: [origin, other],
      })
      const challenge = (body: unknown, from = origin, instance = accounts) =>
        instance.handler.fetch(
          new Request(`${api}/accounts/auth/siwe/challenge`, {
            body: JSON.stringify(body),
            headers: { 'content-type': 'application/json', origin: from },
            method: 'POST',
          }),
        )

      const testnet = await challenge({ chainId: 42431 })
      const second = await challenge({}, other)
      const unknown = await challenge({ chainId: 1 })
      // Without `chains`, a sign-in on another Tempo chain than the instance's is refused, since an
      // account's configuration there may hold a key that the instance's chain retired.
      const elsewhere = await challenge(
        { chainId: 42431 },
        origin,
        tokenInstance(),
      )
      const malformed = await challenge({ chainId: '42431' })

      expect(((await testnet.json()) as { message: string }).message).toContain(
        'Chain ID: 42431',
      )
      const { message } = (await second.json()) as { message: string }
      expect(second.headers.get('access-control-allow-origin')).toBe(other)
      expect(message).toMatch(/^www\.example\.com wants you to sign in/)
      expect(message).toContain('URI: https://www.example.com')
      expect(message).toContain('Chain ID: 4217')
      expect({ body: await unknown.json(), status: unknown.status }).toEqual({
        body: {
          error: 'invalid_request',
          error_description:
            "Invalid chain: the app accepts no sign-in on this chain. Request a challenge on the app's chain.",
        },
        status: 400,
      })
      expect(elsewhere.status).toBe(400)
      expect({
        body: await malformed.json(),
        status: malformed.status,
      }).toMatchObject({ body: { error: 'invalid_request' }, status: 400 })
    })
  })

  test('serves no SIWE route without the siwe plugin', async () => {
    const accounts = instance()

    const response = await accounts.handler.fetch(
      new Request(`${origin}/accounts/auth/siwe/challenge`, {
        headers: { origin },
        method: 'POST',
      }),
    )

    expect(response.status).toMatchInlineSnapshot(`404`)
  })
})

describe('session.get', () => {
  test("returns the session that the request's cookie names", async () => {
    const accounts = instance()
    const { id } = await accounts.backend.save({ session: session() })

    const [found, missing] = await Promise.all([
      accounts.session.get(
        new Request(origin, {
          headers: { cookie: `other=1; __Host-tempo-id.sid=${id}` },
        }),
      ),
      accounts.session.get(new Request(origin)),
    ])

    expect(found?.method === 'tempo-id' && found.user).toMatchInlineSnapshot(`
      {
        "email": "user@example.com",
        "id": "user_1",
      }
    `)
    expect(missing).toMatchInlineSnapshot(`undefined`)
  })
})

/** Returns the `Cookie` header that a browser sends after `response`'s `Set-Cookie` headers. */
/** Returns the `Cookie` header of a browser that received the cookies of `responses` in order. */
function cookies(...responses: readonly Response[]) {
  const jar = new Map<string, string>()
  for (const response of responses)
    for (const cookie of response.headers.getSetCookie()) {
      const [pair = ''] = cookie.split(';')
      const index = pair.indexOf('=')
      const value = pair.slice(index + 1)
      if (value) jar.set(pair.slice(0, index), value)
      else jar.delete(pair.slice(0, index))
    }
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
}

/** Returns a `Set-Cookie` value with the session ID and the start of a sign-in in progress masked. */
function masked(cookie: string) {
  return cookie
    .replace(
      /^(__Host-tempo-id\.pending\.)[\w-]+=([0-9a-z]+(?=[!:]))?/,
      (_, prefix: string, start?: string) =>
        `${prefix}<id>=${start ? '<start>' : ''}`,
    )
    .replace(/^(__Host-tempo-id\.pending=)[\w-]+/, '$1<id>')
}

/**
 * Returns an instance whose routes sit under `/auth`, with its sessions in `store` or a memory store,
 * at a Tempo ID URL where nothing listens.
 */
function instance(
  options: Pick<Accounts.create.Options, 'accessKey' | 'clientSecret'> & {
    store?: Store.Store | undefined
  } = {},
) {
  const { store, ...rest } = options

  return Accounts.create({
    ...rest,
    clientId: origin,
    handler: { basePath: '/accounts' },
    plugins: [backend({ store: store ?? Store.memory() })],
    url: 'http://127.0.0.1:9',
  })
}

/**
 * Returns an instance of the `siwe` plugin's token mode, for the pages on `options.origins`, or on
 * {@link origin}, which accepts sign-ins on `options.chains`, or on its chain.
 */
function tokenInstance(
  options: {
    chains?: readonly number[] | undefined
    origins?: readonly string[] | undefined
  } = {},
) {
  return Accounts.create({
    chain: 4217,
    clientId: origin,
    handler: { basePath: '/accounts' },
    plugins: [
      backend({ store: Store.memory() }),
      siwe({
        chains: options.chains,
        origin: options.origins ?? origin,
        token: true,
      }),
      viem({ transport: transport() }),
    ],
    url: 'http://127.0.0.1:9',
  })
}

/**
 * Returns an instance with the `siwe` plugin, whose routes sit under `/auth`, at a Tempo ID URL
 * where nothing listens, on the chain of `transport`. Each account signs with a secp256k1 key.
 */
function siweInstance() {
  return Accounts.create({
    chain: 4217,
    clientId: origin,
    handler: { basePath: '/accounts' },
    plugins: [
      backend({ store: Store.memory() }),
      siwe(),
      viem({ transport: transport() }),
    ],
    url: 'http://127.0.0.1:9',
  })
}

/**
 * Returns the transport of a scripted chain whose accounts hold no config commitment, so an owner
 * key signs for its account. The chain answers the read of a config commitment with zero, and no
 * other request.
 */
function transport() {
  return custom(
    {
      request(args: { method: string; params?: unknown }) {
        const [call] = (args.params ?? []) as [{ to?: string }?]
        const read =
          args.method === 'eth_call' &&
          call?.to?.toLowerCase() ===
            '0xaacc000000000000000000000000000000000000'
        if (!read) return Promise.reject(new Error('No node listens.'))
        return Promise.resolve(`0x${'00'.repeat(32)}`)
      },
    },
    { retryCount: 0 },
  )
}

/** Returns a session without an access key or a refresh token, so its end sends no revocation. */
function session() {
  return Session.from({
    accessToken: 'access-token',
    expiresAt: Date.now() + 60 * 60 * 1000,
    user: { email: 'user@example.com', id: 'user_1' },
  })
}

describe('callbackStatus', () => {
  const cases = [
    { code: 'invalid_grant', expected: 400, signedIn: true, status: 400 },
    { code: 'rate_limited', expected: 429, signedIn: true, status: 429 },
    { code: 'server_error', expected: 503, signedIn: true, status: 500 },
    { code: 'server_error', expected: 503, signedIn: true, status: 600 },
    { code: 'server_error', expected: 503, signedIn: true, status: 0 },
    { code: 'server_error', expected: 503, signedIn: true, status: 200 },
    { code: 'redirect_refused', expected: 503, signedIn: true, status: 0 },
    { code: 'server_error', expected: 400, signedIn: false, status: 0 },
    { code: 'access_denied', expected: 400, signedIn: false, status: 0 },
  ] as const

  for (const entry of cases)
    test(`${entry.code} with status ${entry.status}${entry.signedIn ? ' after sign-in' : ''} answers ${entry.expected}`, () => {
      const refusal = new Accounts.RequestError({
        code: entry.code,
        message: entry.code,
        signedIn: entry.signedIn,
        status: entry.status,
      })

      expect(Backend.callbackStatus(refusal)).toBe(entry.expected)
    })
})

describe('loginStatus', () => {
  const cases = [
    { code: 'invalid_client', expected: 401, status: 401 },
    { code: 'invalid_target', expected: 400, status: 400 },
    { code: 'rate_limited', expected: 503, status: 429 },
    { code: 'server_error', expected: 503, status: 500 },
    { code: 'server_error', expected: 503, status: 200 },
    { code: 'server_error', expected: 503, status: 0 },
  ] as const

  for (const entry of cases)
    test(`${entry.code} with status ${entry.status} answers ${entry.expected}`, () => {
      const refusal = new Accounts.RequestError({
        code: entry.code,
        message: entry.code,
        status: entry.status,
      })

      expect(Backend.loginStatus(refusal)).toBe(entry.expected)
    })
})
