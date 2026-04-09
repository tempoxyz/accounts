import { type Provider as ox_Provider } from 'ox'
import { type Chain, type Client, type Transport } from 'viem'
import type { tempo } from 'viem/chains'

import type * as Store from './Store.js'
/** Resolves a viem Client for a given chain ID (cached). */
export declare function fromChainId(
  chainId: number | undefined,
  options: fromChainId.Options,
): Client<Transport, typeof tempo>
export declare namespace fromChainId {
  type Options = {
    /** Supported chains. */
    chains: readonly [Chain, ...Chain[]]
    /** Fee payer service URL. When set, the transport routes fee-payer RPC calls to this URL. */
    feePayer?: string | undefined
    /** Provider instance. When set, the transport routes requests through the provider first, falling back to HTTP for unknown methods. */
    provider?: ox_Provider.Provider | undefined
    /** Reactive state store. */
    store: Store.Store
  }
}
//# sourceMappingURL=Client.d.ts.map
