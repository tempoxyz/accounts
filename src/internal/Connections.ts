/**
 * The connections of a registered resource's API: for each user's connection of an app, the
 * access keys that the API holds for it, with their private keys, in a `Store` or outside the
 * process, where an `Adapter` reaches them. A policy with an access key endpoint prepares each access key before the approval, and the
 * redemption claims it. A policy without one redeems the allowance for an access key that the API
 * generates then. An instance's `connections` runs it.
 * @module
 */
import { Address, type Hex, PublicKey, Secp256k1 } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import type { JWK } from 'jose'
import type { TransactionReceipt } from 'viem'
import { type Config, RequestError } from '../Accounts.js'
import * as ConnectionsActions from '../actions/connections.js'
import type * as Permissions from '../Permissions.js'
import type { Store } from '../Store.js'
import * as AccessKey from './AccessKey.js'
import * as AccessToken from '../AccessToken.js'
import type * as Handler from './Handler.js'
import * as AccessKeyEndpoint from './handlers/AccessKeyEndpoint.js'

/**
 * One user's connection of an app to the API, with the access keys that the API holds for it. A
 * `viem` client or an `mpp` payer takes it as `session`, so `accessKey` signs for the connection's
 * account.
 */
export type Connection = {
  /** The access key that pays: the newest that the token names, or else the newest. */
  accessKey: AccessKey.AccessKey
  /**
   * Every live access key that the API holds for the connection, newest first, each with its
   * private key.
   */
  accessKeys: readonly AccessKey.AccessKey[]
  /** The client ID of the app that opened the connection, such as an MCP client. */
  clientId: string
  /** The API's registered resource. */
  resource: string
  /** The user's ID, `user_` and a ULID. */
  userId: string
}

/**
 * An access key that the access key endpoint prepared for an approval, before any redemption claims
 * it. The access key request names no user, so the access key belongs to the app until a token of
 * the connection names it.
 */
export type Pending = {
  /** The access key's address. */
  address: `0x${string}`
  /** The chain of the access key, from the access key request. */
  chainId: number
  /** The app of the connection, from the access key request. */
  clientId: string
  /** When the API discards the access key unclaimed, in milliseconds. */
  expiresAt: number
  /** The connection nonce of the access key request, which the redemption sends. */
  nonce: string
  /** The access key's secp256k1 private key. */
  privateKey: Hex.Hex
}

/**
 * The `connections` option of `Accounts.create`: the API's registered resource, the apps whose
 * tokens it accepts, and where the connections live.
 */
export type Options = {
  /**
   * The client IDs of the apps whose tokens the API accepts, or `'any'` for every app's token.
   * Defaults to `'any'`, since any app may open a connection to the resource.
   */
  clientIds?: readonly string[] | 'any' | undefined
  /**
   * Tempo ID's public origin, the `iss` of its tokens, when the instance's `url` reaches it at
   * another address. Defaults to the origin of the instance's `url`.
   */
  issuer?: string | undefined
  /**
   * The policy and key of an API that Tempo ID discovers without a registration. `accounts.handler`
   * then serves the API's protected resource metadata (RFC 9728) and its app's metadata document,
   * and the instance authenticates as that app. Absent for a registered resource.
   */
  metadata?: Metadata | undefined
  /**
   * How long the access key endpoint's access key waits for a redemption to claim it, in milliseconds.
   * The API never learns whether the user approved, so an access key that no token names by then
   * is discarded, and the user approves again. Defaults to 7 days.
   */
  pendingLifetime?: number | undefined
  /**
   * The API's resource, such as `https://api.example/mcp`, which each token that it accepts names
   * in `aud`.
   */
  resource: string
} & (
  | {
      /**
       * Reaches the connections that live outside the process, one process for each connection,
       * in place of `store`. `Connections.durableObject` of `accounts/cloudflare` returns the
       * whole option with one, which holds each connection in a Durable Object of its own, and
       * each app's prepared access keys in another. The instance verifies each token, and the
       * objects redeem the allowance.
       */
      adapter: Adapter
      store?: undefined
    }
  | {
      adapter?: undefined
      /**
       * Where the connections and the access key endpoint's access keys live, unserialized, such
       * as `Store.postgres`. Keys start with `tempo-id:api:`. Each entry passes an expiry as
       * `expiresAt` to `setItem`. One process, or one replica with connection affinity, serves
       * each connection. The store stays on the server, since each value holds an access key's
       * private key, which spends within the limits that the user approved.
       */
      store: Store
    }
)

/**
 * The access key policy and the app key of an API that Tempo ID discovers from its metadata.
 */
export type Metadata = {
  /**
   * The limits and scopes of each access key that the API holds, on the instance's chain, within
   * the headless ceiling of about $1,000. Without `scopes`, the scopes come from the limits. The
   * policy has no expiry of its own, and its access keys make only the calls that it names.
   */
  accessKey: Omit<
    Permissions.Permissions,
    'chainId' | 'expiry' | 'limits' | 'scopes'
  > & {
    limits: NonNullable<Permissions.Permissions['limits']>
    scopes?: Exclude<Permissions.Permissions['scopes'], 'any'> | undefined
  }
  /** The seconds that each access key lasts, up to 30 days. Defaults to 30 days. */
  lifetime?: number | undefined
  /** The app's `client_name`. Tempo ID names a discovered API by its host on each page. */
  name?: string | undefined
  /**
   * The private key of the API's app, as a JWK whose `kid` names it, such as an ES256 key. It signs
   * the app's client assertions. The app's document holds only its public half.
   */
  privateKey: JWK
  /**
   * More public keys that the app's document publishes beside `privateKey`'s, each with its own
   * `kid`. Tempo ID keeps a document's keys for 5 minutes, so a rotation publishes the next key here
   * first, and signs with it after that time. Only their public members appear.
   */
  publicKeys?: readonly JWK[] | undefined
}

/**
 * Returns the connections of the API `apiClientId`'s `resource` that live outside the process, and
 * its apps' prepared access keys. Every call of one connection reaches one process, so concurrent
 * requests of a connection redeem its allowance once.
 */
export type Adapter = (options: Adapter.Options) => Adapter.ReturnType

export declare namespace Adapter {
  type Options = {
    /** The client ID of the API's OAuth app. */
    apiClientId: string
    /** The API's registered resource. */
    resource: string
  }

  type ReturnType = {
    /** The connections, as {@link create} returns them for a store. */
    connections: create.ReturnType
    /** The prepared access keys of each app, as {@link pending} returns them for a store. */
    prepared: pending.ReturnType
  }
}

/** How long a prepared access key waits for a redemption by default, in milliseconds. */
const defaultPendingLifetime = 7 * 24 * 60 * 60 * 1000

/**
 * How much later than the last check of the access keys, in milliseconds, a token must be issued
 * before its `api_access_keys` decides which of them are live. It covers the skew between Tempo
 * ID's clock and the API's.
 */
const skew = 60_000

/**
 * Returns the connections of an instance's `connections` option: a verifier of the resource's
 * tokens, the access key endpoint's handler, and the connections in `store`, or those that
 * `adapter` reaches. `Accounts.create` calls it at the first call of `accounts.connections`.
 */
export function attach(auth: Config, options: Options): attach.ReturnType {
  const {
    clientIds = 'any',
    pendingLifetime = defaultPendingLifetime,
    resource,
  } = options
  const verifier = AccessToken.create(auth, {
    audience: resource,
    clientIds,
    issuer: options.issuer,
  })
  const { connections, prepared } = options.store
    ? {
        connections: create(auth, { resource, store: options.store }),
        prepared: pending(options.store, { resource }),
      }
    : options.adapter({ apiClientId: auth.clientId, resource })

  return {
    accessKeyEndpoint: AccessKeyEndpoint.create({
      prepare: (request) =>
        prepared.prepare({
          expiresAt: Date.now() + pendingLifetime,
          request,
        }),
      verifier,
    }),
    async connect(parameters) {
      const token = await verifier.verify(parameters)
      const { accessToken } = parameters
      // A stored connection answers without a request to Tempo ID, which checks a DPoP proof, so a
      // DPoP-bound token without its proof would unlock the API's access key.
      if (token.boundTo) throw new AccessToken.InvalidError()

      // A prepared access key belongs to the app until a token of the connection names it. The
      // prepared access keys are read only for the addresses that the connection does not hold.
      const result = await connections.connect({ accessToken, token })
      const { claimed, connection } =
        'connection' in result
          ? result
          : await connections.connect({
              accessToken,
              pending: await prepared.read({
                addresses: result.unclaimed,
                clientId: token.clientId,
              }),
              token,
            })
      if (claimed.length)
        await prepared.remove({ addresses: claimed, clientId: token.clientId })
      return { connection, token }
    },
    get: connections.get,
    revoke: connections.revoke,
    revokeAccessKey: connections.revokeAccessKey,
  }
}

export declare namespace attach {
  type ReturnType = {
    /**
     * The handler of the policy's access key endpoint, which Tempo ID calls at each approval. It
     * verifies the access key request token, and returns the public key of a new access key, which
     * it keeps.
     */
    accessKeyEndpoint: Handler.Handler
    /**
     * Verifies an app's access token for the resource, and returns its claims and its connection.
     * It claims each prepared access key that the token names, and otherwise redeems the
     * connection's allowance for an access key that it generates.
     */
    connect: (parameters: connect.Parameters) => Promise<connect.ReturnType>
    /** Returns the stored connection, or `undefined` without a live access key. */
    get: create.ReturnType['get']
    /** Revokes every access key of the connection, then deletes the connection. */
    revoke: create.ReturnType['revoke']
    /** Revokes one access key of the connection. */
    revokeAccessKey: create.ReturnType['revokeAccessKey']
  }

  namespace connect {
    type Parameters = {
      /** The Bearer token that the API received from the app. */
      accessToken: string
    }

    type ReturnType = {
      /** The connection, with the API's access keys, to pass as `session`. */
      connection: Connection
      /** The verified access token's claims. */
      token: AccessToken.create.Token
    }
  }
}

/**
 * Creates the connections of the API's `resource` in `store`. The instance serializes the calls of
 * each connection, so one instance serves every request of a connection: one for a single process,
 * or one Durable Object for each connection on Cloudflare Workers.
 *
 * @example
 * ```ts
 * import { Connections } from 'accounts/internal'
 *
 * const connections = Connections.create(accounts.config, { resource, store })
 * ```
 */
export function create(
  auth: Config,
  options: create.Options,
): create.ReturnType {
  const { resource, store } = options

  // The last call in progress for each connection. Each call waits for the one before it, so a
  // second request reads the access key that the first one stored.
  const queue = new Map<string, Promise<unknown>>()

  /** Runs `fn` after the calls in progress for the connection `name`. */
  function serialize<value>(name: string, fn: () => Promise<value>) {
    const previous = queue.get(name)
    const next = (async () => {
      await previous?.catch(() => undefined)
      return fn()
    })()
    queue.set(name, next)
    return next.finally(() => {
      if (queue.get(name) === next) queue.delete(name)
    })
  }

  /** Reads the connection, without its expired access keys. */
  async function read(name: string): Promise<Stored> {
    // A connection that an earlier release stored names `accessKeys` as `keys`.
    const { keys: earlier, ...stored } = ((await store.getItem(name)) ??
      {}) as Partial<Stored> & { keys?: Stored['accessKeys'] }
    return {
      ...stored,
      accessKeys: (stored.accessKeys ?? earlier ?? []).filter(
        (accessKey) => !AccessKey.expired(accessKey),
      ),
    }
  }

  /**
   * Writes the connection, which the store may delete once its last access key expires, or deletes
   * it without access keys or a pending redemption.
   */
  async function write(name: string, value: Stored) {
    if (!value.accessKeys.length && !value.pending)
      return store.removeItem(name)
    const expiries = value.accessKeys.map(
      (accessKey) =>
        KeyAuthorization.fromRpc(accessKey.keyAuthorization).expiry,
    )
    // A pending redemption, or an access key without an expiry, keeps the entry until a call
    // deletes it, since the store deletes the whole entry at its expiry.
    const expiry =
      !value.pending && expiries.every((entry): entry is number => !!entry)
        ? Math.max(...expiries)
        : undefined
    return store.setItem(
      name,
      value,
      expiry ? { expiresAt: expiry * 1000 } : {},
    )
  }

  /** Returns the connection of `accessKeys`, which pays with `accessKey`. */
  function view(
    accessKeys: readonly AccessKey.AccessKey[],
    options: {
      accessKey: AccessKey.AccessKey
      clientId: string
      userId: string
    },
  ): Connection {
    return {
      accessKey: options.accessKey,
      accessKeys,
      clientId: options.clientId,
      resource,
      userId: options.userId,
    }
  }

  /** Redeems `privateKey`'s public key, and returns its access key. */
  async function redeem(options: {
    accessToken: string
    nonce?: string | undefined
    privateKey: Hex.Hex
  }) {
    const publicKey = Secp256k1.getPublicKey({ privateKey: options.privateKey })
    const redeemed = await ConnectionsActions.connect(auth, {
      keyType: 'secp256k1',
      nonce: options.nonce,
      publicKey: PublicKey.toHex(publicKey),
      resource,
      subjectToken: options.accessToken,
    })
    const authorization = KeyAuthorization.fromRpc(redeemed.keyAuthorization)
    if (
      !Address.isEqual(authorization.address, Address.fromPublicKey(publicKey))
    )
      throw new RequestError({
        code: 'server_error',
        message:
          'Invalid key authorization: it names another access key than the one sent. Retry the request.',
        status: 200,
      })
    return AccessKey.from({
      account: redeemed.account,
      keyAuthorization: redeemed.keyAuthorization,
      privateKey: options.privateKey,
    })
  }

  /** Revokes `accessKey`, and returns the receipt, or `null` when Tempo ID holds it no longer. */
  async function revokeOne(accessKey: AccessKey.AccessKey) {
    try {
      return await ConnectionsActions.revokeAccessKey(auth, {
        accessKey: accessKey.keyAuthorization.keyId,
        account: accessKey.account,
        chainId: accessKey.chainId,
      })
    } catch (error) {
      // Tempo ID holds no live access key of the API's at the address, so none remains.
      if (error instanceof RequestError && error.reason === 'unknown_key')
        return null
      throw error
    }
  }

  function connect(
    options: create.connect.Options & { pending: readonly Pending[] },
  ): Promise<create.connect.ReturnType>
  function connect(
    options: create.connect.Options,
  ): Promise<create.connect.ReturnType | create.connect.Unclaimed>
  function connect(
    options: create.connect.Options,
  ): Promise<create.connect.ReturnType | create.connect.Unclaimed> {
    const { accessToken, token } = options
    const name = storeKey({ ...token, resource })
    return serialize(name, async () => {
      const stored = await read(name)
      const named = (accessKey: AccessKey.AccessKey) =>
        token.apiAccessKeys.some(
          (entry) =>
            entry.chainId === accessKey.chainId &&
            Address.isEqual(entry.address, accessKey.keyAuthorization.keyId),
        )

      // Without `pending`, a token that names an access key the connection does not hold returns
      // the addresses, so the caller reads their prepared access keys and calls again.
      if (!options.pending) {
        const unclaimed = token.apiAccessKeys
          .filter(
            (entry) =>
              !stored.accessKeys.some(
                (accessKey) =>
                  accessKey.chainId === entry.chainId &&
                  Address.isEqual(
                    entry.address,
                    accessKey.keyAuthorization.keyId,
                  ),
              ),
          )
          .map((entry) => entry.address)
        if (unclaimed.length) return { unclaimed }
      }

      // A token issued after the last check names every live access key, so the others are
      // revoked. An earlier token names none of the access keys that a later redemption delivered.
      const current =
        token.issuedAt !== undefined &&
        token.issuedAt > (stored.checkedAt ?? 0) + skew
      let accessKeys = current
        ? stored.accessKeys.filter(named)
        : stored.accessKeys

      const claimed: `0x${string}`[] = []
      for (const entry of options.pending ?? []) {
        if (
          accessKeys.some((accessKey) =>
            Address.isEqual(accessKey.keyAuthorization.keyId, entry.address),
          )
        ) {
          claimed.push(entry.address)
          continue
        }
        try {
          const accessKey = await redeem({
            accessToken,
            nonce: entry.nonce,
            privateKey: entry.privateKey,
          })
          accessKeys = [accessKey, ...accessKeys]
          claimed.push(entry.address)
        } catch (error) {
          // An access key of an earlier approval, which a new nonce replaced, belongs to no
          // allowance, so it is discarded.
          if (
            error instanceof RequestError &&
            error.reason === 'connection_mismatch'
          ) {
            claimed.push(entry.address)
            continue
          }
          throw error
        }
      }

      const paying =
        accessKeys.find(named) ?? (current ? undefined : accessKeys[0])
      if (paying) {
        await write(name, {
          ...stored,
          ...(claimed.length ? { checkedAt: Date.now() } : {}),
          accessKeys,
        })
        return {
          claimed,
          connection: view(accessKeys, { ...token, accessKey: paying }),
        }
      }

      // A private key that a redemption sent without a known outcome is sent again, since Tempo ID
      // returns the same key authorization for it, unless the user approved other limits or scopes
      // since. The stored access keys stay until it delivers.
      const privateKey = stored.pending ?? Secp256k1.randomPrivateKey()
      if (!stored.pending) await write(name, { ...stored, pending: privateKey })

      const accessKey = await (async () => {
        try {
          return await redeem({ accessToken, privateKey })
        } catch (error) {
          if (!(error instanceof RequestError)) throw error
          // Another app or connection holds the access key, or the access key has a key
          // authorization with other limits or scopes, so the next redemption sends a new one.
          if (
            error.reason === 'access_key_pending' ||
            error.reason === 'access_key_taken'
          )
            await write(name, { ...stored, pending: undefined })
          // Tempo ID refuses with `allowance_redeemed` only while the access key that the allowance
          // delivered is live, so the token predates that delivery on Tempo ID's clock, whatever the
          // local clock says. The stored access keys and the pending private key stay.
          // `checkedAt` moves to the token's issue time, so the same token redeems no more.
          if (error.reason === 'allowance_redeemed') {
            accessKeys = [
              ...accessKeys.filter(
                (entry) => !stored.accessKeys.includes(entry),
              ),
              ...stored.accessKeys,
            ]
            await write(name, {
              ...stored,
              accessKeys,
              checkedAt: Math.max(stored.checkedAt ?? 0, token.issuedAt ?? 0),
            })
            if (!accessKeys.length) throw error
            return undefined
          }
          if (
            error.reason !== 'connection_mismatch' &&
            error.reason !== 'unknown_allowance'
          )
            throw error
          // Without an allowance, the private key can never deliver, and Tempo ID revoked each
          // access key that the token omits. The next token issued after this check decides again.
          await write(name, { accessKeys, checkedAt: Date.now() })
          if (!accessKeys.length) throw error
          return undefined
        }
      })()
      if (!accessKey)
        return {
          claimed,
          connection: view(accessKeys, { ...token, accessKey: accessKeys[0]! }),
        }

      accessKeys = [accessKey, ...accessKeys]
      await write(name, { accessKeys, checkedAt: Date.now() })
      return { claimed, connection: view(accessKeys, { ...token, accessKey }) }
    })
  }

  return {
    connect,
    async get(options) {
      const { accessKeys } = await read(storeKey({ ...options, resource }))
      const [accessKey] = accessKeys
      if (!accessKey) return undefined
      return view(accessKeys, { ...options, accessKey })
    },
    revoke(options) {
      const name = storeKey({ ...options, resource })
      return serialize(name, async () => {
        const stored = await read(name)
        const results = await Promise.allSettled(
          stored.accessKeys.map(revokeOne),
        )

        // An access key whose revocation failed stays, so a later call revokes it again.
        const kept = stored.accessKeys.filter(
          (_, index) => results[index]?.status === 'rejected',
        )
        await write(name, { ...stored, accessKeys: kept, pending: undefined })
        const failure = results.find((result) => result.status === 'rejected')
        if (failure) throw failure.reason
        return results.flatMap((result) =>
          result.status === 'fulfilled' && result.value ? [result.value] : [],
        )
      })
    },
    revokeAccessKey(options) {
      const name = storeKey({ ...options, resource })
      return serialize(name, async () => {
        const stored = await read(name)
        const accessKey = stored.accessKeys.find((entry) =>
          Address.isEqual(entry.keyAuthorization.keyId, options.accessKey),
        )
        if (!accessKey) return null

        const receipt = await revokeOne(accessKey)
        await write(name, {
          ...stored,
          accessKeys: stored.accessKeys.filter((entry) => entry !== accessKey),
        })
        return receipt
      })
    },
  }
}

export declare namespace create {
  type Options = {
    /** The API's registered resource, such as `https://api.example/mcp`. */
    resource: string
    /** Where the connections live, unserialized. Each value holds an access key's private key. */
    store: Store
  }

  type ReturnType = {
    /**
     * Returns the connection of a verified access token, with the access keys that the API holds
     * for it. It redeems each of `pending` that the token names, and otherwise, without a live
     * access key, the connection's allowance for a new access key. A token issued more than a
     * minute after the last check names every live access key, so the connection drops the others.
     * @throws {Accounts.RequestError} For a refused redemption, such as `unknown_allowance`.
     */
    connect: {
      (
        options: connect.Options & { pending: readonly Pending[] },
      ): Promise<connect.ReturnType>
      (
        options: connect.Options,
      ): Promise<connect.ReturnType | connect.Unclaimed>
    }
    /** Returns the stored connection, or `undefined` without a live access key. */
    get: (options: get.Options) => Promise<Connection | undefined>
    /**
     * Revokes every access key of the connection on its chain, then deletes the connection. Returns
     * the receipts of the revoking transactions. An access key that Tempo ID holds no longer sends
     * none.
     * @throws {Accounts.RequestError} For a refused revocation. Its access key stays.
     */
    revoke: (options: get.Options) => Promise<readonly TransactionReceipt[]>
    /**
     * Revokes one access key of the connection on its chain. Returns the receipt, or `null` when
     * the connection holds no such access key, or Tempo ID holds it no longer.
     * @throws {Accounts.RequestError} For a refused revocation. The access key stays.
     */
    revokeAccessKey: (
      options: revokeAccessKey.Options,
    ) => Promise<TransactionReceipt | null>
  }

  namespace connect {
    type Options = {
      /** The app's access token, as the app sent it to the API. */
      accessToken: string
      /**
       * The prepared access keys of the token's app that the token names. Absent, a token that
       * names an access key the connection does not hold returns `Unclaimed`, with no change.
       */
      pending?: readonly Pending[] | undefined
      /** The access token's verified claims. */
      token: Pick<
        AccessToken.create.Token,
        'apiAccessKeys' | 'clientId' | 'issuedAt' | 'userId'
      >
    }

    type ReturnType = {
      /** The addresses of `pending` that the connection claimed, which the caller discards. */
      claimed: readonly `0x${string}`[]
      /** The connection. */
      connection: Connection
    }

    type Unclaimed = {
      /** The addresses that the token names and the connection does not hold. */
      unclaimed: readonly `0x${string}`[]
    }
  }

  namespace get {
    type Options = {
      /** The client ID of the connection's app. */
      clientId: string
      /** The user's ID. */
      userId: string
    }
  }

  namespace revokeAccessKey {
    type Options = get.Options & {
      /** The access key's address. */
      accessKey: `0x${string}`
    }
  }
}

/**
 * Returns the prepared access keys of the API's `resource` in `store`, which the access key endpoint
 * writes and the redemptions claim. Each access key request writes a marker of its `jti` and `nonce`
 * until it expires, so a repeated request returns no access key.
 *
 * @example
 * ```ts
 * import { Connections } from 'accounts/internal'
 *
 * const prepared = Connections.pending(store, { resource })
 * ```
 */
export function pending(
  store: Store,
  options: pending.Options,
): pending.ReturnType {
  const { resource } = options
  const key = (kind: string, ...parts: readonly string[]) =>
    `tempo-id:api:${kind}:${JSON.stringify([resource, ...parts])}`

  // The last claim of markers in progress. Claims run one at a time, so concurrent requests with
  // one access key request token cannot both read the markers as absent. Processes that share a store,
  // such as Redis, are not serialized, but each process that an `Adapter` reaches holds its own.
  let claiming: Promise<unknown> = Promise.resolve()

  /** Writes `markers`, and returns `false` if any of them is already written. */
  function claim(markers: readonly string[], options: { expiresAt: number }) {
    const next = claiming.then(async () => {
      const seen = await Promise.all(
        markers.map((marker) => store.getItem(marker)),
      )
      if (seen.some((value) => value !== undefined && value !== null))
        return false
      await Promise.all(
        markers.map((marker) =>
          store.setItem(marker, true, { expiresAt: options.expiresAt }),
        ),
      )
      return true
    })
    claiming = next.catch(() => undefined)
    return next
  }

  return {
    async prepare(options) {
      const { expiresAt, request } = options
      const claimed = await claim(
        [key('jti', request.id), key('nonce', request.nonce)],
        { expiresAt: request.expiresAt },
      )
      if (!claimed) return undefined

      const privateKey = Secp256k1.randomPrivateKey()
      const publicKey = Secp256k1.getPublicKey({ privateKey })
      const address = Address.fromPublicKey(publicKey)
      const entry: Pending = {
        address,
        chainId: request.chainId,
        clientId: request.clientId,
        expiresAt,
        nonce: request.nonce,
        privateKey,
      }
      await store.setItem(
        key('pending', request.clientId, address.toLowerCase()),
        entry,
        {
          expiresAt,
        },
      )
      return { keyType: 'secp256k1', publicKey: PublicKey.toHex(publicKey) }
    },
    async read(options) {
      const entries = await Promise.all(
        options.addresses.map(
          async (address) =>
            (await store.getItem(
              key('pending', options.clientId, address.toLowerCase()),
            )) as Pending | undefined,
        ),
      )
      const now = Date.now()
      return entries.filter(
        (entry): entry is Pending => !!entry && entry.expiresAt > now,
      )
    },
    async remove(options) {
      await Promise.all(
        options.addresses.map((address) =>
          store.removeItem(
            key('pending', options.clientId, address.toLowerCase()),
          ),
        ),
      )
    },
  }
}

export declare namespace pending {
  type Options = {
    /** The API's registered resource. */
    resource: string
  }

  type ReturnType = {
    /**
     * Generates an access key for a verified access key request, and keeps it until `expiresAt`.
     * Returns its public key, or `undefined` for a repeated `jti` or `nonce`.
     */
    prepare: (options: prepare.Options) => Promise<prepare.ReturnType>
    /** Returns the unexpired prepared access keys of the app at `addresses`. */
    read: (options: read.Options) => Promise<readonly Pending[]>
    /** Discards the prepared access keys of the app at `addresses`. */
    remove: (options: read.Options) => Promise<void>
  }

  namespace prepare {
    type Options = {
      /** When the access key is discarded unclaimed, in milliseconds. */
      expiresAt: number
      /** The verified access key request token's claims. */
      request: AccessToken.create.AccessKeyRequest
    }

    type ReturnType =
      | {
          /** The access key's signature scheme. */
          keyType: 'secp256k1'
          /** The access key's uncompressed public key. */
          publicKey: `0x${string}`
        }
      | undefined
  }

  namespace read {
    type Options = {
      /** The access keys' addresses. */
      addresses: readonly `0x${string}`[]
      /** The app of the access key requests. */
      clientId: string
    }
  }
}

/** A connection as the store holds it. */
type Stored = {
  /** The access keys that Tempo ID delivered for the connection, newest first. */
  accessKeys: readonly AccessKey.AccessKey[]
  /**
   * When the connection last confirmed its access keys, in milliseconds: a delivery, or a refused
   * renewal. Absent before the first.
   */
  checkedAt?: number | undefined
  /** The private key of a redemption without a known outcome, which the next one sends again. */
  pending?: Hex.Hex | undefined
}

/** Returns the store key of a connection of `resource`. */
function storeKey(options: {
  clientId: string
  resource: string
  userId: string
}) {
  return `tempo-id:api:${JSON.stringify([options.resource, options.clientId, options.userId])}`
}
