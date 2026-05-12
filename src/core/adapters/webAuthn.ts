import { PublicKey, Signature } from 'ox'
import { SignatureEnvelope } from 'ox/tempo'
import { Account } from 'viem/tempo'
import { Authentication, Registration } from 'webauthx/client'
import type { z } from 'zod'

import type { OneOf } from '../../internal/types.js'
import * as Adapter from '../Adapter.js'
import * as WebAuthnCeremony from '../WebAuthnCeremony.js'
import * as Rpc from '../zod/rpc.js'
import { local } from './local.js'

/**
 * Creates a WebAuthn adapter backed by real passkey ceremonies.
 *
 * Wraps the {@link local} adapter with WebAuthn registration and authentication flows,
 * using the provided {@link WebAuthnCeremony} for challenge generation and verification.
 *
 * @example
 * ```ts
 * import { webAuthn } from 'accounts'
 *
 * const provider = Provider.create({
 *   adapter: webAuthn(),
 * })
 * ```
 */
export function webAuthn(options: webAuthn.Options = {}): Adapter.Adapter {
  const { auth, authUrl, icon, name, rdns } = options

  const url = (() => {
    if (auth) return typeof auth === 'string' ? auth : auth.url
    return authUrl
  })()

  return Adapter.define({ icon, name, rdns }, (parameters) => {
    const { storage } = parameters

    const ceremony =
      options.ceremony ??
      (url ? WebAuthnCeremony.server({ url }) : WebAuthnCeremony.local({ storage }))

    const base = local({
      async createAccount(parameters) {
        const { options } = await ceremony.getRegistrationOptions(parameters)
        const rpId = options.publicKey?.rp.id
        if (!rpId) throw new Error('rpId is required')
        const credential = await Registration.create({ options })
        const { publicKey, email, username } = await ceremony.verifyRegistration(credential, {
          name: parameters.name,
        })
        await storage.setItem('lastCredentialId', credential.id)
        const account = Account.fromWebAuthnP256({ id: credential.id, publicKey })
        return {
          accounts: [
            {
              address: account.address,
              label: parameters.name,
              keyType: 'webAuthn',
              credential: { id: credential.id, publicKey, rpId },
            },
          ],
          email,
          username,
        }
      },
      async loadAccounts(parameters = {}) {
        const { selectAccount, digest } = parameters

        const credentialId = selectAccount
          ? undefined
          : (parameters?.credentialId ??
            (await storage.getItem<string>('lastCredentialId')) ??
            undefined)

        const { options } = await ceremony.getAuthenticationOptions({
          ...parameters,
          challenge: digest,
          credentialId,
        })

        const rpId = options.publicKey?.rpId
        if (!rpId) throw new Error('rpId is required')

        const response = await Authentication.sign({ options })
        const { publicKey, email, username } = await ceremony.verifyAuthentication(response)

        await storage.setItem('lastCredentialId', response.id)

        const account = Account.fromWebAuthnP256({ id: response.id, publicKey }, { rpId })

        const signature = digest
          ? SignatureEnvelope.serialize(
              {
                metadata: response.metadata,
                publicKey: PublicKey.fromHex(publicKey),
                signature: Signature.from(response.signature),
                type: 'webAuthn',
              },
              { magic: true },
            )
          : undefined

        return {
          accounts: [
            {
              address: account.address,
              keyType: 'webAuthn',
              credential: { id: response.id, publicKey, rpId },
            },
          ],
          email,
          signature,
          username,
        }
      },
    })(parameters)

    return { ...base, persistAccounts: true }
  })
}

export declare namespace webAuthn {
  type Options = OneOf<
    | {
        /** Ceremony strategy for WebAuthn registration and authentication. @default WebAuthnCeremony.local() */
        ceremony?: WebAuthnCeremony.WebAuthnCeremony | undefined
      }
    | {
        /**
         * Server Authentication endpoint for WebAuthn ceremonies (shorthand for
         * `WebAuthnCeremony.server({ url })`). Accepts the same shape as the
         * Provider `auth` capability — only the `url` field is consumed here;
         * other fields (`challenge`, `verify`, `logout`, `returnToken`) are
         * SIWE-only and ignored by the WebAuthn ceremony.
         */
        auth?: z.input<typeof Rpc.wallet_connect.auth> | undefined
        /** @deprecated Use `auth` instead. */
        authUrl?: string | undefined
      }
  > & {
    /** Data URI of the provider icon. @default Black 1×1 SVG. */
    icon?: `data:image/${string}` | undefined
    /** Display name of the provider (e.g. `"My Wallet"`). @default "Injected Wallet" */
    name?: string | undefined
    /** Reverse DNS identifier. @default `com.{lowercase name}` */
    rdns?: string | undefined
  }
}
