import type { ConnectedWallet } from '@privy-io/react-auth'
import { usePrivy, useWallets } from '@privy-io/react-auth'
import type { privy } from 'accounts'
import { useEffect } from 'react'

/**
 * Singleton snapshot of the Privy React hook state. The accounts adapter is
 * created imperatively (outside the React tree), but `@privy-io/react-auth`
 * exposes its state only via hooks. This bridge captures the latest hook values
 * into a module-scoped object so a {@link privy.Client} shim can read them
 * without being inside a component.
 */
type PrivyReactSnapshot = {
  /** Currently connected Privy wallets (filtered to embedded Ethereum). */
  wallets: readonly ConnectedWallet[]
  /** True once Privy has finished initial hydration. */
  ready: boolean
  /** True if the user has an active Privy session. */
  authenticated: boolean
  /** Returns the Privy access token, or null if no session. */
  getAccessToken: () => Promise<string | null>
  /** Opens the Privy login modal. */
  login: () => void
  /** Logs the user out of Privy. */
  logout: () => Promise<void>
}

let snapshot: PrivyReactSnapshot | undefined
const subscribers = new Set<() => void>()

function setSnapshot(next: PrivyReactSnapshot | undefined) {
  snapshot = next
  for (const listener of subscribers) listener()
}

function snapshotOrThrow(): PrivyReactSnapshot {
  if (!snapshot)
    throw new Error(
      'Privy React bridge is not mounted. Render <PrivyReactBridge /> inside <PrivyProvider>.',
    )
  return snapshot
}

/**
 * React component that captures the latest `usePrivy()` + `useWallets()` state
 * into the module-scoped snapshot. Mount once, inside `<PrivyProvider>`.
 */
export function PrivyReactBridge() {
  const { ready, authenticated, getAccessToken, login, logout } = usePrivy()
  const { wallets } = useWallets()

  useEffect(() => {
    setSnapshot({
      // useWallets() (from the Ethereum entrypoint) returns ETH wallets only;
      // filter to embedded Privy wallets here.
      wallets: wallets.filter((w) => w.walletClientType === 'privy'),
      ready,
      authenticated,
      getAccessToken: async () => (await getAccessToken()) ?? null,
      login: () => login(),
      logout: async () => {
        await logout()
      },
    })
    return () => {
      setSnapshot(undefined)
    }
  }, [ready, authenticated, wallets, getAccessToken, login, logout])

  return null
}

/**
 * Waits for `predicate(snapshot)` to become true. Resolves with the matching
 * snapshot, or rejects after `timeoutMs`. Used by the playground's
 * `loadAccounts` callback to wait for the user to finish the Privy login modal
 * and for the embedded wallet to populate.
 */
function waitFor(
  predicate: (snapshot: PrivyReactSnapshot) => boolean,
  timeoutMs = 120_000,
): Promise<PrivyReactSnapshot> {
  return new Promise((resolve, reject) => {
    const tryNow = () => {
      if (snapshot && predicate(snapshot)) {
        cleanup()
        resolve(snapshot)
      }
    }
    const onSnapshot = () => tryNow()
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for Privy React bridge update.'))
    }, timeoutMs)
    function cleanup() {
      clearTimeout(timeout)
      subscribers.delete(onSnapshot)
    }
    subscribers.add(onSnapshot)
    tryNow()
  })
}

/**
 * Drives the Privy login modal (if not already authenticated) and waits for the
 * embedded wallet to populate. Throws if Privy is not configured or the user
 * cancels the login.
 */
export async function ensurePrivyReactLoggedIn(): Promise<readonly ConnectedWallet[]> {
  await waitFor((s) => s.ready)

  if (!snapshotOrThrow().authenticated) {
    snapshotOrThrow().login()
    await waitFor((s) => s.authenticated)
  }

  // Wait for the embedded Privy wallet to finish provisioning. With
  // `createOnLogin: 'users-without-wallets'`, this happens automatically.
  const final = await waitFor((s) => s.authenticated && s.wallets.length > 0)
  return final.wallets
}

/**
 * Returns a {@link privy.Client} shim backed by the React bridge snapshot. Safe
 * to call outside the React tree — it reads the latest values lazily on each
 * adapter call.
 */
export function getPrivyReactAdapterClient(): privy.Client {
  return {
    getAccessToken: () => snapshotOrThrow().getAccessToken(),
    loadEthereumWallets: async () => {
      const wallets = snapshotOrThrow().wallets
      return await Promise.all(
        wallets.map(async (w) => ({
          address: w.address,
          provider: (await w.getEthereumProvider()) as privy.EthereumProvider,
        })),
      )
    },
    logout: () => snapshotOrThrow().logout(),
  }
}
