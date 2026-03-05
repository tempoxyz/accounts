import { sendTransaction, sendTransactionSync } from 'viem/actions'

import type { Adapter, setup } from '../Adapter.js'
import type * as Store from '../Store.js'

/**
 * Creates a local adapter where the app manages keys and signing in-process.
 *
 * @example
 * ```ts
 * import { local } from 'zyzz/provider'
 *
 * const adapter = local({
 *   loadAccounts: async () => [{
 *     address: '0x...',
 *     sign: { keyType: 'secp256k1', privateKey: '0x...' },
 *   }],
 * })
 * ```
 */
export function local(options: local.Options): Adapter {
  const { createAccount, loadAccounts } = options

  let params: setup.Parameters

  return {
    setup(params_) {
      params = params_
      return undefined
    },
    actions: {
      async createAccount() {
        if (!createAccount) throw new Error('`createAccount` not configured on adapter.')
        const accounts = await createAccount()
        params.store.setState({ accounts, activeAccount: 0, status: 'connected' })
        return accounts
      },
      async disconnect() {
        params.store.setState({ accounts: [], activeAccount: 0, status: 'disconnected' })
      },
      async loadAccounts() {
        const accounts = await loadAccounts()
        params.store.setState({ accounts, activeAccount: 0, status: 'connected' })
        return accounts
      },
      async sendTransaction({ calls, to, data, gas, nonce, maxFeePerGas, maxPriorityFeePerGas }) {
        const account = params.getAccount(undefined, { signable: true })
        const client = params.getClient()
        return await sendTransaction(client, {
          account,
          calls: calls ?? [{ to, data }],
          gas,
          nonce,
          maxFeePerGas,
          maxPriorityFeePerGas,
        })
      },
      async sendTransactionSync({ calls, to, data, gas, nonce, maxFeePerGas, maxPriorityFeePerGas }) {
        const account = params.getAccount(undefined, { signable: true })
        const client = params.getClient()
        return await sendTransactionSync(client, {
          account,
          calls: calls ?? [{ to, data }],
          gas,
          nonce,
          maxFeePerGas,
          maxPriorityFeePerGas,
        }) as never
      },
      async switchChain({ chainId }) {
        params.store.setState({ chainId })
      },
    },
  }
}

export declare namespace local {
  type Options = {
    /** Create a new account. Optional — omit for login-only flows. */
    createAccount?: (() => Promise<readonly Store.Account[]>) | undefined
    /** Discover existing accounts (e.g. WebAuthn assertion). */
    loadAccounts: () => Promise<readonly Store.Account[]>
  }
}
