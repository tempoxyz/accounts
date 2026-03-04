import type { Address } from 'viem/accounts'

import type { Adapter } from '../Adapter.js'
import type * as Store from '../Store.js'

/**
 * Creates a local adapter where the app manages keys and signing in-process.
 *
 * @example
 * ```ts
 * import { local } from 'zyzz/provider'
 * import { Account } from 'viem/tempo'
 *
 * const account = Account.fromSecp256k1(privateKey)
 *
 * const adapter = local({
 *   loadAccounts: async () => [account],
 * })
 * ```
 */
export function local(options: local.Options): Adapter {
  const { createAccount, loadAccounts } = options

  let store: Store.Store

  return {
    setup(params) {
      store = params.store
      return undefined
    },
    actions: {
      async createAccount() {
        if (!createAccount) throw new Error('`createAccount` not configured on adapter.')
        const accounts = await createAccount()
        store.setState({ accounts, activeAccount: 0, status: 'connected' })
        return accounts
      },
      async disconnect() {
        store.setState({ accounts: [], activeAccount: 0, status: 'disconnected' })
      },
      async loadAccounts() {
        const accounts = await loadAccounts()
        store.setState({ accounts, activeAccount: 0, status: 'connected' })
        return accounts
      },
      async switchChain({ chainId }) {
        store.setState({ chainId })
      },
    },
  }
}

export declare namespace local {
  type Options = {
    /** Create a new account. Optional — omit for login-only flows. */
    createAccount?: (() => Promise<readonly { address: Address }[]>) | undefined
    /** Discover existing accounts (e.g. WebAuthn assertion). */
    loadAccounts: () => Promise<readonly { address: Address }[]>
  }
}
