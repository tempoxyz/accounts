/**
 * Keeps the part of a redirect's state that redeems its code in the tab's `sessionStorage`, beside
 * the default IndexedDB store: its `state`, redirect URI, and PKCE verifier, and whether it
 * authorizes an access key. The callback page reads it at once, so the code exchange starts before
 * IndexedDB's first read, which waits behind the page's first tasks. It holds no material of an
 * access key. With a custom `store`, the tab keeps only the redirect's `state`, its app, its chain,
 * the instance's configured chain, and its redirect URI, so the callback knows that this tab started the redirect.
 * @module
 */
/* istanbul ignore file -- `sessionStorage` exists only in a browser. */
import type { Config } from '../Accounts.js'
import * as InstanceChain from './InstanceChain.js'
import type * as Pending from './Pending.js'

/** The part of a redirect's state that redeems its code. */
export type Ticket = {
  /**
   * Whether the redirect authorizes an access key, whose material only the instance's store holds.
   */
  accessKey: boolean
  /** The chain of the instance that started the redirect. */
  chainId?: number | undefined
  /** The app that started the redirect. */
  clientId?: string | undefined
  /** Where Tempo ID redirects back to. The code exchange repeats it. */
  redirectUri: string
  /** The value that the callback must echo. */
  state: string
  /** The PKCE verifier that redeems the code. */
  verifier: string
}

/**
 * Keeps the ticket of `pending` for the tab. With a `store` of its own, the instance keeps only the
 * mark of the redirect: its `state`, app, chain, the instance's configured chain, and redirect URI.
 */
export function save(
  auth: Config,
  pending: Pending.Addressed | Pending.Pending | Pending.WithoutAccessKey,
) {
  const storage = tab()
  if (!storage) return
  try {
    if (auth.store)
      storage.setItem(
        markKey,
        JSON.stringify({
          chainId: pending.chainId,
          clientId: pending.clientId,
          configured: configuredOf(auth),
          redirectUri: pending.redirectUri,
          state: pending.state,
        } satisfies Mark),
      )
    else storage.setItem(storageKey, JSON.stringify(ticket(pending)))
  } catch {
    // A full or blocked storage leaves the callback to read the instance's store.
  }
}

/**
 * Returns the mark of the redirect of `state` that the tab started for the instance with a `store`
 * of its own, and removes it. The instance is the mark's app on its configured chain, also after
 * `switchChain`. Returns `undefined` without one, and for an instance without a `store`, which keeps
 * a ticket.
 */
export function started(
  auth: Config,
  options: { state: string | undefined },
): Mark | undefined {
  if (!auth.store || options.state === undefined) return undefined
  const storage = tab()
  if (!storage) return undefined
  try {
    const value = storage.getItem(markKey)
    if (!value) return undefined
    const mark = JSON.parse(value) as Mark
    // Another instance of the page, such as one of another app or chain, keeps its own redirect's
    // mark. The configured chain names the instance, since a store that lost a `switchChain`
    // selection no longer holds the chain that the redirect started on.
    const own =
      mark.configured === undefined
        ? owns(auth, mark)
        : owns(auth, { clientId: mark.clientId }) &&
          mark.configured === configuredOf(auth)
    if (!own || mark.state !== options.state) return undefined
    storage.removeItem(markKey)
    return mark
  } catch {
    return undefined
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

/** Returns the ticket of `pending`, without the material of its access key. */
function ticket(
  pending: Pending.Addressed | Pending.Pending | Pending.WithoutAccessKey,
): Ticket {
  return {
    accessKey: pending.accessKey !== false,
    chainId: pending.chainId,
    clientId: pending.clientId,
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
  return tab()
}

/** Returns the tab's `sessionStorage`, or `undefined` where the browser blocks storage. */
function tab() {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch {
    return undefined
  }
}

/** The mark of a redirect that an instance with a `store` of its own started in the tab. */
export type Mark = {
  /** The chain of the instance that started the redirect. */
  chainId?: number | undefined
  /** The app that started the redirect. */
  clientId?: string | undefined
  /**
   * The configured chain of the instance that started the redirect, which `switchChain` never
   * changes. Absent in a mark that an earlier version saved.
   */
  configured?: number | undefined
  /**
   * Where Tempo ID redirects back to. Its own query parameters are the app's, not the callback's.
   * Absent in a mark that an earlier version saved.
   */
  redirectUri?: string | undefined
  /** The value that the callback must echo. */
  state: string
}

/**
 * Returns the configured chain of the instance of `auth`, or its chain for a configuration that
 * `Accounts.create` did not build.
 */
function configuredOf(auth: Config): number {
  const chainId = (auth as Record<symbol, unknown>)[InstanceChain.configured]
  return typeof chainId === 'number' ? chainId : auth.chainId
}

/** Where a redirect of an instance with a `store` of its own keeps its mark in `sessionStorage`. */
const markKey = 'tempo-id:redirect:started'

/** Where a redirect keeps its ticket in `sessionStorage`. */
const storageKey = 'tempo-id:redirect'
