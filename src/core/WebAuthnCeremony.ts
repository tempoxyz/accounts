import { Base64, Bytes, Hex as core_Hex } from 'ox'
import type { Hex } from 'viem'
import { Authentication, Registration } from 'webauthx/server'

import * as Storage from './Storage.js'

/** Pluggable strategy for WebAuthn registration and authentication ceremonies. */
export type WebAuthnCeremony = {
  /** Get credential creation options for `navigator.credentials.create()`. */
  getRegistrationOptions: (
    params: getRegistrationOptions.Parameters,
  ) => Promise<getRegistrationOptions.ReturnType>
  /** Verify a registration response and extract the public key. */
  verifyRegistration: (
    credential: Registration.Credential,
    options?: verifyRegistration.Options | undefined,
  ) => Promise<verifyRegistration.ReturnType>
  /** Get credential request options for `navigator.credentials.get()`. */
  getAuthenticationOptions: (
    params?: getAuthenticationOptions.Parameters | undefined,
  ) => Promise<getAuthenticationOptions.ReturnType>
  /** Verify an authentication response and extract the public key. */
  verifyAuthentication: (
    response: Authentication.Response,
    options?: verifyAuthentication.Options | undefined,
  ) => Promise<verifyAuthentication.ReturnType>
  /** Ends the server session, if the ceremony has one. Called on `wallet_disconnect`. */
  logout?: (() => Promise<void>) | undefined
  /**
   * Fetches a login and a registration challenge ahead of the ceremonies that
   * use them, and a new one each time one is used (see {@link server}). A
   * ceremony with `prefetch` picks a random `userId` itself when
   * {@link getRegistrationOptions} gets none, so the `webAuthn` adapter
   * leaves it unset.
   */
  prefetch?: (() => void) | undefined
  /**
   * Takes a login challenge the server already issued, if one is ready, so
   * the caller can build request options before {@link getAuthenticationOptions}
   * answers (it answers at once for this challenge).
   */
  takeChallenge?: (() => Hex | undefined) | undefined
}

export declare namespace getRegistrationOptions {
  type Parameters = {
    /** Credential IDs to exclude (prevents re-registering existing credentials). */
    excludeCredentialIds?: readonly string[] | undefined
    /** Credential display name (e.g. `"alice"`). */
    name: string
    /**
     * Opaque user identifier. Encoded as `user.id` in the WebAuthn creation
     * options. A random one when omitted (`Handler.webAuthn` picks it for
     * {@link server} ceremonies).
     */
    userId?: string | undefined
  }
  type ReturnType = { options: Registration.Options }
}

export declare namespace verifyRegistration {
  type Options = {
    /** Display name for the credential (e.g. user's email). */
    name?: string | undefined
    /**
     * Cancels background verification (see `verified`), which then rejects
     * with the signal's reason, and can no longer issue a session. The
     * `webAuthn` adapter cancels a verification that outlasts its wait.
     */
    signal?: AbortSignal | undefined
  }
  type ReturnType = {
    /** The registered credential's ID. */
    credentialId: string
    /** The credential's public key (uncompressed P256, hex-encoded). */
    publicKey: Hex
    /** Username associated with the account. */
    username?: string | null | undefined
    /**
     * Settles once the server has stored the credential, when the ceremony
     * verifies the registration in the background (see {@link deferred}).
     * Rejects when the server refuses it.
     * `session` is `false` when a retry found the registration already
     * processed after a lost response, so its session was never received.
     */
    verified?: Promise<{ session: boolean }> | undefined
  }
}

export declare namespace getAuthenticationOptions {
  type Parameters = {
    /** Challenge to use. */
    challenge?: `0x${string}` | undefined
    /** Credential ID or IDs to restrict authentication to. */
    credentialId?: string | readonly string[] | undefined
    /** Mediation hint for passkey autofill / conditional UI. */
    mediation?: 'conditional' | 'optional' | 'required' | 'silent' | undefined
  }
  type ReturnType = { options: Authentication.Options }
}

export declare namespace verifyAuthentication {
  type Options = {
    /**
     * The credential the caller already knows: the challenge it signed, its
     * public key and RP ID. A {@link deferred} ceremony checks the signature
     * against them and verifies the login with the server in the background.
     */
    credential?:
      | {
          challenge: Hex
          publicKey: Hex
          rpId: string
        }
      | undefined
    /**
     * Resolves once the server may be sent the login, e.g. after earlier
     * registrations have landed, so none replaces its session. A ceremony
     * that verifies logins with a server waits for it before sending
     * `/login`; one that answers before verifying (see {@link deferred}) only
     * delays its background verification.
     */
    ready?: Promise<unknown> | undefined
    /**
     * Cancels background verification (see `verified`), which then rejects
     * with the signal's reason, and can no longer issue a session.
     */
    signal?: AbortSignal | undefined
  }
  type ReturnType = {
    /** The authenticated credential's ID. */
    credentialId: string
    /** The credential's public key (uncompressed P256, hex-encoded). */
    publicKey: Hex
    /** User identifier from the authenticator's `userHandle` (discoverable/conditional flows). */
    userId?: string | undefined
    /** Username associated with the account. */
    username?: string | null | undefined
    /**
     * Settles once the server has verified the login, when the ceremony
     * verifies it in the background (see {@link deferred}). `session` is
     * `false` when the outcome is unknown (every attempt failed in transit, a
     * retry found the challenge consumed, or the server failed for a reason
     * other than refusing the credential): the login wasn't refused, but no
     * session of its own is in place. Rejects when the server refuses it.
     */
    verified?: Promise<{ session: boolean }> | undefined
  }
}

/** Creates a {@link WebAuthnCeremony} from a custom implementation. */
export function from(ceremony: WebAuthnCeremony): WebAuthnCeremony {
  return ceremony
}

/**
 * Creates a pure client-side ceremony for development and prototyping.
 *
 * Generates challenges and verifies responses locally using `webauthx/server`.
 * Stores credentials in memory. No external server needed.
 *
 * @example
 * ```ts
 * import { WebAuthnCeremony } from 'accounts'
 *
 * const ceremony = WebAuthnCeremony.local()
 * ```
 */
export function local(options: local.Options = {}): WebAuthnCeremony {
  const rpId = options.rpId ?? (typeof location !== 'undefined' ? location.hostname : 'localhost')
  const storage =
    options.storage ?? (typeof window !== 'undefined' ? Storage.idb() : Storage.memory())
  const storageKey = 'credentials'

  return from({
    async getRegistrationOptions(parameters) {
      const { excludeCredentialIds, name, userId } = parameters
      const { options } = Registration.getOptions({
        excludeCredentialIds: excludeCredentialIds as string[] | undefined,
        name,
        rp: { id: rpId, name: rpId },
        // A random `userId` by default, so passkeys with the same name don't replace each other.
        user: { id: Bytes.fromString(userId || core_Hex.random(16)), name },
      })
      return { options }
    },

    async verifyRegistration(credential) {
      const publicKey = credential.publicKey
      const credentials = (await storage.getItem<Record<string, Hex>>(storageKey)) ?? {}
      credentials[credential.id] = publicKey
      await storage.setItem(storageKey, credentials)
      return { credentialId: credential.id, publicKey }
    },

    async getAuthenticationOptions(parameters = {}) {
      const { challenge, credentialId } = parameters
      const { options } = Authentication.getOptions({
        challenge,
        credentialId:
          typeof credentialId === 'string'
            ? credentialId
            : credentialId
              ? [...credentialId]
              : undefined,
        rpId,
      })
      return { options }
    },

    async verifyAuthentication(response) {
      const credentials = (await storage.getItem<Record<string, Hex>>(storageKey)) ?? {}
      const publicKey = credentials[response.id]
      if (!publicKey) throw new Error(`Unknown credential: ${response.id}`)
      return { credentialId: response.id, publicKey }
    },
  })
}

export declare namespace local {
  type Options = {
    /** Relying Party ID (e.g. `"example.com"`). @default location.hostname */
    rpId?: string | undefined
    /** Storage adapter for credential persistence. @default Storage.idb() in browser, Storage.memory() otherwise. */
    storage?: Storage.Storage | undefined
  }
}

/**
 * Creates a server-backed ceremony that delegates to a remote {@link Handler.webAuthn} endpoint.
 *
 * All challenge generation, verification, and credential storage happen server-side.
 * The client uses `fetch()` to communicate with 4 POST endpoints derived from the base URL.
 *
 * @example
 * ```ts
 * import { WebAuthnCeremony } from 'accounts'
 *
 * const ceremony = WebAuthnCeremony.server({ url: 'https://example.com/webauthn' })
 * ```
 */
export function server(options: server.Options): WebAuthnCeremony {
  return create(options).ceremony
}

/** Builds a {@link server} ceremony, with its challenge prefetcher for {@link deferred}. */
function create(options: server.Options) {
  const { credentials, url } = options

  async function request<returnType>(path: string, body: unknown): Promise<returnType> {
    const response = await fetch(`${url}${path}`, {
      body: JSON.stringify(body),
      ...(credentials ? { credentials } : {}),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    const json = await response.json()
    if (!response.ok) throw new Error((json as { error?: string }).error ?? 'Request failed')
    return json as returnType
  }

  const challenges = prefetcher(request)

  const ceremony = from({
    async getRegistrationOptions(parameters) {
      const { excludeCredentialIds, name, userId } = parameters
      // The server binds a `userId` when it issues the challenge, so a
      // prefetched one only serves sign-ups that leave it to the server.
      const ready = userId === undefined ? await challenges.register() : undefined
      if (!ready)
        return request('/register/options', {
          excludeCredentialIds,
          name,
          // Random by default, so passkeys with the same name don't share a user handle on servers
          // that leave `user.id` to the name.
          userId: userId ?? core_Hex.random(16),
        })
      challenges.bind(ready, name)
      return {
        options: Registration.getOptions({
          challenge: ready.challenge,
          excludeCredentialIds: excludeCredentialIds as string[] | undefined,
          name,
          rp: { id: ready.rpId, name: ready.rpId },
          user: { id: ready.userId, name },
        }).options,
      }
    },

    async verifyRegistration(credential) {
      return request('/register', challenges.body(credential))
    },

    async getAuthenticationOptions(parameters = {}) {
      const { challenge, credentialId, mediation } = parameters
      const ready = challenge ? challenges.issued(challenge) : await challenges.login()
      if (!ready) return request('/login/options', { challenge, credentialId, mediation })
      const { options } = Authentication.getOptions({
        challenge: ready.challenge,
        credentialId: credentialId as string | string[] | undefined,
        rpId: ready.rpId,
      })
      return { options: mediation ? { ...options, mediation } : options }
    },

    prefetch: challenges.warm,

    takeChallenge() {
      return challenges.issue()?.challenge
    },

    async verifyAuthentication(response, options = {}) {
      await options.ready
      // Only the declared fields: a hook can merge others into the response.
      const { credentialId, publicKey, userId, username } =
        await request<verifyAuthentication.ReturnType>('/login', response)
      return {
        credentialId,
        publicKey,
        ...(userId !== undefined ? { userId } : {}),
        ...(username !== undefined ? { username } : {}),
      }
    },

    async logout() {
      const response = await fetch(`${url}/logout`, {
        method: 'POST',
        credentials: credentials ?? 'include',
      })
      // A server without a logout route has no session to end.
      if (!response.ok && response.status !== 404)
        throw new Error(`Logout failed with status ${response.status}`)
    },
  })
  return { ceremony, challenges }
}

/**
 * How long before the server's challenge TTL runs out a prefetched challenge
 * stops being used, so the ceremony that takes it can finish in time.
 */
const margin = 60_000

/**
 * When a challenge requested at `requested` stops being used. Undefined for a
 * server that doesn't send its TTL (it predates prefetching, so it can't take
 * a nameless registration challenge either).
 */
function expiry(requested: number, ttl: unknown) {
  if (typeof ttl !== 'number' || !Number.isFinite(ttl)) return undefined
  // Leave a fifth of a short TTL, so a 1-minute TTL still leaves 48 s.
  const value = requested + ttl * 1_000 - Math.min(margin, ttl * 200)
  return value > Date.now() ? value : undefined
}

/**
 * Holds one login and one registration challenge fetched ahead of time, once
 * `warm` is called, and fetches the next one each time one is taken.
 */
function prefetcher(request: <returnType>(path: string, body: unknown) => Promise<returnType>) {
  let enabled = false
  /** Cleared when the server answers without a TTL: it predates prefetching. */
  let login_supported = true
  let register_supported = true
  let login: { challenge: Hex; expires: number; rpId: string } | undefined
  let login_pending: Promise<void> | undefined
  let register:
    | {
        challenge: Hex
        expires: number
        /** When the server's TTL runs out, after `expires`. */
        lapses: number
        rpId: string
        userId: Uint8Array
      }
    | undefined
  let register_pending: Promise<void> | undefined
  /** Login challenges handed out by `issue`, by challenge. */
  const issued = new Map<Hex, { challenge: Hex; expires: number; rpId: string }>()
  /**
   * The name each locally built registration's options were built with, by
   * challenge, so `/register` carries the name the server didn't store. Kept
   * until the server's TTL runs out, so a retry or a slow prompt sends it too.
   */
  const bound = new Map<Hex, { lapses: number; name: string }>()

  function fill_login() {
    if (!enabled || !login_supported || login_pending || (login && Date.now() < login.expires))
      return
    login_pending = (async () => {
      // The server starts the TTL before it answers, so count from the request.
      const requested = Date.now()
      try {
        const { options, ttl } = await request<{ options: Authentication.Options; ttl?: unknown }>(
          '/login/options',
          {},
        )
        if (ttl === undefined) login_supported = false
        const { challenge, rpId } = options.publicKey ?? {}
        const expires = expiry(requested, ttl)
        if (challenge && rpId && expires) login = { challenge, expires, rpId }
      } catch {
        // The ceremony fetches its own challenge instead.
      } finally {
        login_pending = undefined
      }
    })()
  }

  function fill_register() {
    if (
      !enabled ||
      !register_supported ||
      register_pending ||
      (register && Date.now() < register.expires)
    )
      return
    register_pending = (async () => {
      const requested = Date.now()
      try {
        const { options, ttl } = await request<{ options: Registration.Options; ttl?: unknown }>(
          '/register/options',
          {},
        )
        if (ttl === undefined) register_supported = false
        const { challenge, rp, user } = options.publicKey ?? {}
        const expires = expiry(requested, ttl)
        if (challenge && rp?.id && user?.id && expires)
          register = {
            challenge,
            expires,
            lapses: requested + (ttl as number) * 1_000,
            rpId: rp.id,
            userId: Base64.toBytes(user.id),
          }
      } catch {
        // The ceremony fetches its own challenge instead.
      } finally {
        register_pending = undefined
      }
    })()
  }

  /** Whether a fresh login challenge is ready. Read through a call, so it's checked after a wait. */
  function ready_login() {
    return !!login && Date.now() < login.expires
  }

  /** Whether a fresh registration challenge is ready. */
  function ready_register() {
    return !!register && Date.now() < register.expires
  }

  /** Takes the prefetched login challenge, if it's fresh, and fetches the next. */
  function take_login() {
    const value = login && Date.now() < login.expires ? login : undefined
    login = undefined
    fill_login()
    return value
  }

  return {
    /** Starts prefetching. */
    warm() {
      enabled = true
      fill_login()
      fill_register()
    },
    /**
     * Takes the prefetched login challenge, waiting for one in flight (the
     * ceremony would wait as long for its own), and fetches the next.
     */
    async login() {
      // Without a fresh one, wait for the one in flight, or the refill this starts, rather than
      // have the ceremony request another.
      if (!(login && Date.now() < login.expires)) {
        login = undefined
        fill_login()
        if (login_pending) await login_pending
        // A prefetch that failed isn't retried here: the ceremony requests its own instead.
        if (!ready_login()) return undefined
      }
      return take_login()
    },
    /** Takes a ready login challenge for options the caller builds itself, and fetches the next. */
    issue() {
      const value = take_login()
      if (value) issued.set(value.challenge, value)
      return value
    },
    /** The prefetched login challenge `issue` handed out, if `challenge` is one and still fresh. */
    issued(challenge: Hex) {
      const value = issued.get(challenge)
      issued.delete(challenge)
      return value && Date.now() < value.expires ? value : undefined
    },
    /**
     * Takes the prefetched registration challenge, waiting for one in flight
     * (the ceremony would wait as long for its own), and fetches the next.
     */
    async register() {
      if (!(register && Date.now() < register.expires)) {
        register = undefined
        fill_register()
        if (register_pending) await register_pending
        if (!ready_register()) return undefined
      }
      const value = register && Date.now() < register.expires ? register : undefined
      register = undefined
      fill_register()
      return value
    },
    /** Records the name a prefetched registration challenge's options were built with. */
    bind(value: { challenge: Hex; lapses: number }, name: string) {
      for (const [challenge, { lapses }] of bound) if (Date.now() >= lapses) bound.delete(challenge)
      bound.set(value.challenge, { lapses: value.lapses, name })
    },
    /**
     * The `/register` body: the credential, plus the name its options were
     * built with when its challenge was prefetched.
     */
    body(credential: Registration.Credential) {
      if (bound.size === 0) return credential
      const challenge = (() => {
        try {
          const { challenge } = JSON.parse(
            Bytes.toString(Base64.toBytes(credential.clientDataJSON)),
          ) as { challenge: string }
          return core_Hex.fromBytes(Base64.toBytes(challenge))
        } catch {
          return undefined
        }
      })()
      const value = challenge ? bound.get(challenge) : undefined
      if (!value) return credential
      return { ...credential, name: value.name }
    },
  }
}

export declare namespace server {
  type Options = {
    /** Credential mode for ceremony requests. @default "same-origin" */
    credentials?: RequestCredentials | undefined
    /** Base URL of the WebAuthn handler (e.g. `"https://example.com/webauthn"`). */
    url: string
  }
}

/**
 * Creates a {@link server} ceremony that answers registration as soon as the
 * passkey is created, and verifies it with the server (`POST /register`) in
 * the background, retrying requests that fail in transit. The account address
 * derives from the passkey's public key alone, so the app gets the same
 * address it would after verification.
 *
 * Trade-offs: the server session (e.g. `Handler.webAuthn`'s cookie) exists
 * only once verification completes, so server requests the app makes right
 * after registering may not be authenticated yet. The `webAuthn` adapter makes
 * logins and disconnects wait for it, for up to 10 s. A verification still
 * running then is cancelled, so it can't replace the session of the login or
 * disconnect that follows; the account stays, and a later login with the
 * passkey works if the server stored it.
 *
 * A login with a passkey the caller knows (`verifyAuthentication`'s
 * `credential`, which the `webAuthn` adapter passes for its stored accounts)
 * answers once the signature checks out against the stored public key, and
 * `POST /login` runs in the background the same way. The session it issues
 * likewise exists only once it lands, and the adapter makes logins and
 * disconnects wait for it. A refusal ends the session in place and the
 * adapter drops the account, as for a refused registration. A login whose
 * outcome stays unknown (it failed in transit, or a retry found its challenge
 * consumed, or the server failed for a reason other than refusing the
 * credential) ends the session in place but keeps the account.
 *
 * The request is sent with `keepalive`, so it completes when the page closes
 * right after answering, but retries only run while the page is open. If the
 * server rejects the registration while the page is open, the adapter removes
 * the account (an `accountsChanged` event) and keeps its public key in storage
 * under `registration:<credentialId>`. A later login with the passkey restores
 * the account if the server did store it. A rejection that arrives after the
 * page closed goes unnoticed: the account stays stored on the device, and
 * server logins with it fail. Use it where the page outlives the request and
 * every server request waits for it (e.g. an embedded wallet's iframe).
 *
 * @example
 * ```ts
 * import { WebAuthnCeremony } from 'accounts'
 *
 * const ceremony = WebAuthnCeremony.deferred({ url: 'https://example.com/webauthn' })
 * ```
 */
export function deferred(options: deferred.Options): WebAuthnCeremony {
  const { credentials, url } = options

  const { ceremony: base, challenges } = create(options)

  /** Posts to `path` with `keepalive`, so the request survives the page closing. */
  async function post(
    path: '/login' | '/register',
    body: unknown,
    signal: AbortSignal | undefined,
  ): Promise<{ publicKey?: Hex | undefined }> {
    const response = await fetch(`${url}${path}`, {
      body: JSON.stringify(body),
      ...(credentials ? { credentials } : {}),
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      method: 'POST',
      ...(signal ? { signal } : {}),
    })
    // A gateway or overloaded server may answer with JSON too; its status
    // tells a failure in transit from the server's answer.
    if (response.status >= 500 || response.status === 408 || response.status === 429)
      throw new TypeError(`Request failed with status ${response.status}`)
    const json = await response.json()
    if (!response.ok)
      throw Object.assign(new Error((json as { error?: string }).error ?? 'Request failed'), {
        status: response.status,
      })
    return json as { publicKey?: Hex | undefined }
  }

  /**
   * Ends the session in place, retrying with backoff (up to 30 s apart) until
   * it succeeds. Rejects with `signal`'s reason once it aborts.
   */
  async function end(signal: AbortSignal | undefined) {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted()
      try {
        return await base.logout?.()
      } catch {}
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(done, Math.min(250 * 2 ** attempt, 30_000))
        signal?.addEventListener('abort', done, { once: true })
        function done() {
          clearTimeout(timer)
          signal?.removeEventListener('abort', done)
          if (signal?.aborted) reject(signal.reason)
          else resolve()
        }
      })
    }
  }

  /**
   * Whether a `/login` error is the server refusing the credential itself (it
   * doesn't know it, the signature doesn't check out, or a hook denied it),
   * rather than an error unrelated to the account (e.g. an expired challenge
   * or a failing store).
   */
  function refused(error: unknown) {
    const { message, status } = error as { message?: string; status?: number }
    return (
      status === 401 ||
      status === 403 ||
      message === 'Unknown credential' ||
      message === 'Authentication failed'
    )
  }

  return from({
    ...base,

    async verifyRegistration(credential, options = {}) {
      const { signal } = options
      const body = challenges.body(credential)
      const verified = (async () => {
        const { publicKey, session } = await (async () => {
          for (let attempt = 0; ; attempt++)
            try {
              signal?.throwIfAborted()
              const { publicKey } = await post('/register', body, signal)
              return { publicKey, session: true }
            } catch (error) {
              if (signal?.aborted) throw signal.reason
              // A retry that finds the credential means a lost earlier attempt
              // stored it: the authenticator just minted this random credential
              // ID. Count it as acknowledged, without the session that attempt
              // issued. A consumed challenge does not prove that (it may have
              // expired), so it rejects; a later login recovers the account if
              // the server did store it.
              if (attempt > 0 && (error as Error).message === 'Credential already exists')
                return { publicKey: undefined, session: false }
              // `fetch` failures, 5xx, 408 and 429 responses, and non-JSON
              // responses can be retried; any other JSON error is the server's
              // answer.
              const retryable = error instanceof TypeError || error instanceof SyntaxError
              if (!retryable || attempt >= 2) throw error
              await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt))
            }
        })()
        // The app was handed the address of the key the client parsed. If the
        // server parsed another one from the attestation, that address isn't
        // the stored account's: end its session and refuse the registration.
        if (publicKey && publicKey.toLowerCase() !== credential.publicKey.toLowerCase()) {
          // If ending it fails, that failure rejects verification instead.
          await base.logout?.()
          throw new Error('Server stored a different public key')
        }
        // Any session still in place belongs to an earlier sign-in, not this
        // account, so end it rather than let requests run as that account. If
        // that fails, so does verification, and the adapter drops the account.
        if (!session) await base.logout?.()
        return { session }
      })()
      // Observed by the adapter; keep an unobserved failure from going unhandled.
      verified.catch(() => {})
      return {
        credentialId: credential.id,
        publicKey: credential.publicKey,
        verified,
      }
    },

    async verifyAuthentication(response, options = {}) {
      const { credential, ready, signal } = options
      // Without the credential's public key, only the server can verify the
      // login, so the caller waits for it.
      const valid =
        credential && typeof window !== 'undefined'
          ? (() => {
              try {
                return Authentication.verify(response, {
                  challenge: credential.challenge,
                  origin: window.location.origin,
                  publicKey: credential.publicKey,
                  rpId: credential.rpId,
                })
              } catch {
                return false
              }
            })()
          : false
      if (!credential || !valid) return base.verifyAuthentication(response, { ready })
      const verified = (async () => {
        await ready
        try {
          const answer = await (async () => {
            for (let attempt = 0; ; attempt++)
              try {
                signal?.throwIfAborted()
                return await post('/login', response, signal)
              } catch (error) {
                if (signal?.aborted) throw signal.reason
                // As for registration. The first attempt's refusal of the
                // credential is the server's answer. Any other error, or a
                // retry's (an earlier attempt may have landed and consumed
                // the challenge), leaves the outcome unknown.
                const retryable = error instanceof TypeError || error instanceof SyntaxError
                if (!retryable && attempt === 0 && refused(error)) throw error
                if (!retryable || attempt >= 2) return undefined
                await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt))
              }
          })()
          // The app was handed the account of the key checked here. If the
          // server knows the credential by another key, refuse the login.
          if (answer && answer.publicKey?.toLowerCase() !== credential.publicKey.toLowerCase())
            throw new Error('Server stored a different public key')
          // Unknown outcome: the login wasn't refused, so keep the account,
          // and end any session in place, which may be an earlier account's.
          // A logout that fails too (e.g. still offline) is retried until it
          // succeeds or `signal` aborts, rather than drop the account or leave
          // that session in place.
          if (!answer) await end(signal)
          return { session: !!answer }
        } catch (error) {
          // The app now runs as this account, so a session the server left
          // in place (an earlier account's, or the one it just issued) must
          // not stay. If ending it fails, so does verification.
          if (!signal?.aborted) await base.logout?.()
          throw error
        }
      })()
      // Observed by the adapter; keep an unobserved failure from going unhandled.
      verified.catch(() => {})
      return {
        credentialId: response.id,
        publicKey: credential.publicKey,
        verified,
      }
    },
  })
}

export declare namespace deferred {
  /** Same options as {@link server}. */
  type Options = server.Options
}
