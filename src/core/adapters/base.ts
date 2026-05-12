import {
  Address as core_Address,
  Hex,
  Provider as core_Provider,
  PublicKey,
  WebCryptoP256,
} from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { BaseError, hashMessage, hashTypedData } from 'viem'
import type { Address } from 'viem/accounts'
import { prepareTransactionRequest } from 'viem/actions'
import { Account as TempoAccount, Actions } from 'viem/tempo'

import * as AccessKey from '../AccessKey.js'
import type * as Account from '../Account.js'
import * as Adapter from '../Adapter.js'

/**
 * Builds shared wallet actions from an account source that can resolve signers.
 */
export function base(options: base.Options): Adapter.Instance {
  const { createAccount, disconnect, getAccount, getClient, loadAccounts, resolveAccount, store } =
    options

  async function prepareKeyAuthorization(options: Adapter.authorizeAccessKey.Parameters) {
    const { expiry, limits, scopes } = options
    const chainId = options.chainId ?? getClient().chain.id

    if (options.publicKey || options.address) {
      const address =
        options.address ?? core_Address.fromPublicKey(PublicKey.from(options.publicKey!))
      const keyAuthorization = KeyAuthorization.from({
        address,
        chainId: BigInt(chainId),
        expiry,
        limits,
        scopes,
        type: options.keyType ?? 'secp256k1',
      })
      return { keyAuthorization }
    }

    const keyPair = await WebCryptoP256.createKeyPair()
    const address = core_Address.fromPublicKey(PublicKey.from(keyPair.publicKey))
    const keyAuthorization = KeyAuthorization.from({
      address,
      chainId: BigInt(chainId),
      expiry,
      limits,
      scopes,
      type: 'p256',
    })
    return { keyAuthorization, keyPair }
  }

  async function signKeyAuthorization(
    account: TempoAccount.Account,
    prepared: Awaited<ReturnType<typeof prepareKeyAuthorization>>,
    options: signKeyAuthorization.Options = {},
  ) {
    const { keyPair } = prepared
    const digest = KeyAuthorization.getSignPayload(prepared.keyAuthorization)
    const signature = options.signature ?? (await account.sign({ hash: digest }))
    const keyAuthorization = KeyAuthorization.from(prepared.keyAuthorization, {
      signature: SignatureEnvelope.from(signature),
    })

    AccessKey.save({
      address: account.address,
      keyAuthorization,
      ...(keyPair ? { keyPair } : {}),
      store,
    })

    return KeyAuthorization.toRpc(keyAuthorization)
  }

  function resolveFeePayer(feePayer: string | boolean | undefined) {
    if (feePayer === false) return false
    if (typeof feePayer === 'string') return feePayer
    return undefined
  }

  async function prepareTempoTransaction(
    client: ReturnType<typeof getClient>,
    parameters:
      | Adapter.signTransaction.Parameters
      | Adapter.sendTransaction.Parameters
      | Adapter.sendTransactionSync.Parameters,
    account: TempoAccount.Account,
    keyAuthorization?: KeyAuthorization.Signed | undefined,
  ) {
    const { feePayer, ...rest } = parameters
    return await prepareTransactionRequest(client, {
      account,
      ...rest,
      ...(feePayer ? { feePayer: true } : {}),
      keyAuthorization,
      type: 'tempo',
    })
  }

  async function signTempoTransaction(
    account: TempoAccount.Account,
    transaction: Awaited<ReturnType<typeof prepareTempoTransaction>>,
  ) {
    return await account.signTransaction(transaction as never)
  }

  async function connect<
    const parameters extends Adapter.createAccount.Parameters | Adapter.loadAccounts.Parameters,
  >(parameters: parameters, fn: (parameters: parameters) => Promise<base.ConnectResult>) {
    const { authorizeAccessKey, personalSign } = parameters
    if (personalSign && parameters.digest)
      throw new core_Provider.ProviderRpcError(
        -32602,
        '`digest` and `personalSign` cannot both be set on `wallet_connect`.',
      )

    const prepared = authorizeAccessKey
      ? await prepareKeyAuthorization(authorizeAccessKey)
      : undefined
    const signatureDigest = personalSign ? hashMessage(personalSign.message) : parameters.digest
    const keyAuthorizationDigest = prepared
      ? KeyAuthorization.getSignPayload(prepared.keyAuthorization)
      : undefined
    const digest = signatureDigest ?? keyAuthorizationDigest
    const result = await fn({
      ...parameters,
      ...(digest ? { digest } : {}),
    })
    const needsAccount = !!signatureDigest || !!prepared
    const account = needsAccount ? result.account : undefined
    if (needsAccount && result.accounts.length > 0 && !account)
      throw new core_Provider.UnauthorizedError({ message: 'Connected account cannot sign.' })

    const signature =
      signatureDigest && account
        ? (result.signature ?? (await account.sign({ hash: signatureDigest })))
        : undefined
    const keyAuthorization =
      prepared && account
        ? await signKeyAuthorization(account, prepared, {
            signature:
              authorizeAccessKey?.signature ?? (!signatureDigest ? result.signature : undefined),
          })
        : undefined

    return {
      accounts: result.accounts,
      ...(result.email !== undefined ? { email: result.email } : {}),
      ...(keyAuthorization ? { keyAuthorization } : {}),
      ...(signatureDigest || prepared ? { signature } : {}),
      ...(result.username !== undefined ? { username: result.username } : {}),
      ...(personalSign ? { personalSign: { message: personalSign.message } } : {}),
    }
  }

  async function withAccessKey<result>(
    parameters: { calls?: Adapter.signTransaction.Parameters['calls'] | undefined },
    fn: (
      account: TempoAccount.Account,
      keyAuthorization?: KeyAuthorization.Signed | undefined,
    ) => Promise<result>,
  ) {
    const account = (() => {
      try {
        return getAccount({
          signable: true,
          ...(parameters.calls ? { calls: parameters.calls } : {}),
        })
      } catch {
        return undefined
      }
    })()

    if (account?.source === 'accessKey') {
      const keyAuthorization = AccessKey.getPending(account, { store })
      try {
        const result = await fn(account, keyAuthorization ?? undefined)
        AccessKey.removePending(account, { store })
        return result
      } catch {
        AccessKey.remove(account, { store })
      }
    }

    if (account && account.source !== 'accessKey') return await fn(account, undefined)

    return await fn(await resolveAccount({ accessKey: false }), undefined)
  }

  return {
    actions: {
      async createAccount(parameters) {
        if (!createAccount)
          throw new core_Provider.UnsupportedMethodError({
            message: '`createAccount` not configured on adapter.',
          })
        return await connect(parameters, createAccount)
      },
      async authorizeAccessKey(parameters) {
        const prepared = await prepareKeyAuthorization(parameters)
        const account = await resolveAccount({ accessKey: false })
        const keyAuthorization = await signKeyAuthorization(account, prepared, {
          signature: parameters.signature,
        })
        return { keyAuthorization, rootAddress: account.address }
      },
      async loadAccounts(parameters) {
        return await connect(parameters ?? {}, loadAccounts)
      },
      async revokeAccessKey(parameters) {
        const account = await resolveAccount({
          accessKey: false,
          address: parameters.address,
        })
        const client = getClient()
        try {
          await Actions.accessKey.revoke(client, {
            account,
            accessKey: parameters.accessKeyAddress,
          })
        } catch (error) {
          const isKeyNotFound =
            error instanceof BaseError && !!error.walk((e) => getErrorName(e) === 'KeyNotFound')
          if (!isKeyNotFound) throw error
        }
        store.setState((state) => ({
          accessKeys: state.accessKeys.filter(
            (a) => a.address?.toLowerCase() !== parameters.accessKeyAddress.toLowerCase(),
          ),
        }))
      },
      async signPersonalMessage({ data, address }) {
        const account = await resolveAccount({ address })
        return await account.sign({ hash: hashMessage({ raw: data }) })
      },
      async signTransaction(parameters) {
        const { feePayer } = parameters
        const client = getClient({ feePayer: resolveFeePayer(feePayer) })
        return await withAccessKey(parameters, async (account, keyAuthorization) => {
          const prepared = await prepareTempoTransaction(
            client,
            parameters,
            account,
            keyAuthorization,
          )
          return await signTempoTransaction(account, prepared)
        })
      },
      async signTypedData({ data, address }) {
        const account = await resolveAccount({ address })
        const parsed: Parameters<typeof hashTypedData>[0] = JSON.parse(data)
        return await account.sign({ hash: hashTypedData(parsed) })
      },
      async sendTransaction(parameters) {
        const { feePayer } = parameters
        const client = getClient({
          chainId: parameters.chainId,
          feePayer: resolveFeePayer(feePayer),
        })
        const signed = await withAccessKey(parameters, async (account, keyAuthorization) => {
          const prepared = await prepareTempoTransaction(
            client,
            parameters,
            account,
            keyAuthorization,
          )
          return await signTempoTransaction(account, prepared)
        })
        return await client.request({
          method: 'eth_sendRawTransaction',
          params: [signed],
        })
      },
      async sendTransactionSync(parameters) {
        const { feePayer } = parameters
        const client = getClient({
          chainId: parameters.chainId,
          feePayer: resolveFeePayer(feePayer),
        })
        const signed = await withAccessKey(parameters, async (account, keyAuthorization) => {
          const prepared = await prepareTempoTransaction(
            client,
            parameters,
            account,
            keyAuthorization,
          )
          return await signTempoTransaction(account, prepared)
        })
        return await client.request({
          method: 'eth_sendRawTransactionSync',
          params: [signed],
        })
      },
      ...(disconnect ? { disconnect } : {}),
    },
  }
}

function getErrorName(error: unknown) {
  if (typeof error !== 'object') return undefined
  if (!error) return undefined
  if (!('data' in error)) return undefined
  const { data } = error
  if (typeof data !== 'object') return undefined
  if (!data) return undefined
  if (!('errorName' in data)) return undefined
  return typeof data.errorName === 'string' ? data.errorName : undefined
}

declare namespace signKeyAuthorization {
  type Options = {
    signature?: Hex.Hex | undefined
  }
}

export declare namespace base {
  /** Options for {@link base}. */
  type Options = Adapter.SetupFn.Parameters & {
    /** Creates/registers an account and returns the selected signer when available. */
    createAccount?:
      | ((parameters: Adapter.createAccount.Parameters) => Promise<ConnectResult>)
      | undefined
    /** Disconnect hook for source-owned sessions. */
    disconnect?: (() => Promise<void>) | undefined
    /** Discovers existing accounts and returns the selected signer when available. */
    loadAccounts: (parameters: Adapter.loadAccounts.Parameters) => Promise<ConnectResult>
    /** Resolves a signable root account for future signing requests. */
    resolveAccount: (
      parameters?: ResolveAccountParameters | undefined,
    ) => Promise<TempoAccount.Account>
  }

  /** Account acquisition result returned by a signer source. */
  type ConnectResult = {
    /** Signable account selected by the connect flow. */
    account?: TempoAccount.Account | undefined
    /** Serializable accounts to put in provider state. */
    accounts: readonly Account.Store[]
    /** Email associated with the selected account. */
    email?: string | null | undefined
    /** Signature produced by the source's native connect ceremony. */
    signature?: Hex.Hex | undefined
    /** Username associated with the selected account. */
    username?: string | null | undefined
  }

  /** Parameters used when resolving a signer from a source. */
  type ResolveAccountParameters = {
    /** Whether access keys may satisfy the request. */
    accessKey?: boolean | undefined
    /** Address to resolve. Defaults to the active account. */
    address?: Address | undefined
    /** Calls to match against access key scopes. */
    calls?: readonly { to?: Address | undefined; data?: Hex.Hex | undefined }[] | undefined
  }
}
