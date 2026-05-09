import { Base64, Bytes, Hex } from 'ox'
import { Credential } from 'ox/webauthn'
import {
  Authentication,
  Registration,
  type Registration as Registration_Types,
} from 'webauthx/server'

import { type Handler, from } from '../../Handler.js'
import * as Kv from '../../Kv.js'
import * as Session from './session.js'

const defaults = {
  cookieName: 'accounts_webauthn',
  ttl: {
    challenge: 5 * 60, // 5 minutes
    session: 24 * 60 * 60, // 24 hours
  },
} as const

const sessionKey = (token: string) => `session:${token}`

/**
 * Session payload persisted in the session store and surfaced via
 * `getSession`. Mirrors the shape of the WebAuthn login response so
 * downstream handlers can identify the authenticated credential without
 * an extra round-trip.
 */
export type SessionPayload = {
  /** Credential ID returned by the authenticator. */
  credentialId: string
  /** Credential public key (hex). */
  publicKey: string
  /** Optional `userHandle` returned by the authenticator. */
  userId?: string | undefined
  /** Unix timestamp (seconds) when the session was issued. */
  issuedAt: number
  /** Unix timestamp (seconds) when the session expires. */
  expiresAt: number
}

/**
 * Instantiates a WebAuthn ceremony handler that manages registration and
 * authentication flows server-side.
 *
 * Mounts five POST endpoints under `path`:
 * - `POST {path}/register/options` — generate credential creation options
 * - `POST {path}/register` — verify registration and store credential
 * - `POST {path}/login/options` — generate credential request options
 * - `POST {path}/login` — verify authentication and issue a session
 *   (cookie via `Set-Cookie`, or `{ token }` body when `cookie: false`
 *   or the request opts in via `returnToken: true`)
 * - `POST {path}/logout` — revoke the session and clear the cookie
 *
 * The returned handler also exposes `getSession(req)` for resolving the
 * current session from a follow-up request's cookie or `Authorization:
 * Bearer` header.
 *
 * @example
 * ```ts
 * import { Handler, Kv } from 'accounts/server'
 *
 * const handler = Handler.webAuthn({
 *   kv: Kv.memory(),
 *   origin: 'https://example.com',
 *   rpId: 'example.com',
 * })
 *
 * export default handler
 * ```
 *
 * @param options - Options.
 * @returns Request handler.
 */
export function webAuthn(options: webAuthn.Options): webAuthn.ReturnType {
  const {
    cookie = true,
    cookieName = defaults.cookieName,
    kv,
    onAuthenticate,
    onRegister,
    path = '',
    rpId,
    session = true,
    ttl: {
      challenge: challengeTtl = defaults.ttl.challenge,
      session: sessionTtl = defaults.ttl.session,
    } = {},
    ...rest
  } = options
  const origin = options.origin as string | string[]

  const router = from(rest)

  router.post(`${path}/register/options`, async (c) => {
    try {
      const body = await c.req.raw.json()
      const { excludeCredentialIds, name, userId } = body as {
        excludeCredentialIds?: string[]
        name: string
        userId?: string
      }

      const { challenge, options } = Registration.getOptions({
        excludeCredentialIds,
        name,
        rp: { id: rpId, name: rpId },
        ...(userId ? { user: { id: new TextEncoder().encode(userId), name } } : undefined),
      })

      await kv.set(`challenge:${challenge}`, { created: Date.now(), name }, { ttl: challengeTtl })

      return Response.json({ options })
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 400 })
    }
  })

  router.post(`${path}/register`, async (c) => {
    try {
      const credential = (await c.req.raw.json()) as Registration_Types.Credential
      const deserialized = Credential.deserialize(credential)

      const clientData = JSON.parse(
        Bytes.toString(new Uint8Array(deserialized.clientDataJSON)),
      ) as { challenge: string }
      const challenge = Hex.fromBytes(Base64.toBytes(clientData.challenge))
      const stored = await kv.get<{ created: number; name: string }>(`challenge:${challenge}`)
      if (!stored || Date.now() - stored.created > challengeTtl * 1_000)
        throw new Error('Missing or expired challenge')

      const result = Registration.verify(credential, {
        challenge,
        origin,
        rpId,
      })

      const { publicKey } = result.credential
      const credentialId = credential.id

      const json = { credentialId, publicKey }
      const [, hook] = await Promise.all([
        kv.set(`credential:${credentialId}`, { publicKey }),
        onRegister?.({
          credentialId,
          name: stored.name,
          publicKey,
          request: c.req.raw,
        }),
        kv.delete(`challenge:${challenge}`),
      ])
      return Session.mergeResponse(json, hook || undefined)
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 400 })
    }
  })

  router.post(`${path}/login/options`, async (c) => {
    try {
      const body = await c.req.raw.json()
      const {
        allowCredentialIds,
        challenge: requestChallenge,
        credentialId,
        mediation,
      } = body as {
        allowCredentialIds?: string[]
        challenge?: Hex.Hex
        credentialId?: string
        mediation?: string
      }

      const { challenge, options: authOptions } = Authentication.getOptions({
        challenge: requestChallenge,
        credentialId: allowCredentialIds ?? credentialId,
        rpId,
      })
      const options = mediation ? { ...authOptions, mediation } : authOptions

      await kv.set(`challenge:${challenge}`, Date.now(), { ttl: challengeTtl })

      return Response.json({ options })
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 400 })
    }
  })

  router.post(`${path}/login`, async (c) => {
    try {
      const body = (await c.req.raw.json()) as Authentication.Response & {
        returnToken?: boolean
      }
      const { returnToken, ...response } = body

      const clientData = JSON.parse(response.metadata.clientDataJSON) as {
        challenge: string
      }
      const challenge = Hex.fromBytes(Base64.toBytes(clientData.challenge))

      const [stored, credentialData] = await Promise.all([
        kv.get<number>(`challenge:${challenge}`),
        kv.get<{ publicKey: string }>(`credential:${response.id}`),
      ])
      if (!stored || Date.now() - stored > challengeTtl * 1_000)
        throw new Error('Missing or expired challenge')
      if (!credentialData) throw new Error('Unknown credential')

      const valid = Authentication.verify(response, {
        challenge,
        origin,
        publicKey: credentialData.publicKey as `0x${string}`,
        rpId,
      })
      if (!valid) throw new Error('Authentication failed')

      const rawResponse = response.raw?.response as unknown as Record<string, string> | undefined
      const userHandle = rawResponse?.userHandle

      const credentialId = response.id
      const publicKey = credentialData.publicKey
      const userId = userHandle && userHandle.length > 0 ? userHandle : undefined

      // Hook for side effects (user provisioning, analytics, allow/deny).
      // The legacy contract — return a `Response` to merge fields onto
      // the JSON body — is preserved. Throwing now rejects the request
      // with `401` (vs the outer `400`) so callers can tell hook errors
      // apart from protocol errors.
      let hookResponse: Response | undefined
      if (onAuthenticate) {
        try {
          const result = await onAuthenticate({
            credentialId,
            publicKey,
            request: c.req.raw,
            ...(userId ? { userId } : {}),
          })
          if (result) hookResponse = result
        } catch (error) {
          await kv.delete(`challenge:${challenge}`)
          return Response.json(
            { error: error instanceof Error ? error.message : 'authentication rejected' },
            { status: 401 },
          )
        }
      }

      // `session: false` short-circuits — login acts as a stateless
      // verification. No token, no cookie, no kv write. Useful for
      // hosts that mint their own session in `onAuthenticate` (e.g. JWTs).
      if (!session) {
        await kv.delete(`challenge:${challenge}`)
        return Session.mergeResponse(
          {
            credentialId,
            publicKey,
            ...(userId ? { userId } : {}),
          },
          hookResponse,
        )
      }

      const issuedAt = Math.floor(Date.now() / 1000)
      const payload: SessionPayload = {
        credentialId,
        publicKey,
        ...(userId ? { userId } : {}),
        issuedAt,
        expiresAt: issuedAt + sessionTtl,
      }
      const token = Session.generateToken()
      await Promise.all([
        kv.set(sessionKey(token), payload, { ttl: sessionTtl }),
        kv.delete(`challenge:${challenge}`),
      ])

      const json = {
        credentialId,
        publicKey,
        ...(userId ? { userId } : {}),
        // Token mode: forced when `cookie: false`, opt-in via
        // `returnToken: true` otherwise. Cookie mode (default) carries
        // the token in `Set-Cookie` and omits it from the body.
        ...(!cookie || returnToken ? { token } : {}),
      }

      // Cookie is appended on the merged response below — the route
      // builds its own `Response`, so Hono's context-stashed headers
      // wouldn't carry through.
      const cookieHeader =
        cookie && !returnToken
          ? Session.serializeCookie({
              name: cookieName,
              protocol: new URL(c.req.url).protocol,
              ttl: sessionTtl,
              value: token,
            })
          : undefined

      return Session.mergeResponse(json, hookResponse, cookieHeader)
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 400 })
    }
  })

  // Logout has no meaning when sessions are disabled — skip mounting the
  // route entirely so callers get a clean `404` instead of a misleading
  // `204` no-op.
  if (session)
    router.post(`${path}/logout`, async (c) => {
      const token = Session.tokenFromRequest(c.req.raw, { cookie, cookieName })
      if (token) await kv.delete(sessionKey(token))
      const headers = new Headers()
      if (cookie) headers.append('set-cookie', Session.clearCookieHeader(cookieName))
      return new Response(null, { status: 204, headers })
    })

  const getSession: webAuthn.getSession = async (req) => {
    if (!session) return undefined
    const token = Session.tokenFromRequest(req, { cookie, cookieName })
    if (!token) return undefined
    return await kv.get<SessionPayload>(sessionKey(token))
  }

  return Object.assign(router, { getSession })
}

export declare namespace webAuthn {
  /** Return type of `webAuthn()` — a `Handler` extended with `getSession`. */
  type ReturnType = Handler & { getSession: getSession }

  /** Resolves the current session from a request's cookie or bearer token. */
  type getSession = (req: Request) => Promise<SessionPayload | undefined>

  type Options = from.Options & {
    /**
     * Whether to issue a session cookie on successful login. When
     * `false`, the login response always contains `{ token }` in the
     * body, no `Set-Cookie` header is sent, logout does not clear a
     * cookie, and `getSession` ignores any incoming cookie — only
     * `Authorization: Bearer <token>` is honored. Use this when the SDK
     * lives in a non-browser context or the host app already manages
     * its own auth cookies.
     * @default true
     */
    cookie?: boolean | undefined
    /** Cookie name for the session token. @default "accounts_webauthn" */
    cookieName?: string | undefined
    /** Key-value store for challenges, credentials, and sessions. */
    kv: Kv.Kv
    /** Called after a successful registration. The returned response is merged onto the default JSON response. */
    onRegister?: (parameters: {
      credentialId: string
      /** The name provided during `/register/options` (e.g. user email). */
      name: string
      publicKey: string
      request: Request
    }) => Response | Promise<Response> | void | Promise<void>
    /**
     * Called after a successful authentication, before the session
     * token is issued. Returning a `Response` merges its JSON body and
     * status onto the default login response (legacy contract).
     * Throwing rejects the request with `401` — the thrown error's
     * `message` is surfaced as the response `error` field — and no
     * session is issued.
     */
    onAuthenticate?: (parameters: {
      credentialId: string
      publicKey: string
      userId?: string | undefined
      request: Request
    }) => Response | Promise<Response> | void | Promise<void>
    /** Expected origin(s) (e.g. `"https://example.com"` or `["https://a.com", "https://b.com"]`). */
    origin: string | readonly string[]
    /** Path prefix for the WebAuthn endpoints (e.g. `"/webauthn"`). @default "" */
    path?: string | undefined
    /** Relying Party ID (e.g. `"example.com"`). */
    rpId: string
    /**
     * Whether to issue a session on successful login. When `false`,
     * login acts as a stateless WebAuthn verification — no token is
     * generated, no entry is written to the kv, and no cookie is sent.
     * The login response still carries `{ credentialId, publicKey,
     * userId? }`. `getSession` always returns `undefined` and `/logout`
     * is a no-op (still returns `204`). Use this when the host
     * application mints its own session token (e.g. a JWT inside
     * `onAuthenticate`).
     * @default true
     */
    session?: boolean | undefined
    /** TTLs in seconds. */
    ttl?:
      | {
          /** Challenge TTL. @default 300 (5m) */
          challenge?: number | undefined
          /** Session TTL. @default 86400 (24h) */
          session?: number | undefined
        }
      | undefined
  }
}


