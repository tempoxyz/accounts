/**
 * Keeps the part of a redirect's state that redeems its code in the tab's `sessionStorage`, beside
 * the default IndexedDB store: its `state`, redirect URI, and PKCE verifier, and whether it
 * authorizes an access key. The callback page reads it at once, so the code exchange starts before
 * IndexedDB's first read, which waits behind the page's first tasks. It holds no key material.
 * @module
 */
/* istanbul ignore file -- `sessionStorage` exists only in a browser. */
import type { Config } from '../Accounts.js'
import type * as Pending from '../Pending.js'

/** The part of a redirect's state that redeems its code. */
export type Ticket = {
  /** The chain of the instance that started the redirect. */
  chainId?: number | undefined
  /** The app that started the redirect. */
  clientId?: string | undefined
  /** Whether the redirect authorizes an access key, whose material only the instance's store holds. */
  key: boolean
  /** Where Tempo ID redirects back to. The code exchange repeats it. */
  redirectUri: string
  /** The value that the callback must echo. */
  state: string
  /** The PKCE verifier that redeems the code. */
  verifier: string
}

/** Keeps the ticket of `pending` for the tab, unless the instance has a `store` of its own. */
export function save(
  auth: Config,
  pending: Pending.Pending | Pending.WithoutKey,
) {
  const storage = session(auth)
  if (!storage) return
  try {
    storage.setItem(storageKey, JSON.stringify(ticket(pending)))
  } catch {
    // A full or blocked storage leaves the callback to read the instance's store.
  }
}

/** Returns the tab's ticket and removes it, or `undefined` without one. */
export function take(auth: Config): Ticket | undefined {
  const storage = session(auth)
  if (!storage) return undefined
  try {
    const value = storage.getItem(storageKey)
    if (!value) return undefined
    const ticket = JSON.parse(value) as Ticket
    // Another instance of the page, such as one of another app, keeps its own redirect's ticket.
    if (!owns(auth, ticket)) return undefined
    storage.removeItem(storageKey)
    return ticket
  } catch {
    return undefined
  }
}

/**
 * Returns whether the redirect of `pending` belongs to the instance of `auth`: its app and its
 * chain. A redirect of an earlier version names neither, and belongs to every instance.
 */
export function owns(
  auth: Config,
  pending: { chainId?: number | undefined; clientId?: string | undefined },
): boolean {
  return (
    (pending.clientId ?? auth.clientId) === auth.clientId &&
    (pending.chainId ?? auth.chainId) === auth.chainId
  )
}

/** Returns the ticket of `pending`, without its key material. */
function ticket(pending: Pending.Pending | Pending.WithoutKey): Ticket {
  return {
    chainId: pending.chainId,
    clientId: pending.clientId,
    key: pending.key !== false,
    redirectUri: pending.redirectUri,
    state: pending.state,
    verifier: pending.verifier,
  }
}

/**
 * Returns the tab's `sessionStorage`, or `undefined` for an instance with a `store` of its own,
 * which then holds the verifier alone, and where the browser blocks storage.
 */
function session(auth: Config) {
  if (auth.store) return undefined
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch {
    return undefined
  }
}

/** Where a redirect keeps its ticket in `sessionStorage`. */
const storageKey = 'tempo-id:redirect'
