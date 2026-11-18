/**
 * An API's connections that live outside the process: `durableObject`, in the Durable Objects of
 * a namespace.
 * @module
 */
import * as InternalConnections from '../internal/Connections.js'
import type { connections } from './DurableObject.js'
import * as Rpc from './Rpc.js'

/**
 * Returns an instance's `connections` option, which reaches the connections in the Durable Objects
 * of `namespace`, whose class `DurableObject.connections` returns: one object for each connection,
 * and one for each app's prepared access keys, since an access key request names the app but no
 * user. `options` holds the API's `resource`, and the tokens that the instance accepts. An object's
 * name holds the API's client ID and resource beside the app's client ID and the user's ID, so one
 * namespace serves several APIs.
 *
 * @throws {Accounts.RequestError} From a returned operation, for a refusal that an object returns.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { Connections, DurableObject } from 'accounts/cloudflare'
 * import { viem } from 'accounts/plugins'
 *
 * type Env = {
 *   API_CLIENT_ID: string
 *   API_CLIENT_SECRET: string
 *   CONNECTIONS: Connections.durableObject.Namespace
 * }
 *
 * export const CONNECTIONS = DurableObject.connections((env: Env) => ({
 *   clientSecret: env.API_CLIENT_SECRET,
 * }))
 *
 * // In each request of the Worker:
 * const accounts = Accounts.create({
 *   clientId: env.API_CLIENT_ID,
 *   clientSecret: env.API_CLIENT_SECRET,
 *   connections: Connections.durableObject(env.CONNECTIONS, {
 *     resource: 'https://api.example/mcp',
 *   }),
 *   plugins: [viem()],
 * })
 * ```
 */
export function durableObject(
  namespace: durableObject.Namespace,
  options: durableObject.Options,
): durableObject.ReturnType {
  const adapter: InternalConnections.Adapter = (api) => {
    const stub = (connection: { clientId: string; userId: string }) =>
      namespace.getByName(
        Rpc.connectionName({
          ...api,
          clientId: connection.clientId,
          userId: connection.userId,
        }),
      )
    const app = (clientId: string) =>
      namespace.getByName(Rpc.connectionName({ ...api, clientId }))

    function connect(
      options: InternalConnections.create.connect.Options & {
        pending: readonly InternalConnections.Pending[]
      },
    ): Promise<InternalConnections.create.connect.ReturnType>
    function connect(
      options: InternalConnections.create.connect.Options,
    ): Promise<
      | InternalConnections.create.connect.ReturnType
      | InternalConnections.create.connect.Unclaimed
    >
    async function connect(
      options: InternalConnections.create.connect.Options,
    ) {
      // Only the claims that the object reads cross RPC.
      const token = {
        apiAccessKeys: options.token.apiAccessKeys,
        clientId: options.token.clientId,
        issuedAt: options.token.issuedAt,
        userId: options.token.userId,
      }
      return Rpc.unwrap(
        await stub(token).resolve({
          accessToken: options.accessToken,
          pending: options.pending,
          token,
        }),
      )
    }

    return {
      connections: {
        connect,
        async get(options) {
          return Rpc.unwrap(await stub(options).get(options))
        },
        async revoke(options) {
          return Rpc.unwrap(await stub(options).revoke(options))
        },
        async revokeAccessKey(options) {
          return Rpc.unwrap(await stub(options).revokeAccessKey(options))
        },
      },
      prepared: {
        async prepare(options) {
          return Rpc.unwrap(
            await app(options.request.clientId).prepare(options),
          )
        },
        async read(options) {
          return Rpc.unwrap(await app(options.clientId).read(options))
        },
        async remove(options) {
          Rpc.unwrap(await app(options.clientId).remove(options))
        },
      },
    }
  }

  return { ...options, adapter }
}

export declare namespace durableObject {
  /**
   * The Durable Object namespace of the class that `DurableObject.connections` returns, as the
   * instance calls it: the Worker's binding. The function calls only `getByName` on it.
   */
  type Namespace = {
    /** Returns the stub of the object that `name` names. */
    getByName: (name: string) => Stub
  }

  /**
   * The API's registered `resource`, and the tokens that the instance accepts, as the `connections`
   * option takes them. `clientIds`, `issuer`, and `pendingLifetime` are optional.
   */
  type Options = Omit<InternalConnections.Options, 'adapter' | 'store'>

  /**
   * The `connections` option of `Accounts.create`: `options`, with an `adapter` that reaches the
   * objects of `namespace`.
   */
  type ReturnType = Options & {
    /**
     * Reaches the connections in the objects of `namespace`: a `Connections.Adapter` of
     * `accounts/internal`. The instance calls it once with the API's client ID and resource. It
     * returns `connections`, whose `connect`, `get`, `revoke`, and `revokeAccessKey` call the
     * object of a connection, and `prepared`, whose `prepare`, `read`, and `remove` call the
     * object of an app. A stub's own `connect` opens a TCP socket, so `connect` calls the RPC
     * method `resolve`.
     */
    adapter: InternalConnections.Adapter
  }

  /** The RPC methods of an object that the instance calls. */
  type Stub = Omit<connections.Instance, 'alarm'>
}
