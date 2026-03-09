import { Provider as ox_Provider } from 'ox'
import { prepareTransactionRequest, sendTransaction } from 'viem/actions'

import * as Account from '../Account.js'
import type { Adapter, createAccount, loadAccounts, setup } from '../Adapter.js'

/**
 * Creates a local adapter where the app manages keys and signing in-process.
 *
 * @example
 * ```ts
 * import { local } from 'zyzz/provider'
 *
 * const adapter = local({
 *   loadAccounts: async () => ({
 *     accounts: [{ address: '0x...' }],
 *   }),
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
      async createAccount(parameters) {
        if (!createAccount)
          throw new ox_Provider.UnsupportedMethodError({
            message: '`createAccount` not configured on adapter.',
          })
        const { accounts, signature } = await createAccount(parameters)
        if (!parameters?.digest || signature) return { accounts, signature }
        const account = Account.hydrate(accounts[0]!, { sign: true })
        return { accounts, signature: await account.sign({ hash: parameters.digest }) }
      },
      async loadAccounts(parameters) {
        const { accounts, signature } = await loadAccounts(parameters)
        if (!parameters?.digest || signature) return { accounts, signature }
        const account = Account.hydrate(accounts[0]!, { sign: true })
        return { accounts, signature: await account.sign({ hash: parameters.digest }) }
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
        const prepared = await prepareTransactionRequest(client, {
          account,
          // TODO: support fee payer
          // feePayer,
          ...rest,
          type: 'tempo',
        })
        const signed = await account.signTransaction(prepared as never)
        return await client.request({
          method: 'eth_sendRawTransactionSync' as never,
          params: [signed],
        } as never)
      },
    },
  }
}

export declare namespace local {
  type Options = {
    /** Create a new account. Optional — omit for login-only flows. */
    createAccount?:
      | ((params: createAccount.Parameters) => Promise<createAccount.ReturnType>)
      | undefined
    /** Discover existing accounts (e.g. WebAuthn assertion). */
    loadAccounts: (params?: loadAccounts.Parameters | undefined) => Promise<loadAccounts.ReturnType>
    /** Data URI of the provider icon. @default Black 1×1 SVG. */
    icon?: `data:image/${string}` | undefined
    /** Display name of the provider (e.g. `"My Wallet"`). @default "Injected Wallet" */
    name?: string | undefined
    /** Reverse DNS identifier. @default `com.{lowercase name}` */
    rdns?: string | undefined
  }
}
