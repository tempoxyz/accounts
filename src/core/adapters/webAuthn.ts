import { Hex, PublicKey, Signature } from 'ox'
import { SignatureEnvelope } from 'ox/tempo'
import { Account } from 'viem/tempo'
import { Authentication, Registration } from 'webauthx/client'
import { Authentication as core_Authentication } from 'webauthx/server'
import type * as core_z from 'zod'
import * as z from 'zod/mini'

import type { OneOf } from '../../internal/types.js'
import * as Adapter from '../Adapter.js'
import type * as Store from '../Store.js'
import * as WebAuthnCeremony from '../WebAuthnCeremony.js'
import * as Rpc from '../zod/rpc.js'
import * as u from '../zod/utils.js'
import { local } from './local.js'

/** How long a registration's server session backs the local signing shortcut. */
const ttl_registration = 5 * 60 * 1_000

/** How long logins and disconnects wait for registrations still verifying. */
const timeout_pending = 10_000

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

    // Server verifications still in flight (registrations and deferred logins). Each settles once
    // the server acknowledges or rejects the credential, or once it's cancelled.
    const pending = new Set<{
      controller: AbortController
      /** The credential ID being verified. */
      id: string
      promise: Promise<void>
    }>()
    // Account addresses of credentials the server rejected. Their accounts and
    // access keys are dropped whenever they show up in the store, including
    // ones stored after the rejection (e.g. while a sign-up's signature prompt
    // was still open). A later login with the credential clears it.
    const rejected = new Set<string>()
    // Credential IDs of those rejections, so none is restored as the last used.
    const rejected_ids = new Set<string>()
    // What `drop` removed, per account address, so a login that proves the
    // server knows the credential after all puts it back.
    const dropped = new Map<
      string,
      { accessKeys: Store.State['accessKeys']; account: Store.State['accounts'][number] }
    >()
    // The latest login per credential ID, so only it decides the credential's rejection.
    const logins = new Map<string, object>()
    // Connects and disconnects so far, so a late login restores its account as
    // the selected one only if none has happened since.
    let connects = 0
    // Dropped after the update that added them, so the provider emits both.
    store.subscribe(() => {
      if (rejected.size > 0) queueMicrotask(drop)
    })

    /**
     * Removes accounts of rejected credentials, with their access keys. Keeps
     * `auth`, so `wallet_disconnect` still ends a session started alongside.
     */
    function drop() {
      const { accessKeys, accounts, activeAccount } = store.getState()
      const kept = accounts.filter((account) => !rejected.has(account.address.toLowerCase()))
      const keys = accessKeys.filter((accessKey) => !rejected.has(accessKey.access.toLowerCase()))
      if (kept.length === accounts.length && keys.length === accessKeys.length) return
      for (const account of accounts) {
        const address = account.address.toLowerCase()
        if (!rejected.has(address)) continue
        dropped.set(address, {
          accessKeys: accessKeys.filter((accessKey) => accessKey.access.toLowerCase() === address),
          account,
        })
      }
      // Keep the active account selected, unless it is the one dropped.
      const active = kept.indexOf(accounts[activeAccount]!)
      store.setState({
        accessKeys: keys,
        accounts: kept,
        activeAccount: Math.max(active, 0),
      })
    }

    /**
     * Clears the rejection of a credential the server knows after all. With
     * `options.restore` (a login that landed after the drop), also restores
     * the account and access keys `drop` removed for it. With
     * `options.selected` (no connect or disconnect since that login), it's
     * restored as the active account and the last used credential, as its
     * connect left them; otherwise the newer selection stays.
     */
    async function accept(
      credential: { id: string; publicKey: Hex.Hex },
      options: { restore?: boolean | undefined; selected?: boolean | undefined } = {},
    ) {
      const address = Account.fromWebAuthnP256(credential).address.toLowerCase()
      rejected.delete(address)
      rejected_ids.delete(credential.id)
      if (!options.restore) return
      const restored = dropped.get(address)
      dropped.delete(address)
      if (!restored) return
      const { accessKeys, accounts } = store.getState()
      const keys = restored.accessKeys.filter(
        (key) =>
          !accessKeys.some(
            (accessKey) => accessKey.address.toLowerCase() === key.address.toLowerCase(),
          ),
      )
      // Its connect stored the account again: restore only its access keys.
      if (accounts.some((account) => account.address.toLowerCase() === address)) {
        if (keys.length > 0) store.setState({ accessKeys: [...accessKeys, ...keys] })
        return
      }
      if (!options.selected) {
        store.setState({
          accessKeys: [...accessKeys, ...keys],
          accounts: [...accounts, restored.account],
        })
        return
      }
      store.setState({
        accessKeys: [...keys, ...accessKeys],
        accounts: [restored.account, ...accounts],
        activeAccount: 0,
      })
      await storage.setItem('lastCredentialId', credential.id)
    }

    /** Drops the account of a credential the server never stored. */
    async function reject(
      credential: { id: string; publicKey: Hex.Hex },
      options: { name: string; previous?: string | undefined },
    ) {
      const { name, previous } = options
      const { address } = Account.fromWebAuthnP256(credential)
      rejected.add(address.toLowerCase())
      rejected_ids.add(credential.id)
      if (registered?.credentialId === credential.id) registered = undefined
      drop()
      // Keep the public key on this device, so the account can be recovered.
      await storage.setItem(`registration:${credential.id}`, {
        name,
        publicKey: credential.publicKey,
      })
      // Point the next sign-in back at the credential used before, unless it
      // was rejected too.
      if ((await storage.getItem<string>('lastCredentialId')) === credential.id)
        if (previous && !rejected_ids.has(previous))
          await storage.setItem('lastCredentialId', previous)
        else await storage.removeItem('lastCredentialId')
    }

    /** Tracks a registration the ceremony verifies in the background. */
    function track(
      credential: { id: string; publicKey: Hex.Hex },
      options: {
        controller: AbortController
        name: string
        previous: string | undefined
        verified: Promise<{ session: boolean }>
      },
    ) {
      const { controller, name, previous, verified } = options
      const promise = verified.then(
        async ({ session }) => {
          // A later registration is sent only once this one lands (see
          // `ready`), so it can't replace a later one's session. Drop the
          // shortcut only if it is this registration's and its response
          // didn't carry the session (a retry after a lost response).
          if (!session && registered?.credentialId === credential.id) registered = undefined
        },
        async (error) => {
          // Cancelled by `settle`: the outcome is unknown, so keep the account.
          // A refusal stays the server's answer, even if its cleanup was cancelled.
          if (controller.signal.aborted && error === controller.signal.reason) return
          // The server never stored the credential: drop the account the app
          // was handed, so it signs in or registers again.
          await reject(credential, { name, previous })
          throw error
        },
      )
      // One entry per verification, so overlapping ones for a credential are all waited for.
      const entry = { controller, id: credential.id, promise }
      pending.add(entry)
      promise.then(
        () => pending.delete(entry),
        () => pending.delete(entry),
      )
    }

    /**
     * Waits for registrations still verifying, for up to `timeout_pending`,
     * then cancels the rest, so none can land later and replace the session of
     * the login, sign-up or disconnect that follows. Verifications of
     * `options.except` (a credential ID) are neither waited for nor cancelled.
     */
    async function settle(options: { except?: string | undefined } = {}) {
      const { except } = options
      const waited = [...pending.values()].filter(({ id }) => id !== except)
      if (waited.length === 0) return
      let timer: ReturnType<typeof setTimeout> | undefined
      const settled = await Promise.race([
        Promise.allSettled(waited.map(({ promise }) => promise)).then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), timeout_pending)
        }),
      ]).finally(() => clearTimeout(timer))
      if (settled) return
      // Only the shortcut of a registration cancelled here: a newer one may hold it meanwhile.
      if (waited.some(({ id }) => id === registered?.credentialId)) registered = undefined
      for (const { controller } of waited) controller.abort()
    }

    /** Returns the latest registration if it still owns a fresh server session. */
    function current(credentialId: string) {
      if (registered?.credentialId !== credentialId) return undefined
      if (Date.now() - registered.time > ttl_registration) return undefined
      return registered
    }

    const base = local({
      async createAccount(parameters) {
        connects++
        const { options } = await ceremony.getRegistrationOptions({
          ...parameters,
          // A random `userId` by default, so passkeys with the same name don't share a user
          // handle. Prefetching ceremonies (`WebAuthnCeremony.server`) pick their own.
          userId: parameters.userId ?? (ceremony.prefetch ? undefined : Hex.random(16)),
        })
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
        const controller = new AbortController()
        // A login or registration still verifying would replace this sign-up's session if it
        // landed after it, so the server registration waits for it (the ceremony sends it once
        // `ready` resolves; see `settle`). Started only once the passkey exists, so a sign-up
        // that fails before it cancels nothing.
        const ready = settle()
        const { publicKey, username, verified } = await ceremony.verifyRegistration(credential, {
          name: parameters.name,
          ready,
          signal: controller.signal,
        })
        let failure: { error: unknown } | undefined
        verified?.catch((error) => {
          if (!controller.signal.aborted) failure = { error }
        })
        registered = {
          credentialId: credential.id,
          publicKey,
          rpId,
          time: Date.now(),
          ...(username ? { username } : {}),
        }
        if (verified) {
          const previous = (await storage.getItem<string>('lastCredentialId')) ?? undefined
          track(
            { id: credential.id, publicKey },
            { controller, name: parameters.name, previous, verified },
          )
        }
        await storage.setItem('lastCredentialId', credential.id)
        const account = Account.fromWebAuthnP256({ id: credential.id, publicKey })
        const signed = signature ? await signature : undefined
        // Rejected while the signature prompt was open: fail the sign-up, as
        // with `WebAuthnCeremony.server`.
        if (failure) throw failure.error
        return {
          accounts: [
            {
              address: account.address,
              label: parameters.name,
              keyType: 'webAuthn',
              credential: { id: credential.id, publicKey, rpId },
            },
          ],
          ...(signed ? { signature: signed } : {}),
          username,
        }
      },
      async loadAccounts(parameters = {}) {
        const connect = ++connects
        const { digest, selectAccount } = parameters

        const credentialId = selectAccount
          ? undefined
          : (parameters?.credentialId ??
            (await storage.getItem<string>('lastCredentialId')) ??
            undefined)

        // A login needs the server to know the credential, and a registration
        // landing after a login would replace its session, so the server login
        // waits for registrations still verifying in the background (the
        // ceremony sends it once `ready` resolves). Their failures are handled
        // by `track`. The latest registration, still fresh, signing a digest
        // with its own credential (the shortcut below) needs no login, and the
        // session it issues when it lands is this account's, so it isn't waited
        // for. A stale one is, since a login follows.
        const latest =
          digest && typeof credentialId === 'string' && current(credentialId)
            ? credentialId
            : undefined
        // The shortcut uses the latest registration's session, which an
        // earlier one landing after it would replace.
        if (latest) await settle({ except: latest })

        const fresh = digest && typeof credentialId === 'string' ? current(credentialId) : undefined
        if (fresh && typeof credentialId === 'string') {
          const { publicKey, rpId, username } = fresh
          const account = Account.fromWebAuthnP256({ id: credentialId, publicKey }, { rpId })
          const signature = await account.sign({ hash: digest! })
          // Its registration may have been refused while the prompt was open,
          // dropping the account: fail, as `createAccount` does.
          if (rejected.has(account.address.toLowerCase()))
            throw new Error('The server refused to store the passkey.')
          return {
            accounts: [
              {
                address: account.address,
                keyType: 'webAuthn',
                credential: { id: credentialId, publicKey, rpId },
              },
            ],
            signature,
            username,
          }
        }

        // A known credential's request options are deterministic (challenge,
        // credential and RP ID), so build them locally and prompt for the
        // passkey while the ceremony registers the challenge, not after. A
        // challenge the ceremony prefetched is registered already.
        const known = typeof credentialId === 'string' ? find(credentialId) : undefined
        const challenge =
          digest ?? (known ? (ceremony.takeChallenge?.() ?? Hex.random(32)) : undefined)
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
        // The known credential's public key lets a deferred ceremony check the
        // passkey's signature itself and verify the login in the background.
        // Started once the passkey answered, so a prompt that fails or is
        // cancelled leaves earlier registrations alone.
        const ready = settle()
        const controller = new AbortController()
        const { publicKey, username, verified } = await ceremony.verifyAuthentication(
          response,
          known && response.id === credentialId
            ? {
                credential: {
                  challenge: options.publicKey!.challenge,
                  publicKey: known.publicKey,
                  rpId: known.rpId,
                },
                ready,
                signal: controller.signal,
              }
            : { ready, signal: controller.signal },
        )
        // The server session now belongs to this login.
        registered = undefined
        // The server knows the credential, even if its registration looked
        // rejected (e.g. every response to it was lost), so the account is kept.
        const was_rejected = rejected_ids.has(response.id)
        // This connect stores the account again. A login the server verified
        // already also restores the access keys a refusal dropped.
        await accept({ id: response.id, publicKey }, { restore: !verified, selected: true })

        const previous = (await storage.getItem<string>('lastCredentialId')) ?? undefined
        await storage.setItem('lastCredentialId', response.id)
        // A login verified in the background proves that only once it lands
        // with a session, which also clears a rejection that arrived while it
        // waited. Until then the account is kept, so connecting doesn't drop
        // it. An unknown outcome restores the rejection, unless a later login
        // with the credential has started since (a refusal drops it in `track`).
        const login = {}
        logins.set(response.id, login)
        if (verified)
          verified.then(
            ({ session }) => {
              // Only the latest login with the credential decides its rejection.
              if (logins.get(response.id) !== login) return
              if (session)
                return accept(
                  { id: response.id, publicKey },
                  { restore: true, selected: connects === connect },
                )
              if (!was_rejected || controller.signal.aborted) return
              return reject({ id: response.id, publicKey }, { name: known?.label ?? '', previous })
            },
            () => {},
          )
        // Tracked like a registration verified in the background: logins and
        // disconnects wait for it, and if the server refuses it, the account
        // is dropped (an `accountsChanged` event) as the server's answer.
        if (verified)
          track(
            { id: response.id, publicKey },
            {
              controller,
              name: known?.label ?? '',
              previous,
              verified,
            },
          )

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

    /**
     * Looks up a credential's public key, RP ID and label from the latest
     * registration or stored accounts.
     */
    function find(
      credentialId: string,
    ): { label?: string | undefined; publicKey: Hex.Hex; rpId: string } | undefined {
      if (registered?.credentialId === credentialId)
        return {
          ...(registered.username ? { label: registered.username } : {}),
          publicKey: registered.publicKey,
          rpId: registered.rpId,
        }
      for (const account of store.getState().accounts)
        if ('credential' in account && account.credential?.id === credentialId)
          return {
            ...('label' in account && account.label ? { label: account.label } : {}),
            publicKey: account.credential.publicKey,
            rpId: account.credential.rpId,
          }
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
      // A registration landing after logout would restore its session, so
      // wait for it, or cancel it (see `settle`).
      await settle()
      // A later login mustn't restore accounts or access keys this disconnect removes.
      dropped.clear()
      connects++
      await ceremony.logout?.().catch(() => {})
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
