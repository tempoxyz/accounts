import type { Context } from 'hono'
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
 * Runs `promise` after the response when the runtime exposes `waitUntil`
 * (e.g. Cloudflare Workers via Hono's `executionCtx`). Otherwise awaits it,
 * so runtimes that may stop work after the response still finish it.
 */
async function defer(c: Context, promise: Promise<unknown>) {
  const ctx = (() => {
    try {
      return c.executionCtx
    } catch {
      return undefined
    }
  })()
  if (!ctx) return void (await promise)
  ctx.waitUntil(promise.catch(() => {}))
}

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

  /** Reads a challenge, consuming it atomically when the store implements `take`. */
  function consume<value>(key: string) {
    return kv.take ? kv.take<value>(key) : kv.get<value>(key)
  }

  router.post(`${path}/register/options`, async (c) => {
    try {
      const body = await c.req.raw.json()
      const { excludeCredentialIds, name, userId } = body as {
        excludeCredentialIds?: string[]
        name?: string
        userId?: string
      }

      // Without a name or `userId`, the challenge is issued ahead of the
      // sign-up (see `WebAuthnCeremony.server`'s `prefetch`): the client builds
      // the options itself and sends both with `/register`.
      const { challenge, options } = Registration.getOptions({
        excludeCredentialIds,
        name: name ?? '',
        rp: { id: rpId, name: rpId },
        ...(userId !== undefined
          ? { user: { id: new TextEncoder().encode(userId), name: name ?? '' } }
          : undefined),
      })

      await kv.set(
        `challenge:${challenge}`,
        {
          created: Date.now(),
          ...(name !== undefined ? { name } : {}),
          ...(userId !== undefined ? { userId } : {}),
        },
        { ttl: challengeTtl },
      )

      // `ttl` tells a client that fetches challenges ahead of time how long it may hold one.
      return Response.json({ options, ttl: challengeTtl })
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 400 })
    }
  })

  router.post(`${path}/register`, async (c) => {
    try {
      const {
        name: name_body,
        userId: userId_body,
        ...credential
      } = (await c.req.raw.json()) as Registration_Types.Credential & {
        name?: string | undefined
        userId?: string | undefined
      }
      const deserialized = Credential.deserialize(credential)

      const clientData = JSON.parse(
        Bytes.toString(new Uint8Array(deserialized.clientDataJSON)),
      ) as { challenge: string }
      const challenge = Hex.fromBytes(Base64.toBytes(clientData.challenge))
      const credentialId = credential.id
      const key = `credential:${credentialId}`
      // Without an atomic `create`, duplicates are rejected by a read before
      // the write. Run that read alongside the challenge read.
      // A store with `take` consumes the challenge atomically, so it is
      // single-use and needs no delete. Otherwise it is read here and deleted
      // after the response.
      const [stored, existing] = await Promise.all([
        consume<{ created: number; name?: string; userId?: string } | number>(
          `challenge:${challenge}`,
        ),
        kv.create ? undefined : kv.get(key),
      ])
      // Login challenges are stored as a bare timestamp, so they can't register.
      if (
        typeof stored !== 'object' ||
        stored === null ||
        Date.now() - stored.created > challengeTtl * 1_000
      ) {
        // A retry whose first attempt stored the credential (and consumed the
        // challenge) but lost its response: answer as a duplicate, so the
        // client can tell it was stored.
        if (existing ?? (await kv.get(key))) throw new Error('Credential already exists')
        throw new Error('Missing or expired challenge')
      }
      // A registration challenge issued with neither a name nor a `userId` was
      // fetched ahead of the sign-up, so it takes both from the credential's
      // request, as `/register/options` would have.
      const prefetched = stored.name === undefined && stored.userId === undefined
      const name = prefetched ? name_body : (stored.name ?? '')
      if (typeof name !== 'string') throw new Error('Missing name')
      const userId_raw = prefetched ? userId_body : stored.userId
      if (userId_raw !== undefined && typeof userId_raw !== 'string')
        throw new Error('Invalid userId')

      const result = Registration.verify(credential, {
        challenge,
        origin,
        rpId,
      })

      const { aaguid } = result
      const { publicKey } = result.credential
      // Base64url-encode the userId we registered with so it matches
      // the `userHandle` shape the authenticator emits on `/login`.
      // Callers see a consistent identifier across both flows.
      const userId = userId_raw
        ? Base64.fromBytes(Bytes.fromString(userId_raw), { pad: false, url: true })
        : undefined
      const value = { publicKey, ...(userId ? { userId } : {}) }
      const created = await (async () => {
        if (kv.create) return await kv.create(key, value)
        if (existing) return false
        await kv.set(key, value)
        return true
      })()
      if (!created) throw new Error('Credential already exists')

      const hook = await (async () => {
        try {
          return await onRegister?.({
            ...(aaguid ? { aaguid } : {}),
            credentialId,
            name,
            publicKey,
            request: c.req.raw,
            ...(userId ? { userId } : {}),
          })
        } catch (error) {
          await Promise.all([kv.delete(key), kv.delete(`challenge:${challenge}`)])
          throw error
        }
      })()
      // Without `take`, the challenge was only read. It expires on its own, and
      // replaying it cannot register the same credential twice, so its deletion
      // does not hold the response.
      if (!kv.take) await defer(c, kv.delete(`challenge:${challenge}`))

      // Successful registration is also a successful authentication for
      // the freshly-minted credential. Issue a session here so the
      // common "register → automatically signed in" flow doesn't require
      // an extra `/login` round-trip.
      if (!session)
        return Session.mergeResponse(
          { credentialId, publicKey, ...(userId ? { userId } : {}) },
          hook || undefined,
        )

      const issuedAt = Math.floor(Date.now() / 1000)
      const payload: SessionPayload = {
        credentialId,
        publicKey,
        ...(userId ? { userId } : {}),
        issuedAt,
        expiresAt: issuedAt + sessionTtl,
      }
      const token = Session.generateToken()
      // The session presented with this request belongs to an earlier
      // sign-in. The new one replaces it, so revoke it rather than leave it
      // usable for the rest of its lifetime.
      const previous = Session.tokenFromRequest(c.req.raw, { cookie, cookieName })
      await Promise.all([
        kv.set(sessionKey(token), payload, { ttl: sessionTtl }),
        previous ? kv.delete(sessionKey(previous)) : undefined,
      ])

      const json = {
        credentialId,
        publicKey,
        ...(userId ? { userId } : {}),
        ...(!cookie ? { token } : {}),
      }

      const cookieHeader = cookie
        ? Session.serializeCookie({
            name: cookieName,
            protocol: new URL(c.req.url).protocol,
            ttl: sessionTtl,
            value: token,
          })
        : undefined

      return Session.mergeResponse(json, hook || undefined, cookieHeader)
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
        credentialId?: string | string[]
        mediation?: string
      }

      const { challenge, options: authOptions } = Authentication.getOptions({
        challenge: requestChallenge,
        credentialId: credentialId ?? allowCredentialIds,
        rpId,
      })
      const options = mediation ? { ...authOptions, mediation } : authOptions

      await kv.set(`challenge:${challenge}`, Date.now(), { ttl: challengeTtl })

      return Response.json({ options, ttl: challengeTtl })
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
        consume<number>(`challenge:${challenge}`),
        kv.get<{ publicKey: string; userId?: string }>(`credential:${response.id}`),
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

      const credentialId = response.id
      const publicKey = credentialData.publicKey
      const userId = credentialData.userId

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
          if (!kv.take) await kv.delete(`challenge:${challenge}`)
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
        if (!kv.take) await kv.delete(`challenge:${challenge}`)
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
        kv.take ? undefined : kv.delete(`challenge:${challenge}`),
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
  type getSession = (req: Session.SessionRequest) => Promise<SessionPayload | undefined>

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
    /**
     * Key-value store for challenges, credentials, and sessions. When
     * `create` is available, credential registration uses it to reject
     * duplicates atomically. Otherwise, registration falls back to
     * best-effort `get` then `set` storage.
     *
     * When `take` is available, challenges are consumed atomically and are
     * strictly single-use. Otherwise they are read, then deleted: on
     * runtimes with `waitUntil` (e.g. Cloudflare Workers), pass the execution
     * context (`handler.fetch(request, env, ctx)`) so `/register` deletes its
     * challenge after responding, while `/login` deletes its challenge before
     * responding. Without `take` that deletion is best-effort: concurrent
     * requests can read a challenge before it is deleted. With `create`, a
     * registration challenge replayed in that window cannot register the same
     * credential twice.
     */
    kv: Kv.Kv
    /**
     * Called after a successful registration. The returned response is merged
     * onto the default JSON response. Throwing rejects the request and removes
     * the newly stored credential.
     */
    onRegister?: (parameters: {
      /** Authenticator model identifier, when the authenticator reports one. */
      aaguid?: string | undefined
      credentialId: string
      /** The name provided during `/register/options`, or with `/register` for a prefetched challenge (e.g. user email). */
      name: string
      publicKey: string
      request: Request
      /** The `userId` provided during `/register/options`, if any. */
      userId?: string | undefined
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
