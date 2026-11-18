/**
 * The metadata routes of an API that Tempo ID discovers from its metadata: the protected resource
 * metadata (RFC 9728), which names the API's access key policy, and the metadata document of the
 * API's app, whose public key verifies the API's client assertions. `accounts.handler` serves
 * them with `connections.metadata`.
 * @module
 */
import { Hex } from 'ox'
import type * as Connections from '../Connections.js'
import * as Handler from '../Handler.js'
import * as Request from '../Request.js'

/** The longest lifetime of a discovered policy's access keys, and its default, in seconds: 30 days. */
const maxLifetime = 30 * 86_400

/** The member of the metadata that holds the access key policy. */
export const parameter = 'tempo_access_key_policy'

/**
 * The public members of each key type that the app's document publishes (RFC 7518 §6, RFC 8037),
 * beside `alg`, `kid`, and `use`. Any other member, such as a private one or the private key's
 * `key_ops`, stays out. A key of another type, such as `oct`, has no public half to publish.
 */
const publicMembers: Record<string, readonly string[] | undefined> = {
  EC: ['crv', 'x', 'y'],
  OKP: ['crv', 'x'],
  RSA: ['e', 'n'],
}

/**
 * Creates the handler of the metadata routes. It answers a `GET` of the protected resource metadata
 * at `/.well-known/oauth-protected-resource` and the resource's path, and of the app's document
 * at `clientId`. Another method receives 405. `paths` holds every path, which `Server` routes to it.
 * The policy's access key endpoint is `accessKeyEndpoint`. The app's document uses
 * `private_key_jwt` and names only the `refresh_token` grant type and no redirect URI, so the app
 * signs no user in.
 *
 * @throws {RequestError} With status 0, for permissions that a sign-in's request refuses, such as
 * empty `limits` or two limits on one token. See `Request.permissions`.
 * @throws The errors of `Permissions.resolve` for a limit that it cannot resolve, such as
 * `Permissions.TokenUnknownError` for a token symbol that the chain does not list.
 * @throws {Error} For a key that is not an EC, OKP, or RSA key, for keys without distinct `kid`s,
 * and for a `lifetime` that is not a whole number of seconds from 1 to 30 days.
 */
export function create(options: create.Options): create.ReturnType {
  const {
    accessKey,
    accessKeyEndpoint,
    authorizationServer,
    chainId,
    clientId,
    lifetime = maxLifetime,
    name,
    privateKey,
    publicKeys = [],
    resource,
  } = options
  // Tempo ID refuses a discovered policy with another lifetime.
  if (!Number.isInteger(lifetime) || lifetime <= 0 || lifetime > maxLifetime)
    throw new Error(
      `Invalid \`metadata.lifetime\`: ${lifetime} is not a whole number of seconds from 1 to ${maxLifetime}. Use a lifetime of at most 30 days.`,
    )
  const url = new URL(resource)
  // Tempo ID requests the path without a trailing `/`. RFC 9728 §3 keeps it, so both paths serve.
  const metadataPaths = [
    `/.well-known/oauth-protected-resource${url.pathname.replace(/\/$/, '')}`,
    ...(url.pathname === '/'
      ? []
      : [`/.well-known/oauth-protected-resource${url.pathname}`]),
  ]

  // The checks of a sign-in's request apply, so a policy that Tempo ID refuses fails here, at the
  // first request of the handler, not at a user's sign-in.
  const resolved = Request.permissions({ chainId }, { accessKey })
  // Tempo charges an access key's fees to its limit of the fee token, so the fee allowance follows
  // the policy's own limits, as in an app's key authorization request.
  const limits = [...(resolved.limits ?? []), ...(resolved.fees ?? [])].map(
    (entry) => ({
      limit: Hex.fromNumber(entry.limit),
      ...(entry.period ? { period: entry.period } : {}),
      token: entry.token,
    }),
  )
  const metadata = {
    authorization_servers: [authorizationServer],
    resource,
    [parameter]: {
      access_key_endpoint: accessKeyEndpoint,
      chain_id: resolved.chainId,
      client_id: clientId,
      lifetime,
      limits,
      // The metadata is public, so each scope holds only the members of a key authorization.
      scopes: resolved.scopes?.map((scope) => ({
        address: scope.address,
        ...(scope.recipients !== undefined
          ? { recipients: scope.recipients }
          : {}),
        ...(scope.selector !== undefined ? { selector: scope.selector } : {}),
      })),
    },
  }
  const keys = [privateKey, ...publicKeys].map((key, index) => {
    const members = publicMembers[key.kty ?? '']
    if (!members)
      throw new Error(
        `Unsupported \`metadata.${index === 0 ? 'privateKey' : `publicKeys.${index - 1}`}\`: a ${key.kty ?? 'typeless'} JWK has no public key to publish. Use an EC, OKP, or RSA key, such as ES256.`,
      )
    return Object.fromEntries(
      Object.entries(key).filter((entry) =>
        ['alg', 'kid', 'use', 'kty', ...members].includes(entry[0]),
      ),
    )
  })
  // Tempo ID selects the key of an assertion by its `kid`, so each published key needs its own.
  const keyIds = keys.map((key) => key.kid)
  if (
    keys.length > 1 &&
    (keyIds.some((kid) => typeof kid !== 'string' || kid === '') ||
      new Set(keyIds).size !== keys.length)
  )
    throw new Error(
      'Invalid `metadata.publicKeys`: a key has no `kid`, an empty one, or shares the `kid` of another key. Give each key its own `kid`.',
    )
  const app = {
    client_id: clientId,
    ...(name ? { client_name: name } : {}),
    grant_types: ['refresh_token'],
    jwks: { keys },
    token_endpoint_auth_method: 'private_key_jwt',
  }

  // Each document serializes once, so a GET costs no work that grows with the policy.
  const documents = new Map<string, string>([
    [new URL(clientId).pathname, JSON.stringify(app)],
    ...metadataPaths.map((path) => [path, JSON.stringify(metadata)] as const),
  ])
  return {
    ...Handler.from({
      fetch(request) {
        const document = documents.get(new URL(request.url).pathname)
        if (!document)
          return Promise.resolve(
            Response.json({ error: 'not_found' }, { status: 404 }),
          )
        if (request.method !== 'GET')
          return Promise.resolve(
            new Response(null, { headers: { allow: 'GET' }, status: 405 }),
          )
        // Tempo ID reads each document again after 5 minutes, so no cache in between holds an old
        // policy or key.
        return Promise.resolve(
          new Response(document, {
            headers: {
              'cache-control': 'no-store',
              'content-type': 'application/json',
            },
          }),
        )
      },
    }),
    paths: new Set(documents.keys()),
  }
}

export declare namespace create {
  type Options = Connections.Metadata & {
    /** The URL of the handler's access key endpoint, on the resource's origin. */
    accessKeyEndpoint: string
    /** Tempo ID's issuer, which the metadata names in `authorization_servers`. */
    authorizationServer: string
    /** The chain of the API's access keys: the instance's chain. */
    chainId: number
    /** The URL of the app's document, on the resource's origin, which is the instance's client ID. */
    clientId: string
    /** The resource's identifier, such as `https://api.example/mcp`. */
    resource: string
  }

  type ReturnType = Handler.Handler & {
    /** The paths of the documents, which `Server` routes to the handler. */
    paths: ReadonlySet<string>
  }
}
