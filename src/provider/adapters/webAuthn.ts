import type { Address } from 'viem'
import { Account } from 'viem/tempo'
import { Authentication, Registration } from 'webauthx/client'

import type { Adapter } from '../Adapter.js'
import type { Ceremony } from '../Ceremony.js'
import type * as Store from '../Store.js'
import { local } from './local.js'

/**
 * Creates a WebAuthn adapter backed by real passkey ceremonies.
 *
 * Wraps the {@link local} adapter with WebAuthn registration and authentication flows,
 * using the provided {@link Ceremony} for challenge generation and verification.
 *
 * @example
 * ```ts
 * import { Ceremony, webAuthn } from 'zyzz/provider'
 *
 * const ceremony = Ceremony.local({
 *   rpId: 'example.com',
 *   origin: 'https://example.com',
 * })
 *
 * const adapter = webAuthn({ ceremony })
 * ```
 */
export function webAuthn(options: webAuthn.Options): Adapter {
  const { ceremony, icon, name, rdns } = options

  return {
    ...local({
      async createAccount(params) {
        const { options } = await ceremony.getRegistrationOptions(params)
        const credential = await Registration.create({ options })
        const { publicKey } = await ceremony.verifyRegistration(credential)
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
      async loadAccounts(params) {
        const { options } = await ceremony.getAuthenticationOptions(params)
        const response = await Authentication.sign({ options })
        const { publicKey } = await ceremony.verifyAuthentication(response)
        const account = Account.fromWebAuthnP256({ id: response.id, publicKey })
        return {
          accounts: [
            {
              address: account.address,
              keyType: 'webAuthn',
              credential: { id: response.id, publicKey },
            },
          ],
        }
      },
    }),
    icon,
    name,
    rdns,
    internal_persistPrivate: true,
  }
}

export declare namespace webAuthn {
  type Options = {
    /** Ceremony strategy for WebAuthn registration and authentication. */
    ceremony: Ceremony
    /** Data URI of the provider icon. @default Black 1×1 SVG. */
    icon?: `data:image/${string}` | undefined
    /** Display name of the provider (e.g. `"My Wallet"`). @default "Injected Wallet" */
    name?: string | undefined
    /** Reverse DNS identifier. @default `com.{lowercase name}` */
    rdns?: string | undefined
  }
}
