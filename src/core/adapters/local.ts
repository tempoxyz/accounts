import { Address as ox_Address, Hex, Provider as ox_Provider, PublicKey, WebCryptoP256 } from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { prepareTransactionRequest } from 'viem/actions'
import { Account as TempoAccount } from 'viem/tempo'

import * as AccessKey from '../AccessKey.js'
import * as Account from '../Account.js'
import * as Adapter from '../Adapter.js'

/**
 * Creates a local adapter where the app manages keys and signing in-process.
 *
 * @example
 * ```ts
 * import { local, Provider } from 'tempox'
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

  return Adapter.define({ icon, name, rdns }, ({ getAccount, getClient, store }) => {
    /**
     * Resolves access key params and computes the key authorization digest.
     *
     * For external keys: derives the address from the provided publicKey/address.
     * For local keys: generates a P256 key pair via `AccessKey.generate`.
     */
    async function prepareKeyAuthorization(options: Adapter.authorizeAccessKey.Parameters) {
      const { expiry, limits } = options
      const chainId = getClient().chain.id

      if (options.publicKey || options.address) {
        const accessKeyAddress =
          options.address ?? ox_Address.fromPublicKey(PublicKey.from(options.publicKey!))
        const keyType = options.keyType ?? 'secp256k1'
        const keyAuthorization = KeyAuthorization.from({
          address: accessKeyAddress,
          chainId: BigInt(chainId),
          expiry,
          limits,
          type: keyType,
        })
        return { keyAuthorization }
      }

      const keyPair = await WebCryptoP256.createKeyPair()
      const address = ox_Address.fromPublicKey(PublicKey.from(keyPair.publicKey))
      const keyAuthorization = KeyAuthorization.from({
        address,
        chainId: BigInt(chainId),
        expiry,
        limits,
        type: 'p256',
      })
      return { keyAuthorization, keyPair }
    }

    /**
     * Signs (or wraps a pre-computed signature into) a key authorization
     * and saves the result to the store.
     */
    async function signKeyAuthorization(
      account: TempoAccount.Account,
      prepared: Awaited<ReturnType<typeof prepareKeyAuthorization>>,
      options: {
        signature?: Hex.Hex | undefined
      } = {},
    ): Promise<Adapter.authorizeAccessKey.ReturnType> {
      const { keyPair } = prepared

      const keyAuthorization = await (async () => {
        const digest = KeyAuthorization.getSignPayload(prepared.keyAuthorization)
        const signature = options.signature ?? (await account.sign({ hash: digest }))
        return KeyAuthorization.from(prepared.keyAuthorization, {
          signature: SignatureEnvelope.from(signature),
        })
      })()

      AccessKey.save({ address: account.address, keyAuthorization, keyPair, store })

      return KeyAuthorization.toRpc(keyAuthorization)
    }

    async function withAccessKey<result>(
      fn: (
        account: TempoAccount.Account,
        keyAuthorization?: KeyAuthorization.Signed,
      ) => Promise<result>,
    ): Promise<result> {
      const account = getAccount({ signable: true })
      const keyAuthorization = AccessKey.getPending(account, { store })
      try {
        const result = await fn(account, keyAuthorization ?? undefined)
        AccessKey.removePending(account, { store })
        return result
      } catch (error) {
        if (account.source !== 'accessKey') throw error
        if (AccessKey.isExecutionError(error)) AccessKey.remove(account, { store })
        const root = getAccount({ accessKey: false, signable: true })
        return await fn(root, undefined)
      }
    }

    return {
      actions: {
        async createAccount(parameters) {
          if (!createAccount)
            throw new ox_Provider.UnsupportedMethodError({
              message: '`createAccount` not configured on adapter.',
            })
          const { authorizeAccessKey: grantOptions, ...rest } = parameters
          const { accounts, signature } = await createAccount(rest)

          // Hydrate the first account for signing. Must be done here (not via
          // the store) because accounts aren't merged into the store until
          // Provider.ts processes the return value.
          const account = Account.hydrate(accounts[0]!, { signable: true })

          // If the caller requested a digest signature but the adapter didn't
          // produce one (e.g. secp256k1 adapters), sign it ourselves.
          const signature_ =
            rest.digest && !signature ? await account.sign({ hash: rest.digest }) : signature

          const keyAuthorization = await (async () => {
            if (!grantOptions) return undefined
            const prepared = await prepareKeyAuthorization(grantOptions)
            return await signKeyAuthorization(account, prepared)
          })()

          return { accounts, keyAuthorization, signature: signature_ }
        },
        async authorizeAccessKey(parameters) {
          const prepared = await prepareKeyAuthorization(parameters)
          const account = getAccount({ accessKey: false, signable: true })
          return await signKeyAuthorization(account, prepared, { signature: parameters.signature })
        },
        async loadAccounts(parameters) {
          const { authorizeAccessKey, ...rest } =
            parameters ?? ({} as Adapter.loadAccounts.Parameters)

          const keyAuthorization_unsigned = authorizeAccessKey
            ? await prepareKeyAuthorization(authorizeAccessKey)
            : undefined

          const digest = (() => {
            if (rest.digest) return rest.digest
            if (keyAuthorization_unsigned?.keyAuthorization)
              return KeyAuthorization.getSignPayload(keyAuthorization_unsigned.keyAuthorization)
            return undefined
          })()

          // Pass the prepared digest (or the caller's) into loadAccounts so
          // the ceremony can sign it in a single biometric prompt.
          const { accounts, signature } = await loadAccounts({ ...rest, digest })

          // Hydrate here (not from the store) — same reason as createAccount.
          // Guard against empty accounts (e.g. user cancelled the ceremony).
          const account = accounts[0] ? Account.hydrate(accounts[0], { signable: true }) : undefined

          // Fall back to local signing if the adapter didn't return a signature.
          let signature_ = signature
          if (digest && !signature_ && account) signature_ = await account.sign({ hash: digest })

          const keyAuthorization =
            keyAuthorization_unsigned && account
              ? await signKeyAuthorization(account, keyAuthorization_unsigned, { signature: signature_ })
              : undefined

          return { accounts, keyAuthorization, signature: signature_ }
        },
        async revokeAccessKey(parameters) {
          AccessKey.revoke({
            address: parameters.address,
            store,
          })
        },
        async signPersonalMessage({ data, address }) {
          const account = getAccount({ address, signable: true })
          return await account.signMessage({ message: { raw: data } })
        },
        async signTransaction(parameters) {
          const { feePayer, ...rest } = parameters
          const client = getClient({
            feePayer: typeof feePayer === 'string' ? feePayer : undefined,
          })
          const { account, prepared } = await withAccessKey(async (account, keyAuthorization) => ({
            account,
            prepared: await prepareTransactionRequest(client, {
              account,
              ...rest,
              ...(feePayer ? { feePayer: true } : {}),
              keyAuthorization,
              type: 'tempo',
            }),
          }))
          return await account.signTransaction(prepared as never)
        },
        async signTypedData({ data, address }) {
          const account = getAccount({ address, signable: true })
          const { domain, types, primaryType, message } = JSON.parse(data)
          return await account.signTypedData({ domain, types, primaryType, message })
        },
        async sendTransaction(parameters) {
          const { feePayer, ...rest } = parameters
          const client = getClient({
            feePayer: typeof feePayer === 'string' ? feePayer : undefined,
          })
          const { account, prepared } = await withAccessKey(async (account, keyAuthorization) => ({
            account,
            prepared: await prepareTransactionRequest(client, {
              account,
              ...rest,
              ...(feePayer ? { feePayer: true } : {}),
              keyAuthorization,
              type: 'tempo',
            }),
          }))
          const signed = await account.signTransaction(prepared as never)
          return await client.request({
            method: 'eth_sendRawTransaction' as never,
            params: [signed],
          })
        },
        async sendTransactionSync(parameters) {
          const { feePayer, ...rest } = parameters
          const client = getClient({
            feePayer: typeof feePayer === 'string' ? feePayer : undefined,
          })
          const { account, prepared } = await withAccessKey(async (account, keyAuthorization) => ({
            account,
            prepared: await prepareTransactionRequest(client, {
              account,
              ...rest,
              ...(feePayer ? { feePayer: true } : {}),
              keyAuthorization,
              type: 'tempo',
            }),
          }))
          const signed = await account.signTransaction(prepared as never)
          return await client.request({
            method: 'eth_sendRawTransactionSync' as never,
            params: [signed],
          })
        },
      },
    }
  })
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
