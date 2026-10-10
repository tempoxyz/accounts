import { Hex, PublicKey, Signature } from 'ox'
import { SignatureEnvelope } from 'ox/tempo'
import { Account } from 'viem/tempo'
import { Authentication, Registration } from 'webauthx/client'
import { Authentication as core_Authentication } from 'webauthx/server'
import type * as core_z from 'zod'
import * as z from 'zod/mini'

import type { OneOf } from '../../internal/types.js'
import * as Adapter from '../Adapter.js'
import * as WebAuthnCeremony from '../WebAuthnCeremony.js'
import * as Rpc from '../zod/rpc.js'
import * as u from '../zod/utils.js'
import { local } from './local.js'

/** How long a registration's server session backs the local signing shortcut. */
const ttl_registration = 5 * 60 * 1_000

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
    const { storage, store } = parameters

    const ceremony =
      options.ceremony ??
      (url ? WebAuthnCeremony.server({ url }) : WebAuthnCeremony.local({ storage }))

    // The credential this instance most recently registered. Its registration
    // started the current server session, so a follow-up connect for the same
    // credential shortly after (e.g. an access key authorized right after
    // sign-up) can sign locally instead of running a second server-verified
    // authentication. Any later registration or server login takes over the
    // session and replaces or clears it.
    let registered:
      | { credentialId: string; publicKey: Hex.Hex; rpId: string; time: number; username?: string }
      | undefined

    /** Returns the latest registration if it still owns a fresh server session. */
    function current(credentialId: string) {
      if (registered?.credentialId !== credentialId) return undefined
      if (Date.now() - registered.time > ttl_registration) return undefined
      return registered
    }

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
        registered = {
          credentialId: credential.id,
          publicKey,
          rpId,
          time: Date.now(),
          ...(username ? { username } : {}),
        }
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

        const fresh = digest && typeof credentialId === 'string' ? current(credentialId) : undefined
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

        // A known credential's request options are deterministic (challenge,
        // credential and RP ID), so build them locally and prompt for the
        // passkey while the ceremony registers the challenge, not after.
        const known = typeof credentialId === 'string' ? find(credentialId) : undefined
        const challenge = digest ?? (known ? Hex.random(32) : undefined)
        const options_local =
          known && typeof credentialId === 'string'
            ? core_Authentication.getOptions({ challenge, credentialId, rpId: known.rpId }).options
            : undefined
        const signed = options_local ? Authentication.sign({ options: options_local }) : undefined
        // Rethrown from the `await` below; avoid an unhandled rejection meanwhile.
        signed?.catch(() => {})

        const { options } = await ceremony.getAuthenticationOptions({
          ...parameters,
          challenge,
          credentialId,
        })

        const rpId = options.publicKey?.rpId
        if (!rpId) throw new Error('rpId is required')

        const response = await (async () => {
          if (!signed) return await Authentication.sign({ options })
          if (matches(options, options_local!)) return await signed
          // The ceremony answered with different options (e.g. its own
          // challenge); sign those instead once the first prompt settles.
          await signed.catch(() => {})
          return await Authentication.sign({ options })
        })()
        const { publicKey, username } = await ceremony.verifyAuthentication(response)
        // The server session now belongs to this login.
        registered = undefined

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

    /** Looks up a credential's RP ID from the latest registration or stored accounts. */
    function find(credentialId: string): { rpId: string } | undefined {
      if (registered?.credentialId === credentialId) return { rpId: registered.rpId }
      for (const account of store.getState().accounts)
        if ('credential' in account && account.credential?.id === credentialId)
          return { rpId: account.credential.rpId }
      return undefined
    }

    // When a server-backed ceremony is used, also revoke the
    // `Handler.webAuthn` session on disconnect — otherwise the
    // `accounts_webauthn` cookie persists past `wallet_disconnect`
    // and follow-up authenticated requests still succeed.
    async function disconnect() {
      // Forget the latest registration so the next connect authenticates with
      // the server again.
      registered = undefined
      if (!url) return
      await fetch(`${url}/logout`, {
        method: 'POST',
        credentials: 'include',
      }).catch(() => {})
    }

    return {
      ...base,
      actions: { ...base.actions, disconnect },
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

/** Whether two credential request options ask the authenticator for the same assertion. */
function matches(
  options: core_Authentication.Options,
  options_local: core_Authentication.Options,
): boolean {
  const a = options.publicKey
  const b = options_local.publicKey
  if (!a || !b) return false
  if (a.challenge !== b.challenge || a.rpId !== b.rpId) return false
  if (a.userVerification !== b.userVerification) return false
  const ids = (options: typeof a) => (options.allowCredentials ?? []).map((c) => c.id).join(',')
  return ids(a) === ids(b)
}
