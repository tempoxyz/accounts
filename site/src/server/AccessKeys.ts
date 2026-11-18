/**
 * Serves the routes of the demo of "Bind challenges", under `/api/access-keys`: one issues a
 * challenge, and one verifies the key authorization that binds it.
 * @module
 */
import { Accounts, Challenge } from 'accounts'
import { tokens } from 'accounts/plugins'
import * as Store from './Store.ts'

/** A challenge that the issue route keeps until the verify route spends it. */
type Issued = {
  /** The message that the sign-in signs. */
  challenge: string
  /** When the challenge expires, in milliseconds. */
  expiresAt: number
}

/** The body of a request to the verify route. */
type Proof = {
  /** The ID of the challenge, as the issue route returned it. */
  id: string
  /** The signed key authorization of the sign-in, in the node's RPC format. */
  keyAuthorization: Challenge.verify.Options['keyAuthorization']
}

/** The refusal of a request without an access token of the app, or with one that fails. */
const invalidToken = {
  message: 'The access token is missing or invalid. Sign in again.',
  status: 401,
}

/** How long a challenge stays valid, in milliseconds. */
const lifetime = 5 * 60 * 1000

/** Path that each route of the topic starts with. */
export const path = '/api/access-keys'

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
 * | Route                             | Result                                                      |
 * | --------------------------------- | ----------------------------------------------------------- |
 * | `POST /api/access-keys/challenge` | Issues a challenge, and returns it with its `id`            |
 * | `POST /api/access-keys/verify`    | Verifies the proof of a challenge, and spends the challenge |
 */
export function fetch(request: Request): Promise<Response> | Response {
  const { pathname } = new URL(request.url)
  if (request.method === 'POST' && pathname === `${path}/challenge`)
    return issue(request)
  if (request.method === 'POST' && pathname === `${path}/verify`)
    return verify(request)
  return refuse('not_found', { status: 404 })
}

/** Issues a challenge for one sign-in, and keeps it for five minutes. */
async function issue(request: Request): Promise<Response> {
  const id = crypto.randomUUID()
  // The message names the origin, so a signature for one site proves nothing to another. The user
  // reads it on Tempo ID's approval page.
  const challenge = `${new URL(request.url).host} asks for proof of this sign-in.\n\nNonce: ${id}`
  const expiresAt = Date.now() + lifetime

  await store().setItem(id, { challenge, expiresAt }, { expiresAt })
  return Response.json({ challenge, id })
}

/**
 * Verifies that the key authorization of the request binds the challenge of `id`, for the user of
 * the request's access token. Spends the challenge once it verifies, and returns the Tempo Account
 * and the access key.
 */
async function verify(request: Request): Promise<Response> {
  const body = await request.json().catch(() => undefined)
  if (!isProof(body))
    return refuse('invalid_request', {
      message: 'The request holds no proof. Send `id` and `keyAuthorization`.',
      status: 400,
    })

  // The page's origin is the client ID of the demo, so each request names its own instance. An app
  // with one client ID creates one instance for the Worker.
  const clientId = new URL(request.url).origin
  const accounts = instances.get(clientId) ?? create(clientId)
  instances.set(clientId, accounts)

  const [token, issued] = await Promise.all([
    accounts.tokens.verifyAccessToken(request),
    store().getItem(body.id) as Promise<Issued | undefined>,
  ])
  if (!token) return refuse('invalid_token', invalidToken)
  if (!issued || issued.expiresAt <= Date.now())
    return refuse('unknown_challenge', {
      message:
        'The challenge is unknown, expired, or spent. Request a new challenge.',
      status: 400,
    })

  try {
    const proven = await accounts.tokens.verifyChallenge({
      accessToken: token,
      challenge: issued.challenge,
      keyAuthorization: body.keyAuthorization,
    })

    // The chain spends no witness, so the route spends the challenge. KV deletes in a second step,
    // so two requests at once can both pass. An app's store takes the challenge in one step.
    await store().removeItem(body.id)
    return Response.json(proven)
  } catch (error) {
    if (error instanceof Challenge.InvalidError)
      return refuse('invalid_proof', { message: error.message, status: 400 })
    throw error
  }
}

/** Returns whether `value` holds the fields of a {@link Proof}. */
function isProof(value: unknown): value is Proof {
  if (typeof value !== 'object' || value === null) return false
  if (!('id' in value) || typeof value.id !== 'string') return false
  return (
    'keyAuthorization' in value &&
    typeof value.keyAuthorization === 'object' &&
    value.keyAuthorization !== null
  )
}

/** Returns the refusal of `error` as a JSON response, with the fault and the fix as `message`. */
function refuse(error: string, options: refuse.Options): Response {
  const { message, status } = options
  return Response.json({ error, message }, { status })
}

declare namespace refuse {
  type Options = {
    /** The fault, then the fix. Absent for a path that holds no route. */
    message?: string | undefined
    /** The HTTP status of the response. */
    status: number
  }
}

/** Returns the store of the topic's challenges. */
function store() {
  return Store.create({ prefix: 'access-keys:' })
}
