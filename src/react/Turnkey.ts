import { Hex as ox_Hex } from 'ox'
import { useMemo } from 'react'

import type * as Adapter from '../core/Adapter.js'
import { turnkey as core_turnkey } from '../core/adapters/turnkey.js'

/**
 * Creates a memoized Accounts adapter from `@turnkey/react-wallet-kit` state.
 *
 * Pass the result of Turnkey's `useTurnkey()` hook as the first argument. The helper does not
 * import Turnkey directly, keeping Turnkey packages optional for apps that do not use this path.
 *
 * @example
 * ```tsx
 * const turnkey = useTurnkey()
 * const adapter = useTurnkeyAdapter(turnkey)
 * ```
 */
export function useTurnkeyAdapter(
  kit: useTurnkeyAdapter.Turnkey,
  options: useTurnkeyAdapter.Options = {},
): Adapter.Adapter {
  const {
    messageMode = 'headless',
    organizationId = kit.organizationId,
    toMessage = (data) => ox_Hex.toString(data),
    ...rest
  } = options

  return useMemo(
    () =>
      core_turnkey({
        ...rest,
        createWallet: kit.createWallet,
        createWalletAccounts: kit.createWalletAccounts,
        organizationId,
        refreshWallets: kit.refreshWallets,
        signPersonalMessage: async ({ data, signWith, walletAccount: selected }) => {
          const walletAccount = selected ?? selectWalletAccount(kit.wallets, signWith)
          const signMessage =
            messageMode === 'modal' ? (kit.handleSignMessage ?? kit.signMessage) : kit.signMessage
          if (!signMessage) throw new Error('Turnkey signMessage is not available.')
          return await signMessage({
            addEthereumPrefix: true,
            message: toMessage(data),
            walletAccount,
          })
        },
        signRawPayload: kit.signRawPayload,
        signTransaction: async (params) =>
          await kit.signTransaction({
            organizationId: params.organizationId,
            stampWith: params.stampWith,
            transactionType: params.transactionType,
            unsignedTransaction: params.unsignedTransaction,
            walletAccount:
              params.walletAccount ?? selectWalletAccount(kit.wallets, params.signWith),
          }),
        wallets: kit.wallets,
      }),
    [
      kit.createWallet,
      kit.createWalletAccounts,
      kit.handleSignMessage,
      kit.refreshWallets,
      kit.signMessage,
      kit.signRawPayload,
      kit.signTransaction,
      kit.wallets,
      options,
    ],
  )
}

function selectWalletAccount(wallets: readonly core_turnkey.Wallet[] | undefined, address: string) {
  const account = wallets
    ?.flatMap((wallet) => wallet.accounts ?? [])
    .find((account) => account.address.toLowerCase() === address.toLowerCase())
  if (!account) throw new Error(`Turnkey wallet account "${address}" is not available.`)
  return account
}

export declare namespace useTurnkeyAdapter {
  /** Minimal `useTurnkey()` return shape consumed by {@link useTurnkeyAdapter}. */
  type Turnkey = {
    /** React Wallet Kit `createWallet` helper. */
    createWallet?: core_turnkey.Options['createWallet']
    /** React Wallet Kit `createWalletAccounts` helper. */
    createWalletAccounts?: core_turnkey.Options['createWalletAccounts']
    /** React Wallet Kit modal message signing helper. */
    handleSignMessage?:
      | ((params: {
          addEthereumPrefix?: boolean | undefined
          message: string
          walletAccount: core_turnkey.WalletAccount
        }) => Promise<core_turnkey.SignatureResult>)
      | undefined
    /** Active Turnkey organization ID. */
    organizationId?: string | undefined
    /** React Wallet Kit `refreshWallets` helper. */
    refreshWallets?: core_turnkey.Options['refreshWallets']
    /** React Wallet Kit headless message signing helper. */
    signMessage?:
      | ((params: {
          addEthereumPrefix?: boolean | undefined
          message: string
          walletAccount: core_turnkey.WalletAccount
        }) => Promise<core_turnkey.SignatureResult>)
      | undefined
    /** Raw-payload signing helper, when exposed by the app's Turnkey client. */
    signRawPayload?: core_turnkey.Options['signRawPayload']
    /** React Wallet Kit transaction signing helper. */
    signTransaction: (params: {
      organizationId?: string | undefined
      stampWith?: string | undefined
      transactionType: string
      unsignedTransaction: string
      walletAccount: core_turnkey.WalletAccount
    }) => Promise<string>
    /** React Wallet Kit wallets state. */
    wallets?: readonly core_turnkey.Wallet[] | undefined
  }

  /** React Turnkey adapter options. */
  type Options = Omit<
    core_turnkey.Options,
    | 'createWallet'
    | 'createWalletAccounts'
    | 'refreshWallets'
    | 'signPersonalMessage'
    | 'signTransaction'
    | 'wallets'
  > & {
    /** Message helper to use for `personal_sign`. @default `'headless'` */
    messageMode?: 'headless' | 'modal' | undefined
    /** Converts hex `personal_sign` data into the Turnkey message string. */
    toMessage?: ((data: `0x${string}`) => string) | undefined
  }
}
