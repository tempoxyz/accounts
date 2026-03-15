import { Bytes } from 'ox'
import type { Hex } from 'viem'
import { Authentication, Registration } from 'webauthx/server'

import * as Storage from './Storage.js'

/** Pluggable strategy for WebAuthn registration and authentication ceremonies. */
export type Ceremony = {
  /** Get credential creation options for `navigator.credentials.create()`. */
  getRegistrationOptions: (
    params: getRegistrationOptions.Parameters,
  ) => Promise<getRegistrationOptions.ReturnType>
  /** Verify a registration response and extract the public key. */
  verifyRegistration: (
    credential: Registration.Credential,
  ) => Promise<verifyRegistration.ReturnType>
  /** Get credential request options for `navigator.credentials.get()`. */
  getAuthenticationOptions: (
    params?: getAuthenticationOptions.Parameters | undefined,
  ) => Promise<getAuthenticationOptions.ReturnType>
  /** Verify an authentication response and extract the public key. */
  verifyAuthentication: (
    response: Authentication.Response,
  ) => Promise<verifyAuthentication.ReturnType>
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
  type ReturnType = {
    /** The registered credential's ID. */
    credentialId: string
    /** The credential's public key (uncompressed P256, hex-encoded). */
    publicKey: Hex
  }
}

export declare namespace getAuthenticationOptions {
  type Parameters = {
    /** Credential IDs to allow (restricts which credentials can be used). */
    allowCredentialIds?: readonly string[] | undefined
    /** Challenge to use. */
    challenge?: `0x${string}` | undefined
    /** Credential ID to restrict authentication to a specific credential. */
    credentialId?: string | undefined
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
  }
}

/** Creates a {@link Ceremony} from a custom implementation. */
export function from(ceremony: Ceremony): Ceremony {
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
 * import { Ceremony } from 'tempox'
 *
 * const ceremony = Ceremony.local()
 * ```
 */
export function local(options: local.Options = {}): Ceremony {
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
      const { allowCredentialIds, challenge, credentialId } = parameters
      const { options } = Authentication.getOptions({
        challenge,
        credentialId: (allowCredentialIds as string[] | undefined) ?? credentialId,
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
 * Creates a server-backed ceremony that delegates to a remote {@link Handler.webauthn} endpoint.
 *
 * All challenge generation, verification, and credential storage happen server-side.
 * The client uses `fetch()` to communicate with 4 POST endpoints derived from the base URL.
 *
 * @example
 * ```ts
 * import { Ceremony } from 'tempox'
 *
 * const ceremony = Ceremony.server({ url: 'https://example.com/webauthn' })
 * ```
 */
export function server(options: server.Options): Ceremony {
  const { url } = options

  async function request(path: string, body: unknown) {
    const response = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await response.json()
    if (!response.ok) throw new Error((json as { error?: string }).error ?? 'Request failed')
    return json
  }

  return from({
    async getRegistrationOptions(parameters) {
      const { excludeCredentialIds, name, userId } = parameters
      return request('/register/options', { excludeCredentialIds, name, userId })
    },

    async verifyRegistration(credential) {
      return request('/register', credential)
    },

    async getAuthenticationOptions(parameters = {}) {
      const { allowCredentialIds, challenge, credentialId, mediation } = parameters
      return request('/login/options', { allowCredentialIds, challenge, credentialId, mediation })
    },

    async verifyAuthentication(response) {
      return request('/login', response)
    },
  })
}

export declare namespace server {
  type Options = {
    /** Base URL of the WebAuthn handler (e.g. `"https://example.com/webauthn"`). */
    url: string
  }
}
