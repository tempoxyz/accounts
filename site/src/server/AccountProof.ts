/**
 * Serves the routes of the demos of "Account proof", under `/api/account-proof`. A page proves a
 * Tempo Account to these routes: with the signature of a challenge that a route issues, or with a
 * message that the app's access key signs.
 * @module
 */
import { AccessToken, Accounts } from 'accounts'
import { viem } from 'accounts/plugins'
import { createClient, http, isAddress, isHex } from 'viem'
import { verifyMessage } from 'viem/actions'
import { tempoTestnet } from 'viem/chains'
import * as Store from './Store.ts'

/** Path that each route of the topic starts with. */
export const path = '/api/account-proof'

/** Time that a challenge lasts, in milliseconds. */
const challengeLifetime = 5 * 60 * 1000

/**
 * Greatest length of a challenge of a request, in characters, which bounds the key of the store.
 * A character takes up to 3 bytes.
 */
const maxChallengeLength = 160

/** Greatest length of a message of a request, in characters. */
const maxMessageLength = 256

/** Answers a request to a route of the topic. */
export function fetch(request: Request): Promise<Response> | Response {
  const { pathname } = new URL(request.url)

  if (request.method !== 'POST') return refuse('not_found', 404)
  if (pathname === `${path}/challenge`) return issue(request)
  if (pathname === `${path}/verify`) return verify(request)
  if (pathname === `${path}/message`) return verify_message(request)
  return refuse('not_found', 404)
}

/**
 * Issues a challenge, and keeps it until its expiry. The challenge names the host of the page, so
 * its signature is of no use to another server, and a random value, so no two are equal.
 */
async function issue(request: Request) {
  const challenge = `${new URL(request.url).host} asks for a proof of your Tempo Account.\nNonce: ${crypto.randomUUID()}`
  const expiresAt = Date.now() + challengeLifetime
  await challenges().setItem(challenge, expiresAt, { expiresAt })

  return Response.json({ challenge })
}

/**
 * Verifies the proof of a challenge, and returns the proven Tempo Account. The route spends the
 * challenge before it verifies the signature, so a second request with the same proof is refused,
 * also one at the same time.
 */
async function verify(request: Request) {
  const body = await read(request)
  const { address, challenge, signature } = body
  if (
    typeof address !== 'string' ||
    !isAddress(address) ||
    typeof challenge !== 'string' ||
    challenge.length > maxChallengeLength ||
    !isHex(signature)
  )
    return refuse('invalid_request', 400)

  const expiresAt = await challenges().takeItem(challenge)
  if (typeof expiresAt !== 'number' || expiresAt <= Date.now())
    return refuse('invalid_challenge', 400)

  // Viem's default mode counts the signature of the account's owner, and not of an access key.
  const client = createClient({ chain: tempoTestnet, transport: http() })
  const valid = await verifyMessage(client, {
    address,
    message: challenge,
    signature,
  })
  if (!valid) return refuse('invalid_signature', 400)

  return Response.json({ address })
}

/**
 * Verifies a message that an access key signs for a Tempo Account, and returns the account. The
 * signature counts only if the access token of the request names the access key for the account.
 *
 * The page's origin is the client ID of a demo, and each deployment has its own origin. The route
 * thus reads the client ID from the origin of its request, and accepts only the access tokens of
 * that origin. An app's server names its own client ID instead.
 */
async function verify_message(request: Request) {
  const [scheme, accessToken] =
    request.headers.get('authorization')?.split(' ') ?? []
  if (scheme?.toLowerCase() !== 'bearer' || !accessToken)
    return refuse('invalid_token', 401)

  const body = await read(request)
  const { address, message, signature } = body
  if (
    typeof address !== 'string' ||
    !isAddress(address) ||
    typeof message !== 'string' ||
    message.length > maxMessageLength ||
    !isHex(signature)
  )
    return refuse('invalid_request', 400)

  const accounts = Accounts.create({
    chain: 'testnet',
    clientId: new URL(request.url).origin,
    plugins: [viem()],
  })
  try {
    const valid = await accounts.verifyMessage({
      accessToken,
      address,
      message,
      signature,
    })
    if (!valid) return refuse('invalid_signature', 400)
  } catch (error) {
    if (error instanceof AccessToken.InvalidError)
      return refuse('invalid_token', 401)
    throw error
  }

  return Response.json({ address })
}

/** Returns the store of the challenges that `issue` keeps, each with its expiry in milliseconds. */
function challenges() {
  return Store.durableObject({ prefix: 'account-proof:challenge:' })
}

/** Returns the JSON object of the request's body, or an empty object for any other body. */
async function read(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => undefined)
  return typeof body === 'object' && body !== null
    ? (body as Record<string, unknown>)
    : {}
}

/** Returns the response that refuses a request with `error`. */
function refuse(error: string, status: number) {
  return Response.json({ error }, { status })
}
