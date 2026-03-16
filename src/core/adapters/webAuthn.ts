import { PublicKey, Signature } from 'ox'
import { SignatureEnvelope } from 'ox/tempo'
import { Account } from 'viem/tempo'
import { Authentication, Registration } from 'webauthx/client'

import type { OneOf } from '../../internal/types.js'
import * as Adapter from '../Adapter.js'
import * as Ceremony from '../Ceremony.js'
import { local } from './local.js'

/**
 * Creates a WebAuthn adapter backed by real passkey ceremonies.
 *
 * Wraps the {@link local} adapter with WebAuthn registration and authentication flows,
 * using the provided {@link Ceremony} for challenge generation and verification.
 *
 * @example
 * ```ts
 * import { webAuthn } from 'tempodk'
 *
 * const provider = Provider.create({
 *   adapter: webAuthn(),
 * })
 * ```
 */
export function webAuthn(options: webAuthn.Options = {}): Adapter.Adapter {
  const { authUrl, icon, name, rdns } = options

  return Adapter.define({ icon, name, rdns }, (params) => {
    const { storage } = params
    const ceremony =
      options.ceremony ??
      (authUrl ? Ceremony.server({ url: authUrl }) : Ceremony.local({ storage }))

    const base = local({
      async createAccount(p) {
        const { options } = await ceremony.getRegistrationOptions(p)
        const credential = await Registration.create({ options })
        const { publicKey } = await ceremony.verifyRegistration(credential)
        await storage.setItem('lastCredentialId', credential.id)
        const account = Account.fromWebAuthnP256({ id: credential.id, publicKey })
        return {
          accounts: [
            {
              address: account.address,
              keyType: 'webAuthn',
              credential: { id: credential.id, publicKey },
            },
          ],
        }
      },
      async loadAccounts(p) {
        const credentialId = p?.selectAccount
          ? undefined
          : (p?.credentialId ?? (await storage.getItem<string>('lastCredentialId')) ?? undefined)
        const { options } = await ceremony.getAuthenticationOptions({
          ...p,
          challenge: p?.digest,
          credentialId,
        })
        const response = await Authentication.sign({ options })
        const { publicKey } = await ceremony.verifyAuthentication(response)
        await storage.setItem('lastCredentialId', response.id)
        const account = Account.fromWebAuthnP256({ id: response.id, publicKey })

        const signature = p?.digest
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
              credential: { id: response.id, publicKey },
            },
          ],
          signature,
        }
      },
    })(params)

    return base
  })
}

export declare namespace webAuthn {
  type Options = OneOf<
    | {
        /** Ceremony strategy for WebAuthn registration and authentication. @default Ceremony.local() */
        ceremony?: Ceremony.Ceremony | undefined
      }
    | {
        /** URL of a WebAuthn handler (shorthand for `Ceremony.server({ url })`). */
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
