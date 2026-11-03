/**
 * Runs `DurableObject.sessions` and `backend({ namespace })` in workerd, through the test Worker
 * in `test/fixtures/workers/sessions`, against `apps/id`: each session in the Durable Object of its ID, and
 * each refusal across RPC as its class.
 * @module
 */
import * as Path from 'node:path'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'vite-plus/test'
import { createTestHarness } from 'wrangler'
import * as Admin from '../../test/Admin.js'
import { Env, Harness } from '../../test/TempoId.js'

const admin = Admin.create()
const server = Harness.create()

/** The redirect URI of the app. */
const redirectUri = 'https://app.example.com/callback'

/** The test Worker's config, whose vars the suite sets to the app's credentials. */
const configPath = Path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'test',
  'fixtures',
  'workers',
  'sessions',
  'wrangler.json',
)

/** Where the harness serves Tempo ID, which the test Worker calls. */
let origin = ''

let worker: ReturnType<typeof createTestHarness> | undefined

beforeAll(async () => {
  const [{ url }] = await Promise.all([server.listen(), admin.listen()])
  origin = url.origin
  const realmId = `cash-${crypto.randomUUID().replaceAll('-', '')}`
  await Admin.addRealm(admin, { id: realmId, name: 'Tempo Cash' })
  const { app, clientSecret } = await Admin.createApp(admin, {
    name: 'Backend',
    redirectUris: [redirectUri],
    secret: true,
  })
  await Admin.setAppRealms(admin, { clientId: app.clientId, realms: [realmId] })

  // The app exists only once the suite registers it, so its credentials reach the Worker as vars
  // that the suite sets.
  worker = createTestHarness({
    workers: [
      {
        configPath,
        vars: {
          CLIENT_ID: app.clientId,
          CLIENT_SECRET: clientSecret!,
          URL: origin,
        },
      },
    ],
  })
  await worker.listen()
}, 120_000)

afterEach(async (context) => {
  if (context.task.result?.state === 'fail') {
    admin.debug()
    server.debug()
  }
  await Promise.all([admin.reset(), server.reset()])
})

afterAll(async () => {
  await Promise.all([admin.close(), server.close(), worker?.close()])
})

describe('sessions', () => {
  test('starts a redirect, completes it, and reads the session from the Durable Object of its ID, then ends it', async () => {
    const email = `tempo-id-test+${crypto.randomUUID()}@example.org`

    const started = (await call('start', { redirectUri })) as {
      id: string
      url: string
    }
    const completed = (await call('complete', {
      id: started.id,
      url: await follow({ cookie: await signIn({ email }), url: started.url }),
    })) as { user: { email: string } }
    const read = (await call('get', { id: started.id })) as {
      accessToken: string
      user: { email: string }
    }
    await call('end', { id: started.id })
    const ended = await call('get', { id: started.id })

    expect(started.id).toMatch(/^[\w-]{43}$/)
    expect(completed.user.email).toBe(email)
    expect(read.user.email).toBe(email)
    expect(read.accessToken).toMatch(/^ey/)
    expect(ended).toBeNull()
  })

  test("starts a redirect to the instance's redirect URI without a redirectUri, which the Durable Object's configuration leaves out", async () => {
    const email = `tempo-id-test+${crypto.randomUUID()}@example.org`

    const started = (await call('start', {})) as { id: string; url: string }
    const callback = await follow({
      cookie: await signIn({ email }),
      url: started.url,
    })
    const completed = (await call('complete', {
      id: started.id,
      url: callback,
    })) as { user: { email: string } }

    expect(new URL(callback).origin + new URL(callback).pathname).toBe(
      redirectUri,
    )
    expect(completed.user.email).toBe(email)
  })

  test("sends a request with the session's access token through the Durable Object, which holds the session's configuration", async () => {
    const email = `tempo-id-test+${crypto.randomUUID()}@example.org`
    const started = (await call('start', { redirectUri })) as {
      id: string
      url: string
    }
    await call('complete', {
      id: started.id,
      url: await follow({ cookie: await signIn({ email }), url: started.url }),
    })

    const response = (await call('fetch', {
      id: started.id,
      url: `${origin}/oauth2/userinfo`,
    })) as { body: { email: string }; status: number }
    const unknown = await call('fetch', {
      id: 'unknown',
      url: `${origin}/oauth2/userinfo`,
    })

    expect(response.status).toBe(200)
    expect(response.body.email).toBe(email)
    expect(unknown).toBeNull()
  })

  test('throws PendingNotFoundError as its class across RPC for a second callback', async () => {
    const started = (await call('start', { redirectUri })) as {
      id: string
      url: string
    }
    const callback = await follow({
      cookie: await signIn({
        email: `tempo-id-test+${crypto.randomUUID()}@example.org`,
      }),
      url: started.url,
    })
    await call('complete', { id: started.id, url: callback })

    expect(await call('complete', { id: started.id, url: callback }))
      .toMatchInlineSnapshot(`
      {
        "error": {
          "name": "Id.PendingNotFoundError",
        },
      }
    `)
  })

  test('throws a RequestError with its reason across RPC for a forged callback', async () => {
    const started = (await call('start', { redirectUri })) as { id: string }

    expect(
      await call('complete', {
        id: started.id,
        url: `${redirectUri}?code=forged&state=forged`,
      }),
    ).toMatchObject({
      error: { name: 'Id.RequestError', signedIn: false },
    })
  })
})

/**
 * Calls `tempoId.backend[action]` in the test Worker, and returns its result, or its error's name
 * and fields as `{ error }`.
 */
async function call(action: string, parameters: Record<string, unknown>) {
  const response = await worker!.getWorker('sessions').fetch('/', {
    body: JSON.stringify({ action, parameters }),
    method: 'POST',
  })
  const body = (await response.json()) as { error?: unknown; result?: unknown }
  return 'error' in body ? { error: body.error } : body.result
}

/** Follows the sign-in URL with the session cookie until it leaves Tempo ID, and returns the callback URL. */
async function follow(options: { cookie: string; url: string }) {
  let url = new URL(options.url)
  for (let hop = 0; hop < 5; hop++) {
    if (url.origin !== origin && url.origin !== Env.origin) return url.href
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

/** Signs `email` in to Tempo ID with an emailed code, and returns the session cookie. */
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
