/**
 * Serves the routes of the demo of "Sign-In With Ethereum", under `/api/siwe`: the SIWE routes of
 * `accounts.handler`, and a route that returns the account of the request's session.
 * @module
 */
import { Accounts } from 'accounts'
import { backend, siwe } from 'accounts/plugins'
import * as Store from './Store.ts'

/** Path that each route of the topic starts with. */
export const path = '/api/siwe'

/**
 * Answers a request to a route of the topic. The handler serves its sign-in routes under
 * `/api/siwe/auth`, and keeps each challenge and each session in a Durable Object, so each challenge
 * verifies once, also for concurrent requests.
 *
 * | Route                                | Result                                                 |
 * | ------------------------------------ | ------------------------------------------------------ |
 * | `POST /api/siwe/auth/siwe/challenge` | Issues the message, and sets the challenge cookie      |
 * | `POST /api/siwe/auth/siwe/verify`    | Verifies the signature, and sets the session cookie    |
 * | `GET /api/siwe/auth/session`         | Returns the session of the page                        |
 * | `POST /api/siwe/auth/logout`         | Ends the session                                       |
 * | `GET /api/siwe/account`              | Returns the account and the expiry of the SIWE session |
 */
export async function fetch(request: Request): Promise<Response> {
  const { origin, pathname } = new URL(request.url)
  // The page's origin is the client ID, and each message names it as its domain and URI.
  const accounts = Accounts.create({
    chain: 'testnet',
    clientId: origin,
    handler: { basePath: path },
    plugins: [
      backend({ store: Store.durableObject({ prefix: 'siwe:' }) }),
      siwe({ statement: 'Sign in to the demo of the accounts docs.' }),
    ],
  })

  if (pathname !== `${path}/account`) return accounts.handler.fetch(request)
  if (request.method !== 'GET')
    return Response.json({ error: 'not_found' }, { status: 404 })

  const session = await accounts.session.get(request)
  if (session?.method !== 'siwe')
    return Response.json({ error: 'invalid_token' }, { status: 401 })

  return Response.json(
    { account: session.address, expiresAt: session.expiresAt },
    { headers: { 'cache-control': 'no-store' } },
  )
}
