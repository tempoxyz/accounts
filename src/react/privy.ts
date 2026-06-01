import {
  type ConnectedWallet,
  type User,
  toViemAccount,
  useLogin,
  usePrivy,
  useWallets,
} from '@privy-io/react-auth'
import { useEffect, useRef, useSyncExternalStore } from 'react'

import type * as Adapter from '../core/Adapter.js'
import { privy as core_privy } from '../core/adapters/privy.js'

/**
 * Creates a Privy adapter wired to `@privy-io/react-auth`.
 *
 * Mount {@link PrivyAccountsBridge} under Privy's `PrivyProvider` in the same
 * React tree. The bridge owns Privy's login modal, hook state, public-key
 * lookup, and account materialization for this adapter.
 */
export function privy(options: privy.Options = {}): Adapter.Adapter {
  return core_privy({
    ...options,
    client,
    loadAccounts: async () => await requestPrivyAccounts(),
  })
}

/** Mounts the React boundary needed by {@link privy}. */
export function PrivyAccountsBridge() {
  const privy = usePrivy()
  const wallets = useWallets()
  const request = usePrivyAccountsRequest()
  const loading = useRef(false)
  const login_started = useRef(false)
  const login = useLogin({
    onError(error) {
      login_started.current = false
      rejectPrivyAccounts(new Error(String(error)))
    },
  })

  useEffect(() => {
    bridge_mounts += 1

    return () => {
      bridge_mounts = Math.max(bridge_mounts - 1, 0)
      if (bridge_mounts === 0)
        rejectPrivyAccounts(
          new Error('PrivyAccountsBridge unmounted before Privy returned accounts.'),
        )
    }
  }, [])

  useEffect(() => {
    const keys = getPublicKeys(privy.user)

    setPrivyReactState({
      authenticated: privy.authenticated,
      getAccessToken: privy.getAccessToken,
      logout: privy.logout,
      ready: privy.ready,
      userId: privy.user?.id,
      wallets: wallets.wallets.filter(isEmbeddedEthereumWallet).map((wallet) => {
        const publicKey = keys.get(normalizeAddress(wallet.address))
        return {
          address: wallet.address,
          getEthereumProvider: wallet.getEthereumProvider,
          ...(publicKey ? { publicKey } : {}),
          walletIndex: wallet.walletIndex,
        }
      }),
      walletsReady: wallets.ready,
    })
  }, [
    privy.authenticated,
    privy.getAccessToken,
    privy.logout,
    privy.ready,
    privy.user,
    wallets.ready,
    wallets.wallets,
  ])

  useEffect(() => {
    if (!request || loading.current || !privy.ready) return

    if (!privy.authenticated) {
      if (!login_started.current) {
        login_started.current = true
        login.login()
      }
      return
    }

    login_started.current = false
    if (!wallets.ready) return

    loading.current = true
    void (async () => {
      try {
        const keys = getPublicKeys(privy.user)
        const embedded = wallets.wallets.filter(isEmbeddedEthereumWallet)
        if (embedded.length === 0)
          throw new Error('Privy React returned no embedded Ethereum wallet.')

        resolvePrivyAccounts(
          await Promise.all(embedded.map(async (wallet) => await toPrivyAccount(wallet, keys))),
        )
      } catch (error) {
        rejectPrivyAccounts(error instanceof Error ? error : new Error(String(error)))
      } finally {
        loading.current = false
      }
    })()
  }, [login, privy.authenticated, privy.ready, privy.user, request, wallets.ready, wallets.wallets])

  return null
}

type PrivyReactWallet = {
  address: string
  getEthereumProvider: () => Promise<core_privy.EthereumProvider> | core_privy.EthereumProvider
  publicKey?: string | undefined
  walletIndex?: number | undefined
}

type PrivyReactState = {
  authenticated: boolean
  getAccessToken?: (() => Promise<string | null>) | undefined
  logout?: (() => Promise<void>) | undefined
  ready: boolean
  userId?: string | undefined
  wallets: readonly PrivyReactWallet[]
  walletsReady: boolean
}

type PrivyAccountsRequest = {
  reject: (error: Error) => void
  resolve: (accounts: Exclude<core_privy.AccountSelection, void>) => void
}

let request: PrivyAccountsRequest | undefined
let state: PrivyReactState = {
  authenticated: false,
  ready: false,
  wallets: [],
  walletsReady: false,
}
let bridge_mounts = 0
const listeners = new Set<() => void>()
const ready_listeners = new Set<() => void>()
const wallets_ready_listeners = new Set<() => void>()

const client = {
  auth: {
    async logout() {
      await state.logout?.()
    },
  },
  embeddedWallet: {
    async getEthereumProvider(parameters: {
      entropyId: string
      entropyIdVerifier: string
      wallet: core_privy.LinkedAccount
    }) {
      await waitForWallets()

      const address = parameters.wallet.address
      if (!address) throw new Error('Privy React wallet address is required.')

      const wallet = state.wallets.find((wallet) => sameAddress(wallet.address, address))
      if (!wallet) throw new Error(`Privy React wallet "${address}" is no longer connected.`)

      return await wallet.getEthereumProvider()
    },
  },
  async getAccessToken() {
    await waitForReady()
    if (!state.authenticated) return null
    return (await state.getAccessToken?.()) ?? null
  },
  initialize() {},
  user: {
    async get() {
      await waitForWallets()
      if (!state.authenticated) throw new Error('Privy React user is not authenticated.')

      return {
        user: {
          id: state.userId ?? 'privy-react-user',
          linked_accounts: state.wallets.map((wallet, index) => ({
            address: wallet.address,
            chain_type: 'ethereum',
            connector_type: 'embedded',
            ...(wallet.publicKey ? { public_key: wallet.publicKey } : {}),
            type: 'wallet',
            wallet_client_type: 'privy',
            wallet_index: wallet.walletIndex ?? index,
          })),
        },
      }
    },
  },
} satisfies core_privy.Client

function setPrivyReactState(next: PrivyReactState) {
  state = next
  if (next.ready) emitReady()
  if (next.ready && next.walletsReady) emitWalletsReady()
}

function usePrivyAccountsRequest() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function requestPrivyAccounts() {
  if (bridge_mounts === 0) throw createMissingBridgeError()
  if (request) request.reject(new Error('Another Privy React request is already active.'))

  return new Promise<Exclude<core_privy.AccountSelection, void>>((resolve, reject) => {
    request = { reject, resolve }
    emit()
  })
}

function resolvePrivyAccounts(accounts: Exclude<core_privy.AccountSelection, void>) {
  request?.resolve(accounts)
  request = undefined
  emit()
}

function rejectPrivyAccounts(error: Error) {
  request?.reject(error)
  request = undefined
  emit()
}

async function toPrivyAccount(
  wallet: ConnectedWallet,
  keys: Map<string, string>,
): Promise<core_privy.Account> {
  const publicKey = keys.get(normalizeAddress(wallet.address))
  const account = await toViemAccount({ wallet })
  return {
    ...account,
    ...(account.publicKey || publicKey ? { publicKey: account.publicKey ?? publicKey } : {}),
  }
}

function emit() {
  for (const listener of listeners) listener()
}

function emitReady() {
  for (const listener of ready_listeners) listener()
  ready_listeners.clear()
}

function emitWalletsReady() {
  for (const listener of wallets_ready_listeners) listener()
  wallets_ready_listeners.clear()
}

function createMissingBridgeError() {
  return new Error('PrivyAccountsBridge must be mounted under PrivyProvider to use privy().')
}

function getPublicKeys(user: User | null | undefined) {
  return new Map(
    (user?.linkedAccounts ?? [])
      .filter(isEmbeddedEthereumLinkedAccount)
      .map((account) => [normalizeAddress(account.address), account.publicKey]),
  )
}

function getSnapshot() {
  return request
}

function isEmbeddedEthereumWallet(wallet: ConnectedWallet) {
  return wallet.type === 'ethereum' && wallet.walletClientType === 'privy'
}

function isEmbeddedEthereumLinkedAccount(
  account: User['linkedAccounts'][number],
): account is Extract<User['linkedAccounts'][number], { type: 'wallet' }> & { publicKey: string } {
  return (
    account.type === 'wallet' &&
    account.chainType === 'ethereum' &&
    account.walletClientType === 'privy' &&
    typeof account.publicKey === 'string'
  )
}

function normalizeAddress(address: string) {
  return address.toLowerCase()
}

function sameAddress(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function waitForReady() {
  if (state.ready) return Promise.resolve()
  return new Promise<void>((resolve) => ready_listeners.add(resolve))
}

async function waitForWallets() {
  await waitForReady()
  if (state.walletsReady) return
  return new Promise<void>((resolve) => wallets_ready_listeners.add(resolve))
}

export declare namespace privy {
  /** Options for {@link privy}. */
  type Options = {
    /** Data URI of the provider icon. @default Black 1×1 SVG. */
    icon?: `data:image/${string}` | undefined
    /** Display name of the provider. @default "Privy" */
    name?: string | undefined
    /** Reverse DNS identifier. @default "io.privy" */
    rdns?: string | undefined
  }
}
