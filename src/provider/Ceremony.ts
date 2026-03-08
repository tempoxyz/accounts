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
    /** Credential display name (e.g. `"alice"`). */
    name: string
    /** Opaque user identifier. Encoded as `user.id` in the WebAuthn creation options. */
    userId?: string | undefined
  }
  type ReturnType = { options: Registration.Options }
}

export declare namespace verifyRegistration {
  type ReturnType = { publicKey: Hex }
}

export declare namespace getAuthenticationOptions {
  type Parameters = {
    /** Challenge to use. */
    challenge?: `0x${string}` | undefined
    /** Credential ID to restrict authentication to a specific credential. */
    credentialId?: string | undefined
  }
  type ReturnType = { options: Authentication.Options }
}

export declare namespace verifyAuthentication {
  type ReturnType = { publicKey: Hex }
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
      const { name, userId } = parameters
      const { options } = Registration.getOptions({
        name,
        rp: { id: rpId, name: rpId },
        user: userId ? { id: Bytes.fromString(userId), name } : undefined,
      })
      return { options }
    },

    async verifyRegistration(credential) {
      const publicKey = credential.publicKey
      credentials.set(credential.id, publicKey)
      return { publicKey }
    },

    async getAuthenticationOptions(parameters = {}) {
      const { challenge, credentialId } = parameters
      const { options } = Authentication.getOptions({
        challenge,
        credentialId,
        rpId,
      })
      return { options }
    },

    async verifyAuthentication(response) {
      const publicKey = credentials.get(response.id)
      if (!publicKey) throw new Error(`Unknown credential: ${response.id}`)
      return { publicKey }
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
