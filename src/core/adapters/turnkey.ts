import {
  Address as ox_Address,
  Hex as ox_Hex,
  Provider as ox_Provider,
  PublicKey,
  Signature,
} from 'ox'
import { KeyAuthorization, SignatureEnvelope, TxEnvelopeTempo } from 'ox/tempo'
import type { Address, Hex } from 'viem'
import { prepareTransactionRequest } from 'viem/actions'
import { Account as TempoAccount, Transaction } from 'viem/tempo'

import * as AccessKey from '../AccessKey.js'
import * as Adapter from '../Adapter.js'
import type * as Store from '../Store.js'

/**
 * Creates a Turnkey adapter backed by injected Turnkey clients, providers, or React Wallet Kit state.
 *
 * The adapter keeps Turnkey-specific custody and provisioning outside the Accounts provider while
 * exposing standard Accounts SDK provider methods.
 *
 * @example
 * ```ts
 * import { Provider, turnkey } from 'accounts'
 *
 * const provider = Provider.create({
 *   adapter: turnkey({
 *     organizationId: '...',
 *     signWith: '0x...',
 *     loadAccounts: async () => ({ accounts: [{ address: '0x...' }] }),
 *     signTransaction: async (params) => turnkeyClient.signTransaction(params),
 *   }),
 * })
 * ```
 */
export function turnkey(options: turnkey.Options = {}): Adapter.Adapter {
  const {
    icon,
    name = 'Turnkey',
    rdns = 'com.turnkey',
    transactionType = 'TRANSACTION_TYPE_TEMPO',
  } = options

  return Adapter.define({ icon, name, rdns }, ({ getAccount, getClient, store }) => {
    async function getProvider() {
      return options.getProvider ? await options.getProvider() : options.provider
    }

    async function loadWalletAccounts(
      parameters?: Adapter.loadAccounts.Parameters | undefined,
      request?: Adapter.loadAccounts.Request | undefined,
    ) {
      if (options.loadAccounts) return await options.loadAccounts(parameters, context(request))

      const account = await selectAccount()
      if (!account)
        throw new ox_Provider.DisconnectedError({
          message: 'No Turnkey Ethereum account is available.',
        })

      return { accounts: [toStoreAccount(account)] }
    }

    async function createWalletAccount(parameters: Adapter.createAccount.Parameters) {
      if (options.createAccount) return await options.createAccount(parameters, context())

      const created = await (async () => {
        if (options.createWallet) {
          await options.createWallet({
            accounts: ['ADDRESS_FORMAT_ETHEREUM'],
            walletName: parameters.name,
          })
          await options.refreshWallets?.()
          return await selectAccount()
        }

        const wallet = options.wallets?.find((wallet) => wallet.walletId)
        if (wallet?.walletId && options.createWalletAccounts) {
          await options.createWalletAccounts({
            accounts: ['ADDRESS_FORMAT_ETHEREUM'],
            walletId: wallet.walletId,
          })
          await options.refreshWallets?.()
          return await selectAccount()
        }

        return undefined
      })()

      if (!created)
        throw new ox_Provider.UnsupportedMethodError({
          message: '`createAccount` not configured on Turnkey adapter.',
        })

      return { accounts: [toStoreAccount(created)] }
    }

    async function selectAccount() {
      if (options.walletAccount) return options.walletAccount
      if (options.address) return { address: options.address }
      if (options.signWith?.startsWith('0x')) return { address: options.signWith as Address }
      const wallets = options.wallets ?? []
      const accounts = wallets.flatMap((wallet) =>
        (wallet.accounts ?? []).map((account) => ({
          ...account,
          walletId: account.walletId ?? wallet.walletId,
          walletSource: account.walletSource ?? wallet.source,
        })),
      )
      if (options.selectAccount) return await options.selectAccount(accounts, context())
      return (
        accounts.find(
          (account) => isEthereumAccount(account) && account.walletSource !== 'connected',
        ) ??
        accounts.find(isEthereumAccount) ??
        accounts[0]
      )
    }

    async function resolveAccount(address?: Address | undefined) {
      const loaded = await loadWalletAccounts(undefined)
      const account = address
        ? loaded.accounts.find((account) => account.address.toLowerCase() === address.toLowerCase())
        : loaded.accounts[0]
      if (!account)
        throw new ox_Provider.UnauthorizedError({
          message: address
            ? `Turnkey account "${address}" is not available.`
            : 'No Turnkey account is available.',
        })
      return account
    }

    async function resolveSignWith(account: { address: Address }) {
      if (options.resolveSignWith) return await options.resolveSignWith(account, context())
      return options.signWith ?? account.address
    }

    async function signDigest(digest: Hex, account: { address: Address }) {
      const signWith = await resolveSignWith(account)
      if (!options.signRawPayload)
        throw new ox_Provider.UnsupportedMethodError({
          message: '`signRawPayload` is required to sign Turnkey digests.',
        })
      return normalizeSignature(
        await options.signRawPayload({
          encoding: 'PAYLOAD_ENCODING_HEXADECIMAL',
          hashFunction: 'HASH_FUNCTION_NO_OP',
          organizationId: options.organizationId,
          payload: digest,
          signWith,
          stampWith: options.stampWith,
        }),
      )
    }

    async function prepareKeyAuthorization(options: Adapter.authorizeAccessKey.Parameters) {
      const { expiry, limits, scopes } = options
      const chainId = options.chainId ?? getClient().chain.id

      if (options.publicKey || options.address) {
        const accessKeyAddress =
          options.address ?? ox_Address.fromPublicKey(PublicKey.from(options.publicKey!))
        const keyAuthorization = KeyAuthorization.from({
          address: accessKeyAddress,
          chainId: BigInt(chainId),
          expiry,
          limits,
          scopes,
          type: options.keyType ?? 'secp256k1',
        })
        return { keyAuthorization }
      }

      const { accessKey, keyPair } = await AccessKey.generate()
      const keyAuthorization = KeyAuthorization.from({
        address: accessKey.address,
        chainId: BigInt(chainId),
        expiry,
        limits,
        scopes,
        type: 'p256',
      })
      return { keyAuthorization, keyPair }
    }

    async function signKeyAuthorization(
      account: { address: Address },
      prepared: Awaited<ReturnType<typeof prepareKeyAuthorization>>,
      signature?: Hex | undefined,
    ) {
      const digest = KeyAuthorization.getSignPayload(prepared.keyAuthorization)
      const signed = KeyAuthorization.from(prepared.keyAuthorization, {
        signature: SignatureEnvelope.from(signature ?? (await signDigest(digest, account))),
      })

      AccessKey.save({
        address: account.address,
        keyAuthorization: signed,
        keyPair: prepared.keyPair,
        store,
      })

      return KeyAuthorization.toRpc(signed)
    }

    async function withAccessKey<result>(
      fn: (
        account: TempoAccount.Account | { address: Address; type: 'json-rpc' },
        keyAuthorization?: KeyAuthorization.Signed | undefined,
      ) => Promise<result>,
    ) {
      const account = (() => {
        try {
          return getAccount({ signable: true })
        } catch {
          const root = getAccount({ accessKey: false })
          return { address: root.address, type: 'json-rpc' as const }
        }
      })()
      const keyAuthorization =
        'source' in account && account.source === 'accessKey'
          ? AccessKey.getPending(account, { store })
          : undefined

      try {
        const result = await fn(account, keyAuthorization)
        if ('source' in account && account.source === 'accessKey')
          AccessKey.removePending(account, { store })
        return result
      } catch (error) {
        if (!('source' in account) || account.source !== 'accessKey') throw error
        AccessKey.remove(account, { store })
        const root = getAccount({ accessKey: false })
        return await fn({ address: root.address, type: 'json-rpc' }, undefined)
      }
    }

    async function signPreparedTransaction(
      parameters: Adapter.signTransaction.Parameters,
    ): Promise<Hex> {
      const { feePayer, ...rest } = parameters
      const client = getClient({
        feePayer: (() => {
          if (feePayer === false) return false
          if (typeof feePayer === 'string') return feePayer
          return undefined
        })(),
      })

      return await withAccessKey(async (account, keyAuthorization) => {
        if ('signTransaction' in account && typeof account.signTransaction === 'function') {
          const prepared = await prepareTransactionRequest(client, {
            account,
            ...rest,
            ...(feePayer ? { feePayer: true } : {}),
            keyAuthorization,
            type: 'tempo',
          })
          return await account.signTransaction(prepared as never)
        }

        const root = await resolveAccount(account.address)
        const prepared = await prepareTransactionRequest(client, {
          account,
          ...rest,
          ...(feePayer ? { feePayer: true } : {}),
          keyAuthorization,
          type: 'tempo',
        })
        const unsignedTransaction = (await Transaction.serialize(prepared as never)) as Hex
        const signWith = await resolveSignWith(root)

        if (options.signRawPayload) {
          const payload = TxEnvelopeTempo.getSignPayload(
            TxEnvelopeTempo.from(unsignedTransaction as `0x76${string}`),
          )
          const signature = Signature.from(
            normalizeSignature(
              await options.signRawPayload({
                encoding: 'PAYLOAD_ENCODING_HEXADECIMAL',
                hashFunction: 'HASH_FUNCTION_NO_OP',
                organizationId: options.organizationId,
                payload,
                signWith,
                stampWith: options.stampWith,
              }),
            ),
          )
          return (await Transaction.serialize(prepared as never, signature as never)) as Hex
        }

        if (options.signTransaction) {
          return normalizeHex(
            await options.signTransaction({
              organizationId: options.organizationId,
              signWith,
              stampWith: options.stampWith,
              transactionType,
              unsignedTransaction,
              walletAccount: await selectAccount(),
            }),
          )
        }

        const provider = await getProvider()
        if (provider)
          return (await provider.request({
            method: 'eth_signTransaction',
            params: [prepared],
          } as never)) as Hex

        throw new ox_Provider.UnsupportedMethodError({
          message: '`signTransaction` not configured on Turnkey adapter.',
        })
      })
    }

    function context(request?: Adapter.loadAccounts.Request | undefined): turnkey.Context {
      return {
        getAccount,
        getClient,
        getProvider,
        organizationId: options.organizationId,
        request,
        signWith: options.signWith,
        stampWith: options.stampWith,
        store,
      }
    }

    return {
      actions: {
        async createAccount(parameters) {
          return await mapTurnkeyError(async () => {
            const { authorizeAccessKey, digest, ...rest } = parameters
            const result = await createWalletAccount({ ...rest, digest })
            const account = result.accounts[0]
            const signature = digest && account ? await signDigest(digest, account) : undefined
            const keyAuthorization =
              authorizeAccessKey && account
                ? await signKeyAuthorization(
                    account,
                    await prepareKeyAuthorization(authorizeAccessKey),
                    signature,
                  )
                : undefined
            return { ...result, keyAuthorization, signature }
          })
        },

        async loadAccounts(parameters, request) {
          return await mapTurnkeyError(async () => {
            const { authorizeAccessKey, digest } = parameters ?? {}
            const result = await loadWalletAccounts(parameters, request)
            const account = result.accounts[0]
            const signature = digest && account ? await signDigest(digest, account) : undefined
            const keyAuthorization =
              authorizeAccessKey && account
                ? await signKeyAuthorization(
                    account,
                    await prepareKeyAuthorization(authorizeAccessKey),
                    signature,
                  )
                : undefined
            return { ...result, keyAuthorization, signature }
          })
        },

        async authorizeAccessKey(parameters) {
          return await mapTurnkeyError(async () => {
            const account = await resolveAccount()
            const prepared = await prepareKeyAuthorization(parameters)
            return {
              keyAuthorization: await signKeyAuthorization(account, prepared, parameters.signature),
              rootAddress: account.address,
            }
          })
        },

        async disconnect() {
          await options.disconnect?.(context())
        },

        async revokeAccessKey(parameters) {
          AccessKey.revoke({ address: parameters.address, store })
        },

        async signPersonalMessage(parameters, request) {
          return await mapTurnkeyError(async () => {
            const account = await resolveAccount(parameters.address)
            const signWith = await resolveSignWith(account)
            if (options.signPersonalMessage)
              return normalizeSignature(
                await options.signPersonalMessage(
                  { ...parameters, signWith, walletAccount: await selectAccount() },
                  context(),
                ),
              )
            const provider = await getProvider()
            if (provider) return (await provider.request(request as never)) as Hex
            throw new ox_Provider.UnsupportedMethodError({
              message: '`signPersonalMessage` not configured on Turnkey adapter.',
            })
          })
        },

        async signTransaction(parameters) {
          return await mapTurnkeyError(async () => await signPreparedTransaction(parameters))
        },

        async signTypedData(parameters, request) {
          return await mapTurnkeyError(async () => {
            const account = await resolveAccount(parameters.address)
            const signWith = await resolveSignWith(account)
            if (options.signTypedData)
              return normalizeSignature(
                await options.signTypedData(
                  { ...parameters, signWith, walletAccount: await selectAccount() },
                  context(),
                ),
              )
            if (options.signRawPayload)
              return normalizeSignature(
                await options.signRawPayload({
                  encoding: 'PAYLOAD_ENCODING_EIP712',
                  hashFunction: 'HASH_FUNCTION_NOT_APPLICABLE',
                  organizationId: options.organizationId,
                  payload: parameters.data,
                  signWith,
                  stampWith: options.stampWith,
                }),
              )
            const provider = await getProvider()
            if (provider) return (await provider.request(request as never)) as Hex
            throw new ox_Provider.UnsupportedMethodError({
              message: '`signTypedData` not configured on Turnkey adapter.',
            })
          })
        },

        async sendTransaction(parameters) {
          return await mapTurnkeyError(async () => {
            const signed = await signPreparedTransaction(parameters)
            const client = getClient({
              feePayer: typeof parameters.feePayer === 'string' ? parameters.feePayer : undefined,
            })
            return await client.request({
              method: 'eth_sendRawTransaction' as never,
              params: [signed],
            })
          })
        },

        async sendTransactionSync(parameters) {
          return await mapTurnkeyError(async () => {
            const signed = await signPreparedTransaction(parameters)
            const client = getClient({
              feePayer: typeof parameters.feePayer === 'string' ? parameters.feePayer : undefined,
            })
            return await client.request({
              method: 'eth_sendRawTransactionSync' as never,
              params: [signed],
            })
          })
        },

        async switchChain(parameters) {
          await mapTurnkeyError(async () => {
            await options.switchChain?.(parameters, context())
            const provider = await getProvider()
            await provider?.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: ox_Hex.fromNumber(parameters.chainId) }],
            } as never)
          })
        },
      },
    }
  })
}

async function mapTurnkeyError<result>(fn: () => Promise<result>) {
  try {
    return await fn()
  } catch (error) {
    if (isProviderError(error)) throw error
    if (isUserRejected(error))
      throw new ox_Provider.UserRejectedRequestError({
        message: error instanceof Error ? error.message : undefined,
      })
    throw error
  }
}

function isUserRejected(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const message = 'message' in error && typeof error.message === 'string' ? error.message : ''
  const code = 'code' in error ? error.code : undefined
  return code === 4001 || code === 'USER_REJECTED' || /cancel|reject|denied|declined/i.test(message)
}

function isProviderError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const name = 'name' in error && typeof error.name === 'string' ? error.name : ''
  return name.startsWith('Provider.')
}

function isEthereumAccount(account: turnkey.WalletAccount) {
  return (
    account.addressFormat === 'ADDRESS_FORMAT_ETHEREUM' ||
    account.addressType === 'ADDRESS_TYPE_ETHEREUM' ||
    account.address.startsWith('0x')
  )
}

function toStoreAccount(account: turnkey.WalletAccount): Store.Account {
  return {
    address: account.address,
    accountType: account.walletSource === 'embedded' ? 'embedded' : 'external',
    signatureKeyType: 'secp256k1',
  }
}

function normalizeHex(value: string): Hex {
  return (value.startsWith('0x') ? value : `0x${value}`) as Hex
}

function normalizeSignature(value: turnkey.SignatureResult): Hex {
  if (typeof value === 'string') return normalizeHex(value)

  const r = ox_Hex.padLeft(normalizeHex(value.r), 32)
  const s = ox_Hex.padLeft(normalizeHex(value.s), 32)
  const v =
    typeof value.v === 'number'
      ? ox_Hex.padLeft(ox_Hex.fromNumber(value.v), 1)
      : ox_Hex.padLeft(normalizeHex(value.v), 1)
  return ox_Hex.concat(r, s, v)
}

export declare namespace turnkey {
  /** Minimal EIP-1193 provider shape used by the Turnkey adapter. */
  type Provider = {
    /** Sends a JSON-RPC request to the provider. */
    request: (request: { method: string; params?: unknown[] | undefined }) => Promise<unknown>
  }

  /** Minimal Turnkey wallet account shape consumed by the adapter. */
  type WalletAccount = {
    /** Wallet account address. */
    address: Address
    /** Turnkey address format, e.g. `ADDRESS_FORMAT_ETHEREUM`. */
    addressFormat?: string | undefined
    /** Turnkey address type, e.g. `ADDRESS_TYPE_ETHEREUM`. */
    addressType?: string | undefined
    /** Turnkey wallet account identifier. */
    walletAccountId?: string | undefined
    /** Parent Turnkey wallet identifier. */
    walletId?: string | undefined
    /** Source copied from the parent wallet when selected from `wallets`. */
    walletSource?: string | undefined
  }

  /** Minimal Turnkey wallet shape consumed by the adapter. */
  type Wallet = {
    /** Turnkey wallet accounts. */
    accounts?: readonly WalletAccount[] | undefined
    /** Turnkey wallet identifier. */
    walletId?: string | undefined
    /** Turnkey wallet source, e.g. embedded or connected. */
    source?: string | undefined
  }

  /** Shared context passed to custom Turnkey hooks. */
  type Context = {
    /** Returns the active Accounts SDK account. */
    getAccount: Adapter.SetupFn.Parameters['getAccount']
    /** Returns the configured viem client. */
    getClient: Adapter.SetupFn.Parameters['getClient']
    /** Resolves the optional delegated EIP-1193 provider. */
    getProvider: () => Promise<Provider | undefined>
    /** Turnkey organization ID, when configured. */
    organizationId?: string | undefined
    /** Provider request that triggered this hook, when available. */
    request?: Adapter.loadAccounts.Request | undefined
    /** Configured Turnkey signing target, when configured. */
    signWith?: string | undefined
    /** Optional Turnkey stamper override. */
    stampWith?: string | undefined
    /** Accounts SDK store. */
    store: Adapter.SetupFn.Parameters['store']
  }

  /** Turnkey signature result, either serialized or split into ECDSA parts. */
  type SignatureResult =
    | string
    | {
        /** ECDSA r value. */
        r: string
        /** ECDSA s value. */
        s: string
        /** ECDSA recovery value. */
        v: string | number
      }

  /** Parameters passed to Turnkey transaction signing hooks. */
  type SignTransactionParameters = {
    /** Turnkey organization ID. */
    organizationId?: string | undefined
    /** Turnkey signing target. */
    signWith: string
    /** Optional Turnkey stamper override. */
    stampWith?: string | undefined
    /** Turnkey transaction type. */
    transactionType: string
    /** Serialized unsigned transaction. */
    unsignedTransaction: Hex
    /** Selected Turnkey wallet account. */
    walletAccount?: WalletAccount | undefined
  }

  /** Parameters passed to Turnkey raw-payload signing hooks. */
  type SignRawPayloadParameters = {
    /** Turnkey payload encoding. */
    encoding:
      | 'PAYLOAD_ENCODING_HEXADECIMAL'
      | 'PAYLOAD_ENCODING_TEXT_UTF8'
      | 'PAYLOAD_ENCODING_EIP712'
      | 'PAYLOAD_ENCODING_EIP7702_AUTHORIZATION'
    /** Turnkey hash function. */
    hashFunction:
      | 'HASH_FUNCTION_NO_OP'
      | 'HASH_FUNCTION_SHA256'
      | 'HASH_FUNCTION_KECCAK256'
      | 'HASH_FUNCTION_NOT_APPLICABLE'
    /** Turnkey organization ID. */
    organizationId?: string | undefined
    /** Raw payload to sign. */
    payload: string
    /** Turnkey signing target. */
    signWith: string
    /** Optional Turnkey stamper override. */
    stampWith?: string | undefined
  }

  /** Adapter options for Turnkey-backed accounts. */
  type Options = {
    /** Directly configured account address to expose through Accounts. */
    address?: Address | undefined
    /** Creates a Turnkey account for `wallet_connect` register flows. */
    createAccount?:
      | ((
          params: Adapter.createAccount.Parameters,
          context: Context,
        ) => Promise<Adapter.createAccount.ReturnType>)
      | undefined
    /** React Wallet Kit `createWallet` helper. */
    createWallet?:
      | ((params: {
          accounts: readonly ['ADDRESS_FORMAT_ETHEREUM']
          walletName: string
        }) => Promise<unknown>)
      | undefined
    /** React Wallet Kit `createWalletAccounts` helper. */
    createWalletAccounts?:
      | ((params: {
          accounts: readonly ['ADDRESS_FORMAT_ETHEREUM']
          walletId: string
        }) => Promise<unknown>)
      | undefined
    /** Adapter-specific disconnect cleanup. */
    disconnect?: ((context: Context) => Promise<void> | void) | undefined
    /** EIP-1193 provider to delegate optional methods to. */
    provider?: Provider | undefined
    /** Lazily resolves an EIP-1193 provider to delegate optional methods to. */
    getProvider?: (() => Promise<Provider | undefined> | Provider | undefined) | undefined
    /** Data URI of the provider icon. @default Black 1×1 SVG. */
    icon?: `data:image/${string}` | undefined
    /** Loads Turnkey accounts. */
    loadAccounts?:
      | ((
          params: Adapter.loadAccounts.Parameters | undefined,
          context: Context,
        ) => Promise<Adapter.loadAccounts.ReturnType>)
      | undefined
    /** Display name of the provider. @default `'Turnkey'` */
    name?: string | undefined
    /** Turnkey organization ID used for signing activities. */
    organizationId?: string | undefined
    /** React Wallet Kit `refreshWallets` helper. */
    refreshWallets?: (() => Promise<unknown> | unknown) | undefined
    /** Reverse DNS identifier. @default `'com.turnkey'` */
    rdns?: string | undefined
    /** Resolves the Turnkey signing target for a selected Accounts account. */
    resolveSignWith?:
      | ((account: { address: Address }, context: Context) => Promise<string> | string)
      | undefined
    /** Selects the Turnkey wallet account exposed to Accounts. */
    selectAccount?:
      | ((
          accounts: readonly WalletAccount[],
          context: Context,
        ) => Promise<WalletAccount | undefined> | WalletAccount | undefined)
      | undefined
    /** Optional Turnkey stamper override. */
    stampWith?: string | undefined
    /** Signs an EIP-191 personal message. */
    signPersonalMessage?:
      | ((
          params: Adapter.signPersonalMessage.Parameters & {
            /** Turnkey signing target. */
            signWith: string
            /** Selected Turnkey wallet account. */
            walletAccount?: WalletAccount | undefined
          },
          context: Context,
        ) => Promise<SignatureResult>)
      | undefined
    /** Signs a raw payload through Turnkey. Used for digests and EIP-712 fallback. */
    signRawPayload?: ((params: SignRawPayloadParameters) => Promise<SignatureResult>) | undefined
    /** Turnkey signing target. Defaults to the selected account address. */
    signWith?: string | undefined
    /** Signs a prepared transaction through Turnkey. */
    signTransaction?: ((params: SignTransactionParameters) => Promise<string>) | undefined
    /** Signs EIP-712 typed data. */
    signTypedData?:
      | ((
          params: Adapter.signTypedData.Parameters & {
            /** Turnkey signing target. */
            signWith: string
            /** Selected Turnkey wallet account. */
            walletAccount?: WalletAccount | undefined
          },
          context: Context,
        ) => Promise<SignatureResult>)
      | undefined
    /** Adapter-specific chain switch hook. */
    switchChain?:
      | ((params: Adapter.switchChain.Parameters, context: Context) => Promise<void> | void)
      | undefined
    /** Turnkey transaction type. @default `'TRANSACTION_TYPE_TEMPO'` */
    transactionType?: string | undefined
    /** Selected Turnkey wallet account. */
    walletAccount?: WalletAccount | undefined
    /** React Wallet Kit `wallets` state. */
    wallets?: readonly Wallet[] | undefined
  }
}
