import { getCookie, setCookie } from 'hono/cookie'
import type { Address, Transport } from 'viem'
import { createClient, http, zeroAddress } from 'viem'
import { verifyMessage } from 'viem/actions'
import { tempo } from 'viem/chains'
import { createSiweMessage, generateSiweNonce, parseSiweMessage } from 'viem/siwe'
import * as z from 'zod/mini'

import * as u from '../../../core/zod/utils.js'
import { type Handler, from } from '../../Handler.js'
import * as Kv from '../../Kv.js'
import * as Hono from '../hono.js'

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
 */
type ChallengePayload = {
  chainId: number
  expiresAt: number
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
    cookieName = defaults.cookieName,
    domain,
    path = '/',
    store = Kv.memory(),
    transport = http(),
    ttl: { challenge: challengeTtl = defaults.ttl.challenge, session: sessionTtl = defaults.ttl.session } = {},
    ...rest
  } = options

  const client = createClient({ chain: tempo, transport })

  const router = from(rest)
  const verifyPath = path === '/' ? '/' : path
  const challengePath = path === '/' ? '/challenge' : `${path}/challenge`
  const logoutPath = path === '/' ? '/logout' : `${path}/logout`

  router.post(challengePath, Hono.validate('json', schema.challenge.parameters), async (c) => {
    const { chainId = 0 } = c.req.valid('json')

    const { protocol, host: reqHost } = publicOrigin(c.req.raw)
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
      { chainId, expiresAt: Math.floor(expirationTime.getTime() / 1000) },
      { ttl: challengeTtl },
    )

    return c.json(z.encode(schema.challenge.returns, { message }))
  })

  router.post(verifyPath, Hono.validate('json', schema.verify.parameters), async (c) => {
    const { address, message, signature, returnToken } = c.req.valid('json')

    const parsed = parseSiweMessage(message)
    if (!parsed.nonce) return c.json({ error: 'message missing `nonce`' }, 400)

    const { protocol, host: reqHost } = publicOrigin(c.req.raw)
    const resolvedDomain = domain ?? reqHost
    if (parsed.domain !== resolvedDomain)
      return c.json({ error: 'domain mismatch' }, 400)

    const now = Date.now()
    if (parsed.expirationTime && parsed.expirationTime.getTime() < now)
      return c.json({ error: 'message expired' }, 400)
    if (parsed.notBefore && parsed.notBefore.getTime() > now)
      return c.json({ error: 'message not yet valid' }, 400)

    // Atomically consume the challenge: read + delete + assert it existed.
    const challenge = await store.get<ChallengePayload>(challengeKey(parsed.nonce))
    if (!challenge) return c.json({ error: 'invalid or replayed nonce' }, 409)
    await store.delete(challengeKey(parsed.nonce))

    if (parsed.chainId !== challenge.chainId)
      return c.json({ error: 'chainId mismatch' }, 400)

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
    const session: SessionPayload = {
      address,
      chainId: parsed.chainId,
      issuedAt,
      expiresAt: issuedAt + sessionTtl,
    }
    const token = generateSiweNonce()
    await store.set(sessionKey(token), session, { ttl: sessionTtl })

    // Token mode (opt-in): caller will send `Authorization: Bearer <token>`.
    // Cookie mode (default): browser carries the cookie automatically.
    if (returnToken) return c.json(z.encode(schema.verify.returns, { token }))

    setCookie(c, cookieName, token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: protocol === 'https:',
      path: '/',
      maxAge: sessionTtl,
    })

    return c.json(z.encode(schema.verify.returns, {}))
  })

  router.post(logoutPath, async (c) => {
    const token = getCookie(c, cookieName)
    if (token) await store.delete(sessionKey(token))
    setCookie(c, cookieName, '', { path: '/', maxAge: 0 })
    return c.body(null, 204)
  })

  const getSession: auth.getSession = async (req) => {
    // Prefer `Authorization: Bearer <token>` (token mode) over cookie
    // (cookie mode). Either is accepted on every request.
    const authz = req.headers.get('authorization')
    const bearer = authz?.toLowerCase().startsWith('bearer ')
      ? authz.slice(7).trim()
      : undefined
    const cookieHeader = req.headers.get('cookie')
    const token = bearer ?? (cookieHeader ? parseCookieValue(cookieHeader, cookieName) : undefined)
    if (!token) return undefined
    return await store.get<SessionPayload>(sessionKey(token))
  }

  return Object.assign(router, { getSession })
}

export declare namespace auth {
  /** Return type of `auth()` — a `Handler` extended with `getSession`. */
  type ReturnType = Handler & { getSession: getSession }

  /** Resolves the current session from a request's cookie. */
  type getSession = (req: Request) => Promise<SessionPayload | undefined>

  type Options = from.Options & {
    /** Cookie name for the session token. @default "accounts_auth" */
    cookieName?: string | undefined
    /** Domain echoed into challenge messages. @default request `Host` header */
    domain?: string | undefined
    /** Path prefix for the auth endpoints. @default "/" */
    path?: string | undefined
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
 * Resolves the public-facing protocol and host for a request, honoring
 * `x-forwarded-proto` / `x-forwarded-host` so SIWE `domain`/`uri` reflect
 * the browser-visible origin behind reverse proxies (OrbStack, Cloudflare
 * tunnels, etc.). Falls back to the `host` header and the request URL.
 */
function publicOrigin(req: Request): { protocol: string; host: string } {
  const headers = req.headers
  const forwardedHost = headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const forwardedProto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const reqUrl = new URL(req.url)
  const host = forwardedHost || headers.get('host') || reqUrl.host
  const protocol = forwardedProto ? `${forwardedProto}:` : reqUrl.protocol
  return { protocol, host }
}

function parseCookieValue(header: string, name: string): string | undefined {
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    if (trimmed.slice(0, eq) === name) return decodeURIComponent(trimmed.slice(eq + 1))
  }
  return undefined
}
