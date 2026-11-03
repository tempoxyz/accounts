/**
 * Carries the results of a backend's sessions across Durable Object RPC, which keeps no error's
 * class or fields, and no function, such as a `TempoAccount`'s.
 * @module
 */
import { PendingNotFoundError, RequestError } from '../Id.js'
import type * as Session from '../Session.js'
import * as TempoAccount from '../TempoAccount.js'

/** A method's result across RPC: its value, or the refusal that it threw, as data. */
export type Result<value> =
  | { ok: true; value: value }
  | { error: Refusal; ok: false }

/** A refusal that a method returns in place of throwing it. */
export type Refusal =
  | { name: 'Id.PendingNotFoundError' }
  | { name: 'Id.RequestError'; options: RequestError.Options }

/** A session as it crosses RPC: its account as `TempoAccount.serialize` writes it. */
export type Wire<session extends { account?: unknown }> = Omit<
  session,
  'account'
> & {
  /** The user's Tempo Account, serialized. */
  account?: TempoAccount.Serialized | undefined
}

/** Runs `fn`, and returns its refusal as data. Rethrows any other error. */
export async function wrap<value>(
  fn: () => Promise<value>,
): Promise<Result<value>> {
  try {
    return { ok: true, value: await fn() }
  } catch (error) {
    if (error instanceof PendingNotFoundError)
      return { error: { name: 'Id.PendingNotFoundError' }, ok: false }
    if (error instanceof RequestError)
      return {
        error: {
          name: 'Id.RequestError',
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
  if (result.error.name === 'Id.RequestError')
    throw new RequestError(result.error.options)
  throw new PendingNotFoundError()
}

/** Returns a session in the form that crosses RPC. */
export function toWire<session extends Session.Session>(
  session: session,
): Wire<session> {
  const { account, ...rest } = session
  return account ? { ...rest, account: TempoAccount.serialize(account) } : rest
}

/** Returns a session from the form that crosses RPC. */
export function fromWire<session extends Session.Session>(
  wire: Wire<session>,
): session {
  const { account, ...rest } = wire
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

/** Returns the app and the session ID of a Durable Object's name from {@link name}. */
export function parseName(value: string | undefined): {
  clientId: string
  id: string
} {
  const [clientId, id] = JSON.parse(value ?? '[]') as [unknown?, unknown?]
  if (typeof clientId !== 'string' || typeof id !== 'string')
    throw new Error(
      'Invalid Durable Object name: the object holds no session. Reach it through `backend({ namespace })`.',
    )
  return { clientId, id }
}
