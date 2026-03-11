import { Address as ox_Address, Provider as ox_Provider, PublicKey, type WebCryptoP256 } from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { prepareTransactionRequest } from 'viem/actions'
import { Account as TempoAccount, Actions } from 'viem/tempo'

import * as AccessKey from '../AccessKey.js'
import * as Account from '../Account.js'
import type { Adapter, createAccount, authorizeAccessKey, loadAccounts, setup } from '../Adapter.js'
import type * as Store from '../Store.js'

/**
 * Creates a local adapter where the app manages keys and signing in-process.
 *
 * @example
 * ```ts
 * import { local, Provider } from '@tempoxyz/accounts'
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
export function local(options: local.Options): Adapter {
  const { createAccount, icon, loadAccounts, name, rdns } = options

  let params: setup.Parameters
  let store: Store.Store

  /**
   * Grants an access key for the given (or active) account.
   *
   * When `account` is provided, uses it directly — this is needed during
   * `createAccount`/`loadAccounts` where the account hasn't been merged
   * into the store yet.
   *
   * When `keyPair` is provided, reuses a pre-computed key pair so the
   * ceremony signature can double as the key authorization signature,
   * avoiding a second biometric prompt.
   */
  async function authorizeAccessKey_internal(
    options: authorizeAccessKey.Parameters & {
      account?: TempoAccount.Account | undefined
      keyPair?: Awaited<ReturnType<typeof WebCryptoP256.createKeyPair>> | undefined
    },
  ): Promise<authorizeAccessKey.ReturnType> {
    const { address, expiry, keyType, limits, publicKey, signature } = options

    const account = options.account ?? params.getAccount({ accessKey: false, signable: true })
    const client = params.getClient()

    // External key: caller provides publicKey or address.
    if (publicKey || address) {
      const accessKeyAddress = address ?? ox_Address.fromPublicKey(PublicKey.from(publicKey!))
      const type = keyType ?? 'secp256k1'

      const keyAuthorization = await (async () => {
        if (signature)
          return KeyAuthorization.from(
            {
              address: accessKeyAddress,
              chainId: BigInt(client.chain.id),
              expiry,
              limits,
              type,
            },
            { signature: SignatureEnvelope.from(signature) },
          )
        return await Actions.accessKey.signAuthorization(client, {
          account,
          accessKey: { accessKeyAddress, keyType: type },
          expiry,
          limits: limits as never,
        })
      })()

      AccessKey.save({ address: account.address, keyAuthorization, store })

      return KeyAuthorization.toRpc(keyAuthorization)
    }

    // Reuse a prepared key pair or generate a fresh one.
    const { keyPair, accessKey } = options.keyPair
      ? {
          keyPair: options.keyPair,
          accessKey: TempoAccount.fromWebCryptoP256(options.keyPair, { access: account }),
        }
      : await AccessKey.prepare({
          account,
          chainId: client.chain.id,
          expiry,
          limits,
        })

    // If we already have a signature from the ceremony, wrap it as a key
    // authorization. Otherwise, perform a separate signing.
    const keyAuthorization = await (async () => {
      if (signature)
        return KeyAuthorization.from(
          {
            address: accessKey.accessKeyAddress,
            chainId: BigInt(client.chain.id),
            expiry,
            limits,
            type: accessKey.keyType,
          },
          { signature: SignatureEnvelope.from(signature) },
        )
      return await Actions.accessKey.signAuthorization(client, {
        account,
        accessKey,
        expiry,
        limits: limits as never,
      })
    })()

    AccessKey.save({ address: account.address, keyAuthorization, keyPair, store })

    return KeyAuthorization.toRpc(keyAuthorization)
  }

  /** Access key-related error patterns from the Tempo precompile/tx-pool. */
  const accessKeyErrors = [
    'KeyAuthorization',
    'key authorization',
    'keychain',
    'access key',
    'AccessKey',
    'UnauthorizedCaller',
    'KeyAlreadyExists',
    'KeyNotFound',
    'KeyExpired',
    'SpendingLimitExceeded',
    'KeyAlreadyRevoked',
    'SignatureTypeMismatch',
  ]

  function isAccessKeyError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return accessKeyErrors.some((p) => message.includes(p))
  }

  async function withAccessKey<result>(
    fn: (
      account: TempoAccount.Account,
      keyAuthorization?: KeyAuthorization.Signed,
    ) => Promise<result>,
  ): Promise<result> {
    const account = params.getAccount({ signable: true })
    const keyAuthorization = AccessKey.getPending(account, { store })
    try {
      const result = await fn(account, keyAuthorization ?? undefined)
      AccessKey.removePending(account, { store })
      return result
    } catch (error) {
      if (account.source !== 'accessKey') throw error
      if (isAccessKeyError(error)) AccessKey.remove(account, { store })
      const root = params.getAccount({ accessKey: false, signable: true })
      return await fn(root, undefined)
    }
  }

  return {
    icon,
    name,
    rdns,
    setup(params_) {
      params = params_
      store = params_.store
      return undefined
    },
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

        const keyAuthorization = grantOptions
          ? await authorizeAccessKey_internal({ ...grantOptions, account })
          : undefined

        return { accounts, keyAuthorization, signature: signature_ }
      },
      async authorizeAccessKey(parameters) {
        return await authorizeAccessKey_internal(parameters)
      },
      async loadAccounts(parameters) {
        const { authorizeAccessKey, ...rest } = parameters ?? ({} as loadAccounts.Parameters)

        // If `authorizeAccessKey` is requested, no explicit digest was
        // provided, and no external publicKey is given (BYOAK), prepare a
        // key pair + digest upfront so the ceremony signature can be reused
        // as the key authorization signature.
        const prepared =
          authorizeAccessKey && !rest.digest && !authorizeAccessKey.publicKey
            ? await AccessKey.prepare({
                chainId: params.getClient().chain.id,
                ...authorizeAccessKey,
              })
            : undefined

        const digest = rest.digest ?? prepared?.digest

        // Pass the prepared digest (or the caller's) into loadAccounts so
        // the ceremony can sign it in a single biometric prompt.
        const { accounts, signature } = await loadAccounts({ ...rest, digest })

        // Hydrate here (not from the store) — same reason as createAccount.
        // Guard against empty accounts (e.g. user cancelled the ceremony).
        const account = accounts[0] ? Account.hydrate(accounts[0], { signable: true }) : undefined

        // Fall back to local signing if the adapter didn't return a signature.
        let signature_ = signature
        if (digest && !signature_ && account) signature_ = await account.sign({ hash: digest })

        // If a key pair was prepared, forward the ceremony signature + key
        // pair so authorizeAccessKey_internal can skip a second signing.
        const keyAuthorization =
          authorizeAccessKey && account
            ? await authorizeAccessKey_internal({
                ...authorizeAccessKey,
                account,
                ...(prepared && signature_
                  ? { signature: signature_, keyPair: prepared.keyPair }
                  : {}),
              })
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
        const account = params.getAccount({ address, signable: true })
        return await account.signMessage({ message: { raw: data } })
      },
      async signTransaction(parameters) {
        const { feePayer, ...rest } = parameters
        const client = params.getClient({
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
        const account = params.getAccount({ address, signable: true })
        const { domain, types, primaryType, message } = JSON.parse(data)
        return await account.signTypedData({ domain, types, primaryType, message })
      },
      async sendTransaction(parameters) {
        const { feePayer, ...rest } = parameters
        const client = params.getClient({
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
        const client = params.getClient({
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
}

export declare namespace local {
  type Options = {
    /** Create a new account. Optional — omit for login-only flows. */
    createAccount?:
      | ((params: createAccount.Parameters) => Promise<createAccount.ReturnType>)
      | undefined
    /** Discover existing accounts (e.g. WebAuthn assertion). */
    loadAccounts: (params?: loadAccounts.Parameters | undefined) => Promise<loadAccounts.ReturnType>
    /** Data URI of the provider icon. @default Black 1×1 SVG. */
    icon?: `data:image/${string}` | undefined
    /** Display name of the provider (e.g. `"My Wallet"`). @default "Injected Wallet" */
    name?: string | undefined
    /** Reverse DNS identifier. @default `com.{lowercase name}` */
    rdns?: string | undefined
  }
}
