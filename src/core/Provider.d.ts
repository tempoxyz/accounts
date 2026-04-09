import { Provider as ox_Provider } from 'ox'
import type { Chain, Client as ViemClient, Transport } from 'viem'
import { tempo } from 'viem/chains'

import * as Account from './Account.js'
import type * as Adapter from './Adapter.js'
import * as Schema from './Schema.js'
import * as Storage from './Storage.js'
import * as Store from './Store.js'
export type Provider = ox_Provider.Provider<{
  schema: Schema.Ox
}> &
  ox_Provider.Emitter & {
    /** Configured chains. */
    chains: readonly [Chain, ...Chain[]]
    /** Returns a viem Account for the given address (or active account). */
    getAccount: Account.Find
    /** Returns a viem Client for the given (or current) chain ID. */
    getClient(options?: {
      chainId?: number | undefined
      feePayer?: string | undefined
    }): ViemClient<Transport, typeof tempo>
    /** Reactive state store. */
    store: Store.Store
  }
/**
 * Creates an EIP-1193 provider with a pluggable adapter.
 *
 * @example
 * ```ts
 * import { Provider } from 'accounts'
 *
 * const provider = Provider.create()
 * ```
 */
export declare function create(options?: create.Options): create.ReturnType
export declare namespace create {
  type Options = {
    /** Adapter to use for account management. @default dialog() */
    adapter?: Adapter.Adapter | undefined
    /**
     * Default access key parameters for `wallet_connect`.
     *
     * When set, `wallet_connect` will automatically authorize an access key.
     */
    authorizeAccessKey?: (() => Adapter.authorizeAccessKey.Parameters) | undefined
    /**
     * Supported chains. First chain is the default.
     * @default [tempo, tempoModerato]
     */
    chains?: readonly [Chain, ...Chain[]] | undefined
    /**
     * Fee payer URL for interacting with a service running `Handler.feePayer`
     * from `accounts/server`.
     */
    feePayerUrl?: string | undefined
    /** Enable Machine Payment Protocol (mppx) support. @default false */
    mpp?: boolean | undefined
    /** Whether to persist credentials and access keys to storage. When `false`, only account addresses are persisted. @default true */
    persistCredentials?: boolean | undefined
    /** Storage adapter for persistence. @default Storage.idb() in browser, Storage.memory() otherwise. */
    storage?: Storage.Storage | undefined
    /**
     * Use testnet.
     * @default false
     */
    testnet?: boolean | undefined
  }
  type ReturnType = Provider
}
//# sourceMappingURL=Provider.d.ts.map
