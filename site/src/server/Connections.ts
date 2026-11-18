/**
 * Serves the routes of the demos of "Connections", under `/api/connections`. The routes are the
 * API of a registered resource: the API holds an access key for each connection, and pays for the
 * connection's user with it.
 * @module
 */
import { AccessToken, Accounts } from 'accounts'
import { tokens, viem } from 'accounts/plugins'
import { env } from 'cloudflare:workers'
import { Address, Base64, PublicKey } from 'ox'
import { parseUnits } from 'viem'
import { Addresses } from 'viem/tempo'
import * as Store from './Store.ts'

declare global {
  namespace Cloudflare {
    interface Env {
      /** Client ID of the API's OAuth app, which the resource's access key policy names. */
      CONNECTIONS_CLIENT_ID?: string
      /** Client secret of the API's OAuth app. */
      CONNECTIONS_CLIENT_SECRET?: string
      /** Identifier of the API's registered resource, such as `https://app.example/api/connections`. */
      CONNECTIONS_RESOURCE?: string
    }
  }
}

/** A request that Tempo ID sent to the access key endpoint, and that the endpoint answered. */
type AccessKeyRequest = {
  /** Address of the access key that the endpoint returned. */
  accessKey: `0x${string}`
  /** When the endpoint answered, in milliseconds. */
  at: number
  /** Client ID of the app whose connection the user approved. */
  clientId: string
}

/** Path that each route of the topic starts with. */
export const path = '/api/connections'

/** Amount of each payment, in OUSD. */
const amount = '1'

/** How long the store holds the record of an access key request, in milliseconds. */
const recordLifetime = 24 * 60 * 60 * 1000

/** Recipient of each payment, an address that no one holds. */
const recipient = '0x000000000000000000000000000000000000dEaD'

/**
 * Store of the connections, and of the record of each access key request.
 *
 * KV is eventually consistent, and each isolate holds its own instance. A payment in another
 * location can thus miss an access key that the access key endpoint prepared in the last minute,
 * and fail. The store fits a demo. An app that holds connections gives each connection one process
 * and a consistent store.
 */
const store = Store.create({ prefix: 'connections:' })

/**
 * The API, on Tempo testnet, or `undefined` on a deployment without the registration of the API.
 * One instance serves each request of the isolate, since it serializes the calls of a connection.
 */
const api = (() => {
  const {
    CONNECTIONS_CLIENT_ID: clientId,
    CONNECTIONS_CLIENT_SECRET: clientSecret,
    CONNECTIONS_RESOURCE: resource,
  } = env
  if (!clientId || !clientSecret || !resource) return undefined

  const accounts = Accounts.create({
    chain: 'testnet',
    clientId,
    clientSecret,
    connections: { resource, store },
    // The access key endpoint is `POST /api/connections/access-keys`.
    handler: { basePath: path },
    plugins: [
      // The route of the access key requests redeems nothing, so it reads the token's own claims.
      tokens({ audience: resource, clientIds: 'any' }),
      viem(),
    ],
  })
  return { accounts, resource }
})()

/** The API's instance, and the identifier of its resource. */
type Api = NonNullable<typeof api>

/**
 * Answers a request to a route of the topic. Each route answers 503 on a deployment without the
 * registration of the API.
 *
 * | Route                       | Result                                                             |
 * | --------------------------- | ------------------------------------------------------------------ |
 * | `POST /access-keys`         | Returns a new access key to Tempo ID, the access key endpoint      |
 * | `GET /access-key-requests`  | Returns the access key requests of the access token's connection   |
 * | `POST /pay`                 | Pays 1 OUSD for the user, with the access key of the connection    |
 * | `GET /resource`             | Returns the identifier of the API's registered resource            |
 * | `POST /revoke`              | Revokes the access keys of the connection                          |
 */
export async function fetch(request: Request): Promise<Response> {
  if (!api)
    return Response.json(
      {
        error: 'not_configured',
        error_description:
          'Missing registration: the deployment holds no client ID, client secret, or resource of the API.',
      },
      { status: 503 },
    )

  const route = `${request.method} ${new URL(request.url).pathname.slice(path.length)}`
  try {
    if (route === 'POST /access-keys') return await accessKeys(api, request)
    if (route === 'GET /access-key-requests')
      return await accessKeyRequests(api, request)
    if (route === 'POST /pay') return await pay(api, request)
    if (route === 'GET /resource')
      return Response.json({ resource: api.resource })
    if (route === 'POST /revoke') return await revoke(api, request)
    return Response.json({ error: 'not_found' }, { status: 404 })
  } catch (error) {
    return refusal(error)
  }
}

/**
 * Serves the access key endpoint with the instance's handler, and keeps a record of each request
 * that it answers, by the address of the access key.
 */
async function accessKeys(api: Api, request: Request) {
  const authorization = request.headers.get('authorization') ?? ''
  const response = await api.accounts.handler.fetch(request)
  if (!response.ok) return response

  // The handler verified the token, so its payload names the app of the approval.
  const claims = JSON.parse(
    Base64.toString(authorization.split('.')[1] ?? ''),
  ) as { client_id: string }
  const body = (await response.clone().json()) as { public_key: `0x${string}` }
  const accessKey = Address.fromPublicKey(PublicKey.fromHex(body.public_key))
  const at = Date.now()
  const record: AccessKeyRequest = { accessKey, at, clientId: claims.client_id }
  await store.setItem(name(accessKey), record, {
    expiresAt: at + recordLifetime,
  })
  return response
}

/**
 * Returns the record of each access key request whose access key the access token names. Tempo ID
 * names the access keys of a connection only in the connection's tokens.
 */
async function accessKeyRequests(api: Api, request: Request) {
  const token = await api.accounts.tokens.verifyAccessToken(request)
  // The route records no DPoP proof, which can repeat within its window, so it accepts only Bearer
  // tokens.
  if (!token || token.boundTo)
    return Response.json(
      {
        error: 'invalid_token',
        error_description:
          'Invalid access token: the request carries no valid access token of the resource. Sign in again.',
      },
      { status: 401 },
    )
  const records = await Promise.all(
    token.apiAccessKeys.map((entry) => store.getItem(name(entry.address))),
  )
  return Response.json({ requests: records.filter(Boolean) })
}

/**
 * Pays 1 OUSD for the user of the access token, with the access key that the API holds for the
 * connection. On testnet, the faucet funds a Tempo Account that holds less first.
 */
async function pay(api: Api, request: Request) {
  const { accounts } = api
  const { connection } = await accounts.connections.connect({
    accessToken: bearer(request),
  })
  const client = accounts.viem({ session: connection })
  const { account } = connection.accessKey

  const balance = await client.token.getBalance({
    account,
    token: Addresses.ousd,
  })
  if (balance.amount < parseUnits(amount, 6) * 2n)
    await client.faucet.fundSync({ account })

  const { transaction } = await accounts.pay({
    amount,
    session: connection,
    to: recipient,
    token: 'ousd',
  })
  return Response.json({
    accessKey: connection.accessKey.keyAuthorization.keyId,
    account,
    transactionHash: transaction,
  })
}

/**
 * Revokes each access key that the API holds for the connection of the access token. The token of
 * `connections.connect` names the connection.
 */
async function revoke(api: Api, request: Request) {
  const { accounts } = api
  const { token } = await accounts.connections.connect({
    accessToken: bearer(request),
  })
  const receipts = await accounts.connections.revoke({
    clientId: token.clientId,
    userId: token.userId,
  })
  return Response.json({
    transactionHashes: receipts.map((receipt) => receipt.transactionHash),
  })
}

/** Returns the Bearer token of the request, or an empty string, which no verifier accepts. */
function bearer(request: Request) {
  return request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
}

/** Returns the store key of the record of the access key request of `accessKey`. */
function name(accessKey: string) {
  return `access-key-request:${accessKey.toLowerCase()}`
}

/**
 * Returns the response of a refusal that a route threw. Throws each other error.
 *
 * | Refusal                                                | Status            |
 * | ------------------------------------------------------ | ----------------- |
 * | An access token that does not verify                   | 401               |
 * | A connection without an approval for a new access key  | 403               |
 * | Each other refusal of Tempo ID                         | Tempo ID's status |
 */
function refusal(error: unknown) {
  if (error instanceof AccessToken.InvalidError)
    return Response.json(
      { error: 'invalid_token', error_description: error.message },
      { status: 401 },
    )
  if (!(error instanceof Accounts.RequestError)) throw error

  const { reason } = error
  if (reason === 'connection_mismatch' || reason === 'unknown_allowance')
    return Response.json(
      { error: reason, error_description: 'Approve the connection again.' },
      { status: 403 },
    )
  return Response.json(
    { error: reason ?? error.code, error_description: error.message },
    // A request without a response holds the status 0, and a malformed response holds its own
    // status, such as 200. Neither is the status of a refusal.
    { status: error.status >= 400 ? error.status : 502 },
  )
}
