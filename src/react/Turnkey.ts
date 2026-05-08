import { Hex as ox_Hex, Provider as ox_Provider } from 'ox'

import * as core_Provider from '../core/Provider.js'
import { turnkey as core_turnkey } from '../core/adapters/turnkey.js'

/**
 * Creates an EIP-1193 provider backed by Turnkey React Wallet Kit.
 *
 * React Wallet Kit owns the Turnkey sign-in UI, session state, and Turnkey SDK client. The returned
 * provider exposes existing embedded Ethereum accounts and signs through the authenticated Turnkey
 * client. Compose it with `dialog({ provider })` to use Tempo for post-connect consent.
 *
 * @example
 * ```tsx
 * const turnkeyProvider = Turnkey.fromReactKit({ kit: useTurnkey() })
 *
 * const provider = Provider.create({
 *   adapter: dialog({ provider: turnkeyProvider }),
 * })
 * ```
 */
export function fromReactKit(options: fromReactKit.Options): fromReactKit.Provider {
  const { kit, toMessage = (data) => ox_Hex.toString(data), ...providerOptions } = options

  const provider = core_Provider.create({
    adapter: core_turnkey({
      disconnect: async () => {
        if (!kit.session) return
        await kit.logout()
      },
      loadAccounts: async () => {
        if (!kit.session) await kit.handleLogin()

        const wallets = await kit.refreshWallets(turnkeySessionParams(kit))
        const account = selectEthereumAccount(wallets)
        if (!account)
          throw new ox_Provider.DisconnectedError({
            message: 'No embedded Turnkey Ethereum account is available.',
          })

        return { accounts: [toStoreAccount(account)] }
      },
      organizationId: kit.session?.organizationId,
      refreshWallets: async () => await kit.refreshWallets(turnkeySessionParams(kit)),
      signPersonalMessage: async ({ data, signWith }) => {
        const walletAccount = selectWalletAccount(kit.wallets, signWith)
        const signMessage = typeof kit.signMessage === 'function' ? kit.signMessage : undefined
        if (!signMessage) throw new Error('Turnkey signMessage is not available.')
        return (await signMessage({
          addEthereumPrefix: true,
          message: toMessage(data),
          walletAccount,
        } as never)) as core_turnkey.SignatureResult
      },
      signRawPayload: async (params) => {
        const signRawPayload =
          typeof kit.httpClient?.signRawPayload === 'function'
            ? kit.httpClient.signRawPayload
            : undefined
        if (!signRawPayload) throw new Error('Turnkey signRawPayload is not available.')
        const response = await signRawPayload(
          {
            encoding: params.encoding as never,
            hashFunction: params.hashFunction as never,
            organizationId: kit.session?.organizationId ?? params.organizationId,
            payload: params.payload,
            signWith: params.signWith,
          },
          params.stampWith as never,
        )
        const result = response?.activity.result.signRawPayloadResult
        if (!result) throw new Error('Turnkey did not return a raw-payload signature.')
        return result
      },
      signTransaction: async (params) => {
        const signTransaction =
          typeof kit.signTransaction === 'function' ? kit.signTransaction : undefined
        if (!signTransaction) throw new Error('Turnkey signTransaction is not available.')
        return (await signTransaction({
          organizationId: params.organizationId,
          stampWith: params.stampWith,
          transactionType: params.transactionType,
          unsignedTransaction: params.unsignedTransaction,
          walletAccount: params.walletAccount ?? selectWalletAccount(kit.wallets, params.signWith),
        } as never)) as string
      },
      wallets: kit.wallets.map((wallet) => ({
        accounts: wallet.accounts.map((account) => ({
          address: account.address as `0x${string}`,
          addressFormat: account.addressFormat,
          walletAccountId: account.walletAccountId,
          walletId: account.walletId,
          walletSource: wallet.source,
        })),
        source: wallet.source,
        walletId: wallet.walletId,
      })),
    }),
    ...providerOptions,
  })

  return {
    on: (event, listener) => provider.on(event as never, listener as never),
    removeListener: (event, listener) =>
      provider.removeListener(event as never, listener as never),
    request: provider.request,
  }
}

function turnkeySessionParams(kit: fromReactKit.Kit) {
  return {
    organizationId: kit.session?.organizationId,
    userId: kit.session?.userId,
  }
}

function selectEthereumAccount(wallets: fromReactKit.Kit['wallets']) {
  return wallets
    .flatMap((wallet) =>
      wallet.accounts.map((account) => ({ ...account, walletSource: wallet.source })),
    )
    .find(
      (account) =>
        (account.addressFormat === 'ADDRESS_FORMAT_ETHEREUM' || account.address.startsWith('0x')) &&
        account.walletSource === 'embedded',
    )
}

function selectWalletAccount(wallets: fromReactKit.Kit['wallets'], address: string) {
  const account = wallets
    .flatMap((wallet) => wallet.accounts)
    .find((account) => account.address.toLowerCase() === address.toLowerCase())
  if (!account) throw new Error(`Turnkey wallet account "${address}" is not available.`)
  return account
}

function toStoreAccount(account: NonNullable<ReturnType<typeof selectEthereumAccount>>) {
  return {
    address: account.address as `0x${string}`,
    accountType: 'embedded',
    signatureKeyType: 'secp256k1',
  } as const
}

export declare namespace fromReactKit {
  /** Minimal React Wallet Kit shape consumed by {@link fromReactKit}. */
  type Kit = {
    /** Opens the React Wallet Kit sign-in UI. */
    handleLogin: () => Promise<void>
    /** Authenticated Turnkey HTTP client. */
    httpClient?: { signRawPayload?: unknown | undefined } | undefined
    /** Clears the active Turnkey session. */
    logout: () => Promise<void>
    /** Refreshes React Wallet Kit wallet state. */
    refreshWallets: (params?: {
      organizationId?: string | undefined
      userId?: string | undefined
    }) => Promise<readonly Wallet[]>
    /** Active Turnkey session. */
    session?: { organizationId?: string | undefined; userId?: string | undefined } | undefined
    /** Signs an EIP-191 message through Turnkey. */
    signMessage?: unknown | undefined
    /** Signs a transaction through Turnkey. */
    signTransaction?: unknown | undefined
    /** Current React Wallet Kit wallet state. */
    wallets: readonly Wallet[]
  }

  /** Minimal React Wallet Kit wallet shape. */
  type Wallet = {
    /** Wallet accounts. */
    accounts: readonly WalletAccount[]
    /** Turnkey wallet source, e.g. embedded or connected. */
    source?: string | undefined
    /** Turnkey wallet identifier. */
    walletId?: string | undefined
  }

  /** Minimal React Wallet Kit wallet account shape. */
  type WalletAccount = {
    /** Wallet account address. */
    address: string
    /** Turnkey address format, e.g. `ADDRESS_FORMAT_ETHEREUM`. */
    addressFormat?: string | undefined
    /** Turnkey wallet account identifier. */
    walletAccountId?: string | undefined
    /** Parent Turnkey wallet identifier. */
    walletId?: string | undefined
  }

  /** Options for {@link fromReactKit}. */
  type Options = Omit<core_Provider.create.Options, 'adapter'> & {
    /** React Wallet Kit state returned from `useTurnkey()`. */
    kit: Kit
    /** Converts hex `personal_sign` data into the Turnkey message string. */
    toMessage?: ((data: `0x${string}`) => string) | undefined
  }

  /** EIP-1193 provider shape returned from {@link fromReactKit}. */
  type Provider = {
    /** Subscribe to provider events. */
    on?: ((event: string, listener: (...args: readonly unknown[]) => void) => void) | undefined
    /** Remove a provider event listener. */
    removeListener?:
      | ((event: string, listener: (...args: readonly unknown[]) => void) => void)
      | undefined
    /** Execute an EIP-1193 request. */
    request: (request: { method: string; params?: unknown | undefined }) => Promise<unknown>
  }
}
