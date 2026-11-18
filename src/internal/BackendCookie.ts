/**
 * The cookies of the `backend` and `siwe` plugins' routes, and the session ID of the `siwe` plugin's
 * token mode in the `Authorization` header: the session ID, the session ID of a
 * sign-in in progress, the path to return to after it, and the mark of a sign-in in the dialog. Each is `HttpOnly`, `Secure`, and `SameSite=Lax`,
 * with the `__Host-` prefix, so a sibling host cannot set one.
 * @module
 */

/** The name of each cookie. The `__Host-` prefix needs `Secure`, `Path=/`, and no `Domain`. */
export const names = {
  /** Present while a sign-in that the dialog started is in progress, for 10 minutes. */
  dialog: '__Host-tempo-id.dialog',
  /** The session ID of the newest sign-in in progress, for 10 minutes. */
  pending: '__Host-tempo-id.pending',
  /**
   * The session IDs of the 3 newest sign-ins in progress, each with its flow and its path to return
   * to, as an earlier release writes them. The routes read it, and delete it at their next write of
   * the sign-ins' cookies.
   */
  pendings: '__Host-tempo-id.pendings',
  /** The app's path to return to after the newest sign-in in progress, for 10 minutes. */
  return: '__Host-tempo-id.return',
  /** The session ID. */
  session: '__Host-tempo-id.sid',
  /** The session ID of a SIWE sign-in in progress, for 10 minutes. */
  siwe: '__Host-tempo-id.siwe',
} as const

/**
 * The prefix of each cookie of one sign-in in progress, which the session ID of the sign-in follows.
 * Each cookie holds the sign-in's start, its flow, and its path to return to, for 10 minutes. Each
 * sign-in has a cookie of its own, so the concurrent requests of the browser's tabs never replace
 * another tab's sign-in.
 */
export const pendingPrefix = '__Host-tempo-id.pending.'

/** A cookie's name. */
export type Name =
  | (typeof names)[keyof typeof names]
  | `${typeof pendingPrefix}${string}`

/**
 * Returns the value of the cookie `name` in `request`'s `Cookie` header, or `undefined` without one.
 *
 * @example
 * ```ts
 * const id = BackendCookie.get(request, { name: BackendCookie.names.session })
 * ```
 */
export function get(
  request: Request,
  options: get.Options,
): string | undefined {
  const header = request.headers.get('cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    if (part.slice(0, index).trim() !== options.name) continue
    const value = part.slice(index + 1).trim()
    return value || undefined
  }
  return undefined
}

export declare namespace get {
  type Options = {
    /** The cookie's name. */
    name: Name
  }
}

/**
 * Returns the session ID in `request`'s `Authorization: Bearer` header, which a page of the `siwe`
 * plugin's token mode sends in place of the session cookie, or `undefined` without one. A value
 * that is no session ID, such as an access token, returns `undefined`.
 *
 * @example
 * ```ts
 * const id = BackendCookie.bearer(request)
 * ```
 */
export function bearer(request: Request): string | undefined {
  const [scheme, value] = (request.headers.get('authorization') ?? '').split(
    ' ',
  )
  if (scheme?.toLowerCase() !== 'bearer' || !value) return undefined
  // A session ID is 32 random bytes in unpadded URL-safe Base64, which no JWT matches.
  return /^[\w-]{43}$/.test(value) ? value : undefined
}

/**
 * Returns the name and value of each cookie in `request`'s `Cookie` header whose name starts with
 * `prefix`, in the order of the header. A cookie without a value is left out.
 *
 * @example
 * ```ts
 * const entries = BackendCookie.list(request, { prefix: BackendCookie.pendingPrefix })
 * ```
 */
export function list(
  request: Request,
  options: list.Options,
): readonly (readonly [Name, string])[] {
  const header = request.headers.get('cookie')
  if (!header) return []
  return header.split(';').flatMap((part) => {
    const index = part.indexOf('=')
    if (index < 0) return []
    const name = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (!name.startsWith(options.prefix) || !value) return []
    return [[name as Name, value] as const]
  })
}

export declare namespace list {
  type Options = {
    /** The prefix of the cookies' names. */
    prefix: typeof pendingPrefix
  }
}

/**
 * Returns a `Set-Cookie` value for the cookie `name`. Without `value`, it deletes the cookie. Without
 * `maxAge`, the cookie lasts until the browser closes.
 *
 * @example
 * ```ts
 * headers.append('set-cookie', BackendCookie.serialize({ name: BackendCookie.names.session, value: id }))
 * ```
 */
export function serialize(options: serialize.Options): string {
  const { maxAge, name, value } = options
  const attributes = ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax']
  if (value === undefined) attributes.push('Max-Age=0')
  else if (maxAge !== undefined) attributes.push(`Max-Age=${maxAge}`)
  return [`${name}=${value ?? ''}`, ...attributes].join('; ')
}

export declare namespace serialize {
  type Options = {
    /** How long the cookie lasts, in seconds. Absent, until the browser closes. */
    maxAge?: number | undefined
    /** The cookie's name. */
    name: Name
    /** The cookie's value. Absent, the cookie is deleted. */
    value?: string | undefined
  }
}
