/**
 * Carries the results of a backend's sessions across Durable Object RPC, which keeps no error's
 * class or fields, and no function, such as a `TempoAccount`'s, and names the Durable Objects of
 * the sessions and of an API's connections.
 * @module
 */
import {
  PendingNotFoundError,
  RedirectUriRequiredError,
  RequestError,
} from '../Accounts.js'
import * as TempoAccount from '../internal/TempoAccount.js'

/** A method's result across RPC: its value, or the refusal that it threw, as data. */
export type Result<value> =
  | { ok: true; value: value }
  | { error: Refusal; ok: false }

/** A refusal that a method returns in place of throwing it. */
export type Refusal =
  | { name: 'Accounts.PendingNotFoundError' }
  | { name: 'Accounts.RedirectUriRequiredError' }
  | { name: 'Accounts.RequestError'; options: RequestError.Options }

/**
 * A session as it crosses RPC: its account as `TempoAccount.serialize` writes it. Each member of a
 * union crosses on its own, and a session without an account crosses as it is.
 */
export type Wire<session extends object> = session extends unknown
  ? Omit<session, 'account'> & {
      /** The user's Tempo Account, serialized. */
      account?: TempoAccount.Serialized | undefined
    }
  : never

/** Runs `fn`, and returns its refusal as data. Rethrows any other error. */
export async function wrap<value>(
  fn: () => Promise<value>,
): Promise<Result<value>> {
  try {
    return { ok: true, value: await fn() }
  } catch (error) {
    if (error instanceof PendingNotFoundError)
      return { error: { name: 'Accounts.PendingNotFoundError' }, ok: false }
    if (error instanceof RedirectUriRequiredError)
      return { error: { name: 'Accounts.RedirectUriRequiredError' }, ok: false }
    if (error instanceof RequestError)
      return {
        error: {
          name: 'Accounts.RequestError',
          options: {
            code: error.code,
            field: error.field,
            message: error.message,
            meta: error.meta,
            reason: error.reason,
            signedIn: error.signedIn,
            status: error.status,
            uri: error.uri,
          },
        },
        ok: false,
      }
    throw error
  }
}

/** Returns a result's value, or throws its refusal as its class. */
export function unwrap<value>(result: Result<value>): value {
  if (result.ok) return result.value
  if (result.error.name === 'Accounts.RequestError')
    throw new RequestError(result.error.options)
  if (result.error.name === 'Accounts.RedirectUriRequiredError')
    throw new RedirectUriRequiredError()
  throw new PendingNotFoundError()
}

/** Returns a session in the form that crosses RPC. */
export function toWire<session extends object>(
  session: session,
): Wire<session> {
  const { account, ...rest } = session as {
    account?: TempoAccount.TempoAccount | undefined
  }
  return (
    account ? { ...rest, account: TempoAccount.serialize(account) } : rest
  ) as Wire<session>
}

/** Returns a session from the form that crosses RPC. */
export function fromWire<session extends object>(wire: Wire<session>): session {
  const { account, ...rest } = wire as {
    account?: TempoAccount.Serialized | undefined
  }
  return (
    account ? { ...rest, account: TempoAccount.deserialize(account) } : rest
  ) as session
}

/**
 * Returns the name of the Durable Object that holds the session `id` of the app `clientId`. Both
 * may hold any character, so the name is their JSON array.
 */
export function name(options: { clientId: string; id: string }): string {
  return JSON.stringify([options.clientId, options.id])
}

/**
 * Returns the name of the Durable Object that holds the index of the Tempo ID session `sid` of the
 * app `clientId`. Its third member keeps it apart from each name of {@link name}, and
 * {@link parseName} reads the first two.
 */
export function indexName(options: { clientId: string; sid: string }): string {
  return JSON.stringify([options.clientId, options.sid, 'sid'])
}

/** Returns the app and the session ID of a Durable Object's name from {@link name}. */
export function parseName(value: string | undefined): {
  clientId: string
  id: string
} {
  const [clientId, id] = JSON.parse(value ?? '[]') as [unknown?, unknown?]
  if (typeof clientId !== 'string' || typeof id !== 'string')
    throw new Error(
      'Invalid Durable Object name: the object holds no session. Reach it through `Sessions.durableObject`.',
    )
  return { clientId, id }
}

/**
 * Returns the name of a Durable Object of the API `apiClientId`'s `resource`: the one that holds the
 * connection of the app `clientId` and the user `userId`, or, without `userId`, the one that holds
 * the app's prepared access keys. Each part may hold any character, so the name is their JSON
 * array.
 */
export function connectionName(options: connectionName.Options): string {
  return JSON.stringify([
    options.apiClientId,
    options.resource,
    options.clientId,
    ...(options.userId !== undefined ? [options.userId] : []),
  ])
}

export declare namespace connectionName {
  type Options = {
    /** The client ID of the API's OAuth app. */
    apiClientId: string
    /** The client ID of the connection's app. */
    clientId: string
    /** The API's registered resource. */
    resource: string
    /** The user's ID. Absent for the object of the app's prepared access keys. */
    userId?: string | undefined
  }
}

/** Returns the parts of a Durable Object's name from {@link connectionName}. */
export function parseConnectionName(
  value: string | undefined,
): connectionName.Options {
  const [apiClientId, resource, clientId, userId] = JSON.parse(
    value ?? '[]',
  ) as unknown[]
  if (
    typeof apiClientId !== 'string' ||
    typeof resource !== 'string' ||
    typeof clientId !== 'string' ||
    (userId !== undefined && typeof userId !== 'string')
  )
    throw new Error(
      'Invalid Durable Object name: the object holds no connection. Reach it through `Connections.durableObject`.',
    )
  return { apiClientId, clientId, resource, userId }
}
