import type { privy } from 'accounts'
import { useSyncExternalStore } from 'react'

/** Connected Privy React wallet data needed by the adapter shim. */
export type PrivyReactWallet = {
  /** Ethereum wallet address. */
  address: string
  /** Returns an EIP-1193 provider for this wallet. */
  getEthereumProvider: () => Promise<privy.EthereumProvider> | privy.EthereumProvider
  /** Secp256k1 public key for this wallet. */
  publicKey?: string | undefined
  /** HD wallet index for embedded wallets. */
  walletIndex?: number | undefined
}

/** Latest Privy React state mirrored into the adapter's non-React surface. */
export type PrivyReactState = {
  /** Whether the Privy React SDK has an authenticated user. */
  authenticated: boolean
  /** Reads the current Privy access token. */
  getAccessToken?: (() => Promise<string | null>) | undefined
  /** Logs the current Privy user out. */
  logout?: (() => Promise<void>) | undefined
  /** Whether Privy React has finished initializing. */
  ready: boolean
  /** Current Privy user ID. */
  userId?: string | undefined
  /** Connected embedded Ethereum wallets. */
  wallets: readonly PrivyReactWallet[]
}

/** Active adapter request for a Privy React account selection. */
export type PrivyReactAccountsRequest = {
  /** Rejects the pending adapter request. */
  reject: (error: Error) => void
  /** Resolves the pending adapter request. */
  resolve: (accounts: Exclude<privy.AccountSelection, void>) => void
}

let request: PrivyReactAccountsRequest | undefined
let state: PrivyReactState = {
  authenticated: false,
  ready: false,
  wallets: [],
}
const listeners = new Set<() => void>()

const client = {
  auth: {
    async logout() {
      await state.logout?.()
    },
  },
  embeddedWallet: {
    async getEthereumProvider(parameters) {
      const address = parameters.wallet.address
      if (!address) throw new Error('Privy React wallet address is required.')

      const wallet = state.wallets.find((wallet) => sameAddress(wallet.address, address))
      if (!wallet) throw new Error(`Privy React wallet "${address}" is no longer connected.`)

      return await wallet.getEthereumProvider()
    },
  },
  async getAccessToken() {
    if (!state.ready || !state.authenticated) return null
    return (await state.getAccessToken?.()) ?? null
  },
  initialize() {},
  user: {
    async get() {
      if (!state.ready || !state.authenticated)
        throw new Error('Privy React user is not authenticated.')

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
} satisfies privy.Client

/** Returns the structural Privy client backed by `@privy-io/react-auth` hooks. */
export function getPrivyReactClient() {
  return client
}

/** Mirrors the latest Privy React hook state into the adapter client shim. */
export function setPrivyReactState(next: PrivyReactState) {
  state = next
}

/** Returns the active Privy React account request for React rendering. */
export function usePrivyReactAccountsRequest() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Requests a Privy React login and materialized viem account selection. */
export function requestPrivyReactAccounts() {
  if (request) request.reject(new Error('Another Privy React request is already active.'))

  return new Promise<Exclude<privy.AccountSelection, void>>((resolve, reject) => {
    request = { reject, resolve }
    emit()
  })
}

/** Resolve and clear the active Privy React account request. */
export function resolvePrivyReactAccounts(accounts: Exclude<privy.AccountSelection, void>) {
  request?.resolve(accounts)
  request = undefined
  emit()
}

/** Reject and clear the active Privy React account request. */
export function rejectPrivyReactAccounts(error: Error) {
  request?.reject(error)
  request = undefined
  emit()
}

function emit() {
  for (const listener of listeners) listener()
}

function getSnapshot() {
  return request
}

function sameAddress(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
