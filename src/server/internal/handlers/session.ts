import type { Context } from 'hono'
import { setCookie as core_setCookie } from 'hono/cookie'
import { Hex } from 'ox'

/**
 * Shared session helpers used by SDK handlers that issue server-side
 * sessions (e.g. `auth`, `webAuthn`). Each handler is responsible for its
 * own session payload shape and storage; this module only provides the
 * token-extraction, cookie-issuance, and token-generation primitives so
 * the conventions stay consistent.
 */

/** Default `Set-Cookie` attributes for handler-issued session cookies. */
export const defaults = {
  httpOnly: true,
  sameSite: 'Lax',
  path: '/',
} as const

/**
 * Parse a `Bearer <token>` value out of an `Authorization` header. Returns
 * `undefined` when the header is missing, doesn't use the `Bearer`
 * scheme, or contains an empty token.
 */
export function bearerToken(authorization: string | null): string | undefined {
  if (!authorization) return undefined
  if (!authorization.toLowerCase().startsWith('bearer ')) return undefined
  return authorization.slice(7).trim() || undefined
}

/**
 * Extract the value of a single cookie from a raw `Cookie` header.
 * Returns `undefined` when the cookie is absent.
 */
export function parseCookieValue(header: string, name: string): string | undefined {
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    if (trimmed.slice(0, eq) === name) return decodeURIComponent(trimmed.slice(eq + 1))
  }
  return undefined
}

/**
 * Resolve the session token for a request. Prefers `Authorization: Bearer
 * <token>` over the cookie. When `cookie: false`, the cookie is ignored
 * even if present so callers cannot opt back into cookie mode by sending
 * a stale `Set-Cookie` value.
 */
export function tokenFromRequest(
  req: Request,
  options: {
    /** Whether cookie issuance is enabled for this handler. */
    cookie: boolean
    /** Cookie name when cookie mode is enabled. */
    cookieName: string
  },
): string | undefined {
  const bearer = bearerToken(req.headers.get('authorization'))
  if (bearer) return bearer
  if (!options.cookie) return undefined
  const cookieHeader = req.headers.get('cookie')
  return cookieHeader ? parseCookieValue(cookieHeader, options.cookieName) : undefined
}

/**
 * Build the raw `Set-Cookie` header value for a session cookie. Use this
 * when the route handler returns a freshly-constructed `Response` (which
 * bypasses Hono's context header merging) — append the returned string
 * to the response's `Set-Cookie` header directly.
 */
export function serializeCookie(options: {
  /** Cookie name. */
  name: string
  /** Token value. */
  value: string
  /** Cookie max-age in seconds. */
  ttl: number
  /** Resolved request protocol — drives the `Secure` attribute. */
  protocol: string
}): string {
  const parts = [`${options.name}=${encodeURIComponent(options.value)}`]
  parts.push(`Max-Age=${options.ttl}`)
  parts.push(`Path=${defaults.path}`)
  parts.push(`SameSite=${defaults.sameSite}`)
  if (defaults.httpOnly) parts.push('HttpOnly')
  if (options.protocol === 'https:') parts.push('Secure')
  return parts.join('; ')
}

/**
 * Build the raw `Set-Cookie` header value that clears a previously
 * issued session cookie.
 */
export function clearCookieHeader(name: string): string {
  return `${name}=; Max-Age=0; Path=${defaults.path}`
}

/**
 * Clear a previously-issued session cookie by writing an empty value with
 * `Max-Age=0`.
 */
export function clearCookie(c: Context, name: string): void {
  core_setCookie(c, name, '', { path: '/', maxAge: 0 })
}

/**
 * Generate a 256-bit cryptographically-random session token, encoded as
 * lowercase hex without the `0x` prefix.
 */
export function generateToken(): string {
  return Hex.fromBytes(crypto.getRandomValues(new Uint8Array(32))).slice(2)
}

/**
 * Build the final JSON response for a verify/login route, merging an
 * optional hook `Response` (extra body fields, status, custom headers)
 * with the handler's own JSON and an optional `Set-Cookie` header.
 *
 * The hook contract — return a `Response` whose body fields and status
 * are folded onto the default response — is shared by `auth` and
 * `webAuthn`. Hook fields take precedence over the handler's defaults
 * via spread order.
 */
export async function mergeResponse(
  json: Record<string, unknown>,
  hook?: Response | undefined,
  cookieHeader?: string | undefined,
): Promise<Response> {
  const headers = hook ? new Headers(hook.headers) : new Headers()
  headers.set('content-type', 'application/json')
  if (cookieHeader) headers.append('set-cookie', cookieHeader)

  if (!hook)
    return new Response(JSON.stringify(json), {
      headers,
      status: 200,
    })

  const extra = (await hook.json().catch(() => ({}))) as Record<string, unknown>
  return new Response(JSON.stringify({ ...json, ...extra }), {
    headers,
    status: hook.status,
  })
}
