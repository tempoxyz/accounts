import { Hex } from 'ox'
import type { Address, Transport } from 'viem'
import { createClient, http, zeroAddress } from 'viem'
import { verifyMessage } from 'viem/actions'
import { createSiweMessage, generateSiweNonce, parseSiweMessage } from 'viem/siwe'
import { tempo } from 'viem/tempo/chains'
import * as z from 'zod/mini'

import * as u from '../../../core/zod/utils.js'
import { type Handler, from } from '../../Handler.js'
import * as Kv from '../../Kv.js'
import * as Hono from '../hono.js'
import * as Session from './session.js'

const defaults = {
  cookieName: 'accounts_auth',
  ttl: {
    challenge: 10 * 60, // 10 minutes
    session: 24 * 60 * 60, // 24 hours
  },
} as const

/**
 * Session payload persisted in the session store and surfaced via
 * `getSession`. `address` is the account address that signed the
 * authentication challenge; `chainId` is the chain echoed in the message.
 */
export type SessionPayload = {
  /** Address of the account. */
  address: Address
  /** Chain ID echoed into the challenge message. */
  chainId: number
  /** Unix timestamp (seconds) when the session was issued. */
  issuedAt: number
  /** Unix timestamp (seconds) when the session expires. */
  expiresAt: number
}

/**
 * Internal challenge-store entry. Tracked separately from the session
 * payload because challenges are single-use and the address isn't bound at
 * challenge time — the account supplies the address at verify time and the
 * server uses the supplied address as the session subject.
 *
 * The full issued SIWE message is persisted so verify can require exact
 * byte-equality between the submitted message and the one we issued.
 * Without this, the wallet (or anyone who tampered with the message in
 * flight) could swap fields the server doesn't otherwise check
 * (`statement`, `resources`, `uri`, `version`, the address placeholder)
 * while keeping `nonce`/`domain`/`chainId` and still pass verification.
 */
type ChallengePayload = {
  /** Echoed for defense-in-depth even though it's also in `message`. */
  chainId: number
  /** Unix seconds. The Kv TTL also enforces this; kept for traceability. */
  expiresAt: number
  /** Verbatim issued SIWE message. Verify rejects any mismatch. */
  message: string
}

const challengeKey = (nonce: string) => `challenge:${nonce}`
const sessionKey = (token: string) => `session:${token}`

/** Zod schemas for the auth handler's request and response payloads. */
export namespace schema {
  /** Schemas for `POST {path}/challenge`. */
  export namespace challenge {
    /** Request body schema. */
    export const parameters = z.object({
      chainId: z.optional(z.number()),
    })

    /** Response body schema. */
    export const returns = z.object({
      message: z.string(),
    })
  }

  /** Schemas for `POST {path}` (verify). */
  export namespace verify {
    /** Request body schema. */
    export const parameters = z.object({
      address: u.address(),
      message: z.string(),
      signature: u.hex(),
      /**
       * When `true`, the server returns the issued session token in the
       * response body as `{ token }` and does NOT set a session cookie.
       * The caller is responsible for sending it as
       * `Authorization: Bearer <token>` on subsequent requests.
       */
      returnToken: z.optional(z.boolean()),
    })

    /** Response body schema. */
    export const returns = z.object({
      token: z.optional(z.string()),
    })
  }
}

/**
 * Server Authentication request handler. Mounts three routes under `path`:
 *
 * - `POST {path}/challenge` → `{ message }`
 * - `POST {path}` → verify and issue a session (cookie via `Set-Cookie`)
 * - `POST {path}/logout` → clear the session cookie
 *
 * The returned handler also exposes `getSession(req)` for resolving the
 * current session from a follow-up request's cookie.
 *
 * The challenge message is wire-formatted as EIP-4361 (SIWE) for ecosystem
 * compatibility, but address binding is deferred: the SDK can fold the
 * challenge digest into the connect ceremony before the account knows
 * which address it will sign with. The wallet supplies the real address at
 * verify time and the server uses it as the session subject.
 */
export function auth(options: auth.Options = {}): auth.ReturnType {
  const {
    cookie = true,
    cookieName = defaults.cookieName,
    domain,
    onAuthenticate,
    path = '/',
    origin: origin_option,
    session = true,
    store = Kv.memory(),
    transport = http(),
    // Cloudflare Workers always run behind Cloudflare's edge proxy, which
    // sets `x-forwarded-proto`/`x-forwarded-host`. Default `trustProxy` to
    // `true` there so deployments work out of the box. Other runtimes keep
    // the secure default of `false` (operator must opt in).
    trustProxy = isCloudflareWorkers(),
    ttl: {
      challenge: challengeTtl = defaults.ttl.challenge,
      session: sessionTtl = defaults.ttl.session,
    } = {},
    ...rest
  } = options

  if (!origin_option && !domain)
    throw new Error('`auth()` requires `origin` or `domain` to pin SIWE domain binding.')

  async function take(key: string): Promise<ChallengePayload | undefined> {
    if (store.take) return store.take<ChallengePayload>(key)
    const value = await store.get<ChallengePayload>(key)
    if (value === undefined) return undefined
    await store.delete(key)
    return value
  }

  // Pre-parse `origin` so a misconfiguration fails loudly at handler
  // construction time rather than per-request.
  const pinnedOrigin = (() => {
    if (!origin_option) return undefined
    try {
      const url = new URL(origin_option)
      return { protocol: url.protocol, host: url.host }
    } catch {
      throw new Error(`\`auth({ origin })\` must be a valid absolute URL. Got: ${origin_option}`)
    }
  })()
  const resolveReqOrigin = (req: Request) => resolveOrigin(req, { pinnedOrigin, trustProxy })

  const client = createClient({ chain: tempo, transport })

  const router = from(rest)
  const verifyPath = path === '/' ? '/' : path
  const challengePath = path === '/' ? '/challenge' : `${path}/challenge`
  const logoutPath = path === '/' ? '/logout' : `${path}/logout`

  router.post(challengePath, Hono.validate('json', schema.challenge.parameters), async (c) => {
    const { chainId = 0 } = c.req.valid('json')

    const { protocol, host: reqHost } = resolveReqOrigin(c.req.raw)
    const resolvedDomain = domain ?? reqHost

    const nonce = generateSiweNonce()
    const issuedAt = new Date()
    const expirationTime = new Date(issuedAt.getTime() + challengeTtl * 1000)

    const message = createSiweMessage({
      address: zeroAddress,
      chainId,
      domain: resolvedDomain,
      uri: `${protocol}//${resolvedDomain}`,
      version: '1',
      nonce,
      issuedAt,
      expirationTime,
    })

    await store.set(
      challengeKey(nonce),
      {
        message,
        chainId,
        expiresAt: Math.floor(expirationTime.getTime() / 1000),
      },
      { ttl: challengeTtl },
    )

    return c.json(z.encode(schema.challenge.returns, { message }))
  })

  router.post(verifyPath, Hono.validate('json', schema.verify.parameters), async (c) => {
    const { address, message, signature, returnToken } = c.req.valid('json')

    const parsed = parseSiweMessage(message)
    if (!parsed.nonce) return c.json({ error: 'message missing `nonce`' }, 400)

    const { protocol, host: reqHost } = resolveReqOrigin(c.req.raw)
    const resolvedDomain = domain ?? reqHost
    if (parsed.domain !== resolvedDomain) return c.json({ error: 'domain mismatch' }, 400)

    const now = Date.now()
    if (parsed.expirationTime && parsed.expirationTime.getTime() < now)
      return c.json({ error: 'message expired' }, 400)
    if (parsed.notBefore && parsed.notBefore.getTime() > now)
      return c.json({ error: 'message not yet valid' }, 400)

    const challenge = await take(challengeKey(parsed.nonce))
    if (!challenge) return c.json({ error: 'invalid or replayed nonce' }, 409)

    // Require exact byte-equality between the submitted message and the one
    // we issued. Without this, the wallet (or anyone tampering with the
    // message in flight) could swap fields we don't otherwise check
    // (`statement`, `resources`, `uri`, `version`, the address placeholder)
    // while keeping `nonce`/`domain`/`chainId` and still pass verification —
    // enabling a phishing-style takeover where a victim signs a benign-looking
    // message bound to an attacker's session.
    if (message !== challenge.message) return c.json({ error: 'message mismatch' }, 400)

    if (parsed.chainId !== challenge.chainId) return c.json({ error: 'chainId mismatch' }, 400)

    // Signature verification via viem's `verifyMessage`. Tempo's chain
    // override unwraps `SignatureEnvelope` for WebAuthn / P256 / keychain
    // sigs and falls back to ECDSA recovery for plain EOAs.
    let valid: boolean
    try {
      valid = await verifyMessage(client, { address, message, signature })
    } catch {
      return c.json({ error: 'invalid signature' }, 401)
    }
    if (!valid) return c.json({ error: 'signature does not match address' }, 401)

    const issuedAt = Math.floor(now / 1000)
    const payload: SessionPayload = {
      address,
      chainId: parsed.chainId,
      issuedAt,
      expiresAt: issuedAt + sessionTtl,
    }

    // Hook for side effects (e.g. user provisioning, analytics). Returning
    // a `Response` merges its JSON body and status onto the verify
    // response (matches `webAuthn`'s contract). Throwing rejects with
    // `401` and surfaces the error's message in the response body.
    let hookResponse: Response | undefined
    if (onAuthenticate) {
      try {
        const result = await onAuthenticate({
          address,
          chainId: parsed.chainId,
          message,
          request: c.req.raw,
          signature,
        })
        if (result) hookResponse = result
      } catch (error) {
        return c.json(
          { error: error instanceof Error ? error.message : 'authentication rejected' },
          401,
        )
      }
    }

    // `session: false` short-circuits — verify acts as a stateless
    // signature check. No token, no cookie, no store write. Useful for
    // hosts that mint their own session in `onAuthenticate` (e.g. JWTs).
    if (!session) return Session.mergeResponse({}, hookResponse)

    const token = Session.generateToken()
    await store.set(sessionKey(token), payload, { ttl: sessionTtl })

    // Token mode: caller sends `Authorization: Bearer <token>`. Forced
    // when `cookie: false`, opt-in via `returnToken: true` otherwise.
    // Cookie mode (default): browser carries the cookie automatically.
    const tokenMode = !cookie || returnToken
    const cookieHeader = tokenMode
      ? undefined
      : Session.serializeCookie({
          name: cookieName,
          protocol,
          ttl: sessionTtl,
          value: token,
        })

    return Session.mergeResponse(tokenMode ? { token } : {}, hookResponse, cookieHeader)
  })

  // Logout has no meaning when sessions are disabled — skip mounting the
  // route entirely so callers get a clean `404` instead of a misleading
  // `204` no-op.
  if (session)
    router.post(logoutPath, async (c) => {
      const token = Session.tokenFromRequest(c.req.raw, { cookie, cookieName })
      if (token) await store.delete(sessionKey(token))
      if (cookie) Session.clearCookie(c, cookieName)
      return c.body(null, 204)
    })

  const getSession: auth.getSession = async (req) => {
    if (!session) return undefined
    const token = Session.tokenFromRequest(req, { cookie, cookieName })
    if (!token) return undefined
    return await store.get<SessionPayload>(sessionKey(token))
  }

  return Object.assign(router, { getSession })
}

export declare namespace auth {
  /** Return type of `auth()` — a `Handler` extended with `getSession`. */
  type ReturnType = Handler & { getSession: getSession }

  /** Resolves the current session from a request's cookie or bearer token. */
  type getSession = (req: Session.SessionRequest) => Promise<SessionPayload | undefined>

  /**
   * Hook invoked after a SIWE signature is verified but before the
   * session token is issued. Returning a `Response` merges its JSON
   * body and status onto the verify response. Throwing rejects with
   * `401` — the thrown error's `message` is surfaced as the response
   * `error` field — and no session is issued.
   */
  type onAuthenticate = (params: {
    /** Verified address that signed the SIWE message. */
    address: Address
    /** Chain ID parsed from the SIWE message. */
    chainId: number
    /** Verbatim SIWE message that was signed. */
    message: string
    /** Underlying request — useful for headers, IP, etc. */
    request: Request
    /** Signature provided by the wallet. */
    signature: Hex.Hex
  }) => Response | Promise<Response> | void | Promise<void>

  type Options = from.Options & {
    /**
     * Whether to issue a session cookie on successful verify. When
     * `false`, the verify response always contains `{ token }` in the
     * body (the per-request `returnToken` flag is ignored), no
     * `Set-Cookie` header is sent, logout does not clear a cookie, and
     * `getSession` ignores any incoming cookie — only
     * `Authorization: Bearer <token>` is honored. Use this when the SDK
     * lives in a non-browser context (CLI, server-to-server) or when
     * the host app already manages auth cookies.
     * @default true
     */
    cookie?: boolean | undefined
    /** Cookie name for the session token. @default "accounts_auth" */
    cookieName?: string | undefined
    /** Domain echoed into challenge messages. @default request `Host` header */
    domain?: string | undefined
    /**
     * Hook invoked after the SIWE signature is verified but before the
     * session token is issued. Use to provision a user record, emit
     * analytics, or apply application-level allow/deny rules. Throwing
     * from this hook rejects the request with `401` and the thrown
     * error's `message` is surfaced as the response `error` field.
     */
    onAuthenticate?: onAuthenticate | undefined
    /** Path prefix for the auth endpoints. @default "/" */
    path?: string | undefined
    /**
     * Pinned canonical public origin (e.g. `'https://app.example.com'`).
     * When set, the SIWE `domain` and `uri`, and the cookie `Secure` flag,
     * are derived from this URL — request `Host`, request URL, and
     * `x-forwarded-*` headers are ignored. This is the recommended setting
     * for production deployments behind a CDN or reverse proxy: it
     * prevents a spoofed `x-forwarded-host` from shifting the SIWE domain
     * and a spoofed `x-forwarded-proto: http` from disabling `Secure`.
     */
    origin?: string | undefined
    /**
     * Whether to issue a session on successful verify. When `false`,
     * verify acts as a stateless signature check — no token is generated,
     * no entry is written to the session store, and no cookie is sent.
     * The verify response is `{}`. `getSession` always returns
     * `undefined` and `/logout` is a no-op (still returns `204`). Use
     * this when the host application mints its own session token (e.g.
     * a JWT inside `onAuthenticate`).
     * @default true
     */
    session?: boolean | undefined
    /**
     * Backing store for both single-use challenges (nonces) and issued
     * sessions. Keys are namespaced internally (`challenge:…`, `session:…`).
     * @default `Kv.memory()`
     */
    store?: Kv.Kv | undefined
    /**
     * Viem transport for the Tempo client used to verify signatures. The
     * client is always built against the `tempo` chain — Tempo's
     * `chain.verifyHash` natively understands `SignatureEnvelope` and
     * falls back to ECDSA recovery for plain EOAs.
     * @default `http()`
     */
    transport?: Transport | undefined
    /**
     * Honor `x-forwarded-proto` / `x-forwarded-host` to derive the public
     * origin. Required when running behind a trusted reverse proxy that
     * terminates TLS (OrbStack on `*.tempo.local`, a CDN, etc.). When
     * `false`, forwarded headers are ignored to prevent spoofing on
     * deployments that expose the origin server directly. Ignored when
     * `origin` is set.
     * @default `true` on Cloudflare Workers (always edge-fronted), `false` elsewhere.
     */
    trustProxy?: boolean | undefined
    /** TTLs in seconds. */
    ttl?:
      | {
          /** Challenge (nonce) TTL. @default 600 (10m) */
          challenge?: number | undefined
          /** Session TTL. @default 86400 (24h) */
          session?: number | undefined
        }
      | undefined
  }
}

/**
 * Resolves the public-facing protocol and host for a request.
 *
 * - When `pinnedOrigin` is set (operator passed `auth({ origin })`),
 *   that origin is the source of truth — forwarded headers and request URL
 *   are ignored. This prevents a spoofed `x-forwarded-host` from shifting
 *   SIWE `domain` and a spoofed `x-forwarded-proto: http` from disabling
 *   the cookie `Secure` flag on an HTTPS deployment.
 * - When `trustProxy` is set, `x-forwarded-proto` / `x-forwarded-host` are
 *   honored (needed behind a reverse proxy like OrbStack or a CDN that
 *   terminates TLS).
 * - Default falls back to the request `host` header and request URL
 *   protocol — safe even on multi-hop deployments because forwarded
 *   headers are ignored.
 */
function resolveOrigin(
  req: Request,
  options: {
    pinnedOrigin?: { protocol: string; host: string } | undefined
    trustProxy?: boolean | undefined
  },
): { protocol: string; host: string } {
  if (options.pinnedOrigin) return options.pinnedOrigin
  const headers = req.headers
  const reqUrl = new URL(req.url)
  if (options.trustProxy) {
    const forwardedHost = headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    const forwardedProto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
    return {
      protocol: forwardedProto ? `${forwardedProto}:` : reqUrl.protocol,
      host: forwardedHost || headers.get('host') || reqUrl.host,
    }
  }
  return {
    protocol: reqUrl.protocol,
    host: headers.get('host') || reqUrl.host,
  }
}

/**
 * Detects whether we're executing inside the Cloudflare Workers runtime,
 * which is always edge-fronted and forwards `x-forwarded-*` headers from
 * Cloudflare's proxy. Used to flip the default `trustProxy` to `true`.
 */
function isCloudflareWorkers(): boolean {
  return (
    typeof globalThis.navigator !== 'undefined' &&
    globalThis.navigator.userAgent === 'Cloudflare-Workers'
  )
}
