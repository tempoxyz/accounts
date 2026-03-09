import { Bytes } from 'ox'
import type { Hex } from 'viem'
import { Authentication, Registration } from 'webauthx/server'

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
 * import { Ceremony } from 'zyzz/provider'
 *
 * const ceremony = Ceremony.local({ rpId: 'example.com', origin: 'https://example.com' })
 * ```
 */
export function local(options: local.Options): Ceremony {
  const { rpId } = options

  /** In-memory credential store: `credentialId → publicKey (hex)`. */
  const credentials = new Map<string, Hex>()

  return {
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
      credentials.set(credential.id, publicKey)
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
      const publicKey = credentials.get(response.id)
      if (!publicKey) throw new Error(`Unknown credential: ${response.id}`)
      return { credentialId: response.id, publicKey }
    },
  }
}

export declare namespace local {
  type Options = {
    /** Expected origin (e.g. `"https://example.com"`). */
    origin: string
    /** Relying Party ID (e.g. `"example.com"`). */
    rpId: string
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
 * import { Ceremony } from 'zyzz/provider'
 *
 * const ceremony = Ceremony.server({ url: 'https://example.com/webauthn' })
 * ```
 */
export function server(options: server.Options): Ceremony {
  const { url } = options

  return {
    async getRegistrationOptions(parameters) {
      const { excludeCredentialIds, name, userId } = parameters
      const response = await fetch(`${url}/register/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excludeCredentialIds, name, userId }),
      })
      return response.json()
    },

    async verifyRegistration(credential) {
      const response = await fetch(`${url}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credential),
      })
      return response.json()
    },

    async getAuthenticationOptions(parameters = {}) {
      const { allowCredentialIds, challenge, credentialId, mediation } = parameters
      const response = await fetch(`${url}/login/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowCredentialIds, challenge, credentialId, mediation }),
      })
      return response.json()
    },

    async verifyAuthentication(response) {
      const res = await fetch(`${url}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(response),
      })
      return res.json()
    },
  }
}

export declare namespace server {
  type Options = {
    /** Base URL of the WebAuthn handler (e.g. `"https://example.com/webauthn"`). */
    url: string
  }
}
