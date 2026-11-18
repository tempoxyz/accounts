/**
 * The Worker of the backend test app, which serves the routes of each instance of the app's
 * backend, and the pages' assets at the same origin.
 *
 * | Path                    | Instance   | Serves                                                          |
 * | ----------------------- | ---------- | --------------------------------------------------------------- |
 * | `/api/*`                | `main`     | The sign-in routes, with the sessions in a Durable Object       |
 * | `/apis/deferred/*`      | An API     | The API of the resource whose policy holds no access key endpoint |
 * | `/apis/prepared/*`      | An API     | The API of the resource whose access key endpoint Tempo ID calls |
 * | `/app/*`                | `main`     | The app's own routes, which read the session's cookie           |
 * | `/assertion/*`          | `asserted` | A sign-in of the app with client assertions, and its logout token |
 * | `/fund/*`               | `main`     | A sign-in with `funding`, through the `backend` plugin's calls  |
 * | `/headless/*`           | `headless` | A sign-in with an emailed code, from the app's own form         |
 * | `/headless/refused/*`   | `refused`  | The same for an app without backend sign-in                     |
 * | `/page/*`               | `page`     | The relay route, and a route that reads a page's access token   |
 * | `/relay/api`            | `api`      | A relay through the suite's Tempo API                           |
 * | `/relay/denied`         | `denied`   | A relay whose `authorize` refuses each caller                   |
 * | `/relay/guarded`        | `guarded`  | A relay whose `validate` refuses each transaction               |
 * | `/relay/wrong-key`      | `wrong`    | A relay through the Tempo API with an API key that it refuses   |
 * | `/short/api/*`          | `short`    | The sign-in routes of the app whose access tokens are short     |
 * | `/short/app/*`          | `short`    | The app's own routes for that app                               |
 *
 * The build reads `VITE_CLIENT_ID`, `VITE_CLIENT_ID_API`, `VITE_CLIENT_ID_ASSERTION`,
 * `VITE_CLIENT_ID_HEADLESS`, `VITE_CLIENT_ID_PAGE`, `VITE_CLIENT_ID_SHORT`, `VITE_CLIENT_SECRET`,
 * `VITE_FEE_PAYER`, `VITE_PRIVATE_KEY`, `VITE_RESOURCE_DEFERRED`, `VITE_RESOURCE_PREPARED`,
 * `VITE_TEMPO_API_KEY`, `VITE_TEMPO_API_URL`, `VITE_TEMPO_ID_URL`, and `VITE_TEMPO_RPC_URL`, which
 * `test/Apps.ts` sets. Only this module reads the client secret, the private keys, and the API key,
 * so the pages' bundle holds none.
 * @module
 */
import { AccessToken, Accounts, Challenge, LogoutToken, Store } from 'accounts'
import { Connections, DurableObject, Sessions } from 'accounts/cloudflare'
import * as Internal from 'accounts/internal'
import { backend, email, relay, siwe, viem } from 'accounts/plugins'
import { env } from 'cloudflare:workers'
import { type Context, Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { csrf } from 'hono/csrf'
import { createClient, http, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Addresses, Relay } from 'viem/tempo'
import { tempoLocalnet } from 'viem/tempo/chains'

declare global {
  namespace Cloudflare {
    /** The Worker's bindings, which `env` from `cloudflare:workers` holds. */
    interface Env {
      /** The Durable Object of each connection of an API, and of each app's prepared access keys. */
      CONNECTIONS: Connections.durableObject.Namespace
      /**
       * What the routes of `/assertion/*` and `/apis/*` keep beside the Durable Objects: the session
       * IDs of each `sid`, each `sid` that a logout token ended, and the latest access key request
       * token of each API.
       */
      KEPT: KVNamespace
      /** The Durable Object of each session ID. */
      SESSIONS: Sessions.durableObject.Namespace
    }
  }
}

/** The instances whose own routes read a session's cookie. */
type Cookied = typeof main

/** The instances whose routes sign a user in with an emailed code. */
type Emailed = typeof headless

/** A transfer that a route sends. */
type Transfer = {
  /** The OUSD to send, as a decimal string. */
  amount: string
  /** The recipient. */
  to: `0x${string}`
}

/** The cookie that holds the session ID of a sign-in of `/assertion/*`. */
const assertionCookie = 'assertion'

/** Returns each client assertion of the `asserted` app, which its private key signs. */
const clientAssertion = Internal.ClientAssertion.fromPrivateKey({
  privateKey: JSON.parse(import.meta.env.VITE_PRIVATE_KEY),
})

/** The cookie that holds the session ID of a sign-in of `/fund/*`. */
const fundCookie = 'fund'

/** The cookie that holds the session ID of a sign-in of `/headless/*`. */
const headlessCookie = 'headless'

/** The seconds that an access token of the `short` app lives, as its sessions read it. */
const lifetime = 20

/** Tempo ID's URL. */
const url: string = import.meta.env.VITE_TEMPO_ID_URL

/** The account that pays the fees of the `page` and `guarded` relays. */
const feePayer = privateKeyToAccount(import.meta.env.VITE_FEE_PAYER)

/** The options that each instance shares: the suite's node, and Tempo ID. */
const shared = { chain: tempoLocalnet.id, url } as const

/**
 * Sends a request as `fetch` does, and returns each token response with a lifetime of
 * {@link lifetime} seconds. A session refreshes within 30 seconds of its expiry, so each read of a
 * session with these tokens refreshes it. Tempo ID's own lifetime of the token stays.
 */
async function shortLived(input: RequestInfo | URL, init?: RequestInit) {
  const request = new Request(input, init)
  const response = await fetch(request)
  if (new URL(request.url).pathname !== '/oauth2/token' || !response.ok)
    return response
  const body = (await response.json()) as Record<string, unknown>
  return Response.json(
    { ...body, expires_in: lifetime },
    { headers: response.headers, status: response.status },
  )
}

/**
 * The connections of each API, in the object's storage. Each object holds the client secret of the
 * OAuth app that both APIs authenticate as.
 */
export const CONNECTIONS = DurableObject.connections(() => ({
  clientSecret: import.meta.env.VITE_CLIENT_SECRET,
  url,
}))

/**
 * The session of each session ID, in the object's storage. Each object holds the client
 * authentication of its app, and the object of the `short` app reads short token lifetimes.
 */
export const SESSIONS = DurableObject.sessions((_env, options) => ({
  ...(options.clientId === import.meta.env.VITE_CLIENT_ID_ASSERTION
    ? { clientAssertion }
    : { clientSecret: import.meta.env.VITE_CLIENT_SECRET }),
  ...(options.clientId === import.meta.env.VITE_CLIENT_ID_SHORT
    ? { fetch: shortLived as typeof fetch }
    : {}),
  url,
}))

/** Returns the `viem` plugin on the suite's node. */
function node() {
  return viem({
    chain: tempoLocalnet,
    transport: http(import.meta.env.VITE_TEMPO_RPC_URL),
  })
}

/** Returns an instance of a confidential app, whose sessions live in the Durable Object. */
function confidential(options: confidential.Options) {
  return Accounts.create({
    ...shared,
    accessKey: () => ({
      expiry: '1d',
      limits: [{ limit: '100', token: 'ousd' }],
    }),
    clientId: options.clientId,
    clientSecret: import.meta.env.VITE_CLIENT_SECRET,
    handler: { basePath: options.basePath },
    plugins: [
      backend({ sessions: Sessions.durableObject(env.SESSIONS) }),
      siwe({ statement: 'Sign in to the backend test app.' }),
      node(),
    ],
  })
}

declare namespace confidential {
  type Options = {
    /** The path of the instance's handler. */
    basePath: string
    /** The app's client ID. */
    clientId: string
  }
}

/** The access key that each sign-in of `asserted`, `headless`, and `refused` requests. */
function accessKey() {
  return { expiry: '1d', limits: [{ limit: '100', token: 'ousd' }] } as const
}

/**
 * The instance of the app that authenticates with a client assertion. Tempo ID posts a logout token
 * to `/assertion/logout-token` for each of its sessions that ends at Tempo ID.
 */
const asserted = Accounts.create({
  ...shared,
  accessKey,
  clientAssertion,
  clientId: import.meta.env.VITE_CLIENT_ID_ASSERTION,
  plugins: [
    backend({ sessions: Sessions.durableObject(env.SESSIONS) }),
    node(),
  ],
})

/** Verifies each logout token that Tempo ID posts for the `asserted` app. */
const logoutTokens = LogoutToken.create(asserted.config)

/** Returns an instance that signs users in with an emailed code, with the app's client secret. */
function emailed(options: emailed.Options) {
  return Accounts.create({
    ...shared,
    accessKey,
    clientId: options.clientId,
    clientSecret: import.meta.env.VITE_CLIENT_SECRET,
    plugins: [
      backend({ sessions: Sessions.durableObject(env.SESSIONS) }),
      email(),
      node(),
    ],
  })
}

declare namespace emailed {
  type Options = {
    /** The app's client ID. */
    clientId: string
  }
}

/** The instance of the app that holds backend sign-in, and `tempo-id:sign` for a challenge. */
const headless = emailed({ clientId: import.meta.env.VITE_CLIENT_ID_HEADLESS })

/** The instance of the app without backend sign-in, whose requests Tempo ID refuses. */
const refused = emailed({ clientId: import.meta.env.VITE_CLIENT_ID })

/** The instance of the app's backend, whose handler serves `/api/*`. */
const main = confidential({
  basePath: '/api',
  clientId: import.meta.env.VITE_CLIENT_ID,
})

/** The instance of the app with short access tokens, whose handler serves `/short/api/*`. */
const short = confidential({
  basePath: '/short/api',
  clientId: import.meta.env.VITE_CLIENT_ID_SHORT,
})

/**
 * The instance behind a page that holds its own session. Its `session` reads the page's access
 * token, and its handler serves the relay route, whose fees {@link feePayer} pays.
 */
const page = Accounts.create({
  ...shared,
  clientId: import.meta.env.VITE_CLIENT_ID_PAGE,
  handler: { basePath: '/page', relay: true },
  plugins: [
    backend({ accessToken: true, store: Store.memory() }),
    node(),
    relay({ account: feePayer }),
  ],
})

/** Returns an instance that only relays, for the page's app. */
function relaying(options: relay.Options) {
  return Accounts.create({
    ...shared,
    clientId: import.meta.env.VITE_CLIENT_ID_PAGE,
    plugins: [node(), relay(options)],
  })
}

/** The relay through the suite's Tempo API, whose sponsor pays the fees. */
const api = relaying({
  apiKey: import.meta.env.VITE_TEMPO_API_KEY,
  apiUrl: import.meta.env.VITE_TEMPO_API_URL,
})

/** The relay whose `authorize` refuses each caller, also one with a valid access token. */
const denied = relaying({
  account: feePayer,
  authorize: () =>
    Response.json(
      { error: 'access_denied', error_description: 'Relay refused.' },
      { status: 403 },
    ),
})

/** The relay whose policy sponsors no transaction, so each sender pays its own fees. */
const guarded = relaying({
  plugins: [Relay.feePayer({ account: feePayer, validate: () => false })],
})

/** The relay through the Tempo API with an API key that the API does not hold. */
const wrong = relaying({
  apiKey: 'tempo:sk:accounts-e2e-unknown',
  apiUrl: import.meta.env.VITE_TEMPO_API_URL,
})

/** Returns the first 8 bytes of the SHA-256 hash of `value`, as hex. */
async function fingerprint(value: string) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return [...new Uint8Array(hash).subarray(0, 8)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/** Returns `token` with a signature that no key wrote. */
function forge(token: string) {
  return `${token.slice(0, token.lastIndexOf('.'))}.${'A'.repeat(86)}`
}

/** Returns the statement and the resource of the approval that the routes of `/approval` share. */
function approval(c: Context, account: string) {
  return {
    resources: [new URL(`/app/approval?account=${account}`, c.req.url).href],
    statement: `Approve the change of ${account}.`,
  }
}

/** Returns the app's own routes, which read the session of `accounts` from the request's cookie. */
function routes(accounts: Cookied) {
  return (
    new Hono()
      // The cookie authenticates each route, so another site's post is refused.
      .use(csrf())
      .get('/introspect', async (c) => {
        const session = await accounts.session.get(c.req.raw)
        if (session?.method !== 'tempo-id') return c.json(null, 401)
        // With `forged`, the token keeps its claims, and holds a signature that no key wrote.
        const token = c.req.query('forged')
          ? forge(session.accessToken)
          : session.accessToken
        const result = await Internal.Actions.oauth.introspect(
          accounts.config,
          { token },
        )
        if (!result.active) return c.json({ active: false })
        return c.json({
          active: true,
          clientId: result.clientId ?? null,
          userId: result.userId ?? null,
        })
      })
      .get('/jwks', async (c) => {
        const { keys } = await Internal.Actions.oauth.jwks(accounts.config)
        return c.json({ keys: keys.map((key) => key.kty) })
      })
      .get('/me', async (c) => {
        const session = await accounts.session.get(c.req.raw)
        if (!session) return c.json(null, 401)
        if (session.method === 'siwe')
          return c.json({
            address: session.address,
            chainId: session.chainId,
            method: session.method,
          })
        if (session.method !== 'tempo-id')
          return c.json({ method: session.method })
        // Each token shows as a fingerprint, so a spec compares tokens, and the proof holds none.
        return c.json({
          accessToken: await fingerprint(session.accessToken),
          account: session.accessKey?.account ?? null,
          email: session.user.email,
          expiresAt: session.expiresAt,
          key: session.accessKey?.keyAuthorization.keyId ?? null,
          method: session.method,
        })
      })
      .post('/send', async (c) => {
        const session = await accounts.session.get(c.req.raw)
        if (session?.method !== 'tempo-id') return c.json(null, 401)
        const body = await c.req.json<{ amount: string; to: `0x${string}` }>()
        // The client signs with this session's access key, which no other request reaches.
        const { receipt } = await accounts
          .viem({ session })
          .token.transferSync({
            amount: parseUnits(body.amount, 6),
            to: body.to,
            token: Addresses.ousd,
          })
        return c.json({ transactionHash: receipt.transactionHash })
      })
      .post('/pay', async (c) => {
        const session = await accounts.session.get(c.req.raw)
        if (session?.method !== 'tempo-id') return c.json(null, 401)
        const body = await c.req.json<Transfer>()
        // The session's access key sends the payment, since the instance holds no session.
        const { transaction } = await accounts.pay({
          amount: body.amount,
          session,
          to: body.to,
          token: 'ousd',
        })
        return c.json({ transaction })
      })
      .get('/userinfo', async (c) => {
        const response = await accounts.session.fetch(c.req.raw, {
          url: new URL('/oauth2/userinfo', url),
        })
        if (!response) return c.json(null, 401)
        const user = (await response.json()) as { email?: string | undefined }
        return c.json({ email: user.email ?? null, status: response.status })
      })
      .post('/approval/challenge', async (c) => {
        const session = await accounts.session.get(c.req.raw)
        if (session?.method !== 'siwe') return c.json(null, 401)
        const { message } = await accounts.siwe.challenge({
          ...approval(c, session.address),
          request: c.req.raw,
          session,
        })
        return c.json({ message })
      })
      .post('/approval/approve', async (c) => {
        const session = await accounts.session.get(c.req.raw)
        if (session?.method !== 'siwe') return c.json(null, 401)
        const body = await c.req.json<{
          message: string
          signature: `0x${string}`
        }>()
        const refusal = await accounts.siwe
          .approve({
            ...approval(c, session.address),
            message: body.message,
            request: c.req.raw,
            session,
            signature: body.signature,
          })
          .then(
            () => undefined,
            (error: Error) => {
              // An approval that does not verify, such as a spent one, is the caller's fault.
              if (error.name === 'Plugins.siwe.InvalidError')
                return error.message
              throw error
            },
          )
        if (refusal)
          return c.json(
            { error: 'access_denied', error_description: refusal },
            403,
          )
        return c.json({ approved: session.address })
      })
  )
}

/** Returns the Bearer token of the request, or an empty string, which no verifier accepts. */
function bearer(c: Context) {
  return c.req.header('authorization')?.replace(/^Bearer /, '') ?? ''
}

/** Returns what a route shows of an API's connection: its access keys by address, and its names. */
function described(connection: Internal.Connections.Connection) {
  return {
    accessKeys: connection.accessKeys.map((key) => key.keyAuthorization.keyId),
    account: connection.accessKey.account,
    clientId: connection.clientId,
    key: connection.accessKey.keyAuthorization.keyId,
    resource: connection.resource,
    userId: connection.userId,
  }
}

/** Returns the response of a refusal that a route's call threw, and throws each other error. */
function refusal(error: Error) {
  if (error instanceof AccessToken.InvalidError)
    return Response.json({ error: 'invalid_token' }, { status: 401 })
  if (error instanceof Accounts.RequestError)
    return Response.json(
      { error: error.reason ?? null, error_description: error.message },
      // A request without a response holds the status 0, which no response takes.
      { status: error.status || 502 },
    )
  throw error
}

/**
 * Returns the routes of the API of a registered resource. The API authenticates as its own OAuth
 * app, and holds an access key for each connection, in the Durable Object. An app sends its access
 * token for the resource as a Bearer token, which names the connection. The handler serves the
 * access key endpoint, at `<basePath>/access-keys`.
 */
function apis(options: apis.Options) {
  const { basePath, resource } = options
  const accounts = Accounts.create({
    ...shared,
    clientId: import.meta.env.VITE_CLIENT_ID_API,
    clientSecret: import.meta.env.VITE_CLIENT_SECRET,
    connections: Connections.durableObject(env.CONNECTIONS, { resource }),
    handler: { basePath },
    plugins: [node()],
  })
  // The routes that redeem nothing read the app and the user from the token's own claims.
  const verifier = AccessToken.create(accounts.config, {
    audience: resource,
    clientIds: 'any',
  })

  /** Returns the app and the user of the request's access token. */
  async function caller(c: Context) {
    const token = await verifier.verify({ accessToken: bearer(c) })
    return { clientId: token.clientId, userId: token.userId }
  }

  return new Hono()
    .onError(refusal)
    .post('/access-keys', async (c) => {
      const authorization = c.req.header('authorization') ?? ''
      const response = await accounts.handler.fetch(c.req.raw)
      // The token names no user, and authenticates Tempo ID, so `/replay` sends it a second time.
      // The record follows the handler, so `/replay` never spends the token of a request that
      // another test still waits for.
      if (response.ok) await env.KEPT.put(`request:${resource}`, authorization)
      return response
    })
    .get('/connection', async (c) => {
      const { connection } = await accounts.connections.connect({
        accessToken: bearer(c),
      })
      return c.json(described(connection))
    })
    .post('/replay', async (c) => {
      const authorization = await env.KEPT.get(`request:${resource}`)
      if (!authorization) return c.json(null, 404)
      const response = await accounts.handler.fetch(
        new Request(new URL(`${basePath}/access-keys`, c.req.url), {
          headers: { authorization },
          method: 'POST',
        }),
      )
      const body = (await response.json()) as { error?: string | undefined }
      return c.json({ error: body.error ?? null, status: response.status })
    })
    .post('/revoke', async (c) => {
      const receipts = await accounts.connections.revoke(await caller(c))
      return c.json({
        transactionHashes: receipts.map((receipt) => receipt.transactionHash),
      })
    })
    .post('/revoke-access-key', async (c) => {
      const body = await c.req.json<{ accessKey: `0x${string}` }>()
      const receipt = await accounts.connections.revokeAccessKey({
        ...(await caller(c)),
        accessKey: body.accessKey,
      })
      return c.json({ transactionHash: receipt?.transactionHash ?? null })
    })
    .post('/send', async (c) => {
      const { connection } = await accounts.connections.connect({
        accessToken: bearer(c),
      })
      const body = await c.req.json<Transfer>()
      // The client signs with the API's own access key of the connection.
      const { receipt } = await accounts
        .viem({ session: connection })
        .token.transferSync({
          amount: parseUnits(body.amount, 6),
          to: body.to,
          token: Addresses.ousd,
        })
      return c.json({
        from: receipt.from,
        transactionHash: receipt.transactionHash,
      })
    })
    .get('/stored', async (c) => {
      const connection = await accounts.connections.get(await caller(c))
      return c.json(connection ? described(connection) : null)
    })
}

declare namespace apis {
  type Options = {
    /** The path of the API's routes, and of its handler. */
    basePath: string
    /** The API's registered resource. */
    resource: string
  }
}

/**
 * The routes of a sign-in of the app that authenticates with a client assertion. They keep the
 * session ID in a cookie of their own, and the session IDs of each `sid`, which a logout token
 * names.
 */
const assertion = new Hono()
  .get('/login', async (c) => {
    const { id, url: location } = await asserted.backend.start({
      redirectUri: new URL('/assertion/callback', c.req.url).href,
    })
    setCookie(c, assertionCookie, id, { httpOnly: true, path: '/' })
    return c.redirect(location, 302)
  })
  .get('/callback', async (c) => {
    const id = getCookie(c, assertionCookie)
    if (!id) return c.json(null, 400)
    const session = await asserted.backend.complete({ id, url: c.req.url })
    if (session.sid) {
      // One entry per session, since one list of each `sid` loses a write of an overlapping callback.
      await env.KEPT.put(`ids:${session.sid}:${id}`, '1')
      // A logout token that arrived before this write ended none, so the session ends here.
      if (await env.KEPT.get(`ended:${session.sid}`))
        await asserted.backend.end({ id, revoke: false })
    }
    return c.redirect('/asserted/', 302)
  })
  // Tempo ID posts the form from its server, with no `Origin`, so the route sits outside `csrf()`.
  // The logout token's signature authenticates the request.
  .post('/logout-token', async (c) => {
    const form = await c.req.formData()
    const token = await logoutTokens
      .verify({ logoutToken: String(form.get('logout_token')) })
      .catch((error: unknown) => {
        if (error instanceof LogoutToken.InvalidError) return undefined
        throw error
      })
    if (!token) return c.body(null, 400)

    // A logout token lives 2 minutes, so a sign-in that completes after it reads the mark.
    await env.KEPT.put(`ended:${token.sessionId}`, '1', { expirationTtl: 120 })
    const prefix = `ids:${token.sessionId}:`
    const entries = await env.KEPT.list({ prefix })
    // Tempo ID revoked the refresh token, so a revocation of it would read as reuse.
    await Promise.all(
      entries.keys.map((entry) =>
        asserted.backend.end({
          id: entry.name.slice(prefix.length),
          revoke: false,
        }),
      ),
    )
    return c.body(null, 200)
  })
  .get('/session', async (c) => {
    const id = getCookie(c, assertionCookie)
    const session = id ? await asserted.backend.get({ id }) : undefined
    if (session?.method !== 'tempo-id') return c.json(null)
    return c.json({
      account: session.accessKey?.account ?? null,
      email: session.user.email,
    })
  })

/**
 * Returns the routes of a sign-in with an emailed code, which the app's own form sends. The
 * backend redeems the code with its client secret, so the browser visits no page of Tempo ID. The
 * routes keep the session ID in a cookie of their own.
 */
function signingIn(accounts: Emailed) {
  // The backend verifies a challenge's proof for its own app alone.
  const verifier = AccessToken.create(accounts.config)
  const client = createClient({
    chain: tempoLocalnet,
    transport: http(import.meta.env.VITE_TEMPO_RPC_URL),
  })

  return (
    new Hono()
      // The cookie authenticates `/send` and `/logout`, so another site's post is refused.
      .use(csrf())
      .onError(refusal)
      .post('/code', async (c) => {
        const body = await c.req.json<{ email: string }>()
        await accounts.email.sendCode({ email: body.email })
        return c.json({ sent: true })
      })
      .post('/logout', async (c) => {
        const id = getCookie(c, headlessCookie)
        if (id) await accounts.backend.end({ id })
        deleteCookie(c, headlessCookie, { path: '/' })
        return c.body(null, 204)
      })
      .post('/send', async (c) => {
        const id = getCookie(c, headlessCookie)
        const session = id ? await accounts.backend.get({ id }) : undefined
        if (session?.method !== 'tempo-id') return c.json(null, 401)
        const body = await c.req.json<Transfer>()
        const { receipt } = await accounts
          .viem({ session })
          .token.transferSync({
            amount: parseUnits(body.amount, 6),
            to: body.to,
            token: Addresses.ousd,
          })
        return c.json({ transactionHash: receipt.transactionHash })
      })
      .get('/session', async (c) => {
        const id = getCookie(c, headlessCookie)
        const session = id ? await accounts.backend.get({ id }) : undefined
        if (session?.method !== 'tempo-id') return c.json(null)
        return c.json({
          account: session.accessKey?.account ?? null,
          email: session.user.email,
        })
      })
      .post('/verify', async (c) => {
        const body = await c.req.json<{
          challenge?: boolean | undefined
          code: string
          email: string
        }>()
        // The challenge is the backend's own, of this request alone, so no caller chooses it.
        const challenge = body.challenge
          ? `Sign in to the backend test app: ${crypto.randomUUID()}`
          : undefined
        const session = await accounts.email.signIn({
          ...(challenge ? { challenge } : {}),
          code: body.code,
          email: body.email,
        })
        // The proof is the key authorization of this sign-in, which the access token names.
        const proved =
          challenge && session.accessKey
            ? await Challenge.verify(client, {
                accessToken: await verifier.verify({
                  accessToken: session.accessToken,
                }),
                challenge,
                keyAuthorization: session.accessKey.keyAuthorization,
              })
            : undefined
        const { id } = await accounts.backend.save({ session })
        setCookie(c, headlessCookie, id, { httpOnly: true, path: '/' })
        return c.json({
          account: session.accessKey?.account ?? null,
          email: session.user.email,
          key: session.accessKey?.keyAuthorization.keyId ?? null,
          proved: proved ?? null,
        })
      })
  )
}

/**
 * The routes of a sign-in with `funding`, which the handler's routes do not take. They call the
 * `backend` plugin's own members, and keep the session ID in a cookie of their own.
 */
const fund = new Hono()
  .get('/login', async (c) => {
    const { id, url: location } = await main.backend.start({
      funding: Internal.Funding.from(JSON.parse(c.req.query('funding')!)),
      redirectUri: new URL('/fund/callback', c.req.url).href,
    })
    setCookie(c, fundCookie, id, { httpOnly: true, path: '/' })
    return c.redirect(location, 302)
  })
  .get('/callback', async (c) => {
    const id = getCookie(c, fundCookie)
    if (!id) return c.json(null, 400)
    await main.backend.complete({ id, url: c.req.url })
    return c.redirect('/funded/', 302)
  })
  .get('/session', async (c) => {
    const id = getCookie(c, fundCookie)
    const session = id ? await main.backend.get({ id }) : undefined
    if (session?.method !== 'tempo-id') return c.json(null)
    return c.json({
      account: session.accessKey?.account ?? null,
      email: session.user.email,
    })
  })
  .post('/logout', csrf(), async (c) => {
    const id = getCookie(c, fundCookie)
    if (id) await main.backend.end({ id })
    deleteCookie(c, fundCookie, { path: '/' })
    return c.body(null, 204)
  })

// The pages' assets never reach the Worker, since `run_worker_first` sends it only these paths.
export default new Hono()
  .all('/api/*', (c) => main.handler.fetch(c.req.raw))
  .route(
    '/apis/deferred',
    apis({
      basePath: '/apis/deferred',
      resource: import.meta.env.VITE_RESOURCE_DEFERRED,
    }),
  )
  .route(
    '/apis/prepared',
    apis({
      basePath: '/apis/prepared',
      resource: import.meta.env.VITE_RESOURCE_PREPARED,
    }),
  )
  .route('/app', routes(main))
  .route('/assertion', assertion)
  .route('/fund', fund)
  // The longer path comes first, since the first route that matches a path answers it.
  .route('/headless/refused', signingIn(refused))
  .route('/headless', signingIn(headless))
  // The page's access token names the user, as a session's cookie does for the other routes.
  .get('/page/bearer', async (c) => {
    const session = await page.session.get(c.req.raw)
    if (session?.method !== 'access-token') return c.json(null, 401)
    return c.json({
      accounts: session.token.accounts,
      clientId: session.token.clientId,
      method: session.method,
    })
  })
  .all('/page/*', (c) => page.handler.fetch(c.req.raw))
  .post('/relay/api', (c) => api.relay.fetch(c.req.raw))
  .post('/relay/denied', (c) => denied.relay.fetch(c.req.raw))
  .post('/relay/guarded', (c) => guarded.relay.fetch(c.req.raw))
  .post('/relay/wrong-key', (c) => wrong.relay.fetch(c.req.raw))
  .all('/short/api/*', (c) => short.handler.fetch(c.req.raw))
  .route('/short/app', routes(short))
