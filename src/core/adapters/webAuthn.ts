import { type Hex, PublicKey, Signature } from 'ox'
import { SignatureEnvelope } from 'ox/tempo'
import { Account } from 'viem/tempo'
import { Authentication, Registration } from 'webauthx/client'
import type * as core_z from 'zod'
import * as z from 'zod/mini'

import type { OneOf } from '../../internal/types.js'
import * as Adapter from '../Adapter.js'
import * as WebAuthnCeremony from '../WebAuthnCeremony.js'
import * as Rpc from '../zod/rpc.js'
import * as u from '../zod/utils.js'
import { local } from './local.js'

const schema = z.object({
  address: u.address(),
  credential: z.object({
    id: z.string(),
    publicKey: u.hex(),
    rpId: z.string(),
  }),
  keyType: z.literal('webAuthn'),
  label: z.optional(z.string()),
})

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

  return Adapter.define({ icon, name, rdns, schema }, (parameters) => {
    const { storage } = parameters

    const ceremony =
      options.ceremony ??
      (url ? WebAuthnCeremony.server({ url }) : WebAuthnCeremony.local({ storage }))

    // Credentials registered by this instance. Registration already started the
    // server session, so a follow-up connect for the same credential (e.g. an
    // access key authorized right after sign-up) can sign locally instead of
    // running a second server-verified authentication.
    const registered = new Map<string, { publicKey: Hex.Hex; rpId: string; username?: string }>()

    const base = local({
      async createAccount(parameters) {
        const { options } = await ceremony.getRegistrationOptions(parameters)
        const rpId = options.publicKey?.rp.id
        if (!rpId) throw new Error('rpId is required')
        const credential = await Registration.create({ options })
        // A registration ceremony can't sign an arbitrary digest (e.g. a SIWE
        // message), so it takes a second prompt. It only needs the new
        // credential, so run it alongside server verification instead of after.
        const signature = parameters.digest
          ? Account.fromWebAuthnP256(
              { id: credential.id, publicKey: credential.publicKey },
              { rpId },
            ).sign({ hash: parameters.digest })
          : undefined
        // Keep a failed prompt from surfacing as an unhandled rejection while
        // verification is still pending; it rethrows from the `await` below.
        signature?.catch(() => {})
        const { publicKey, username } = await ceremony.verifyRegistration(credential, {
          name: parameters.name,
        })
        await storage.setItem('lastCredentialId', credential.id)
        registered.set(credential.id, { publicKey, rpId, ...(username ? { username } : {}) })
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
          ...(signature ? { signature: await signature } : {}),
          username,
        }
      },
      async loadAccounts(parameters = {}) {
        const { digest, selectAccount } = parameters

        const credentialId = selectAccount
          ? undefined
          : (parameters?.credentialId ??
            (await storage.getItem<string>('lastCredentialId')) ??
            undefined)

        const fresh =
          digest && typeof credentialId === 'string' ? registered.get(credentialId) : undefined
        if (fresh && typeof credentialId === 'string') {
          const { publicKey, rpId, username } = fresh
          const account = Account.fromWebAuthnP256({ id: credentialId, publicKey }, { rpId })
          return {
            accounts: [
              {
                address: account.address,
                keyType: 'webAuthn',
                credential: { id: credentialId, publicKey, rpId },
              },
            ],
            signature: await account.sign({ hash: digest! }),
            username,
          }
        }

        const { options } = await ceremony.getAuthenticationOptions({
          ...parameters,
          challenge: digest,
          credentialId,
        })

        const rpId = options.publicKey?.rpId
        if (!rpId) throw new Error('rpId is required')

        const response = await Authentication.sign({ options })
        const { publicKey, username } = await ceremony.verifyAuthentication(response)

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
          signature,
          username,
        }
      },
    })(parameters)

    // When a server-backed ceremony is used, also revoke the
    // `Handler.webAuthn` session on disconnect — otherwise the
    // `accounts_webauthn` cookie persists past `wallet_disconnect`
    // and follow-up authenticated requests still succeed.
    const disconnect = url
      ? async () => {
          registered.clear()
          await fetch(`${url}/logout`, {
            method: 'POST',
            credentials: 'include',
          }).catch(() => {})
        }
      : undefined

    return {
      ...base,
      actions: { ...base.actions, ...(disconnect ? { disconnect } : {}) },
      persistAccounts: true,
    }
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
        auth?: core_z.input<typeof Rpc.wallet_connect.auth> | undefined
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
