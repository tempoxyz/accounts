/**
 * An internal API that verifies Bearer tokens and allowlists the calling apps, and serves MPP
 * payments to any caller.
 * @module
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import * as Mpp from './Mpp.ts'

/** Configuration, each value with a default. */
export type Env = Mpp.Env & {
  /** The apps that may call the API, comma-separated. Defaults to the playgrounds' apps. */
  ALLOWED_CLIENT_IDS?: string | undefined
  /** A suffix for each default client ID, such as `-pr-1`. */
  CLIENT_ID_SUFFIX?: string | undefined
  /** The tokens' `iss` and `aud`. Defaults to `TEMPO_ID_URL`. */
  TEMPO_ID_ISSUER?: string | undefined
  /** Tempo ID's URL, for the keys at `/oauth2/jwks`. Defaults to `http://localhost:5173`. */
  TEMPO_ID_URL?: string | undefined
  /** More web playgrounds that may call the API from a browser, comma-separated. */
  WEB_URL?: string | undefined
}

/** The playgrounds' client IDs, with the end-to-end suite's apps. */
const playgrounds = [
  'tempo-e2e-backend',
  'tempo-e2e-wagmi',
  'tempo-e2e-web',
  'tempo-e2e-web-cash',
  'tempo-e2e-web-shared',
  'tempo-example-backend',
  'tempo-example-mobile',
  'tempo-example-wagmi',
  'tempo-example-web',
  'tempo-example-web-cash',
  'tempo-example-web-shared',
] as const

// One key set per Tempo ID URL, cached across requests.
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

/**
 * Responds to `GET /me` with the caller's identity, or with 401 or 403, and to the MPP routes under
 * `/mpp`.
 */
export const app = new Hono<{ Bindings: Env }>()
  // The browser playgrounds call this API straight from the page, with its Bearer token or an MPP
  // credential. mppx reads the challenge and the receipt from their headers.
  .use((c, next) =>
    cors({
      exposeHeaders: ['Payment-Receipt', 'WWW-Authenticate'],
      origin: config(c.env).origins,
    })(c, next),
  )
  .get('/me', async (c) => {
    const env = config(c.env)
    const token = c.req.header('authorization')?.replace(/^Bearer /, '')
    if (!token) return c.json({ error: 'Sign in first.' }, 401)

    const jwks =
      keySets.get(env.url) ??
      createRemoteJWKSet(new URL('/oauth2/jwks', env.url))
    keySets.set(env.url, jwks)

    // Every access token names Tempo ID's origin in `aud`, so `client_id` identifies the app.
    const payload = await jwtVerify(token, jwks, {
      audience: env.issuer,
      issuer: env.issuer,
      // An ID token has the same issuer, and another `typ`.
      typ: 'at+jwt',
    })
      .then((result) => result.payload)
      .catch(() => undefined)
    if (!payload) return c.json({ error: 'Invalid token.' }, 401)
    if (!env.clientIds.includes(String(payload.client_id)))
      return c.json({ error: 'This app may not call this API.' }, 403)

    return c.json({ clientId: payload.client_id, userId: payload.sub }, 200)
  })
  .route('/mpp', Mpp.app)

/** The configuration, with defaults. */
function config(env: Env | undefined) {
  const url = env?.TEMPO_ID_URL || 'http://localhost:5173'
  const clientIds: readonly string[] =
    env?.ALLOWED_CLIENT_IDS?.split(',') ??
    playgrounds.map((clientId) => `${clientId}${env?.CLIENT_ID_SUFFIX ?? ''}`)
  return {
    clientIds,
    issuer: env?.TEMPO_ID_ISSUER || url,
    origins: [
      'http://localhost:5174',
      'http://127.0.0.1:5174',
      'http://localhost:5177',
      'http://127.0.0.1:5177',
      'http://localhost:5178',
      'http://127.0.0.1:5178',
      'http://localhost:5180',
      'http://127.0.0.1:5180',
      'http://localhost:5182',
      'http://127.0.0.1:5182',
      ...(env?.WEB_URL
        ? env.WEB_URL.split(',').map((url) => new URL(url).origin)
        : []),
    ],
    url,
  }
}
