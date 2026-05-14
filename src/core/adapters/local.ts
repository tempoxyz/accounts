import { Hex, Provider as ox_Provider } from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { BaseError, hashMessage } from 'viem'
import { prepareTransactionRequest } from 'viem/actions'
import { Account as TempoAccount, Actions } from 'viem/tempo'

import * as AccessKey from '../AccessKey.js'
import * as Account from '../Account.js'
import * as Adapter from '../Adapter.js'

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

  return Adapter.define({ icon, name, rdns }, ({ getAccount, getClient, store }) => {
    /**
     * Resolves access key params into an unsigned key authorization.
     */
    async function prepareKeyAuthorization(options: Adapter.authorizeAccessKey.Parameters) {
      const { address, expiry, keyType, limits, scopes } = options
      return await AccessKey.prepare({
        address,
        chainId: options.chainId ?? getClient().chain.id,
        expiry,
        keyType,
        limits,
        scopes,
      })
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
    ) {
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
      options: Pick<Account.find.Options, 'address' | 'calls' | 'chainId'>,
      fn: (
        account: TempoAccount.Account,
        keyAuthorization?: KeyAuthorization.Signed,
      ) => Promise<result>,
    ): Promise<result> {
      const account = getAccount({ ...options, signable: true })
      const keyAuthorization = AccessKey.getPending(account, { store })
      try {
        const result = await fn(account, keyAuthorization ?? undefined)
        AccessKey.removePending(account, { store })
        return result
      } catch (error) {
        if (account.source !== 'accessKey') throw error
        AccessKey.invalidate(account, error, { store })
        const root = getAccount({ accessKey: false, address: options.address, signable: true })
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
          const { authorizeAccessKey: grantOptions, personalSign, ...rest } = parameters

          // `personalSign` claims the ceremony's challenge slot. It conflicts
          // with a caller-supplied `digest` because both target the single
          // WebAuthn challenge in the create-account ceremony.
          if (personalSign && rest.digest)
            throw new ox_Provider.ProviderRpcError(
              -32602,
              '`digest` and `personalSign` cannot both be set on `wallet_connect`.',
            )

          const peronsalSign_digest = personalSign ? hashMessage(personalSign.message) : undefined
          const digest = peronsalSign_digest ?? rest.digest

          const { accounts, email, signature, username } = await createAccount({
            ...rest,
            digest,
          })

          // Hydrate the first account for signing. Must be done here (not via
          // the store) because accounts aren't merged into the store until
          // Provider.ts processes the return value.
          const account = Account.hydrate(accounts[0]!, { signable: true })

          // If the caller requested a digest signature but the adapter didn't
          // produce one (e.g. secp256k1 adapters), sign it ourselves.
          const signature_ = digest && !signature ? await account.sign({ hash: digest }) : signature

          const keyAuthorization = await (async () => {
            if (!grantOptions) return undefined
            const prepared = await prepareKeyAuthorization(grantOptions)
            return await signKeyAuthorization(account, prepared)
          })()

          return {
            accounts,
            email,
            keyAuthorization,
            signature: signature_,
            username,
            ...(personalSign ? { personalSign: { message: personalSign.message } } : {}),
          }
        },
        async authorizeAccessKey(parameters) {
          const prepared = await prepareKeyAuthorization(parameters)
          const account = getAccount({ accessKey: false, signable: true })
          const keyAuthorization = await signKeyAuthorization(account, prepared, {
            signature: parameters.signature,
          })
          return { keyAuthorization, rootAddress: account.address }
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

          const peronsalSign_digest = personalSign ? hashMessage(personalSign.message) : undefined

          const keyAuthorization_unsigned = authorizeAccessKey
            ? await prepareKeyAuthorization(authorizeAccessKey)
            : undefined

          // Slot allocation:
          //   1. `personalSign` digest, if present.
          //   2. Else key-auth digest (existing 1-prompt fold for `authorizeAccessKey`).
          //   3. Else caller's `rest.digest`.
          // When BOTH `personalSign` and `authorizeAccessKey` are present,
          // `personalSign` wins the load-accounts ceremony and the key
          // authorization gets its own follow-up `account.sign` ceremony
          // (2 prompts total).
          const digest =
            peronsalSign_digest ??
            (keyAuthorization_unsigned
              ? KeyAuthorization.getSignPayload(keyAuthorization_unsigned.keyAuthorization)
              : rest.digest)

          // Pass the prepared digest (or the caller's) into loadAccounts so
          // the ceremony can sign it in a single biometric prompt.
          const { accounts, email, signature, username } = await loadAccounts({ ...rest, digest })

          // Hydrate here (not from the store) — same reason as createAccount.
          // Guard against empty accounts (e.g. user cancelled the ceremony).
          const account = accounts[0] ? Account.hydrate(accounts[0], { signable: true }) : undefined

          // Fall back to local signing if the adapter didn't return a signature.
          let signature_ = signature
          if (digest && !signature_ && account) signature_ = await account.sign({ hash: digest })

          // Key auth signing path:
          //   - If `personalSign` took the ceremony slot AND `authorizeAccessKey`
          //     is set, we need a SECOND ceremony to sign the key-auth digest.
          //   - Else (key-auth digest took the slot), reuse `signature_`.
          const keyAuthorization = await (async () => {
            if (!keyAuthorization_unsigned || !account) return undefined
            if (peronsalSign_digest)
              return await signKeyAuthorization(account, keyAuthorization_unsigned)
            return await signKeyAuthorization(account, keyAuthorization_unsigned, {
              signature: signature_,
            })
          })()

          return {
            accounts,
            email,
            keyAuthorization,
            signature: signature_,
            username,
            ...(personalSign ? { personalSign: { message: personalSign.message } } : {}),
          }
        },
        async revokeAccessKey(parameters) {
          const account = getAccount({ accessKey: false, signable: true })
          const client = getClient()
          try {
            await Actions.accessKey.revoke(client, {
              account,
              accessKey: parameters.accessKeyAddress,
            } as never)
          } catch (error) {
            const isKeyNotFound =
              error instanceof BaseError &&
              !!error.walk(
                (e) => (e as { data?: { errorName?: string } }).data?.errorName === 'KeyNotFound',
              )
            if (!isKeyNotFound) throw error
          }
          store.setState((state) => ({
            accessKeys: state.accessKeys.filter(
              (a) => a.address?.toLowerCase() !== parameters.accessKeyAddress.toLowerCase(),
            ),
          }))
        },
        async signPersonalMessage({ data, address }) {
          const account = getAccount({ address, signable: true })
          return await account.signMessage({ message: { raw: data } })
        },
        async signTransaction(parameters) {
          const { feePayer, ...rest } = parameters
          const client = getClient({
            chainId: parameters.chainId,
            feePayer: (() => {
              if (feePayer === false) return false
              if (typeof feePayer === 'string') return feePayer
              return undefined
            })(),
          })
          const { account, prepared } = await withAccessKey(
            { address: parameters.from, calls: parameters.calls, chainId: parameters.chainId },
            async (account, keyAuthorization) => ({
              account,
              prepared: await prepareTransactionRequest(client, {
                account,
                ...rest,
                ...(feePayer ? { feePayer: true } : {}),
                keyAuthorization,
                type: 'tempo',
              }),
            }),
          )
          return await account.signTransaction(prepared as never)
        },
        async signTypedData({ data, address }) {
          const account = getAccount({ address, signable: true })
          const parsed = JSON.parse(data) as {
            domain: Record<string, unknown>
            message: Record<string, unknown>
            primaryType: string
            types: Record<string, unknown>
          }
          return await account.signTypedData(parsed)
        },
        async sendTransaction(parameters) {
          const { feePayer, ...rest } = parameters
          const client = getClient({
            chainId: parameters.chainId,
            feePayer: (() => {
              if (feePayer === false) return false
              if (typeof feePayer === 'string') return feePayer
              return undefined
            })(),
          })
          const { account, prepared } = await withAccessKey(
            { address: parameters.from, calls: parameters.calls, chainId: parameters.chainId },
            async (account, keyAuthorization) => ({
              account,
              prepared: await prepareTransactionRequest(client, {
                account,
                ...rest,
                ...(feePayer ? { feePayer: true } : {}),
                keyAuthorization,
                type: 'tempo',
              }),
            }),
          )
          const signed = await account.signTransaction(prepared as never)
          return await client.request({
            method: 'eth_sendRawTransaction' as never,
            params: [signed],
          })
        },
        async sendTransactionSync(parameters) {
          const { feePayer, ...rest } = parameters
          const client = getClient({
            chainId: parameters.chainId,
            feePayer: (() => {
              if (feePayer === false) return false
              if (typeof feePayer === 'string') return feePayer
              return undefined
            })(),
          })
          const { account, prepared } = await withAccessKey(
            { address: parameters.from, calls: parameters.calls, chainId: parameters.chainId },
            async (account, keyAuthorization) => ({
              account,
              prepared: await prepareTransactionRequest(client, {
                account,
                ...rest,
                ...(feePayer ? { feePayer: true } : {}),
                keyAuthorization,
                type: 'tempo',
              }),
            }),
          )
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
