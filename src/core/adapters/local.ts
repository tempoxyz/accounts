import { Provider as ox_Provider, type WebCryptoP256 } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { hashMessage } from 'viem'
import { Account as TempoAccount } from 'viem/tempo'
import * as z from 'zod/mini'

import * as Account from '../Account.js'
import * as Adapter from '../Adapter.js'
import * as u from '../zod/utils.js'

const secp256k1Schema = z.object({
  address: u.address(),
  keyType: z.literal('secp256k1'),
  label: z.optional(z.string()),
  privateKey: u.hex(),
})

const p256Schema = z.object({
  address: u.address(),
  keyType: z.literal('p256'),
  label: z.optional(z.string()),
  privateKey: u.hex(),
})

const webAuthnSchema = z.object({
  address: u.address(),
  credential: z.object({
    id: z.string(),
    publicKey: u.hex(),
    rpId: z.string(),
  }),
  keyType: z.literal('webAuthn'),
  label: z.optional(z.string()),
})

const webAuthnHeadlessSchema = z.object({
  address: u.address(),
  keyType: z.literal('webAuthn_headless'),
  label: z.optional(z.string()),
  origin: z.string(),
  privateKey: u.hex(),
  rpId: z.string(),
})

const webCryptoSchema = z.object({
  address: u.address(),
  keyPair: z.custom<Awaited<ReturnType<typeof WebCryptoP256.createKeyPair>>>(),
  keyType: z.literal('webCrypto'),
  label: z.optional(z.string()),
})

const functionSignerSchema = z.object({
  address: u.address(),
  keyType: z.union([z.literal('secp256k1'), z.literal('p256'), z.literal('webAuthn')]),
  label: z.optional(z.string()),
  sign: z.custom<TempoAccount.Account['sign']>(),
})

const signableSchema = z.union([
  secp256k1Schema,
  p256Schema,
  webAuthnSchema,
  webAuthnHeadlessSchema,
  webCryptoSchema,
  functionSignerSchema,
])

/**
 * Creates a local adapter where the app manages keys and signing in-process.
 *
 * @example
 * ```ts
 * import { local, Provider } from 'accounts'
 *
 * const Provider = Provider.create({
 *   adapter: local({
 *     loadAccounts: async () => ({
 *       accounts: [{ address: '0x...' }],
 *     }),
 *   }),
 * })
 * ```
 */
export function local(options: local.Options): Adapter.Adapter {
  const { createAccount, icon, loadAccounts, name, rdns } = options

  return Adapter.define(
    { icon, name, rdns, schema: signableSchema },
    ({ getAccount, getClient, store }) => {
      return {
        actions: {
          async createAccount(parameters) {
            if (!createAccount)
              throw new ox_Provider.UnsupportedMethodError({
                message: '`createAccount` not configured on adapter.',
              })
            const { authorizeAccessKey: grantOptions, personalSign, ...rest } = parameters

            // `personalSign` claims the ceremony's challenge slot. It conflicts
            // with a caller-supplied `digest` because both target the single
            // WebAuthn challenge in the create-account ceremony.
            if (personalSign && rest.digest)
              throw new ox_Provider.ProviderRpcError(
                -32602,
                '`digest` and `personalSign` cannot both be set on `wallet_connect`.',
              )

            const client = getClient(
              grantOptions?.chainId ? { chainId: Number(grantOptions.chainId) } : undefined,
            )
            const chainId = grantOptions?.chainId ?? client.chain.id

            // TIP-1053 witness binding (see `loadAccounts`): fold the auth
            // message into the access-key authorization and sign both in the
            // single create-account ceremony.
            const witness =
              personalSign && grantOptions ? hashMessage(personalSign.message) : undefined

            const peronsalSign_digest =
              personalSign && !witness ? hashMessage(personalSign.message) : undefined

            const keyAuthorization_unsigned =
              witness && grantOptions
                ? await store.accessKeys.prepareAuthorization({ ...grantOptions, chainId, witness })
                : undefined

            const keyAuthorization_digest = keyAuthorization_unsigned
              ? KeyAuthorization.getSignPayload(keyAuthorization_unsigned.keyAuthorization)
              : undefined

            const digest = peronsalSign_digest ?? keyAuthorization_digest ?? rest.digest

            const { accounts, signature, username } = await createAccount({
              ...rest,
              digest,
            })

            // Hydrate the first account for signing. Must be done here (not via
            // the store) because accounts aren't merged into the store until
            // Provider.ts processes the return value.
            const account = Account.hydrate(accounts[0]!, { signable: true })

            // If the caller requested a digest signature but the adapter didn't
            // produce one (e.g. secp256k1 adapters), sign it ourselves.
            const signature_ =
              digest && !signature ? await account.sign({ hash: digest }) : signature

            // Witness path: the ceremony already signed the witness-bearing
            // key-auth digest, so reuse that signature instead of a 2nd prompt.
            const keyAuthorization_signed =
              witness && keyAuthorization_unsigned && signature_
                ? await (async () => {
                    const signed = KeyAuthorization.from(
                      keyAuthorization_unsigned.keyAuthorization,
                      { signature: signature_ },
                    )
                    store.accessKeys.add({
                      account: account.address,
                      authorization: signed,
                      ...(keyAuthorization_unsigned.key
                        ? {
                            handle: keyAuthorization_unsigned.key.handle,
                            publicKey: keyAuthorization_unsigned.key.publicKey,
                          }
                        : {}),
                      ...(keyAuthorization_unsigned.privateKey
                        ? { privateKey: keyAuthorization_unsigned.privateKey }
                        : {}),
                    })
                    return signed
                  })()
                : undefined

            const keyAuthorization = await (async () => {
              if (keyAuthorization_signed) return KeyAuthorization.toRpc(keyAuthorization_signed)
              if (!grantOptions) return undefined
              // Non-witness fallback: sign the key authorization on its own
              // (a second ceremony when `personalSign` claimed the first).
              return await store.accessKeys.authorize({
                account,
                chainId: getClient().chain.id,
                parameters: grantOptions,
              })
            })()

            return {
              accounts,
              keyAuthorization,
              signature: signature_,
              username,
              ...(personalSign
                ? {
                    personalSign: {
                      message: personalSign.message,
                      ...(witness && keyAuthorization_signed
                        ? { keyAuthorization: KeyAuthorization.serialize(keyAuthorization_signed) }
                        : {}),
                    },
                  }
                : {}),
            }
          },
          async loadAccounts(parameters) {
            const { authorizeAccessKey, personalSign, ...rest } =
              parameters ?? ({} as Adapter.loadAccounts.Parameters)

            // `personalSign` claims the ceremony's challenge slot. It conflicts
            // with a caller-supplied `digest` because both target the single
            // WebAuthn challenge in the load-accounts ceremony.
            if (personalSign && rest.digest)
              throw new ox_Provider.ProviderRpcError(
                -32602,
                '`digest` and `personalSign` cannot both be set on `wallet_connect`.',
              )

            const client = getClient(
              authorizeAccessKey?.chainId
                ? { chainId: Number(authorizeAccessKey.chainId) }
                : undefined,
            )
            const chainId = authorizeAccessKey?.chainId ?? client.chain.id

            // TIP-1053 witness binding: when both a `personalSign` challenge and
            // an `authorizeAccessKey` are requested, bind the message into the
            // key authorization's `witness` and sign both in ONE ceremony. The
            // signed key authorization doubles as the auth proof. Otherwise fall
            // back to the two-ceremony path below.
            const witness =
              personalSign && authorizeAccessKey ? hashMessage(personalSign.message) : undefined

            // Only claim the ceremony slot with the `personalSign` digest when
            // NOT binding via witness — the witness path signs the key-auth
            // digest (which already commits to the message) instead.
            const peronsalSign_digest =
              personalSign && !witness ? hashMessage(personalSign.message) : undefined

            const keyAuthorization_unsigned = authorizeAccessKey
              ? await store.accessKeys.prepareAuthorization({
                  ...authorizeAccessKey,
                  chainId,
                  ...(witness ? { witness } : {}),
                })
              : undefined

            const keyAuthorization_digest = keyAuthorization_unsigned
              ? KeyAuthorization.getSignPayload(keyAuthorization_unsigned.keyAuthorization)
              : undefined

            // Slot allocation:
            //   1. `personalSign` digest, if present (non-witness path).
            //   2. Else unsigned key-auth digest (1-prompt fold for
            //      `authorizeAccessKey`, including the witness path).
            //   3. Else caller's `rest.digest`.
            // When BOTH `personalSign` and `authorizeAccessKey` are present on a
            // non-witness chain, `personalSign` wins the ceremony and the key
            // authorization gets a follow-up `account.sign` (2 prompts total).
            const digest = peronsalSign_digest ?? keyAuthorization_digest ?? rest.digest

            // Pass the prepared digest (or the caller's) into loadAccounts so
            // the ceremony can sign it in a single biometric prompt.
            const { accounts, signature, username } = await loadAccounts({ ...rest, digest })

            // Hydrate here (not from the store) — same reason as createAccount.
            // Guard against empty accounts (e.g. user cancelled the ceremony).
            const account = accounts[0]
              ? Account.hydrate(accounts[0], { signable: true })
              : undefined

            // Fall back to local signing if the adapter didn't return a signature.
            let signature_ = signature
            if (digest && !signature_ && account) signature_ = await account.sign({ hash: digest })

            // Key auth signing path:
            //   - If `personalSign` took the ceremony slot AND `authorizeAccessKey`
            //     is set (non-witness), we need a SECOND ceremony to sign the
            //     key-auth digest.
            //   - Else (key-auth digest took the slot — witness path or
            //     `authorizeAccessKey`-only), reuse `signature_`.
            const keyAuthorization_signed = await (async () => {
              if (!keyAuthorization_unsigned || !account) return undefined
              const signature_keyAuthorization =
                peronsalSign_digest || !signature_
                  ? await account.sign({ hash: keyAuthorization_digest! })
                  : signature_
              const keyAuthorization = KeyAuthorization.from(
                keyAuthorization_unsigned.keyAuthorization,
                { signature: signature_keyAuthorization },
              )
              store.accessKeys.add({
                account: account.address,
                authorization: keyAuthorization,
                ...(keyAuthorization_unsigned.key
                  ? {
                      handle: keyAuthorization_unsigned.key.handle,
                      publicKey: keyAuthorization_unsigned.key.publicKey,
                    }
                  : {}),
                ...(keyAuthorization_unsigned.privateKey
                  ? { privateKey: keyAuthorization_unsigned.privateKey }
                  : {}),
              })
              return keyAuthorization
            })()

            const keyAuthorization = keyAuthorization_signed
              ? KeyAuthorization.toRpc(keyAuthorization_signed)
              : undefined

            return {
              accounts,
              keyAuthorization,
              signature: signature_,
              username,
              ...(personalSign
                ? {
                    personalSign: {
                      message: personalSign.message,
                      // On the witness path the auth proof IS the signed key
                      // authorization; surface it so the verifier can run the
                      // TIP-1053 check.
                      ...(witness && keyAuthorization_signed
                        ? { keyAuthorization: KeyAuthorization.serialize(keyAuthorization_signed) }
                        : {}),
                    },
                  }
                : {}),
            }
          },
        },
        getAccount(options = {}) {
          return { account: getAccount({ address: options.address, signable: true }) }
        },
      }
    },
  )
}

export declare namespace local {
  type Options = {
    /** Create a new account. Optional — omit for login-only flows. */
    createAccount?:
      | ((params: Adapter.createAccount.Parameters) => Promise<Adapter.createAccount.ReturnType>)
      | undefined
    /** Discover existing accounts (e.g. WebAuthn assertion). */
    loadAccounts: (
      params?: Adapter.loadAccounts.Parameters | undefined,
    ) => Promise<Adapter.loadAccounts.ReturnType>
    /** Data URI of the provider icon. @default Black 1×1 SVG. */
    icon?: `data:image/${string}` | undefined
    /** Display name of the provider (e.g. `"My Wallet"`). @default "Injected Wallet" */
    name?: string | undefined
    /** Reverse DNS identifier. @default `com.{lowercase name}` */
    rdns?: string | undefined
  }
}
