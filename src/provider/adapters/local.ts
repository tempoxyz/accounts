import { Provider as ox_Provider } from 'ox'
import { prepareTransactionRequest, sendTransaction, sendTransactionSync } from 'viem/actions'

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
 *     key: { type: 'secp256k1', privateKey: '0x...' },
 *   }],
 * })
 * ```
 */
export function local(options: local.Options): Adapter {
  const { createAccount, icon, loadAccounts, name, rdns } = options

  let params: setup.Parameters

  return {
    icon,
    name,
    rdns,
    setup(params_) {
      params = params_
      return undefined
    },
    actions: {
      async createAccount({ name }) {
        if (!createAccount)
          throw new ox_Provider.UnsupportedMethodError({
            message: '`createAccount` not configured on adapter.',
          })
        const accounts = await createAccount({ name })
        params.store.setState((state) => ({
          accounts: [...state.accounts, ...accounts],
          activeAccount: state.accounts.length,
          status: 'connected',
        }))
        return accounts
      },
      async disconnect() {
        params.store.setState({ accounts: [], activeAccount: 0, status: 'disconnected' })
      },
      async loadAccounts() {
        const accounts = await loadAccounts()
        params.store.setState({ accounts: [...accounts], activeAccount: 0, status: 'connected' })
        return accounts
      },
      async signPersonalMessage({ data, address }) {
        const account = params.getAccount(address, { signable: true })
        return await account.signMessage({ message: { raw: data } })
      },
      async signTransaction(parameters) {
        const account = params.getAccount(undefined, { signable: true })
        const client = params.getClient()
        const { feePayer: _, ...rest } = parameters
        const prepared = await prepareTransactionRequest(client, {
          account,
          // TODO: support fee payer
          // feePayer,
          ...rest,
          type: 'tempo',
        })
        return await account.signTransaction(prepared as never)
      },
      async signTypedData({ data, address }) {
        const account = params.getAccount(address, { signable: true })
        const { domain, types, primaryType, message } = JSON.parse(data)
        return await account.signTypedData({ domain, types, primaryType, message })
      },
      async sendTransaction(parameters) {
        const account = params.getAccount(undefined, { signable: true })
        const client = params.getClient()
        const { feePayer: _, ...rest } = parameters
        return await sendTransaction(client, {
          account,
          // TODO: support fee payer
          // feePayer,
          ...rest,
          type: 'tempo',
        })
      },
      async sendTransactionSync(parameters) {
        const account = params.getAccount(undefined, { signable: true })
        const client = params.getClient()
        const { feePayer: _, ...rest } = parameters
        return await sendTransactionSync(client, {
          account,
          // TODO: support fee payer
          // feePayer,
          ...rest,
          type: 'tempo',
        })
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
    createAccount?: ((params: { name: string }) => Promise<readonly Store.Account[]>) | undefined
    /** Discover existing accounts (e.g. WebAuthn assertion). */
    loadAccounts: () => Promise<readonly Store.Account[]>
    /** Data URI of the provider icon. @default Black 1×1 SVG. */
    icon?: `data:image/${string}` | undefined
    /** Display name of the provider (e.g. `"My Wallet"`). @default "Injected Wallet" */
    name?: string | undefined
    /** Reverse DNS identifier. @default `com.{lowercase name}` */
    rdns?: string | undefined
  }
}
