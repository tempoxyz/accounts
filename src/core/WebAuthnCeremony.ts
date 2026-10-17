import { Base64, Bytes, Hex as ox_Hex } from 'ox'
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
  ) => Promise<verifyAuthentication.ReturnType>
  /** Ends the server session, if the ceremony has one. Called on `wallet_disconnect`. */
  logout?: (() => Promise<void>) | undefined
  /**
   * Fetches a login and a registration challenge ahead of the ceremonies that
   * use them, and a new one each time one is used (see {@link server}).
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
    /** Opaque user identifier. Encoded as `user.id` in the WebAuthn creation options. */
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
  type ReturnType = {
    /** The authenticated credential's ID. */
    credentialId: string
    /** The credential's public key (uncompressed P256, hex-encoded). */
    publicKey: Hex
    /** User identifier from the authenticator's `userHandle` (discoverable/conditional flows). */
    userId?: string | undefined
    /** Username associated with the account. */
    username?: string | null | undefined
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
        user: userId ? { id: Bytes.fromString(userId), name } : undefined,
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
      // A `userId` is bound to the challenge when it's issued, so it can't use
      // a prefetched one.
      const ready = userId ? undefined : challenges.take('register')
      if (!ready) return request('/register/options', { excludeCredentialIds, name, userId })
      return {
        options: Registration.getOptions({
          challenge: ready.challenge,
          excludeCredentialIds: excludeCredentialIds as string[] | undefined,
          name,
          rp: { id: ready.rpId, name: ready.rpId },
        }).options,
      }
    },

    async verifyRegistration(credential, options = {}) {
      return request('/register', challenges.body(credential, options.name))
    },

    async getAuthenticationOptions(parameters = {}) {
      const { challenge, credentialId, mediation } = parameters
      const ready = challenge ? challenges.issued(challenge) : challenges.take('login')
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
      return challenges.take('login', { issue: true })?.challenge
    },

    async verifyAuthentication(response) {
      return request('/login', response)
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
 * How long a prefetched challenge is used for, under `Handler.webAuthn`'s
 * default 5-minute challenge TTL.
 */
const prefetchMaxAge = 4 * 60_000

/** A challenge the server issued ahead of the ceremony that uses it. */
type Prefetched = { challenge: Hex; created: number; rpId: string }

/**
 * Holds one login and one registration challenge fetched ahead of time, once
 * `warm` is called, and fetches the next one each time one is taken.
 */
function prefetcher(request: <returnType>(path: string, body: unknown) => Promise<returnType>) {
  let enabled = false
  const ready: { login?: Prefetched | undefined; register?: Prefetched | undefined } = {}
  const pending: { login?: Promise<void> | undefined; register?: Promise<void> | undefined } = {}
  /** Login challenges handed out by `take(…, { issue: true })`, by challenge. */
  const issued_login = new Map<Hex, Prefetched>()
  /** Registration challenges whose options were built locally, so `/register` carries the name. */
  const named = new Set<Hex>()

  function fresh(value: Prefetched | undefined) {
    return value && Date.now() - value.created < prefetchMaxAge ? value : undefined
  }

  function fill(kind: 'login' | 'register') {
    if (!enabled || pending[kind] || fresh(ready[kind])) return
    pending[kind] = (async () => {
      try {
        if (kind === 'login') {
          const { options } = await request<{ options: Authentication.Options }>(
            '/login/options',
            {},
          )
          const { challenge, rpId } = options.publicKey ?? {}
          if (challenge && rpId) ready.login = { challenge, created: Date.now(), rpId }
        } else {
          const { options } = await request<{ options: Registration.Options }>(
            '/register/options',
            {},
          )
          const { challenge, rp } = options.publicKey ?? {}
          if (challenge && rp?.id) ready.register = { challenge, created: Date.now(), rpId: rp.id }
        }
      } catch {
        // The ceremony fetches its own challenge instead.
      } finally {
        pending[kind] = undefined
      }
    })()
  }

  return {
    /** Starts prefetching. */
    warm() {
      enabled = true
      fill('login')
      fill('register')
    },
    /** Takes a fresh prefetched challenge, if one is ready, and fetches the next. */
    take(kind: 'login' | 'register', options: { issue?: boolean } = {}) {
      const value = fresh(ready[kind])
      ready[kind] = undefined
      fill(kind)
      if (!value) return undefined
      if (kind === 'login' && options.issue) issued_login.set(value.challenge, value)
      if (kind === 'register') named.add(value.challenge)
      return value
    },
    /** The prefetched login challenge `take` issued, if `challenge` is one. */
    issued(challenge: Hex) {
      const value = issued_login.get(challenge)
      issued_login.delete(challenge)
      return fresh(value)
    },
    /**
     * The `/register` body: the credential, plus its name when its challenge
     * was issued without one.
     */
    body(credential: Registration.Credential, name: string | undefined) {
      if (named.size === 0 || name === undefined) return credential
      const challenge = (() => {
        try {
          const { challenge } = JSON.parse(
            Bytes.toString(Base64.toBytes(credential.clientDataJSON)),
          ) as { challenge: string }
          return ox_Hex.fromBytes(Base64.toBytes(challenge))
        } catch {
          return undefined
        }
      })()
      if (!challenge || !named.delete(challenge)) return credential
      return { ...credential, name }
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

  /** Posts the registration with `keepalive`, so it survives the page closing. */
  async function register(
    body: unknown,
    signal: AbortSignal | undefined,
  ): Promise<{ publicKey?: Hex | undefined }> {
    const response = await fetch(`${url}/register`, {
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
    if (!response.ok) throw new Error((json as { error?: string }).error ?? 'Request failed')
    return json as { publicKey?: Hex | undefined }
  }

  return from({
    ...base,

    async verifyRegistration(credential, options = {}) {
      const { signal } = options
      const body = challenges.body(credential, options.name)
      const verified = (async () => {
        const { publicKey, session } = await (async () => {
          for (let attempt = 0; ; attempt++)
            try {
              signal?.throwIfAborted()
              const { publicKey } = await register(body, signal)
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
  })
}

export declare namespace deferred {
  /** Same options as {@link server}. */
  type Options = server.Options
}
