/** Serves the routes of the demos of "Identity", under `/api/identity`. @module */
import { Accounts } from 'accounts'
import { tokens } from 'accounts/plugins'

/** Path that each route of the topic starts with. */
export const path = '/api/identity'

/** Creates the server's instance of the app at `origin`, which is the app's client ID. */
function create(origin: string) {
  return Accounts.create({
    chain: 'testnet',
    clientId: origin,
    plugins: [tokens()],
  })
}

/**
 * The instance of each origin that the Worker serves, such as a preview URL. The `tokens` plugin
 * caches Tempo ID's key set, so each origin keeps one instance.
 */
const instances = new Map<string, ReturnType<typeof create>>()

/**
 * Answers a request to a route of the topic.
 *
 * | Route                       | Result                                       |
 * | --------------------------- | -------------------------------------------- |
 * | `POST /api/identity/verify` | Verifies an ID token, and returns its claims |
 */
export function fetch(request: Request): Promise<Response> | Response {
  const { pathname } = new URL(request.url)
  if (pathname === `${path}/verify` && request.method === 'POST')
    return verify(request)
  return Response.json({ error: 'not_found' }, { status: 404 })
}

/**
 * Verifies the ID token of the request's JSON body, and returns its claims.
 *
 * The page's origin is the client ID of a demo, so the token's `aud` must name the origin of the
 * request. An app verifies against its own fixed client ID, never against a value of the request.
 *
 * A token that fails a check returns 401 with `invalid_token`. A key set that cannot be read
 * returns 503.
 */
async function verify(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => undefined)) as
    | { idToken?: unknown }
    | undefined
  if (typeof body?.idToken !== 'string')
    return Response.json({ error: 'invalid_request' }, { status: 400 })

  const clientId = origin(request)
  const accounts = instances.get(clientId) ?? create(clientId)
  instances.set(clientId, accounts)

  try {
    const token = await accounts.tokens.verifyIdToken({ idToken: body.idToken })
    if (!token)
      return Response.json({ error: 'invalid_token' }, { status: 401 })
    return Response.json({ claims: token })
  } catch (error) {
    // The key set's fetch failed, so the token can still be valid.
    if (error instanceof Accounts.RequestError && error.status === 0)
      return Response.json(
        { error: 'temporarily_unavailable' },
        { status: 503 },
      )
    throw error
  }
}

/**
 * Returns the origin of the page that sent `request`, which is the origin of the route. A proxy
 * that ends TLS before the Worker, such as that of a local run, names the page's protocol in
 * `x-forwarded-proto`.
 */
function origin(request: Request) {
  const url = new URL(request.url)
  const protocol = request.headers.get('x-forwarded-proto')
  if (protocol) url.protocol = protocol
  return url.origin
}
