/**
 * Serves the routes of the demos of "API authentication", under `/api/api-authentication`: the
 * sign-in routes of a backend, and two API routes that read the user of a request. `/me` accepts
 * the session cookie of the backend, or an access token of the page. `/token/me` accepts only an
 * access token. Both refuse a repeated DPoP proof.
 * @module
 */
import { Accounts } from 'accounts'
import { backend } from 'accounts/plugins'
import * as Store from './Store.ts'

/** The instance of one deployment. */
type Instance = ReturnType<typeof create>

/** Path that each route of the topic starts with. */
export const path = '/api/api-authentication'

/**
 * The instance of each origin that the Worker serves. The page's origin is the client ID, so only
 * a request names it. The instance holds the verifier, which caches Tempo ID's key set, so each
 * isolate keeps one for each origin.
 */
const instances = new Map<string, Instance>()

/**
 * When each DPoP proof that the isolate accepted expires, in milliseconds, by proof ID. The isolate
 * checks it and adds to it in one synchronous step, so two requests of one isolate never both
 * accept a proof. The store covers the other isolates, within the limits of KV.
 */
const proofs = new Map<string, number>()

/** The store of the topic: the sessions of the backend, and each accepted DPoP proof. */
const store = Store.create({ prefix: 'api-authentication:' })

/**
 * Answers a request to a route of the topic.
 *
 * | Route | Result |
 * | --- | --- |
 * | `GET /me` | Returns `{ method, userId }` for a session cookie or an access token, or 401 |
 * | `GET /token/me` | Returns `{ method, userId }` for an access token, or 401 |
 * | `POST /auth/login`, `POST /auth/callback` | Sign a user in through the dialog of the page |
 * | `GET /auth/session` | Returns the session of the cookie |
 * | `POST /auth/logout` | Ends the session of the cookie |
 */
export async function fetch(request: Request): Promise<Response> {
  const { origin, pathname } = new URL(request.url)

  const accounts = instances.get(origin) ?? create({ origin })
  instances.set(origin, accounts)

  if (pathname.startsWith(`${path}/auth/`))
    return accounts.handler.fetch(request)
  const route = pathname.slice(path.length)
  if (route !== '/me' && route !== '/token/me')
    return Response.json({ error: 'not_found' }, { status: 404 })
  if (request.method !== 'GET')
    return Response.json(
      { error: 'method_not_allowed' },
      { headers: { allow: 'GET' }, status: 405 },
    )

  // A page sends each cookie of its origin with a request. The token route reads none, so the
  // session cookie of the backend never authenticates a request without an access token.
  const headers = new Headers(request.headers)
  if (route === '/token/me') headers.delete('cookie')

  const session = await accounts.session
    .get(new Request(request, { headers }))
    .catch((error: unknown) => {
      // Without Tempo ID's key set, a valid token cannot verify, so the request is not refused.
      if (error instanceof Accounts.RequestError && error.status === 0)
        return error
      throw error
    })
  if (session instanceof Accounts.RequestError)
    return answer({ error: 'temporarily_unavailable' }, { status: 503 })

  if (session?.method === 'tempo-id')
    return answer({ method: session.method, userId: session.user.id })
  if (session?.method !== 'access-token')
    return answer({ error: 'invalid_token' }, { status: 401 })

  const { proof, userId } = session.token
  if (proof && !(await first(proof)))
    return answer({ error: 'invalid_dpop_proof' }, { status: 401 })
  return answer({ method: session.method, userId })
}

/** Returns a JSON response that no cache keeps, since it answers one user. */
function answer(body: unknown, init: ResponseInit = {}) {
  return Response.json(body, {
    ...init,
    headers: { 'cache-control': 'no-store' },
  })
}

/**
 * Creates the instance of the deployment at `origin`. Without a web app manifest, Tempo ID
 * redirects an origin client ID only to the origin's root, so the root is the redirect URI. The
 * dialog of the page receives the callback URL, and never loads it.
 */
function create(options: create.Options) {
  const { origin } = options

  return Accounts.create({
    chain: 'testnet',
    clientId: origin,
    handler: { basePath: path },
    plugins: [backend({ accessToken: true, store })],
    redirectUri: `${origin}/`,
  })
}

declare namespace create {
  type Options = {
    /** Origin of the deployment, which is its client ID. */
    origin: string
  }
}

/**
 * Records a verified DPoP proof until it expires, and returns whether the request is the first
 * with it.
 */
async function first(proof: first.Proof) {
  const now = Date.now()
  for (const [id, expiresAt] of proofs) if (expiresAt <= now) proofs.delete(id)
  if (proofs.has(proof.id)) return false
  proofs.set(proof.id, proof.expiresAt)

  const key = `proof:${proof.id}`
  if (await store.getItem(key)) return false
  await store.setItem(key, true, { expiresAt: proof.expiresAt })
  return true
}

declare namespace first {
  /** A DPoP proof that the verifier checked. */
  type Proof = {
    /** When the proof stops verifying, in milliseconds. */
    expiresAt: number
    /** ID of the proof, its `jti`. */
    id: string
  }
}
