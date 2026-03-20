import { PublicKey, Signature } from 'ox'
import { SignatureEnvelope } from 'ox/tempo'
import { Account } from 'viem/tempo'
import { Authentication, Registration } from 'webauthx/client'

import type * as Account_internal from '../Account.js'
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

  return Adapter.define({ icon, name, rdns }, (parameters) => {
    const { storage } = parameters

    const ceremony =
      options.ceremony ??
      (authUrl ? Ceremony.server({ url: authUrl }) : Ceremony.local({ storage }))

    type WebAuthnAccount = Extract<Account_internal.Store, { keyType: 'webAuthn' }>
    const storageKey = 'webauthn:accounts'

    async function getStoredAccounts(): Promise<readonly WebAuthnAccount[]> {
      return (await storage.getItem<WebAuthnAccount[]>(storageKey)) ?? []
    }

    async function saveAccount(account: WebAuthnAccount): Promise<readonly WebAuthnAccount[]> {
      const stored = await getStoredAccounts()
      const filtered = stored.filter(
        (a) => a.address.toLowerCase() !== account.address.toLowerCase(),
      )
      const accounts = [account, ...filtered]
      await storage.setItem(storageKey, accounts)
      return accounts
    }

    const base = local({
      async createAccount(parameters) {
        const { options } = await ceremony.getRegistrationOptions(parameters)
        const rpId = options.publicKey?.rp.id
        if (!rpId) throw new Error('rpId is required')
        const credential = await Registration.create({ options })
        const { publicKey } = await ceremony.verifyRegistration(credential, { name: parameters.name })
        await storage.setItem('lastCredentialId', credential.id)
        const account = Account.fromWebAuthnP256({ id: credential.id, publicKey })
        const accounts = await saveAccount({
          address: account.address,
          keyType: 'webAuthn',
          credential: { id: credential.id, publicKey, rpId },
        })
        return { accounts }
      },
      async loadAccounts(parameters = {}) {
        const { selectAccount, digest } = parameters

        const credentialId = selectAccount
          ? undefined
          : (parameters?.credentialId ?? (await storage.getItem<string>('lastCredentialId')) ?? undefined)

        const { options } = await ceremony.getAuthenticationOptions({
          ...parameters,
          challenge: digest,
          credentialId,
        })

        const rpId = options.publicKey?.rpId
        if (!rpId) throw new Error('rpId is required')

        const response = await Authentication.sign({ options })
        const { publicKey } = await ceremony.verifyAuthentication(response)

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

        const accounts = await saveAccount({
          address: account.address,
          keyType: 'webAuthn',
          credential: { id: response.id, publicKey, rpId },
        })
        return { accounts, signature }
      },
    })(parameters)

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
