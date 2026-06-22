import { Bytes } from 'ox'
import type { Hex } from 'viem'
import { Authentication, Registration } from 'webauthx/server'

import * as Storage from './Storage.js'

/** Pluggable strategy for WebAuthn registration and authentication ceremonies. */
export type WebAuthnCeremony<
  requestExtensions extends Record<string, unknown> = Record<string, unknown>,
  responseExtensions extends Record<string, unknown> = Record<string, unknown>,
> = {
  /** Get credential creation options for `navigator.credentials.create()`. */
  getRegistrationOptions: (
    params: getRegistrationOptions.Parameters<requestExtensions>,
  ) => Promise<getRegistrationOptions.ReturnType>
  /** Verify a registration response and extract the public key. */
  verifyRegistration: (
    credential: Registration.Credential,
    options?: verifyRegistration.Options | undefined,
  ) => Promise<verifyRegistration.ReturnType<responseExtensions>>
  /** Get credential request options for `navigator.credentials.get()`. */
  getAuthenticationOptions: (
    params?: getAuthenticationOptions.Parameters<requestExtensions> | undefined,
  ) => Promise<getAuthenticationOptions.ReturnType>
  /** Verify an authentication response and extract the public key. */
  verifyAuthentication: (
    response: Authentication.Response,
  ) => Promise<verifyAuthentication.ReturnType<responseExtensions>>
}

export declare namespace getRegistrationOptions {
  type Parameters<extensions extends Record<string, unknown> = Record<string, unknown>> = {
    /** Credential IDs to exclude (prevents re-registering existing credentials). */
    excludeCredentialIds?: readonly string[] | undefined
    /** Host-defined, JSON-serializable data to bind to this ceremony challenge. */
    extensions?: extensions | undefined
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
  }
  type ReturnType<extensions extends Record<string, unknown> = Record<string, unknown>> = {
    /** The registered credential's ID. */
    credentialId: string
    /** Host-defined data returned by the server hook. */
    extensions?: extensions | undefined
    /** The credential's public key (uncompressed P256, hex-encoded). */
    publicKey: Hex
    /** Username associated with the account. */
    username?: string | null | undefined
  }
}

export declare namespace getAuthenticationOptions {
  type Parameters<extensions extends Record<string, unknown> = Record<string, unknown>> = {
    /** Credential IDs to allow (restricts which credentials can be used). */
    allowCredentialIds?: readonly string[] | undefined
    /** Challenge to use. */
    challenge?: `0x${string}` | undefined
    /** Credential ID to restrict authentication to a specific credential. */
    credentialId?: string | undefined
    /** Host-defined, JSON-serializable data to bind to this ceremony challenge. */
    extensions?: extensions | undefined
    /** Mediation hint for passkey autofill / conditional UI. */
    mediation?: 'conditional' | 'optional' | 'required' | 'silent' | undefined
  }
  type ReturnType = { options: Authentication.Options }
}

export declare namespace verifyAuthentication {
  type ReturnType<extensions extends Record<string, unknown> = Record<string, unknown>> = {
    /** The authenticated credential's ID. */
    credentialId: string
    /** Host-defined data returned by the server hook. */
    extensions?: extensions | undefined
    /** The credential's public key (uncompressed P256, hex-encoded). */
    publicKey: Hex
    /** User identifier from the authenticator's `userHandle` (discoverable/conditional flows). */
    userId?: string | undefined
    /** Username associated with the account. */
    username?: string | null | undefined
  }
}

/** Creates a {@link WebAuthnCeremony} from a custom implementation. */
export function from<
  const requestExtensions extends Record<string, unknown> = Record<string, unknown>,
  const responseExtensions extends Record<string, unknown> = Record<string, unknown>,
>(
  ceremony: WebAuthnCeremony<requestExtensions, responseExtensions>,
): WebAuthnCeremony<requestExtensions, responseExtensions> {
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
export function server<
  const requestExtensions extends Record<string, unknown> = Record<string, unknown>,
  const responseExtensions extends Record<string, unknown> = Record<string, unknown>,
>(
  options: server.Options<requestExtensions>,
): WebAuthnCeremony<requestExtensions, responseExtensions> {
  const { getExtensions, url } = options

  async function request<returnType>(path: string, body: unknown): Promise<returnType> {
    let json_body: string
    try {
      json_body = JSON.stringify(body)
    } catch {
      throw new Error('WebAuthn extensions must be JSON-serializable')
    }

    const response = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json_body,
    })
    const json = await response.json()
    if (!response.ok) throw new Error((json as { error?: string }).error ?? 'Request failed')
    return json as returnType
  }

  async function resolveExtensions(parameters: { extensions?: requestExtensions | undefined }) {
    if ('extensions' in parameters) return parameters.extensions
    return await getExtensions?.()
  }

  return from({
    async getRegistrationOptions(parameters) {
      const { excludeCredentialIds, name, userId } = parameters
      const extensions = await resolveExtensions(parameters)
      return request('/register/options', {
        excludeCredentialIds,
        ...(extensions !== undefined ? { extensions } : {}),
        name,
        userId,
      })
    },

    async verifyRegistration(credential) {
      return request('/register', credential)
    },

    async getAuthenticationOptions(parameters = {}) {
      const { allowCredentialIds, challenge, credentialId, mediation } = parameters
      const extensions = await resolveExtensions(parameters)
      return request('/login/options', {
        allowCredentialIds,
        challenge,
        credentialId,
        ...(extensions !== undefined ? { extensions } : {}),
        mediation,
      })
    },

    async verifyAuthentication(response) {
      return request('/login', response)
    },
  })
}

export declare namespace server {
  type Options<extensions extends Record<string, unknown> = Record<string, unknown>> = {
    /**
     * Default extension payloads for each options request. Call-time
     * `extensions` parameters take precedence.
     */
    getExtensions?: (() => extensions | undefined | Promise<extensions | undefined>) | undefined
    /** Base URL of the WebAuthn handler (e.g. `"https://example.com/webauthn"`). */
    url: string
  }
}
