/**
 * A confidential client, like console. The server redeems the code with its secret and PKCE
 * verifier, and keeps each session through `backend`, so the browser holds only an opaque
 * session ID in an HttpOnly cookie.
 * @module
 */
import { Accounts, Actions } from 'accounts'
import { mpp } from 'accounts/mpp'
import { type Context, Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { csrf } from 'hono/csrf'
import { html } from 'hono/html'
import { Json } from 'ox'
import { http } from 'viem'
import { createClient } from 'viem/tempo'
import { tempo, tempoLocalnet, tempoTestnet } from 'viem/tempo/chains'
import * as Tokens from 'viem/tokens'
import * as Defaults from '../web/Defaults.ts'
import { backend, viem } from 'accounts/plugins'

/** OUSD, at its mainnet address on every Tempo chain. */
const ousd = Tokens.ousd(tempo.id).address

/** The message that `/sign` signs. */
const message = 'Sign in to the backend playground'

/** Returns the typed data that `/sign` signs, on the chain of the access key. */
function typedData(options: { chainId: number }) {
  return {
    domain: {
      chainId: options.chainId,
      name: 'Backend playground',
      version: '1',
    },
    message: { contents: message, nonce: 1n },
    primaryType: 'Greeting',
    types: {
      Greeting: [
        { name: 'contents', type: 'string' },
        { name: 'nonce', type: 'uint256' },
      ],
    },
  } as const
}

/** Returns a page of the playground, with its stylesheet. */
function page(options: { body: unknown }) {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <title>Backend playground</title>
        <link href="/style.css" rel="stylesheet" />
      </head>
      <body>
        <main>
          <header>
            <h1>Backend playground</h1>
          </header>
          ${options.body}
        </main>
      </body>
    </html>`
}

/** Configuration. Every value but the secret has a default. */
export type Env = {
  /** The API playground's URL. Defaults to `http://127.0.0.1:5176`. */
  API_URL?: string | undefined
  /**
   * The apps, comma-separated. The first is the default, and `/?client_id=` may select another. Each
   * shares `CLIENT_SECRET`. Defaults to `tempo-example-backend`, which `scripts/seed.ts` registers.
   */
  CLIENT_ID?: string | undefined
  /** Required. */
  CLIENT_SECRET?: string | undefined
  /** `false` signs in without an access key. Defaults to `true`. */
  KEY?: string | undefined
  /** The key's permissions, as JSON. Tempo ID fills each omitted field. */
  PERMISSIONS?: string | undefined
  /** The app's origin, such as a TLS proxy's. Defaults to the request's origin. */
  PUBLIC_URL?: string | undefined
  /** Where the server calls Tempo ID. Defaults to `TEMPO_ID_URL`. */
  TEMPO_ID_INTERNAL_URL?: string | undefined
  /** Tempo ID's URL for the browser. Defaults to `http://localhost:5173`. */
  TEMPO_ID_URL?: string | undefined
  /** A local Tempo node's RPC URL. Defaults to Tempo testnet. */
  TEMPO_RPC_URL?: string | undefined
}

type Bindings = { Bindings: Env }

/**
 * Creates the app. `tempoId` returns the instance of the app `clientId`, whose `backend` holds
 * the sessions: in memory on Node, or in one Durable Object for each session on Cloudflare Workers.
 */
export function create(options: create.Options) {
  /** Returns the instance of the request's app, or of the app `clientId`. */
  function tempoId(c: Context<Bindings>, clientId_: string = clientId(c)) {
    return options.tempoId(c.env, { clientId: clientId_ })
  }

  /**
   * Returns the request's session, or `undefined`. A refresh that fails, such as while Tempo ID is
   * unreachable, renders the sign-in instead of an error.
   */
  async function current(c: Context<Bindings>) {
    const id = sessionId(c)
    if (!id) return undefined
    try {
      return await tempoId(c).backend.get({ id })
    } catch (error) {
      console.warn('The session could not be read.', error)
      return undefined
    }
  }

  return (
    new Hono<Bindings>()
      // Another site, such as a preview on the same parent domain, cannot post the app's forms.
      .use(csrf())
      .get('/', async (c) => {
        // `?client_id=` selects one of the allowed apps for the rest of the browser session.
        const requested = c.req.query('client_id')
        if (requested && config(c.env).CLIENT_ID.includes(requested))
          setCookie(c, 'backend-client', requested, cookie(c))
        // An earlier version sealed the tokens into these cookies, which nothing reads now.
        for (const name of ['backend-oauth', 'backend-session'])
          if (read(c, { name })) clear(c, { name })
        const session = await current(c)
        const deposit = c.req.query('deposit')
        const payment = c.req.query('mpp')
        const signed = c.req.query('signed')
        // A refused sign-in, such as a denial on the approval page, returns here without a session.
        const refused =
          c.req.query('refused') === 'true'
            ? 'Tempo ID refused the sign-in. Sign in again.'
            : undefined
        const transaction = c.req.query('transaction')
        if (!session)
          return c.html(
            page({
              body: html`<section>
                  <h2>Sign in</h2>
                  <p class="muted">Sign in to continue.</p>
                  <div class="row">
                    <a class="button primary" href="/auth/start"
                      >Sign in with Tempo</a
                    >
                  </div>
                  <details>
                    <summary>Funding hint</summary>
                    <form action="/auth/start" method="get">
                      <p class="muted">
                        An account below the amount opens the funding page after
                        the approval.
                      </p>
                      <div class="row">
                        <label>
                          Amount
                          <input
                            inputmode="decimal"
                            name="funding_hint"
                            placeholder="10"
                            required
                          />
                        </label>
                        <label>
                          Currency
                          <input name="funding_currency" placeholder="USD" />
                        </label>
                        <label>
                          Token
                          <input name="funding_token" />
                        </label>
                      </div>
                      <div class="row">
                        <button>Sign in with a funding hint</button>
                      </div>
                    </form>
                  </details>
                </section>
                <p role="status">${refused ?? ''}</p>`,
            }),
          )

        // The access token never reaches the browser: the server calls the API itself, with the
        // session that the request already read.
        const response = await Actions.fetch(tempoId(c).config, {
          accessToken: session.accessToken,
          url: new URL('/me', config(c.env).API_URL),
        })
        const me: unknown = await response.json()
        return c.html(
          page({
            body: html`<section>
                <h2>Account</h2>
                <dl>
                  <dt>Email</dt>
                  <dd id="email">${session.user.email}</dd>
                  ${
                    session.key
                      ? html`<dt>Tempo Account</dt>
                          <dd id="account">${session.key.account}</dd>`
                      : ''
                  }
                </dl>
                ${
                  session.key
                    ? ''
                    : html`<p>Signed in without an access key.</p>
                        <div class="row">
                          <a class="button primary" href="/auth/start?key=true"
                            >Authorize an access key</a
                          >
                        </div>`
                }
                <form action="/auth/logout" class="row" method="post">
                  <button>Sign out</button>
                </form>
                <details>
                  <summary>Session details</summary>
                  <pre id="api">${JSON.stringify(me, null, 2)}</pre>
                  <pre>
${Json.stringify(
                      {
                        // The tokens stay on the server.
                        accessKey: session.key
                          ? {
                              account: session.key.account,
                              chainId: session.key.chainId,
                              keyAuthorization: session.key.keyAuthorization,
                            }
                          : null,
                        expiresAt: new Date(session.expiresAt).toISOString(),
                        user: session.user,
                      },
                      null,
                      2,
                    )}</pre>
                </details>
              </section>
              ${
                session.key
                  ? html`<section>
                        <h2>Fund account</h2>
                        <div class="row">
                          <a class="button primary" href="/deposit"
                            >Deposit via redirect</a
                          >
                        </div>
                        <p id="deposit" role="status">${deposit ?? ''}</p>
                      </section>
                      <section>
                        <h2>Send payments</h2>
                        <form action="/send" class="row" method="post">
                          <button class="primary">Send 0.01 OUSD</button>
                        </form>
                        <pre id="transaction">${transaction ?? ''}</pre>
                      </section>
                      <section>
                        <h2>Sign messages</h2>
                        <div class="row">
                          <form action="/sign?kind=message" method="post">
                            <button>Sign message</button>
                          </form>
                          <form action="/sign?kind=typed-data" method="post">
                            <button>Sign typed data</button>
                          </form>
                        </div>
                        <pre id="signature">${signed ?? ''}</pre>
                      </section>
                      <section>
                        <h2>MPP</h2>
                        <div class="cards">
                          <div class="card">
                            <h3>Charge</h3>
                            <p class="muted">0.01 OUSD for one request.</p>
                            <form
                              action="/mpp/charge"
                              class="row"
                              method="post"
                            >
                              <button>Pay the API an MPP charge</button>
                            </form>
                          </div>
                          <div class="card">
                            <h3>Session</h3>
                            <p class="muted">
                              Two requests of 0.01 OUSD in vouchers, then a
                              close.
                            </p>
                            <form
                              action="/mpp/session"
                              class="row"
                              method="post"
                            >
                              <button>
                                Pay the API two requests of an MPP session
                              </button>
                            </form>
                          </div>
                        </div>
                        <pre id="mpp">${payment ?? ''}</pre>
                      </section>`
                  : ''
              }`,
          }),
        )
      })
      // The playgrounds' stylesheet, which every page links.
      .get('/style.css', (c) =>
        c.body(options.stylesheet, 200, {
          'cache-control': 'max-age=300',
          'content-type': 'text/css; charset=utf-8',
        }),
      )
      // `?key=true` authorizes a key for a user who signed in without one, and `?key=false` signs in
      // without a key.
      .get('/auth/start', async (c) => {
        const key = (() => {
          const requested = c.req.query('key')
          if (requested === 'true') return true
          if (requested === 'false') return false
          return c.env?.KEY !== 'false'
        })()
        // Each sign-in gets a new session ID, which the callback sets only once the sign-in completes.
        // `accessKey` requests the key. The client pushes the request with the app's secret first, so
        // Tempo ID refuses a wrong secret here, before the sign-in page.
        // `?funding_hint=10` sends a funding hint, with `funding_currency` and `funding_token` if given.
        // The form sends an empty field, which sends no parameter.
        const amount = c.req.query('funding_hint') || undefined
        const started = await tempoId(c)
          .backend.start({
            accessKey: key ? permissions(c) : false,
            funding: amount
              ? {
                  amount,
                  currency: c.req.query('funding_currency') || undefined,
                  token: c.req.query('funding_token') || undefined,
                }
              : undefined,
            redirectUri: redirectUri(c),
          })
          .catch((error: unknown) => {
            if (error instanceof Accounts.RequestError) return error
            throw error
          })
        if (started instanceof Accounts.RequestError)
          return c.text('Sign-in failed. Start again.', 400)

        setCookie(c, 'backend-pending', started.id, {
          ...cookie(c),
          maxAge: 10 * 60,
        })
        return c.redirect(started.url, 302)
      })
      .get('/auth/callback', async (c) => {
        // The deposit page returns to the same redirect URI, with its result in place of a code.
        const request = new URL(c.req.url)
        const funded = Actions.funding.complete(tempoId(c).config, {
          redirectUri: redirectUri(c),
          url: new URL(`${request.pathname}${request.search}`, origin(c)),
        })
        if (funded)
          return c.redirect(
            `/?${new URLSearchParams({
              deposit:
                funded.status === 'received'
                  ? `Deposit received${funded.amount === undefined ? '' : `: ${funded.amount} USD`}.`
                  : 'Returned without a deposit.',
            })}`,
            302,
          )

        const id = valid(read(c, { name: 'backend-pending' }))
        if (!id) return c.text('Sign-in failed. Start again.', 400)

        const session = await tempoId(c)
          .backend.complete({ id, url: c.req.url })
          .catch((error: unknown) => {
            if (error instanceof Error) return error
            throw error
          })
        // A stale or duplicate callback must not clear a newer sign-in's cookies.
        if (
          (session instanceof Accounts.RequestError &&
            session.field === 'state') ||
          session instanceof Accounts.PendingNotFoundError
        )
          return c.text('Sign-in failed. Start again.', 400)

        clear(c, { name: 'backend-pending' })
        // Once the state matches, Tempo ID's refusal, such as a denial on the approval page, throws
        // on `code`. The sign-in sets no session, so the page shows the sign-in, or the earlier
        // session that requested a key. A callback without the state, such as a forged link, fails
        // instead.
        if (
          session instanceof Accounts.RequestError &&
          session.field === 'code'
        )
          return c.redirect('/?refused=true', 302)
        if (session instanceof Error)
          return c.text('Sign-in failed. Start again.', 400)

        // The new session replaces the browser's earlier one, whose refresh token is revoked under
        // its own app, since `?client_id=` may have selected another since.
        const previous = sessionId(c)
        const previousClientId = sessionClientId(c)
        setCookie(c, 'backend-sid', id, cookie(c))
        setCookie(c, 'backend-sid-client', clientId(c), cookie(c))
        if (previous) await end(c, { clientId: previousClientId, id: previous })
        return c.redirect('/', 302)
      })
      // Redirects to Tempo ID's deposit page for the session's Tempo Account, which returns to the
      // registered redirect URI with the result.
      .get('/deposit', async (c) => {
        const session = await current(c)
        if (!session?.key) return c.redirect('/', 302)
        const { clientId, url } = tempoId(c).config
        // The deposit funds the access key's chain.
        const chainId = Number(session.key.chainId)
        const target = new URL('/deposit', url)
        target.search = new URLSearchParams({
          address: session.key.account,
          // The page reads `mainnet` and `testnet` by name, and another chain by its ID.
          chain: (() => {
            if (chainId === tempo.id) return 'mainnet'
            if (chainId === tempoTestnet.id) return 'testnet'
            return String(chainId)
          })(),
          client_id: clientId,
          redirect_uri: redirectUri(c),
        }).toString()
        return c.redirect(target.href, 302)
      })
      // Signs a message or typed data with the session's access key, and verifies the signature on
      // chain, which holds the access key only after its first transaction.
      .post('/sign', async (c) => {
        const session = await current(c)
        if (!session?.key) return c.redirect('/', 302)
        const kind =
          c.req.query('kind') === 'typed-data' ? 'typed-data' : 'message'
        // The access key signs only on its own chain.
        const client = tempoId(c).viem({
          chainId: Number(session.key.chainId),
          session,
        })
        const reader = createClient({
          chain: client.chain,
          transport: http(config(c.env).TEMPO_RPC_URL),
        })
        const address = session.key.account
        const data = typedData({ chainId: client.chain.id })
        const signature = await (kind === 'message'
          ? client.signMessage({ message })
          : client.signTypedData(data))
        const verified = await (kind === 'message'
          ? reader.verifyMessage({
              address,
              message,
              mode: 'allowAccessKey',
              signature,
            })
          : reader.verifyTypedData({
              ...data,
              address,
              mode: 'allowAccessKey',
              signature,
            }))
        return c.redirect(
          `/?${new URLSearchParams({ signed: `${kind === 'message' ? 'Message' : 'Typed data'}. Verified: ${verified ? 'Yes' : 'No'}.\n${signature}` })}`,
          302,
        )
      })
      // Sends with the session's access key. Viem attaches its authorization to the first transaction.
      .post('/send', async (c) => {
        const session = await current(c)
        if (!session?.key) return c.redirect('/', 302)
        // The client signs with the session's key, which no other request reaches.
        const { receipt } = await tempoId(c)
          .viem({ session })
          .token.transferSync({
            amount: 10_000n,
            to: '0x000000000000000000000000000000000000dEaD',
            token: ousd,
          })
        return c.redirect(
          `/?${new URLSearchParams({ transaction: `${receipt.status} ${receipt.transactionHash}` })}`,
          302,
        )
      })
      // Pays the API playground's MPP charge from the server, with the session's access key.
      .post('/mpp/charge', async (c) => {
        const session = await current(c)
        if (!session?.key) return c.redirect('/', 302)
        const response = await tempoId(c)
          .mpp({ session })
          .fetch(new URL('/mpp/charge', config(c.env).API_URL))
        return c.redirect(
          `/?${new URLSearchParams({ mpp: `${response.status} ${await response.text()}` })}`,
          302,
        )
      })
      // Opens an MPP session with the API playground, pays two requests with vouchers of the session's
      // access key, and closes it, all in one request, since the server keeps no channel between them.
      // A failed request closes the channel too, since no later request holds the manager.
      .post('/mpp/session', async (c) => {
        const session = await current(c)
        if (!session?.key) return c.redirect('/', 302)
        const manager = tempoId(c).mpp({ session }).session()
        const url = new URL('/mpp/session', config(c.env).API_URL)
        const receipt = await (async () => {
          try {
            await manager.fetch(url)
            return (await manager.fetch(url)).receipt
          } catch (error) {
            await manager.close().catch((closeError: unknown) => {
              throw new AggregateError(
                [error, closeError],
                'An MPP request failed, and the close of its channel failed.',
              )
            })
            throw error
          }
        })()
        const closed = await manager.close()
        return c.redirect(
          `/?${new URLSearchParams({ mpp: `Spent ${receipt?.spent ?? 0} of ${receipt?.acceptedCumulative ?? 0}. Close ${closed?.status ?? 'skipped'}.` })}`,
          302,
        )
      })
      // The browser requests an icon for every page, the plain-text failure included, and the app has none.
      .get('/favicon.ico', (c) => c.body(null, 204))
      // Revokes the session's refresh token at Tempo ID, and deletes the session. Tempo ID's own
      // session stays.
      .post('/auth/logout', async (c) => {
        const id = sessionId(c)
        const sessionClient = sessionClientId(c)
        clear(c, { name: 'backend-sid' })
        clear(c, { name: 'backend-sid-client' })
        if (id) await end(c, { clientId: sessionClient, id })
        return c.redirect('/', 302)
      })
  )

  /**
   * Ends the session `id` of the app `clientId`. A revocation that fails, such as while Tempo ID is
   * unreachable, still signs the browser out, since the cookie no longer names the session.
   */
  async function end(
    c: Context<Bindings>,
    options: { clientId: string; id: string },
  ) {
    try {
      await tempoId(c, options.clientId).backend.end({ id: options.id })
    } catch (error) {
      console.warn('The session could not be ended.', error)
    }
  }
}

export declare namespace create {
  type Options = {
    /** The playgrounds' stylesheet, `web/style.css`, which `/style.css` serves. */
    stylesheet: string
    /** Returns the instance of the app `clientId`, such as one from {@link instance}. */
    tempoId: (
      env: Env | undefined,
      options: { clientId: string },
    ) => ReturnType<typeof instance>
  }
}

/**
 * Returns the configuration of the app `clientId`: its secret, and Tempo ID's URLs. Throws for an
 * app that `CLIENT_ID` does not list.
 */
export function settings(env: Env | undefined, options: { clientId: string }) {
  const values = config(env)
  if (!values.CLIENT_ID.includes(options.clientId))
    throw new Error(`Unknown client ID: ${options.clientId}.`)
  return {
    clientSecret: values.CLIENT_SECRET,
    // The server's own calls go to the internal URL, and the redirect it builds keeps the public one.
    fetch: ((input, init) => {
      const url = new URL(input instanceof Request ? input.url : input)
      if (url.origin !== new URL(values.TEMPO_ID_URL).origin)
        return fetch(input, init)
      return fetch(
        new URL(`${url.pathname}${url.search}`, values.TEMPO_ID_INTERNAL_URL),
        init,
      )
    }) as typeof fetch,
    url: values.TEMPO_ID_URL,
  }
}

/**
 * Returns the instance of the app `clientId`, with `backend`, whose `options` name where the
 * sessions live, and `viem` on the chain that `/send` sends on.
 */
export function instance(
  env: Env | undefined,
  options: { backend: backend.Options; clientId: string },
) {
  const { TEMPO_RPC_URL } = config(env)
  return Accounts.create({
    ...settings(env, { clientId: options.clientId }),
    // A local node, or Tempo testnet without a URL.
    chainId: TEMPO_RPC_URL ? tempoLocalnet.id : tempoTestnet.id,
    clientId: options.clientId,
    plugins: [
      backend(options.backend),
      // Without a URL, the transport uses the chain's own RPC.
      viem({ transport: http(TEMPO_RPC_URL) }),
      // Pays MPP endpoints with a session's access key, which a call names.
      mpp({ maxDeposit: '0.05' }),
    ],
  })
}

/**
 * The access key's permissions, from `PERMISSIONS` as ox's `Json`, with the playgrounds' own for what
 * they leave out.
 */
function permissions(c: Context<Bindings>) {
  return Defaults.fill(Json.parse(c.env?.PERMISSIONS ?? '{}'))
}

/** The configuration, with defaults. Throws without the secret. */
function config(env: Env | undefined) {
  if (!env?.CLIENT_SECRET) throw new Error('Set CLIENT_SECRET.')
  return {
    API_URL: env.API_URL || 'http://127.0.0.1:5176',
    CLIENT_ID: (env.CLIENT_ID || 'tempo-example-backend')
      .split(',')
      .map((clientId) => clientId.trim())
      .filter(Boolean),
    CLIENT_SECRET: env.CLIENT_SECRET,
    PUBLIC_URL: env.PUBLIC_URL || undefined,
    TEMPO_ID_INTERNAL_URL:
      env.TEMPO_ID_INTERNAL_URL || env.TEMPO_ID_URL || 'http://localhost:5173',
    TEMPO_ID_URL: env.TEMPO_ID_URL || 'http://localhost:5173',
    TEMPO_RPC_URL: env.TEMPO_RPC_URL || undefined,
  }
}

/**
 * The session's app: an allowed `?client_id=`, then the one that `/` stored, then the first of
 * `CLIENT_ID`.
 */
function clientId(c: Context<Bindings>) {
  const [fallback = 'tempo-example-backend', ...others] = config(
    c.env,
  ).CLIENT_ID
  const requested =
    c.req.query('client_id') ?? read(c, { name: 'backend-client' })
  return requested && others.includes(requested) ? requested : fallback
}

/**
 * The app of the browser's session, which the callback stored beside its ID, or else the selected
 * app.
 */
function sessionClientId(c: Context<Bindings>) {
  const stored = read(c, { name: 'backend-sid-client' })
  return stored && config(c.env).CLIENT_ID.includes(stored)
    ? stored
    : clientId(c)
}

/** `PUBLIC_URL`, or the request's origin, which shows `http` behind a TLS proxy. */
function origin(c: Context<Bindings>) {
  return config(c.env).PUBLIC_URL ?? new URL(c.req.url).origin
}

/** The registered redirect URI, where the sign-in and the deposit page return. */
function redirectUri(c: Context<Bindings>) {
  return new URL('/auth/callback', origin(c)).toString()
}

/** Secure cookies everywhere but plain-HTTP local development. */
function secure(c: Context<Bindings>) {
  return new URL(origin(c)).protocol === 'https:'
}

/** The session ID from the browser's cookie, or `undefined`. */
function sessionId(c: Context<Bindings>) {
  return valid(read(c, { name: 'backend-sid' }))
}

/**
 * Returns `value` if it has the shape of a session ID, 32 bytes in URL-safe Base64, so no other
 * cookie value names a Durable Object.
 */
function valid(value: string | undefined) {
  return value && /^[\w-]{43}$/.test(value) ? value : undefined
}

/** Over HTTPS, `__Host-` cookies, which a sibling host cannot shadow. */
function cookie(c: Context<Bindings>) {
  return secure(c)
    ? ({
        httpOnly: true,
        path: '/',
        prefix: 'host',
        sameSite: 'Lax',
        secure: true,
      } as const)
    : ({ httpOnly: true, path: '/', sameSite: 'Lax', secure: false } as const)
}

/** Reads the cookie `name`, with the `__Host-` prefix over HTTPS. */
function read(c: Context<Bindings>, options: { name: string }) {
  return getCookie(c, options.name, secure(c) ? 'host' : undefined)
}

/** Deletes the cookie `name`. */
function clear(c: Context<Bindings>, options: { name: string }) {
  deleteCookie(c, options.name, cookie(c))
}
